import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, apiClient } from "./api-client.ts";
import {
  IngestionCreatePersistenceError,
  isUncertainIngestionCreateError,
  normalizePersistedIngestionCreateRequest,
  recoverIngestionCreate,
  shouldCleanupRejectedIngestionCreate,
  submitPersistedIngestionCreate,
} from "./ingestion-create-recovery.ts";

const uploadRequest = {
  clientRequestId: "request-103",
  sourceType: "UPLOAD",
  dedupeStrategy: "SKIP",
  items: [{
    fileName: "guide.pdf",
    title: "guide.pdf",
    fileType: "PDF",
    mimeType: "application/pdf",
    sizeBytes: 12,
    objectKey: "uploads/batch/001-guide.pdf",
    fileHash: "abc123",
  }],
};

const task = {
  taskId: "task-103",
  kbId: "kb-1",
  sourceType: "UPLOAD",
  status: "PENDING",
  totalCount: 1,
  successCount: 0,
  failureCount: 0,
  runningCount: 1,
};

test("uses the client request lookup result without replaying create", async () => {
  let creates = 0;
  const result = await recoverIngestionCreate({
    findByClientRequestId: async () => task,
    create: async () => {
      creates += 1;
      return task;
    },
  }, "kb-1", uploadRequest);

  assert.equal(result.state, "resolved");
  assert.equal(result.source, "lookup");
  assert.equal(creates, 0);
});

test("replays the exact persisted request only after the dedicated lookup reports task-not-found", async () => {
  let replayedRequest;
  const result = await recoverIngestionCreate({
    findByClientRequestId: async () => {
      throw new ApiError("not found", 404, "INGESTION_TASK_NOT_FOUND", { requestAccepted: false });
    },
    create: async (_kbId, request) => {
      replayedRequest = request;
      return task;
    },
  }, "kb-1", uploadRequest);

  assert.equal(result.state, "resolved");
  assert.equal(result.source, "create");
  assert.strictEqual(replayedRequest, uploadRequest);
});

test("does not replay when a 404 is not the dedicated task-not-found contract", async () => {
  let creates = 0;
  const result = await recoverIngestionCreate({
    findByClientRequestId: async () => {
      throw new ApiError("route unavailable", 404, "NOT_FOUND", {
        requestAccepted: false,
        uploadCleanupAllowed: true,
      });
    },
    create: async () => {
      creates += 1;
      return task;
    },
  }, "kb-1", uploadRequest);

  assert.equal(result.state, "confirming");
  assert.equal(creates, 0);
});

test("never treats lookup disposition metadata as the historical create outcome", async () => {
  let creates = 0;
  const result = await recoverIngestionCreate({
    findByClientRequestId: async () => {
      throw new ApiError("forbidden lookup", 401, "AUTH_REQUIRED", {
        requestAccepted: false,
        uploadCleanupAllowed: true,
      });
    },
    create: async () => {
      creates += 1;
      return task;
    },
  }, "kb-1", uploadRequest);

  assert.equal(result.state, "confirming");
  assert.equal(creates, 0);
});

test("keeps network and ambiguous HTTP errors confirming", async () => {
  for (const error of [
    new TypeError("network disconnected"),
    new ApiError("gateway timeout", 504),
    new ApiError("ambiguous conflict", 409),
    new ApiError("rate limited", 429),
  ]) {
    assert.equal(isUncertainIngestionCreateError(error), true);
  }

  assert.equal(isUncertainIngestionCreateError(
    new ApiError("rejected", 400, "INVALID_REQUEST", { requestAccepted: false }),
  ), false);
  assert.equal(isUncertainIngestionCreateError(
    new ApiError("conflict", 409, "IDEMPOTENCY_KEY_REUSED"),
  ), false);
  assert.equal(shouldCleanupRejectedIngestionCreate(
    new ApiError("rejected", 400, "INVALID_REQUEST", { uploadCleanupAllowed: true }),
  ), true);
  assert.equal(shouldCleanupRejectedIngestionCreate(
    new ApiError("conflict", 409, "IDEMPOTENCY_KEY_REUSED", { uploadCleanupAllowed: true }),
  ), false);
  assert.equal(shouldCleanupRejectedIngestionCreate(
    new ApiError("malformed conflict", 500, "IDEMPOTENCY_KEY_REUSED", { uploadCleanupAllowed: true }),
  ), false);
  assert.equal(isUncertainIngestionCreateError(
    new ApiError("malformed conflict", 500, "IDEMPOTENCY_KEY_REUSED", { uploadCleanupAllowed: true }),
  ), false);
});

