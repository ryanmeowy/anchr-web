import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeStoredTaskSnapshots,
  preparedImportCreateTask,
  rejectedImportCreateTask,
  restoredImportStage,
  retainStoredBackgroundTasks,
  selectRecoverableImportCreate,
  shouldInterruptImportUpload,
  shouldReplaceStoredTask,
} from "./background-import-state.ts";

test("an active owner lease prevents another tab from declaring upload interruption", () => {
  const activeUpload = {
    status: "running",
    currentStage: "UPLOADING",
    ownerLeaseExpiresAt: 20_000,
  };

  assert.equal(shouldInterruptImportUpload(activeUpload, 10_000), false);
  assert.equal(shouldInterruptImportUpload(activeUpload, 20_001), true);
});

test("refresh restores an expired submit as confirming but preserves a live owner submit", () => {
  const submitting = {
    status: "running",
    currentStage: "SUBMITTING",
    ownerLeaseExpiresAt: 20_000,
  };

  assert.equal(restoredImportStage(submitting, 10_000), "SUBMITTING");
  assert.equal(restoredImportStage(submitting, 20_001), "CONFIRMING");
});

test("storage limits never evict running, confirming, or unacknowledged navigation tasks", () => {
  const running = Array.from({ length: 24 }, (_, index) => ({
    id: `running-${index}`,
    status: "running",
    currentStage: index % 2 === 0 ? "CONFIRMING" : "UPLOADING",
    startedAt: index,
  }));
  const completed = Array.from({ length: 20 }, (_, index) => ({
    id: `completed-${index}`,
    status: "success",
    dismissed: false,
    startedAt: 1_000 + index,
    finishedAt: 1_000 + index,
  }));
  const navigationPending = {
    id: "terminal-navigation",
    status: "success",
    navigationPending: true,
    dismissed: true,
    startedAt: -20_000,
    finishedAt: -20_000,
  };

  const retained = retainStoredBackgroundTasks(
    [...running, ...completed, navigationPending],
    20,
    10_000,
    2_000,
  );

  assert.equal(retained.filter((task) => task.status === "running").length, 24);
  assert.equal(retained.filter((task) => task.status !== "running").length, 1);
  assert.equal(retained.some((task) => task.id === navigationPending.id), true);
});

test("storage retention has a canonical order when tasks start in the same millisecond", () => {
  const first = { id: "a", status: "running", startedAt: 1_000 };
  const second = { id: "b", status: "running", startedAt: 1_000 };

  assert.deepEqual(
    retainStoredBackgroundTasks([second, first], 20, 10_000, 2_000).map((task) => task.id),
    retainStoredBackgroundTasks([first, second], 20, 10_000, 2_000).map((task) => task.id),
  );
});

test("preparing create upserts a complete recoverable task when storage lost the placeholder", () => {
  const pending = {
    id: "import-create:request-103",
    clientRequestId: "request-103",
    kbId: "kb-1",
    label: "guide.pdf",
    totalCount: 1,
    startedAt: 9_000,
    ownerLeaseExpiresAt: 19_000,
  };
  const request = {
    clientRequestId: "request-103",
    sourceType: "UPLOAD",
    dedupeStrategy: "SKIP",
    items: [{ fileName: "guide.pdf", fileType: "PDF", objectKey: "uploads/guide.pdf" }],
  };

  const prepared = preparedImportCreateTask(undefined, pending, request, 20_000, 10_000);

  assert.equal(prepared.id, pending.id);
  assert.equal(prepared.kbId, pending.kbId);
  assert.equal(prepared.status, "running");
  assert.equal(prepared.currentStage, "SUBMITTING");
  assert.equal(prepared.confirmationNotBefore, 20_000);
  assert.strictEqual(prepared.createRequest, request);

  const rejected = rejectedImportCreateTask(prepared, pending, "request rejected", 11_000);
  assert.equal(rejected.status, "error");
  assert.equal(rejected.currentStage, "CREATE_REJECTED");
  assert.equal(rejected.createRequest, undefined);
  assert.equal(rejected.failureMessage, "request rejected");
});

