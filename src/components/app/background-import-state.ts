import type { IngestionCreateRequest } from "../../lib/types";

type RetainedBackgroundTask = {
  id: string;
  status: string;
  navigationPending?: boolean;
  dismissed?: boolean;
  startedAt: number;
  finishedAt?: number;
};

type PendingImportLease = {
  status: string;
  taskId?: string;
  currentStage?: string;
  ownerLeaseExpiresAt?: number;
};

export type PendingImportTaskSnapshot = {
  id: string;
  clientRequestId: string;
  kbId: string;
  label: string;
  totalCount: number;
  startedAt: number;
  ownerLeaseExpiresAt: number;
};

export type PreparedImportTaskState = PendingImportTaskSnapshot & {
  kind: "import";
  taskId?: string;
  createRequest?: IngestionCreateRequest;
  status: "running" | "success" | "error" | "cancelled";
  successCount: number;
  failureCount: number;
  runningCount: number;
  progress: number;
  uploadedCount?: number;
  currentStage?: string;
  confirmationNotBefore?: number;
  navigationPending?: boolean;
  failureMessage?: string;
  updatedAt: number;
  finishedAt?: number;
  dismissed?: boolean;
};

type ExistingImportTaskState = Omit<PreparedImportTaskState, "clientRequestId" | "ownerLeaseExpiresAt">
  & Partial<Pick<PreparedImportTaskState, "clientRequestId" | "ownerLeaseExpiresAt">>;

type ImportCreateNavigationTask = {
  id: string;
  kind: "import";
  kbId: string;
  status: string;
  taskId?: string;
  navigationPending?: boolean;
  startedAt: number;
};

type MergeableBackgroundTask = {
  id: string;
  kind: string;
  status: string;
  taskId?: string;
  currentStage?: string;
  navigationPending?: boolean;
  updatedAt: number;
};

export function retainStoredBackgroundTasks<T extends RetainedBackgroundTask>(
  tasks: T[],
  maxStoredTasks: number,
  completedRetentionMs: number,
  now = Date.now(),
) {
  const cutoff = now - completedRetentionMs;
  const retained = tasks.filter((task) => task.navigationPending === true
    || task.status === "running"
    || !task.dismissed
    || (task.finishedAt ?? task.startedAt) >= cutoff);
  const protectedTasks = retained
    .filter((task) => task.status === "running" || task.navigationPending === true)
    .sort(compareRetainedTask);
  const terminal = retained
    .filter((task) => task.status !== "running" && task.navigationPending !== true)
    .sort(compareRetainedTask)
    .slice(0, Math.max(0, maxStoredTasks - protectedTasks.length));
  return [...protectedTasks, ...terminal];
}

export function restoredImportStage(task: PendingImportLease, now = Date.now()) {
  if (task.status !== "running"
    || task.taskId
    || task.currentStage !== "SUBMITTING"
    || !ownerLeaseExpired(task.ownerLeaseExpiresAt, now)) {
    return task.currentStage;
  }
  return "CONFIRMING";
}

export function shouldInterruptImportUpload(task: PendingImportLease, now = Date.now()) {
  return task.status === "running"
    && !task.taskId
    && task.currentStage === "UPLOADING"
    && ownerLeaseExpired(task.ownerLeaseExpiresAt, now);
}

export function preparedImportCreateTask(
  existing: ExistingImportTaskState | undefined,
  pending: PendingImportTaskSnapshot,
  request: IngestionCreateRequest,
  ownerLeaseExpiresAt: number,
  now = Date.now(),
): PreparedImportTaskState {
  return {
    ...(existing ?? {
      ...pending,
      kind: "import" as const,
      status: "running",
      successCount: 0,
      failureCount: 0,
      runningCount: pending.totalCount,
      progress: 0,
      uploadedCount: 0,
      updatedAt: now,
      dismissed: false,
    }),
    ...pending,
    clientRequestId: request.clientRequestId,
    createRequest: request,
    status: "running",
    currentStage: "SUBMITTING",
    confirmationNotBefore: ownerLeaseExpiresAt,
    ownerLeaseExpiresAt,
    navigationPending: false,
    failureMessage: undefined,
    finishedAt: undefined,
    updatedAt: now,
  };
}

export function rejectedImportCreateTask(
  existing: ExistingImportTaskState | undefined,
  pending: PendingImportTaskSnapshot,
  failureMessage: string,
  now = Date.now(),
): PreparedImportTaskState {
  return {
    ...(existing ?? {
      ...pending,
      kind: "import" as const,
      status: "error",
      successCount: 0,
      failureCount: 0,
      runningCount: 0,
      progress: 0,
      uploadedCount: 0,
      updatedAt: now,
      dismissed: false,
    }),
    ...pending,
    createRequest: undefined,
    status: "error",
    runningCount: 0,
    currentStage: "CREATE_REJECTED",
    confirmationNotBefore: undefined,
    ownerLeaseExpiresAt: 0,
    navigationPending: false,
    failureMessage,
    finishedAt: now,
    updatedAt: now,
    dismissed: false,
  };
}

export function selectRecoverableImportCreate<T extends ImportCreateNavigationTask>(
  tasks: T[],
  selectedKbId?: string,
) {
  return tasks
    .filter((task) => task.kind === "import"
      && task.id.startsWith("import-create:")
      && (!selectedKbId || task.kbId === selectedKbId)
      && ((task.status === "running" && !task.taskId)
        || (task.navigationPending === true && Boolean(task.taskId))))
    .sort((left, right) => {
      const leftUnresolved = left.status === "running" && !left.taskId;
      const rightUnresolved = right.status === "running" && !right.taskId;
      if (leftUnresolved !== rightUnresolved) return rightUnresolved ? 1 : -1;
      return right.startedAt - left.startedAt;
    })[0];
}

export function shouldReplaceStoredTask(
  existing: MergeableBackgroundTask,
  incoming: MergeableBackgroundTask,
) {
  if (existing.kind === "import"
    && incoming.kind === "import"
    && existing.id.startsWith("import-create:")
    && incoming.id === existing.id) {
    if (Boolean(existing.taskId) !== Boolean(incoming.taskId)) return Boolean(incoming.taskId);
    if (existing.taskId && incoming.taskId) {
      if (existing.navigationPending === false && incoming.navigationPending === true) return false;
      if (existing.navigationPending === true && incoming.navigationPending === false) return true;
    }
    if ((existing.status === "running") !== (incoming.status === "running")) {
      const running = existing.status === "running" ? existing : incoming;
      const terminal = existing.status === "running" ? incoming : existing;
      if (!existing.taskId
        && !incoming.taskId
        && terminal.currentStage === "UPLOAD_INTERRUPTED"
        && running.currentStage === "SUBMITTING") {
        return incoming === running;
      }
      return incoming.status !== "running";
    }
  }
  return incoming.updatedAt > existing.updatedAt;
}

export function mergeStoredTaskSnapshots<T extends MergeableBackgroundTask>(
  current: T[],
  incoming: T[],
) {
  const byId = new Map(current.map((task) => [task.id, task]));
  incoming.forEach((task) => {
    const existing = byId.get(task.id);
    if (!existing || shouldReplaceStoredTask(existing, task)) byId.set(task.id, task);
  });
  return Array.from(byId.values());
}

function ownerLeaseExpired(ownerLeaseExpiresAt: number | undefined, now: number) {
  return (ownerLeaseExpiresAt ?? 0) <= now;
}

function compareRetainedTask(left: RetainedBackgroundTask, right: RetainedBackgroundTask) {
  return right.startedAt - left.startedAt || left.id.localeCompare(right.id);
}
