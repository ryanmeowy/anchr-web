"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  Sparkles,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiClient } from "@/lib/api-client";
import {
  normalizePersistedIngestionCreateRequest,
  recoverIngestionCreate,
  shouldCleanupRejectedIngestionCreate,
} from "@/lib/ingestion-create-recovery";
import { deleteUploadedFilesFromOss } from "@/lib/ingestion-files";
import type {
  AgentRunActivity,
  AgentRunSummary,
  IngestionCreateRequest,
  IngestionTask,
  UploadIngestionItem,
} from "@/lib/types";
import {
  recoverableAgentTaskKey,
  shouldDiscoverRecoverableAgentRuns,
} from "./background-task-recovery";
import {
  mergeStoredTaskSnapshots,
  preparedImportCreateTask,
  rejectedImportCreateTask,
  restoredImportStage,
  retainStoredBackgroundTasks,
  shouldInterruptImportUpload,
  type PendingImportTaskSnapshot,
} from "./background-import-state";
import styles from "./background-task-provider.module.css";

const STORAGE_KEY_PREFIX = "anchr.background-tasks.v2";
const MAX_STORED_TASKS = 20;
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const IMPORT_CONFIRMATION_POLL_MS = 2_500;

export type BackgroundTaskStatus = "running" | "success" | "error" | "cancelled";

export type TrackedAgentTask = {
  id: string;
  kind: "agent";
  sessionId: string;
  turnId?: string;
  runId?: string;
  agentTaskId?: string;
  label: string;
  status: BackgroundTaskStatus;
  currentStage?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  dismissed?: boolean;
};

export type TrackedImportTask = {
  id: string;
  kind: "import";
  kbId: string;
  taskId?: string;
  clientRequestId?: string;
  createRequest?: IngestionCreateRequest;
  label: string;
  status: BackgroundTaskStatus;
  totalCount: number;
  successCount: number;
  failureCount: number;
  runningCount: number;
  progress: number;
  uploadedCount?: number;
  currentStage?: string;
  confirmationNotBefore?: number;
  ownerLeaseExpiresAt?: number;
  navigationPending?: boolean;
  failureMessage?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  dismissed?: boolean;
};

export type TrackedBackgroundTask = TrackedAgentTask | TrackedImportTask;

type AgentTaskPatch = Partial<Omit<TrackedAgentTask, "id" | "kind" | "sessionId" | "startedAt">>;
type ImportTaskPatch = Partial<Omit<TrackedImportTask, "id" | "kind" | "kbId" | "startedAt">>;

type BackgroundTaskContextValue = {
  tasks: TrackedBackgroundTask[];
  registerAgentTask: (task: Pick<TrackedAgentTask, "id" | "sessionId" | "label" | "startedAt">) => void;
  updateAgentTask: (id: string, patch: AgentTaskPatch) => void;
  registerImportTask: (task: IngestionTask) => void;
  registerPendingImportTask: (task: PendingImportTaskSnapshot) => void;
  prepareImportCreate: (
    task: PendingImportTaskSnapshot,
    request: IngestionCreateRequest,
    ownerLeaseExpiresAt: number,
  ) => boolean;
  rejectImportCreate: (task: PendingImportTaskSnapshot, failureMessage: string) => boolean;
  updateImportTask: (id: string, patch: ImportTaskPatch) => void;
  resolveImportTask: (id: string, task: IngestionTask) => void;
  dismissTask: (id: string) => void;
};

const BackgroundTaskContext = createContext<BackgroundTaskContextValue | null>(null);

