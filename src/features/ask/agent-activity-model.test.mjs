import assert from "node:assert/strict";
import test from "node:test";

import {
  agentActivityStepKey,
  hasNewAgentActivityStep,
  mergeAgentActivityStep,
  mergeAgentRunActivity,
  mergeAgentActivitySteps,
  mergeAgentTaskProgressStep,
  resolveAgentActivityHandoff,
} from "./agent-activity-model.ts";

function taskStep(overrides = {}) {
  return {
    stepOrder: 101,
    type: "TASK_STAGE",
    taskStage: "READING",
    status: "RUNNING",
    attempt: 1,
    progress: 20,
    ...overrides,
  };
}

test("keeps a task-stage key stable when the persisted event replaces a temporary event", () => {
  const temporary = taskStep({ stepOrder: 7 });
  const persisted = taskStep({ stepOrder: 101, callId: "late-call-id" });

  assert.equal(agentActivityStepKey(temporary), agentActivityStepKey(persisted));
});

test("keeps progress and terminal status monotonic when a stale snapshot arrives", () => {
  const completed = taskStep({ status: "COMPLETED", progress: 100, durationMs: 4200 });
  const stale = taskStep({ status: "RUNNING", progress: 35, durationMs: 1200 });
  const merged = mergeAgentActivityStep(completed, stale);

  assert.equal(merged.status, "COMPLETED");
  assert.equal(merged.progress, 100);
  assert.equal(merged.durationMs, 4200);
});

test("deduplicates persisted and live updates for the same task stage", () => {
  const persisted = taskStep({ progress: 45, createdAt: 2000 });
  const live = taskStep({ stepOrder: 7, progress: 60, createdAt: 3000 });
  const merged = mergeAgentActivitySteps([persisted], [live]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].progress, 60);
  assert.equal(merged[0].stepOrder, 101);
  assert.equal(merged[0].createdAt, 2000);
});

test("updates an existing task stage without changing its visual identity", () => {
  const existing = taskStep({ progress: 30 });
  const updated = mergeAgentTaskProgressStep([existing], {
    taskId: "task-1",
    type: "DOCUMENT_SUMMARY",
    status: "RUNNING",
    progress: 65,
    currentStage: "READING",
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].progress, 65);
  assert.equal(agentActivityStepKey(updated[0]), agentActivityStepKey(existing));
});

test("keeps retries on the backend-owned task stage node", () => {
  const firstAttempt = taskStep({ attempt: 1 });
  const retry = taskStep({ attempt: 2 });

  assert.equal(agentActivityStepKey(firstAttempt), agentActivityStepKey(retry));
});

test("allows a newer task attempt to restart progress without remounting", () => {
  const firstAttempt = taskStep({ attempt: 1, status: "COMPLETED", progress: 100 });
  const retry = taskStep({ attempt: 2, status: "RUNNING", progress: 15 });
  const merged = mergeAgentActivityStep(firstAttempt, retry);

  assert.equal(agentActivityStepKey(firstAttempt), agentActivityStepKey(merged));
  assert.equal(merged.status, "RUNNING");
  assert.equal(merged.progress, 15);
  assert.equal(merged.attempt, 2);
});

test("ignores a stale task attempt after a retry has started", () => {
  const retry = taskStep({ attempt: 2, status: "RUNNING", progress: 40 });
  const staleCompletion = taskStep({ attempt: 1, status: "COMPLETED", progress: 100 });
  const merged = mergeAgentActivityStep(retry, staleCompletion);

  assert.equal(merged, retry);
  assert.equal(merged.status, "RUNNING");
  assert.equal(merged.progress, 40);
});

test("uses normalized type and trace order for transient and persisted tool identity", () => {
  const started = {
    stepOrder: 8,
    type: "TOOL",
    status: "RUNNING",
    callId: "temporary-call-id",
    attempt: 4,
  };
  const persisted = {
    ...started,
    status: "COMPLETED",
    callId: "persisted-call-id",
    attempt: 1,
  };

  assert.equal(agentActivityStepKey(started), agentActivityStepKey(persisted));
  assert.notEqual(
    agentActivityStepKey(started),
    agentActivityStepKey({ ...started, type: "TASK_STAGE", taskStage: "QUEUED" }),
  );
});

test("retains nodes omitted by a later partial source update", () => {
  const decision = {
    stepOrder: 1,
    type: "MODEL_DECISION",
    status: "COMPLETED",
    attempt: 1,
  };
  const toolRunning = {
    stepOrder: 2,
    type: "TOOL",
    status: "RUNNING",
    callId: "tool-1",
  };
  const toolCompleted = { ...toolRunning, status: "COMPLETED", durationMs: 900 };
  const merged = mergeAgentActivitySteps([decision, toolRunning], [toolCompleted]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].type, "MODEL_DECISION");
  assert.equal(merged[1].status, "COMPLETED");
});

test("preserves the runtime activity during persisted-query handoff", () => {
  const runtime = {
    runId: "run-1",
    status: "COMPLETED",
    stepCount: 1,
    toolCallCount: 0,
    steps: [taskStep({ status: "COMPLETED", progress: 100 })],
  };

  assert.equal(resolveAgentActivityHandoff(undefined, runtime), runtime);
  assert.equal(resolveAgentActivityHandoff(runtime, undefined), runtime);
  assert.equal(resolveAgentActivityHandoff({ ...runtime, status: "RUNNING" }, runtime, true), runtime);
});

test("merges runtime snapshots cumulatively without regressing totals", () => {
  const first = {
    runId: "run-1",
    status: "RUNNING",
    stepCount: 1,
    toolCallCount: 1,
    promptTokens: 120,
    completionTokens: 30,
    latencyMs: 900,
    steps: [taskStep({ progress: 70 })],
  };
  const stalePartial = {
    ...first,
    stepCount: 0,
    toolCallCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: 300,
    steps: [],
  };
  const merged = mergeAgentRunActivity(first, stalePartial);

  assert.equal(merged.stepCount, 1);
  assert.equal(merged.toolCallCount, 1);
  assert.equal(merged.promptTokens, 120);
  assert.equal(merged.completionTokens, 30);
  assert.equal(merged.latencyMs, 900);
  assert.equal(merged.steps.length, 1);
});

test("auto-follow reacts only to a genuinely new node", () => {
  assert.equal(hasNewAgentActivityStep(["one", "two"], ["one", "two"]), false);
  assert.equal(hasNewAgentActivityStep(["one", "two"], ["two", "one"]), false);
  assert.equal(hasNewAgentActivityStep(["one", "two"], ["one", "two", "three"]), true);
});