test("keeps confirming when replay has an uncertain result and stops on idempotency conflict", async () => {
  const lookup = async () => {
    throw new ApiError("not found", 404, "INGESTION_TASK_NOT_FOUND", { requestAccepted: false });
  };
  const uncertain = await recoverIngestionCreate({
    findByClientRequestId: lookup,
    create: async () => {
      throw new ApiError("provider unavailable", 503);
    },
  }, "kb-1", uploadRequest);
  const conflict = await recoverIngestionCreate({
    findByClientRequestId: lookup,
    create: async () => {
      throw new ApiError("key reused", 409, "IDEMPOTENCY_KEY_REUSED");
    },
  }, "kb-1", uploadRequest);

  assert.equal(uncertain.state, "confirming");
  assert.equal(conflict.state, "failed");
});

test("keeps corrupted lookup and replay responses confirming", async () => {
  let creates = 0;
  const corruptedLookup = await recoverIngestionCreate({
    findByClientRequestId: async () => ({}),
    create: async () => {
      creates += 1;
      return task;
    },
  }, "kb-1", uploadRequest);
  const corruptedReplay = await recoverIngestionCreate({
    findByClientRequestId: async () => {
      throw new ApiError("not found", 404, "INGESTION_TASK_NOT_FOUND");
    },
    create: async () => null,
  }, "kb-1", uploadRequest);

  assert.equal(corruptedLookup.state, "confirming");
  assert.equal(corruptedReplay.state, "confirming");
  assert.equal(creates, 0);
});

test("restores only the whitelisted create payload and never persists credentials", () => {
  const restored = normalizePersistedIngestionCreateRequest({
    ...uploadRequest,
    securityToken: "must-not-survive",
    items: [{
      ...uploadRequest.items[0],
      accessKeySecret: "must-not-survive",
    }],
  });

  assert.deepEqual(restored, uploadRequest);
  assert.equal("securityToken" in restored, false);
  assert.equal("accessKeySecret" in restored.items[0], false);
  assert.equal(normalizePersistedIngestionCreateRequest({
    ...uploadRequest,
    items: [{ ...uploadRequest.items[0], objectKey: "" }],
  }), null);
  assert.equal(normalizePersistedIngestionCreateRequest({
    ...uploadRequest,
    clientRequestId: "invalid/request",
  }), null);
  assert.equal(normalizePersistedIngestionCreateRequest({
    ...uploadRequest,
    clientRequestId: "x".repeat(129),
  }), null);
});

test("API sends clientRequestId in create body and path-encodes recovery identity", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({ code: 200, message: "ok", data: task }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await apiClient.createIngestionTask("kb /1", uploadRequest);
    await apiClient.getIngestionTaskByClientRequestId("kb /1", "request/with ?");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls[0].input, "/backend/api/v1/kbs/kb%20%2F1/ingestion-tasks");
  assert.deepEqual(JSON.parse(calls[0].init.body), uploadRequest);
  assert.equal(
    calls[1].input,
    "/backend/api/v1/kbs/kb%20%2F1/ingestion-tasks/by-client-request/request%2Fwith%20%3F",
  );
  assert.equal(calls[1].init.cache, "no-store");
});

test("API rejects a successful envelope with a missing ingestion task snapshot", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 200,
    message: "ok",
    data: null,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    await assert.rejects(
      apiClient.createIngestionTask("kb-1", uploadRequest),
      /ingestion task response is incomplete/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("never submits without durable recovery state and cleans uploaded objects first", async () => {
  let submits = 0;
  let cleanups = 0;

  await assert.rejects(
    submitPersistedIngestionCreate(
      () => false,
      async () => {
        submits += 1;
        return task;
      },
      async () => {
        cleanups += 1;
      },
    ),
    IngestionCreatePersistenceError,
  );

  assert.equal(cleanups, 1);
  assert.equal(submits, 0);

  const submitted = await submitPersistedIngestionCreate(
    () => true,
    async () => {
      submits += 1;
      return task;
    },
  );
  assert.strictEqual(submitted, task);
  assert.equal(submits, 1);
});
