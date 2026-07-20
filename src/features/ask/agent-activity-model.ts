import type {
  AgentActivityStatus,
  AgentActivityStep,
  AgentRunActivity,
  AgentTask,
} from "../../lib/types";

const terminalStepStatuses = new Set<AgentActivityStep["status"]>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

const terminalActivityStatuses = new Set<AgentActivityStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "AGENT_DEGRADED",
  "AGENT_FALLBACK",
]);

export function agentActivityStepKey(step: AgentActivityStep) {
  if (step.type === "TASK_STAGE") {
    // Task stages are upserted by stage order in the backend. Retries update the
    // same visual node, so attempt/callId must never participate in React identity.
    return `TASK_STAGE:${step.taskStage ?? step.stepOrder}`;
  }
  // This mirrors AgentRuntimeSnapshotService: persisted and transient steps are
  // reconciled by normalized type + trace order.
  return `${step.type}:${step.stepOrder}`;
}

export function compareAgentActivitySteps(a: AgentActivityStep, b: AgentActivityStep) {
  return a.stepOrder - b.stepOrder || (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

function maximumDefined(base?: number | null, update?: number | null) {
  if (base == null) return update;
  if (update == null) return base;
  return Math.max(base, update);
}

function earliestDefined(base?: number | null, update?: number | null) {
  if (base == null) return update;
  if (update == null) return base;
  return Math.min(base, update);
}

function monotonicStatus(
  base: AgentActivityStep["status"],
  update: AgentActivityStep["status"],
) {
  if (terminalStepStatuses.has(base)) return base;
  return update;
}

export function mergeAgentActivityStep(
  base: AgentActivityStep,
  update: AgentActivityStep,
): AgentActivityStep {
  const staleTaskAttempt = base.type === "TASK_STAGE"
    && update.type === "TASK_STAGE"
    && (update.attempt ?? 1) < (base.attempt ?? 1);
  if (staleTaskAttempt) return base;
  const taskRetry = base.type === "TASK_STAGE"
    && update.type === "TASK_STAGE"
    && (update.attempt ?? 1) > (base.attempt ?? 1);
  const defined = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<AgentActivityStep>;
  return {
    ...base,
    ...defined,
    status: taskRetry ? update.status : monotonicStatus(base.status, update.status),
    stepOrder: Math.max(base.stepOrder, update.stepOrder),
    progress: taskRetry ? update.progress : maximumDefined(base.progress, update.progress),
    durationMs: taskRetry ? update.durationMs : maximumDefined(base.durationMs, update.durationMs),
    promptTokens: maximumDefined(base.promptTokens, update.promptTokens),
    completionTokens: maximumDefined(base.completionTokens, update.completionTokens),
    messageCount: maximumDefined(base.messageCount, update.messageCount),
    plannedToolCallCount: maximumDefined(base.plannedToolCallCount, update.plannedToolCallCount),
    evidenceCount: maximumDefined(base.evidenceCount, update.evidenceCount),
    documentCount: maximumDefined(base.documentCount, update.documentCount),
    segmentCount: maximumDefined(base.segmentCount, update.segmentCount),
    batchCount: maximumDefined(base.batchCount, update.batchCount),
    citationCount: maximumDefined(base.citationCount, update.citationCount),
    modelCallCount: maximumDefined(base.modelCallCount, update.modelCallCount),
    modelLatencyMs: maximumDefined(base.modelLatencyMs, update.modelLatencyMs),
    firstTokenMs: earliestDefined(base.firstTokenMs, update.firstTokenMs),
    createdAt: taskRetry ? update.createdAt ?? base.createdAt : earliestDefined(base.createdAt, update.createdAt),
  };
}

function hasValidAgentStepOrder(step: AgentActivityStep) {
  return Number.isFinite(step.stepOrder) && step.stepOrder > 0;
}

export function mergeAgentActivitySteps(
  persisted: AgentActivityStep[],
  live: AgentActivityStep[],
) {
  const merged = new Map<string, AgentActivityStep>();
  persisted.filter(hasValidAgentStepOrder).forEach((step) => {
    merged.set(agentActivityStepKey(step), step);
  });
  live.filter(hasValidAgentStepOrder).forEach((step) => {
    const key = agentActivityStepKey(step);
    const stored = merged.get(key);
    merged.set(key, stored ? mergeAgentActivityStep(stored, step) : step);
  });
  return Array.from(merged.values())
    .sort(compareAgentActivitySteps)
    .slice(-50);
}

function monotonicActivityStatus(
  base: AgentActivityStatus,
  update: AgentActivityStatus,
) {
  if (terminalActivityStatuses.has(base)) return base;
  return update;
}

export function mergeAgentRunActivity(
  base: AgentRunActivity | undefined,
  update: AgentRunActivity,
  steps = mergeAgentActivitySteps(base?.steps ?? [], update.steps ?? []),
): AgentRunActivity {
  if (!base || base.runId !== update.runId) return { ...update, steps };
  return {
    ...base,
    ...update,
    status: monotonicActivityStatus(base.status, update.status),
    stepCount: Math.max(base.stepCount, update.stepCount, steps.length),
    toolCallCount: Math.max(base.toolCallCount, update.toolCallCount),
    promptTokens: maximumDefined(base.promptTokens, update.promptTokens),
    completionTokens: maximumDefined(base.completionTokens, update.completionTokens),
    latencyMs: maximumDefined(base.latencyMs, update.latencyMs),
    startedAt: earliestDefined(base.startedAt, update.startedAt),
    finishedAt: update.finishedAt ?? base.finishedAt,
    steps,
  };
}

export function resolveAgentActivityHandoff(
  persisted: AgentRunActivity | undefined,
  runtime: AgentRunActivity | undefined,
  preferRuntime = false,
) {
  return preferRuntime ? runtime ?? persisted : persisted ?? runtime;
}

export function mergeAgentTaskProgressStep(
  steps: AgentActivityStep[],
  task?: AgentTask,
) {
  if (!task) return steps;
  const taskStage = task.currentStage || (task.status === "PENDING" ? "QUEUED" : undefined);
  if (!taskStage) return steps;
  const status: AgentActivityStep["status"] = task.status === "FAILED"
    ? "FAILED"
    : task.status === "CANCELLED" ? "CANCELLED" : task.status === "SUCCEEDED" ? "COMPLETED" : "RUNNING";
  const index = steps.findIndex((step) => step.type === "TASK_STAGE" && step.taskStage === taskStage);
  if (index >= 0) {
    const next = [...steps];
    next[index] = mergeAgentActivityStep(next[index], {
      ...next[index],
      progress: task.progress,
      status,
    });
    return next;
  }
  return [...steps, {
    stepOrder: Math.max(0, ...steps.map((step) => step.stepOrder)) + 1,
    type: "TASK_STAGE",
    taskStage,
    status,
    progress: task.progress,
    attempt: 1,
  }];
}

export function equalAgentActivityStep(a: AgentActivityStep, b: AgentActivityStep) {
  const aEntries = Object.entries(a);
  const bKeys = Object.keys(b);
  return aEntries.length === bKeys.length
    && aEntries.every(([key, value]) => Object.is(value, b[key as keyof AgentActivityStep]));
}

export function hasNewAgentActivityStep(previousKeys: string[], nextKeys: string[]) {
  const previous = new Set(previousKeys);
  return nextKeys.some((key) => !previous.has(key));
}
