export const EMPTY_RECOVERABLE_AGENT_TASK_KEY = "[]";
export const MAX_INITIAL_RECOVERY_ATTEMPTS = 3;

type RecoverableDiscoveryTask = {
  id: string;
  kind: "agent" | "import";
  status: string;
  runId?: string;
};

export function recoverableAgentTaskKey(tasks: readonly RecoverableDiscoveryTask[]) {
  return JSON.stringify(tasks
    .filter((task) => task.kind === "agent" && task.status === "running" && !task.runId)
    .map((task) => task.id)
    .sort((left, right) => left.localeCompare(right)));
}

export function shouldDiscoverRecoverableAgentRuns(
  initialDiscoveryComplete: boolean,
  initialDiscoveryAttempts: number,
  unresolvedTaskKey: string,
) {
  return unresolvedTaskKey !== EMPTY_RECOVERABLE_AGENT_TASK_KEY
    || (!initialDiscoveryComplete && initialDiscoveryAttempts < MAX_INITIAL_RECOVERY_ATTEMPTS);
}
