import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_RECOVERABLE_AGENT_TASK_KEY,
  MAX_INITIAL_RECOVERY_ATTEMPTS,
  recoverableAgentTaskKey,
  shouldDiscoverRecoverableAgentRuns,
} from "./background-task-recovery.ts";

test("runs discovery once after task state hydration", () => {
  assert.equal(shouldDiscoverRecoverableAgentRuns(false, 0, EMPTY_RECOVERABLE_AGENT_TASK_KEY), true);
});

test("bounds retries when initial recovery discovery remains unavailable", () => {
  assert.equal(shouldDiscoverRecoverableAgentRuns(
    false,
    MAX_INITIAL_RECOVERY_ATTEMPTS,
    EMPTY_RECOVERABLE_AGENT_TASK_KEY,
  ), false);
});

test("stops discovery when agent tasks are terminal or already bound to a run", () => {
  const key = recoverableAgentTaskKey([
    { id: "completed", kind: "agent", status: "success", runId: "run-1" },
    { id: "bound", kind: "agent", status: "running", runId: "run-2" },
    { id: "import", kind: "import", status: "running" },
  ]);

  assert.equal(key, EMPTY_RECOVERABLE_AGENT_TASK_KEY);
  assert.equal(shouldDiscoverRecoverableAgentRuns(true, 1, key), false);
});

test("continues discovery only for running agent placeholders without a run id", () => {
  const key = recoverableAgentTaskKey([
    { id: "placeholder-b", kind: "agent", status: "running" },
    { id: "bound", kind: "agent", status: "running", runId: "run-2" },
    { id: "placeholder-a", kind: "agent", status: "running" },
  ]);

  assert.equal(key, '["placeholder-a","placeholder-b"]');
  assert.equal(shouldDiscoverRecoverableAgentRuns(true, MAX_INITIAL_RECOVERY_ATTEMPTS, key), true);
});