export function BackgroundTaskProvider({
  children,
  authIdentityKey,
}: {
  children: ReactNode;
  authIdentityKey: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const storageKey = authIdentityKey === null ? null : `${STORAGE_KEY_PREFIX}.${authIdentityKey}`;
  const [tasks, setTasks] = useState<TrackedBackgroundTask[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageRepairRevision, setStorageRepairRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const activeStorageKeyRef = useRef(storageKey);
  const importRecoveryInFlightRef = useRef(new Set<string>());
  const initialRecoveryCompleteRef = useRef(false);
  const initialRecoveryAttemptsRef = useRef(0);

  useEffect(() => {
    activeStorageKeyRef.current = storageKey;
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const frame = window.requestAnimationFrame(() => {
      setTasks(readStoredTasks(storageKey));
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || !storageKey) return;
    try {
      const merged = mergeStoredTasks(readStoredTasks(storageKey), tasks);
      const serialized = JSON.stringify(trimStoredTasks(merged));
      if (window.localStorage.getItem(storageKey) !== serialized) {
        window.localStorage.setItem(storageKey, serialized);
      }
    } catch {
      // Task tracking remains available for the current tab when storage is unavailable.
    }
  }, [hydrated, storageKey, storageRepairRevision, tasks]);

  useEffect(() => {
    if (!storageKey) return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const incoming = parseStoredTasks(event.newValue);
      setTasks((previous) => mergeStoredTasks(previous, incoming));
      setStorageRepairRevision((revision) => revision + 1);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [storageKey]);

  const registerAgentTask = useCallback<BackgroundTaskContextValue["registerAgentTask"]>((task) => {
    setTasks((previous) => upsertTask(previous, {
      ...task,
      kind: "agent",
      status: "running",
      currentStage: "ANALYZING",
      updatedAt: Date.now(),
      dismissed: false,
    }));
  }, []);

  const updateAgentTask = useCallback<BackgroundTaskContextValue["updateAgentTask"]>((id, patch) => {
    setTasks((previous) => previous.map((task) => {
      if (task.kind !== "agent" || task.id !== id) return task;
      const definedPatch = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as AgentTaskPatch;
      const nextStatus = definedPatch.status ?? task.status;
      const justFinished = task.status === "running" && nextStatus !== "running";
      return {
        ...task,
        ...definedPatch,
        status: nextStatus,
        updatedAt: Date.now(),
        finishedAt: justFinished
          ? definedPatch.finishedAt ?? Date.now()
          : definedPatch.finishedAt ?? task.finishedAt,
        dismissed: justFinished ? false : definedPatch.dismissed ?? task.dismissed,
      };
    }));
  }, []);

  const registerImportTask = useCallback<BackgroundTaskContextValue["registerImportTask"]>((task) => {
    setTasks((previous) => upsertTask(previous, trackedImportTask(task)));
  }, []);

  const registerPendingImportTask = useCallback<BackgroundTaskContextValue["registerPendingImportTask"]>((task) => {
    const pending: TrackedImportTask = {
      ...task,
      kind: "import",
      status: "running",
      successCount: 0,
      failureCount: 0,
      runningCount: task.totalCount,
      progress: 0,
      uploadedCount: 0,
      currentStage: "UPLOADING",
      updatedAt: Date.now(),
      dismissed: false,
    };
    setTasks((previous) => upsertTask(previous, pending));
    persistTaskUpdate(storageKey, (stored) => upsertTask(stored, pending));
  }, [storageKey]);

  const prepareImportCreate = useCallback<BackgroundTaskContextValue["prepareImportCreate"]>((
    pending,
    request,
    ownerLeaseExpiresAt,
  ) => {
    const preparedAt = Date.now();
    const snapshot = {
      ...pending,
      ownerLeaseExpiresAt,
    };
    const applyRequest = (previous: TrackedBackgroundTask[]) => {
      const existing = previous.find((task): task is TrackedImportTask => (
        task.kind === "import" && task.id === pending.id
      ));
      return upsertTask(previous, preparedImportCreateTask(
        existing,
        snapshot,
        request,
        ownerLeaseExpiresAt,
        preparedAt,
      ));
    };
    setTasks(applyRequest);
    return persistTaskUpdate(storageKey, applyRequest);
  }, [storageKey]);

  const rejectImportCreate = useCallback<BackgroundTaskContextValue["rejectImportCreate"]>((
    pending,
    failureMessage,
  ) => {
    const rejectedAt = Date.now();
    const applyRejected = (previous: TrackedBackgroundTask[]) => {
      const existing = previous.find((task): task is TrackedImportTask => (
        task.kind === "import" && task.id === pending.id
      ));
      return upsertTask(previous, rejectedImportCreateTask(
        existing,
        pending,
        failureMessage,
        rejectedAt,
      ));
    };
    setTasks(applyRejected);
    return persistTaskUpdate(storageKey, applyRejected);
  }, [storageKey]);

  const updateImportTask = useCallback<BackgroundTaskContextValue["updateImportTask"]>((id, patch) => {
    setTasks((previous) => previous.map((task) => {
      if (task.kind !== "import" || task.id !== id) return task;
      const nextStatus = patch.status ?? task.status;
      const justFinished = task.status === "running" && nextStatus !== "running";
      return {
        ...task,
        ...patch,
        status: nextStatus,
        updatedAt: Date.now(),
        finishedAt: justFinished ? patch.finishedAt ?? Date.now() : patch.finishedAt ?? task.finishedAt,
        dismissed: justFinished ? false : patch.dismissed ?? task.dismissed,
      };
    }));
  }, []);

  const resolveImportTask = useCallback<BackgroundTaskContextValue["resolveImportTask"]>((id, snapshot) => {
    const resolvedAt = Date.now();
    const applyResolved = (previous: TrackedBackgroundTask[]) => resolveImportCreateSnapshot(
      previous,
      id,
      snapshot,
      resolvedAt,
    );
    setTasks(applyResolved);
    persistTaskUpdate(storageKey, applyResolved);
  }, [storageKey]);

  const dismissTask = useCallback((id: string) => {
    setTasks((previous) => previous.map((task) => task.id === id
      ? { ...task, dismissed: true, updatedAt: Date.now() }
      : task));
  }, []);

  const unresolvedAgentTaskKey = useMemo(() => recoverableAgentTaskKey(tasks), [tasks]);

  useEffect(() => {
    if (!hydrated) return;
    // Discovery repairs refresh/disconnect gaps before an Agent placeholder has a
    // runId. Once a run is known, its dedicated activity/runtime channels own
    // liveness and this global endpoint must not remain a second polling loop.
    let cancelled = false;
    let timer: number | undefined;
    let inFlight: Promise<boolean> | null = null;

    const recover = () => {
      if (inFlight) return inFlight;
      if (!initialRecoveryCompleteRef.current) initialRecoveryAttemptsRef.current += 1;
      inFlight = apiClient.listRecoverableAgentRuns(20)
        .then((runs) => {
          if (cancelled) return false;
          setTasks((previous) => mergeRecoverableRuns(previous, runs));
          initialRecoveryCompleteRef.current = true;
          return true;
        })
        .catch(() => false)
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    };

    const scheduleRecover = async () => {
      await recover();
      if (cancelled || !shouldDiscoverRecoverableAgentRuns(
        initialRecoveryCompleteRef.current,
        initialRecoveryAttemptsRef.current,
        unresolvedAgentTaskKey,
      )) return;
      timer = window.setTimeout(scheduleRecover, 10_000);
    };
    const recoverOnWake = () => {
      if (document.visibilityState === "hidden") return;
      void recover();
    };

    if (shouldDiscoverRecoverableAgentRuns(
      initialRecoveryCompleteRef.current,
      initialRecoveryAttemptsRef.current,
      unresolvedAgentTaskKey,
    )) {
      void scheduleRecover();
    }
    window.addEventListener("focus", recoverOnWake);
    window.addEventListener("online", recoverOnWake);
    document.addEventListener("visibilitychange", recoverOnWake);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("focus", recoverOnWake);
      window.removeEventListener("online", recoverOnWake);
      document.removeEventListener("visibilitychange", recoverOnWake);
    };
  }, [hydrated, unresolvedAgentTaskKey]);

  const unresolvedImportCreateKey = useMemo(() => JSON.stringify(tasks
    .filter((task): task is TrackedImportTask => task.kind === "import"
      && task.status === "running"
      && !task.taskId
      && Boolean(task.createRequest)
      && (task.currentStage === "SUBMITTING" || task.currentStage === "CONFIRMING"))
    .map((task) => ({
      id: task.id,
      kbId: task.kbId,
      request: task.createRequest as IngestionCreateRequest,
      confirmationNotBefore: Math.max(task.confirmationNotBefore ?? 0, task.ownerLeaseExpiresAt ?? 0),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))), [tasks]);

  useEffect(() => {
    if (!hydrated || unresolvedImportCreateKey === "[]") return;
    let timer: number | undefined;
    const pending = JSON.parse(unresolvedImportCreateKey) as Array<{
      id: string;
      kbId: string;
      request: IngestionCreateRequest;
      confirmationNotBefore: number;
    }>;

    const confirm = async () => {
      const currentTime = Date.now();
      const due = pending.filter((task) => task.confirmationNotBefore <= currentTime);
      if (due.length === 0) {
        const nextAttemptAt = Math.min(...pending.map((task) => task.confirmationNotBefore));
        timer = window.setTimeout(confirm, Math.max(0, nextAttemptAt - currentTime));
        return;
      }

      const dueIds = new Set(due.map((task) => task.id));
      setTasks((previous) => previous.map((task) => task.kind === "import"
        && dueIds.has(task.id)
        && task.status === "running"
        && !task.taskId
        ? { ...task, currentStage: "CONFIRMING", updatedAt: Date.now() }
        : task));

      await Promise.allSettled(due.map(async (recovered) => {
        if (importRecoveryInFlightRef.current.has(recovered.id)) return;
        importRecoveryInFlightRef.current.add(recovered.id);
        try {
          const result = await recoverIngestionCreate({
            findByClientRequestId: apiClient.getIngestionTaskByClientRequestId,
            create: apiClient.createIngestionTask,
          }, recovered.kbId, recovered.request);
          if (activeStorageKeyRef.current !== storageKey) return;

          const recoveredAt = Date.now();
          const applyRecoveryResult = (previous: TrackedBackgroundTask[]): TrackedBackgroundTask[] => {
            const current = previous.find((task) => task.kind === "import" && task.id === recovered.id);
            if (result.state === "resolved") {
              if (current && (current.kind !== "import" || current.status !== "running" || current.taskId)) {
                return previous;
              }
              return resolveImportCreateSnapshot(
                previous,
                recovered.id,
                result.task,
                recoveredAt,
              );
            }
            if (!current || current.kind !== "import" || current.status !== "running" || current.taskId) {
              return previous;
            }
            if (result.state === "failed") {
              return previous.map((task) => task.kind === "import" && task.id === recovered.id
                ? {
                    ...task,
                    createRequest: undefined,
                    status: "error" as const,
                    runningCount: 0,
                    currentStage: "CREATE_REJECTED",
                    confirmationNotBefore: undefined,
                    ownerLeaseExpiresAt: 0,
                    navigationPending: false,
                    failureMessage: errorMessage(result.error),
                    finishedAt: recoveredAt,
                    updatedAt: recoveredAt,
                    dismissed: false,
                  }
                : task);
            }
            return previous.map((task) => task.kind === "import" && task.id === recovered.id
              ? {
                  ...task,
                  currentStage: "CONFIRMING",
                  confirmationNotBefore: recoveredAt + IMPORT_CONFIRMATION_POLL_MS,
                  failureMessage: undefined,
                  updatedAt: recoveredAt,
                }
              : task);
          };
          setTasks(applyRecoveryResult);
          const persisted = persistTaskUpdate(storageKey, applyRecoveryResult);
          if (persisted
            && result.state === "failed"
            && shouldCleanupRejectedIngestionCreate(result.error)) {
            await cleanupRejectedUpload(recovered.request).catch(() => undefined);
          }
        } finally {
          importRecoveryInFlightRef.current.delete(recovered.id);
        }
      }));
    };

    void confirm();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [hydrated, storageKey, unresolvedImportCreateKey]);

  const unresolvedUploadKey = useMemo(() => JSON.stringify(tasks
    .filter((task): task is TrackedImportTask => task.kind === "import"
      && task.status === "running"
      && !task.taskId
      && task.currentStage === "UPLOADING")
    .map((task) => ({ id: task.id, ownerLeaseExpiresAt: task.ownerLeaseExpiresAt ?? 0 }))
    .sort((left, right) => left.id.localeCompare(right.id))), [tasks]);

  useEffect(() => {
    if (!hydrated || unresolvedUploadKey === "[]") return;
    const pending = JSON.parse(unresolvedUploadKey) as Array<{ id: string; ownerLeaseExpiresAt: number }>;
    const expireAt = Math.min(...pending.map((task) => task.ownerLeaseExpiresAt));
    const markInterrupted = () => {
      const currentTime = Date.now();
      setTasks((previous) => previous.map((task) => task.kind === "import"
        && shouldInterruptImportUpload(task, currentTime)
        ? {
            ...task,
            status: "error",
            currentStage: "UPLOAD_INTERRUPTED",
            failureMessage: "文件上传已中断，请重新选择文件后上传。",
            finishedAt: currentTime,
            updatedAt: currentTime,
            dismissed: false,
          }
        : task));
    };
    const timer = window.setTimeout(markInterrupted, Math.max(0, expireAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [hydrated, unresolvedUploadKey]);

  const activeTaskKey = useMemo(() => JSON.stringify(tasks
    .filter((task) => task.status === "running" && !isSourceRoute(pathname, task.kind))
    .map((task) => task.kind === "agent"
      ? { id: task.id, kind: task.kind, runId: task.runId }
      : { id: task.id, kind: task.kind, kbId: task.kbId, taskId: task.taskId })
    .sort((a, b) => a.id.localeCompare(b.id))), [pathname, tasks]);

  useEffect(() => {
    if (!hydrated || activeTaskKey === "[]") return;
    let cancelled = false;
    const activeTasks = JSON.parse(activeTaskKey) as Array<
      | { id: string; kind: "agent"; runId?: string }
      | { id: string; kind: "import"; kbId: string; taskId?: string }
    >;

    const poll = async () => {
      const results = await Promise.allSettled(activeTasks.map(async (task) => {
        if (task.kind === "agent") {
          if (!task.runId) return null;
          return { id: task.id, kind: task.kind, data: await apiClient.getAgentRunActivity(task.runId) } as const;
        }
        if (!task.taskId) return null;
        return {
          id: task.id,
          kind: task.kind,
          data: await apiClient.getIngestionTask(task.kbId, task.taskId),
        } as const;
      }));
      if (cancelled) return;

      setTasks((previous) => results.reduce((next, result) => {
        if (result.status !== "fulfilled" || !result.value) return next;
        return result.value.kind === "agent"
          ? applyAgentActivity(next, result.value.id, result.value.data as AgentRunActivity)
          : applyImportSnapshot(next, result.value.id, result.value.data as IngestionTask);
      }, previous));
    };

    let timer: number | undefined;
    const schedulePoll = async () => {
      await poll();
      if (!cancelled) timer = window.setTimeout(schedulePoll, 2_500);
    };
    void schedulePoll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeTaskKey, hydrated]);

  const visibleCards = useMemo(() => {
    const visible = tasks.filter((task) => !task.dismissed && !isSourceRoute(pathname, task.kind));
    return (["agent", "import"] as const).flatMap((kind) => {
      const sameKind = visible.filter((task): task is Extract<TrackedBackgroundTask, { kind: typeof kind }> => task.kind === kind);
      if (sameKind.length === 0) return [];
      const representative = sameKind.sort(compareTaskPriority)[0];
      return [{ task: representative, count: sameKind.length }];
    });
  }, [pathname, tasks]);

  useEffect(() => {
    if (!visibleCards.some(({ task }) => task.status === "running")) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [visibleCards]);

  const openImportTask = useCallback((task: TrackedImportTask) => {
    const params = new URLSearchParams({ kbId: task.kbId });
    if (task.taskId) params.set("taskId", task.taskId);
    router.push(`/imports?${params.toString()}`);
    if (task.status !== "running") dismissTask(task.id);
  }, [dismissTask, router]);

  const value = useMemo<BackgroundTaskContextValue>(() => ({
    tasks,
    registerAgentTask,
    updateAgentTask,
    registerImportTask,
    registerPendingImportTask,
    prepareImportCreate,
    rejectImportCreate,
    updateImportTask,
    resolveImportTask,
    dismissTask,
  }), [
    dismissTask,
    registerAgentTask,
    registerImportTask,
    registerPendingImportTask,
    prepareImportCreate,
    rejectImportCreate,
    resolveImportTask,
    tasks,
    updateAgentTask,
    updateImportTask,
  ]);

  return (
    <BackgroundTaskContext.Provider value={value}>
      {children}
      <section className={styles.dock} aria-label="后台任务状态" aria-live="polite">
        {visibleCards.map(({ task, count }) => (
          <BackgroundTaskCard
            key={task.kind}
            task={task}
            count={count}
            now={now}
            onOpen={task.kind === "import" ? () => openImportTask(task) : undefined}
            onDismiss={() => dismissTask(task.id)}
          />
        ))}
      </section>
    </BackgroundTaskContext.Provider>
  );
}

export function useBackgroundTasks() {
  const context = useContext(BackgroundTaskContext);
  if (!context) throw new Error("useBackgroundTasks must be used within BackgroundTaskProvider");
  return context;
}

function BackgroundTaskCard({
  task,
  count,
  now,
  onOpen,
  onDismiss,
}: {
  task: TrackedBackgroundTask;
  count: number;
  now: number;
  onOpen?: () => void;
  onDismiss: () => void;
}) {
  const presentation = taskPresentation(task, count, now);
  const Icon = task.status === "success"
    ? Check
    : task.status === "error" || task.status === "cancelled"
      ? AlertTriangle
      : task.kind === "agent" ? Sparkles : Download;
  const content = (
    <>
      <span className={styles.icon}><Icon size={15} aria-hidden="true" /></span>
      <span className={styles.copy}>
        <small>{presentation.eyebrow}</small>
        <strong>{presentation.title}</strong>
        <span>{presentation.detail}</span>
      </span>
      <span className={styles.meta}>
        {presentation.meta}
        {onOpen && task.status !== "running" ? <ArrowRight size={13} aria-hidden="true" /> : null}
      </span>
    </>
  );

  return (
    <article className={styles.card} data-kind={task.kind} data-status={task.status}>
      {onOpen ? (
        <button className={`${styles.open} ${styles.openButton}`} type="button" onClick={onOpen} aria-label={`${presentation.title}，${presentation.meta}`}>
          {content}
        </button>
      ) : (
        <div className={styles.open}>{content}</div>
      )}
      <button className={styles.dismiss} type="button" onClick={onDismiss} aria-label="关闭任务提醒">
        <X size={14} aria-hidden="true" />
      </button>
      {task.kind === "import"
        && task.status === "running"
        && !(task.currentStage === "SUBMITTING" || task.currentStage === "CONFIRMING") ? (
        <span className={styles.progress} aria-label={`任务进度 ${task.progress}%`}>
          <span className={styles.progressValue} style={{ width: `${task.progress}%` }} />
        </span>
      ) : null}
    </article>
  );
}

function taskPresentation(task: TrackedBackgroundTask, count: number, now: number) {
  if (task.kind === "agent") {
    if (task.status === "success") return {
      eyebrow: "AGENT COMPLETED",
      title: count > 1 ? `${count} 个 Agent 回答已完成` : "Agent 回答已完成",
      detail: task.label,
      meta: "已完成",
    };
    if (task.status === "error" || task.status === "cancelled") return {
      eyebrow: "AGENT NEEDS ATTENTION",
      title: task.status === "cancelled" ? "Agent 回答已取消" : "Agent 回答生成失败",
      detail: task.label,
      meta: task.status === "cancelled" ? "已取消" : "生成失败",
    };
    return {
      eyebrow: "AGENT WORKING",
      title: count > 1 ? `${count} 个 Agent 任务运行中` : "Agent 正在处理回答",
      detail: agentStageLabel(task.currentStage),
      meta: `已运行 ${formatElapsed(now - task.startedAt)}`,
    };
  }

  if (task.status === "success") return {
    eyebrow: "IMPORT COMPLETED",
    title: count > 1 ? `${count} 个导入任务已完成` : `${task.totalCount || 1} 个文件导入完成`,
    detail: task.label,
    meta: "查看任务",
  };
  if (task.status === "error" || task.status === "cancelled") return {
    eyebrow: "IMPORT NEEDS ATTENTION",
    title: task.failureCount > 0 ? `${task.failureCount} 个文件导入失败` : "导入任务未完成",
    detail: task.failureMessage ?? task.label,
    meta: "查看原因",
  };
  const processed = Math.min(task.totalCount, task.successCount + task.failureCount);
  const uploading = task.currentStage === "UPLOADING" && !task.taskId;
  const confirming = (task.currentStage === "SUBMITTING" || task.currentStage === "CONFIRMING") && !task.taskId;
  return {
    eyebrow: "IMPORT RUNNING",
    title: count > 1 ? `${count} 个导入任务运行中` : `正在导入 ${task.label}`,
    detail: confirming
      ? "正在确认后端是否已受理，请勿重复上传"
      : uploading
      ? `${task.uploadedCount ?? 0} / ${task.totalCount || 1} 个文件已上传`
      : `${processed} / ${task.totalCount || 1} 个文件已处理`,
    meta: confirming
      ? "确认中"
      : uploading
      ? `${task.uploadedCount ?? 0} / ${task.totalCount || 1}`
      : `${processed} / ${task.totalCount || 1}`,
  };
}

function trackedImportTask(task: IngestionTask): TrackedImportTask {
  const totalCount = Math.max(task.totalCount ?? task.items?.length ?? 1, 1);
  const completedCount = (task.successCount ?? 0) + (task.failureCount ?? 0);
  const itemProgress = task.items?.length
    ? task.items.reduce((sum, item) => sum + Math.max(0, Math.min(item.progress ?? 0, 100)), 0) / task.items.length
    : (completedCount / totalCount) * 100;
  return {
    id: `import:${task.taskId}`,
    kind: "import",
    kbId: task.kbId,
    taskId: task.taskId,
    ...(task.clientRequestId ? { clientRequestId: task.clientRequestId } : {}),
    label: importTaskLabel(task),
    status: importStatus(task.status),
    totalCount,
    successCount: task.successCount ?? 0,
    failureCount: task.failureCount ?? 0,
    runningCount: task.runningCount ?? 0,
    progress: Math.round(Math.max(0, Math.min(itemProgress, 100))),
    currentStage: latestImportStage(task),
    startedAt: parseTaskTime(task.createdAt) ?? Date.now(),
    updatedAt: Date.now(),
    finishedAt: parseTaskTime(task.finishedAt),
    dismissed: false,
  };
}

function resolveImportCreateSnapshot(
  tasks: TrackedBackgroundTask[],
  id: string,
  snapshot: IngestionTask,
  resolvedAt: number,
) {
  const existing = tasks.find((task): task is TrackedImportTask => (
    task.kind === "import" && task.id === id
  ));
  const resolved = trackedImportTask(snapshot);
  const next: TrackedImportTask = {
    ...(existing ?? resolved),
    ...resolved,
    id,
    clientRequestId: snapshot.clientRequestId ?? existing?.clientRequestId,
    createRequest: undefined,
    confirmationNotBefore: undefined,
    ownerLeaseExpiresAt: undefined,
    startedAt: existing?.startedAt ?? resolved.startedAt,
    updatedAt: resolvedAt,
    navigationPending: true,
    dismissed: existing?.dismissed ?? resolved.dismissed,
  };
  return upsertTask(tasks, next);
}

function applyAgentActivity(tasks: TrackedBackgroundTask[], id: string, activity: AgentRunActivity) {
  return tasks.map((task) => {
    if (task.kind !== "agent" || task.id !== id) return task;
    const status = agentStatus(activity.status);
    const justFinished = task.status === "running" && status !== "running";
    const latestStep = [...(activity.steps ?? [])].reverse().find((step) => step.status === "RUNNING")
      ?? activity.steps?.at(-1);
    return {
      ...task,
      sessionId: activity.sessionId ?? task.sessionId,
      turnId: activity.turnId ?? task.turnId,
      runId: activity.runId,
      status,
      updatedAt: Date.now(),
      currentStage: latestStep?.taskStage ?? latestStep?.decision ?? latestStep?.type ?? activity.currentStep ?? task.currentStage,
      startedAt: activity.startedAt ?? task.startedAt,
      finishedAt: activity.finishedAt ?? (justFinished ? Date.now() : task.finishedAt),
      dismissed: justFinished ? false : task.dismissed,
    };
  });
}

function applyImportSnapshot(tasks: TrackedBackgroundTask[], id: string, snapshot: IngestionTask) {
  const next = trackedImportTask(snapshot);
  return tasks.map((task) => {
    if (task.kind !== "import" || task.id !== id) return task;
    const justFinished = task.status === "running" && next.status !== "running";
    return {
      ...task,
      ...next,
      id: task.id,
      startedAt: task.startedAt,
      updatedAt: Date.now(),
      dismissed: justFinished ? false : task.dismissed,
    };
  });
}

function mergeRecoverableRuns(tasks: TrackedBackgroundTask[], runs: AgentRunSummary[]) {
  return runs.reduce((next, run) => {
    const byRun = next.find((task) => task.kind === "agent" && task.runId === run.runId) as TrackedAgentTask | undefined;
    const placeholder = byRun ?? next.find((task) => task.kind === "agent"
      && !task.runId
      && task.sessionId === run.sessionId
      && Math.abs(task.startedAt - run.startedAt) < 5 * 60_000) as TrackedAgentTask | undefined;
    if (placeholder) {
      return next.map((task) => task.id === placeholder.id ? {
        ...placeholder,
        runId: run.runId,
        sessionId: run.sessionId,
        turnId: run.turnId ?? placeholder.turnId,
        currentStage: run.currentStep ?? placeholder.currentStage,
        startedAt: run.startedAt || placeholder.startedAt,
        status: agentStatus(run.status),
        updatedAt: Date.now(),
      } : task);
    }
    if (agentStatus(run.status) !== "running") return next;
    return upsertTask(next, {
      id: `agent:${run.runId}`,
      kind: "agent",
      sessionId: run.sessionId,
      turnId: run.turnId ?? undefined,
      runId: run.runId,
      label: "Agent 正在处理当前会话",
      status: agentStatus(run.status),
      currentStage: run.currentStep ?? undefined,
      startedAt: run.startedAt || Date.now(),
      updatedAt: Date.now(),
      dismissed: false,
    });
  }, tasks);
}

function upsertTask(tasks: TrackedBackgroundTask[], nextTask: TrackedBackgroundTask) {
  const exists = tasks.some((task) => task.id === nextTask.id);
  const next = exists
    ? tasks.map((task) => task.id === nextTask.id ? { ...task, ...nextTask } as TrackedBackgroundTask : task)
    : [...tasks, nextTask];
  return trimStoredTasks(next);
}

function trimStoredTasks(tasks: TrackedBackgroundTask[]) {
  return retainStoredBackgroundTasks(
    tasks,
    MAX_STORED_TASKS,
    COMPLETED_RETENTION_MS,
  );
}

function persistTaskUpdate(
  storageKey: string | null,
  update: (tasks: TrackedBackgroundTask[]) => TrackedBackgroundTask[],
) {
  if (!storageKey || typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(trimStoredTasks(update(readStoredTasks(storageKey)))));
    return true;
  } catch {
    // React state remains the in-tab source of truth when persistence is unavailable.
    return false;
  }
}

function readStoredTasks(storageKey: string): TrackedBackgroundTask[] {
  return parseStoredTasks(window.localStorage.getItem(storageKey));
}

function parseStoredTasks(rawValue: string | null): TrackedBackgroundTask[] {
  try {
    const parsed = JSON.parse(rawValue ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return trimStoredTasks(parsed.filter(isTrackedTask).map((task) => {
      const migratedTask = {
        ...task,
        updatedAt: task.updatedAt ?? task.finishedAt ?? task.startedAt,
      };
      if (migratedTask.kind !== "import") return migratedTask;

      const createRequest = normalizePersistedIngestionCreateRequest(migratedTask.createRequest);
      if (!createRequest) {
        const unrecoverableSubmit = migratedTask.status === "running"
          && !migratedTask.taskId
          && (migratedTask.currentStage === "SUBMITTING" || migratedTask.currentStage === "CONFIRMING");
        return unrecoverableSubmit
          ? {
              ...migratedTask,
              status: "error" as const,
              currentStage: "CREATE_RECOVERY_UNAVAILABLE",
              failureMessage: "缺少可恢复的任务创建参数，请重新提交。",
              finishedAt: Date.now(),
              updatedAt: Date.now(),
              dismissed: false,
            }
          : { ...migratedTask, createRequest: undefined };
      }

      const restoredStage = restoredImportStage(migratedTask);
      return {
        ...migratedTask,
        clientRequestId: createRequest.clientRequestId,
        createRequest,
        ...(restoredStage !== migratedTask.currentStage
          ? { currentStage: restoredStage, confirmationNotBefore: 0 }
          : {}),
      };
    }));
  } catch {
    return [];
  }
}

function mergeStoredTasks(current: TrackedBackgroundTask[], incoming: TrackedBackgroundTask[]) {
  const merged = trimStoredTasks(mergeStoredTaskSnapshots(current, incoming));
  return JSON.stringify(merged) === JSON.stringify(current) ? current : merged;
}

function isTrackedTask(value: unknown): value is TrackedBackgroundTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<TrackedBackgroundTask>;
  return typeof task.id === "string"
    && (task.kind === "agent" || task.kind === "import")
    && typeof task.status === "string"
    && typeof task.startedAt === "number";
}

function agentStatus(status: string): BackgroundTaskStatus {
  if (["COMPLETED", "AGENT_DEGRADED", "AGENT_FALLBACK", "SUCCEEDED"].includes(status)) return "success";
  if (status === "CANCELLED") return "cancelled";
  if (status === "FAILED") return "error";
  return "running";
}

function importStatus(status: string): BackgroundTaskStatus {
  if (["SUCCESS", "COMPLETED", "PARTIAL_SUCCESS", "SKIPPED"].includes(status)) return "success";
  if (status === "CANCELLED") return "cancelled";
  if (status === "FAILED") return "error";
  return "running";
}

async function cleanupRejectedUpload(request: IngestionCreateRequest) {
  if (request.sourceType !== "UPLOAD") return;
  const items = request.items.filter((item): item is UploadIngestionItem => (
    typeof item.fileName === "string"
    && typeof item.objectKey === "string"
  ));
  if (items.length !== request.items.length) return;
  const token = await apiClient.getStsToken();
  await deleteUploadedFilesFromOss(token, items);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "任务创建失败，请重新提交。";
}

function agentStageLabel(stage?: string) {
  const normalized = stage?.toUpperCase() ?? "";
  if (normalized.includes("RETRIEV") || normalized.includes("SEARCH") || normalized.includes("TOOL")) return "正在检索相关证据";
  if (normalized.includes("EVIDENCE") || normalized.includes("CONTEXT")) return "正在整理证据上下文";
  if (normalized.includes("FINAL") || normalized.includes("ANSWER")) return "正在生成并校验回答";
  if (normalized.includes("TASK") || normalized.includes("SUMMARY")) return "正在处理后续任务";
  return "正在理解问题并规划下一步";
}

function importTaskLabel(task: IngestionTask) {
  const names = (task.items ?? []).map((item) => item.fileName?.trim()).filter((name): name is string => Boolean(name));
  if (names.length === 1) return names[0];
  if (names.length > 1) return `${names[0]} 等 ${names.length} 个文件`;
  return task.sourceType === "URL" ? "URL 资料" : "知识库文件";
}

function latestImportStage(task: IngestionTask) {
  return task.items?.find((item) => !["SUCCESS", "COMPLETED", "FAILED", "SKIPPED"].includes(item.status))?.stage;
}

function parseTaskTime(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function isSourceRoute(pathname: string, kind: TrackedBackgroundTask["kind"]) {
  return kind === "agent"
    ? pathname === "/ask" || pathname.startsWith("/ask/")
    : pathname === "/imports" || pathname.startsWith("/imports/");
}

function compareTaskPriority(a: TrackedBackgroundTask, b: TrackedBackgroundTask) {
  if (a.status === "running" && b.status !== "running") return -1;
  if (a.status !== "running" && b.status === "running") return 1;
  return b.startedAt - a.startedAt;
}