test("terminal create remains navigable until its task route is acknowledged", () => {
  const terminal = {
    id: "import-create:terminal",
    kind: "import",
    kbId: "kb-1",
    status: "success",
    taskId: "task-all-skipped",
    navigationPending: true,
    startedAt: 10_000,
  };
  const otherKbRunning = {
    id: "import-create:other-kb",
    kind: "import",
    kbId: "kb-2",
    status: "running",
    startedAt: 20_000,
  };

  assert.equal(
    selectRecoverableImportCreate([terminal, otherKbRunning], "kb-1")?.id,
    terminal.id,
  );
  assert.equal(selectRecoverableImportCreate([otherKbRunning], "kb-1"), undefined);
  assert.equal(
    selectRecoverableImportCreate([{ ...terminal, navigationPending: false }], "kb-1"),
    undefined,
  );
  assert.equal(selectRecoverableImportCreate([{
    ...terminal,
    status: "running",
    navigationPending: false,
  }], "kb-1"), undefined);
  assert.equal(selectRecoverableImportCreate([
    terminal,
    {
      id: "import-create:unresolved",
      kind: "import",
      kbId: "kb-1",
      status: "running",
      startedAt: 1_000,
    },
  ], "kb-1")?.id, "import-create:unresolved");
});

test("a stale confirming placeholder cannot replace a resolved task id across tabs", () => {
  const resolved = {
    id: "import-create:request-103",
    kind: "import",
    status: "running",
    taskId: "task-103",
    updatedAt: 10_000,
  };
  const laterConfirming = {
    id: "import-create:request-103",
    kind: "import",
    status: "running",
    updatedAt: 20_000,
  };

  assert.equal(shouldReplaceStoredTask(resolved, laterConfirming), false);
  assert.equal(shouldReplaceStoredTask(laterConfirming, resolved), true);
  assert.equal(shouldReplaceStoredTask(
    { ...resolved, taskId: undefined, status: "error", updatedAt: 10_000 },
    { ...resolved, taskId: undefined, status: "running", updatedAt: 30_000 },
  ), false);
  assert.equal(shouldReplaceStoredTask(
    { ...resolved, status: "success", updatedAt: 10_000 },
    { ...resolved, status: "running", updatedAt: 30_000 },
  ), false);
  assert.equal(shouldReplaceStoredTask(
    { ...resolved, status: "success", navigationPending: false, updatedAt: 10_000 },
    { ...resolved, status: "success", navigationPending: true, updatedAt: 30_000 },
  ), false);
  assert.equal(shouldReplaceStoredTask(
    {
      ...resolved,
      taskId: undefined,
      status: "error",
      currentStage: "UPLOAD_INTERRUPTED",
      updatedAt: 30_000,
    },
    {
      ...resolved,
      taskId: undefined,
      status: "running",
      currentStage: "SUBMITTING",
      updatedAt: 20_000,
    },
  ), true);
});

test("an event snapshot repairs a stale whole-storage overwrite without losing resolution", () => {
  const staleConfirming = {
    id: "import-create:request-103",
    kind: "import",
    status: "running",
    currentStage: "CONFIRMING",
    updatedAt: 30_000,
  };
  const resolvedEvent = {
    ...staleConfirming,
    status: "success",
    taskId: "task-103",
    navigationPending: true,
    updatedAt: 20_000,
  };

  const stateAfterEvent = mergeStoredTaskSnapshots([staleConfirming], [resolvedEvent]);
  const repairedStorage = mergeStoredTaskSnapshots([staleConfirming], stateAfterEvent);

  assert.equal(stateAfterEvent[0]?.taskId, "task-103");
  assert.equal(repairedStorage[0]?.taskId, "task-103");
});
