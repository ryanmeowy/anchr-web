import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  apiClient,
  isAccessDeniedError,
  isUploadCleanupAllowed,
} from "./api-client.ts";

test("allows upload cleanup only for an explicit boolean true signal", () => {
  for (const status of [400, 403, 409, 422]) {
    assert.equal(
      isUploadCleanupAllowed(
        new ApiError("rejected", status, "INVALID_REQUEST", { uploadCleanupAllowed: true }),
      ),
      true,
    );
  }

  assert.equal(
    isUploadCleanupAllowed(
      new ApiError("retained", 400, "INVALID_REQUEST", { uploadCleanupAllowed: false }),
    ),
    false,
  );
  assert.equal(isUploadCleanupAllowed(new ApiError("legacy", 400, "INVALID_REQUEST")), false);
  assert.equal(isUploadCleanupAllowed(new ApiError("bad gateway", 502)), false);
  assert.equal(isUploadCleanupAllowed(new ApiError("provider unavailable", 503)), false);
  assert.equal(isUploadCleanupAllowed(new Error("network timeout")), false);
  assert.equal(isUploadCleanupAllowed({ uploadCleanupAllowed: true }), false);
});

test("keeps 403 permission detection independent from cleanup permission", () => {
  const safeRejection = new ApiError("Forbidden", 403, "AUTH_ROLE_FORBIDDEN", {
    uploadCleanupAllowed: true,
  });
  const conservativeRejection = new ApiError("Forbidden", 403, "AUTH_ROLE_FORBIDDEN");

  assert.equal(isAccessDeniedError(safeRejection), true);
  assert.equal(isUploadCleanupAllowed(safeRejection), true);
  assert.equal(isAccessDeniedError(conservativeRejection), true);
  assert.equal(isUploadCleanupAllowed(conservativeRejection), false);
});

test("copies the backend error disposition into ApiError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      code: 400,
      message: "items cannot be empty.",
      errorCode: "INVALID_REQUEST",
      traceId: "trace-102",
      errorId: "trace-102",
      retryable: false,
      requestAccepted: false,
      uploadCleanupAllowed: true,
      data: null,
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(
      apiClient.createUploadIngestionTask("kb-1", { dedupeStrategy: "SKIP", items: [] }),
      (error) => {
        assert.equal(error instanceof ApiError, true);
        assert.equal(error.status, 400);
        assert.equal(error.code, "INVALID_REQUEST");
        assert.equal(error.traceId, "trace-102");
        assert.equal(error.errorId, "trace-102");
        assert.equal(error.retryable, false);
        assert.equal(error.requestAccepted, false);
        assert.equal(error.uploadCleanupAllowed, true);
        assert.equal(isUploadCleanupAllowed(error), true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed and missing error envelopes remain cleanup-conservative", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 502 });

  try {
    await assert.rejects(
      apiClient.createUploadIngestionTask("kb-1", { dedupeStrategy: "SKIP", items: [] }),
      (error) => {
        assert.equal(error instanceof ApiError, true);
        assert.equal(error.status, 502);
        assert.equal(error.uploadCleanupAllowed, undefined);
        assert.equal(isUploadCleanupAllowed(error), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
