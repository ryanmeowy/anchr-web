"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  Folder,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PremiumRail } from "@/components/app/premium-rail";
import { useBackgroundTasks, type TrackedAgentTask } from "@/components/app/background-task-provider";
import { ActionErrorNotice } from "@/components/shared/action-error-notice";
import { AssetScopeChip } from "@/components/shared/asset-scope-chip";
import { TransientNotice } from "@/components/shared/transient-notice";
import { ErrorBlock } from "@/components/ui/query-state";
import { apiClient, isAccessDeniedError } from "@/lib/api-client";
import {
  consumeAssetScopeHandoff,
  readAskAssetScope,
  readAssetNameCache,
  rememberAssetScopes,
  saveAskAssetScope,
  type AssetScope,
} from "@/lib/asset-scope";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import { conversationCitationLabels, resolveConversationCitation } from "@/lib/citation-reference";
import {
  clearPreviewRestoreState,
  normalizeConversationCitations,
  readPreviewRestoreState,
  savePreviewNavigation,
} from "@/lib/preview-context";
import type {
  CapabilityConfig,
  ConversationAnswerMode,
  ConversationAnswerStatus,
  ConversationCitation,
  CitationChunk,
  ConversationIntent,
  ConversationSession,
  ConversationTurn,
  AgentTask,
  AgentActivityStatus,
  AgentActivityStep,
  AgentRunActivity,
  ConversationExecutionMode,
} from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sessionId: string;
  turnId?: string;
  citations?: ConversationCitation[];
  assetScope?: string[];
  answerMode?: ConversationAnswerMode | string;
  answerStatus?: ConversationAnswerStatus;
  answerFallbackReason?: string | null;
  intent?: ConversationIntent;
  executionMode?: ConversationExecutionMode;
  agentRunId?: string;
  workflowVersion?: string;
  agentTask?: AgentTask;
  pending?: boolean;
  error?: string;
};

type MessageCache = Record<string, ChatMessage[]>;
type ComposerMenu = "kb" | "mode" | "model" | null;
type ThemeMode = PremiumThemeMode;
type PermissionNotice = {
  title: string;
  message: string;
};
type LiveAgentActivity = {
  sessionId?: string;
  runId?: string;
  status?: AgentActivityStatus;
  steps: AgentActivityStep[];
};

type AskPremiumReturnState = {
  activeSessionId: string;
  query: string;
  selectedKbIdsValue: string[] | null;
  selectedAnswerMode: ConversationAnswerMode;
  conversations: ConversationSession[];
  nextCursor: string | null;
  messagesBySession: MessageCache;
  liveAgentActivity?: LiveAgentActivity;
  messageScrollTop: number;
  conversationListScrollTop: number;
};

const CONVERSATION_PAGE_SIZE = 50;
const HISTORY_LIMIT = 100;
const ASK_TRACE_HINT_SEEN_KEY = "anchr.ask.trace-hint-seen";
const ASK_AGENT_ENABLED_KEY = "anchr.ask.agent-enabled";
const ASK_HISTORY_COLLAPSED_KEY = "anchr.ask.history-collapsed";
const ASK_TRACE_COLLAPSED_KEY = "anchr.ask.trace-collapsed";
const ANSWER_MODES: Array<{ value: ConversationAnswerMode; label: string; detail: string }> = [
  { value: "STRICT", label: "严格回答", detail: "证据门槛最高，证据不足时拒答" },
  { value: "SUMMARY", label: "摘要回答", detail: "更短输出，保留核心证据" },
  { value: "EXPLORE", label: "探索回答", detail: "允许建议方向，事实仍需引用" },
];

function applyAgentTask(message: ChatMessage, task: AgentTask): ChatMessage {
  if (task.status === "SUCCEEDED") return {
    ...message, agentTask: task, pending: false, content: task.answer || message.content,
    citations: task.citations ?? [], answerStatus: "ANSWERED", answerFallbackReason: null,
  };
  if (task.status === "FAILED") return {
    ...message, agentTask: task, pending: false, content: task.errorMessage || "文档处理失败，请稍后重试。",
    citations: [], answerStatus: "MODEL_FALLBACK", answerFallbackReason: task.errorCode,
  };
  if (task.status === "CANCELLED") return {
    ...message, agentTask: task, pending: false, content: task.answer || "任务已取消。",
    citations: [], answerStatus: "CANCELLED", answerFallbackReason: task.errorCode,
  };
  return {
    ...message,
    agentTask: task,
    pending: true,
    content: task.answer !== null && task.answer !== undefined ? task.answer : message.content,
  };
}

function activityNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function activityBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function mergeLiveAgentStep(steps: AgentActivityStep[], next: AgentActivityStep) {
  const key = liveAgentStepKey(next);
  const index = steps.findIndex((step) => (
    liveAgentStepKey(step)
  ) === key);
  if (index < 0) {
    if (next.stepOrder <= 0) return steps;
    return [...steps, next].sort(compareAgentSteps).slice(-50);
  }
  const merged = [...steps];
  merged[index] = mergeDefinedAgentStep(merged[index], next);
  return merged.sort(compareAgentSteps).slice(-50);
}

function mergeDefinedAgentStep(base: AgentActivityStep, update: AgentActivityStep) {
  const defined = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<AgentActivityStep>;
  return {
    ...base,
    ...defined,
    stepOrder: update.stepOrder > 0 ? update.stepOrder : base.stepOrder,
    createdAt: base.createdAt ?? update.createdAt,
  } as AgentActivityStep;
}

function compareAgentSteps(a: AgentActivityStep, b: AgentActivityStep) {
  return a.stepOrder - b.stepOrder || (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

function liveAgentStepKey(step: AgentActivityStep) {
  if (step.callId && step.type === "TASK_STAGE") {
    return `task:${step.callId}:${step.taskStage ?? "QUEUED"}`;
  }
  if (step.callId) return `tool:${step.callId}`;
  return `${step.type}:${step.stepOrder}`;
}

function statusFromDone(
  executionMode?: ConversationExecutionMode,
  answerStatus?: ConversationAnswerStatus,
): AgentActivityStatus {
  if (executionMode === "AGENT_FALLBACK") return "AGENT_FALLBACK";
  if (answerStatus === "PROCESSING") return "WAITING_TASK";
  if (answerStatus === "CANCELLED") return "CANCELLED";
  if (answerStatus === "MODEL_FALLBACK") return "FAILED";
  return "COMPLETED";
}

function statusFromTask(task?: AgentTask): AgentActivityStatus | undefined {
  if (!task) return undefined;
  if (task.status === "SUCCEEDED") return "COMPLETED";
  if (task.status === "FAILED") return "FAILED";
  if (task.status === "CANCELLED") return "CANCELLED";
  return "WAITING_TASK";
}

export function AskPremiumPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const {
    tasks: backgroundTasks,
    registerAgentTask,
    updateAgentTask: updateBackgroundAgentTask,
  } = useBackgroundTasks();
  const initialKbId = searchParams.get("kbId") ?? "";
  const initialKbName = searchParams.get("kbName") ?? "";
  const initialSessionId = searchParams.get("session") ?? "";
  const initialTurnId = searchParams.get("turn") ?? "";
  const [query, setQuery] = useState("");
  const [selectedKbIdsValue, setSelectedKbIdsValue] = useState<string[] | null>(initialKbId ? [initialKbId] : null);
  const [selectedAnswerMode, setSelectedAnswerMode] = useState<ConversationAnswerMode>("STRICT");
  const [selectedGenerationConfigId, setSelectedGenerationConfigId] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);
  const [conversations, setConversations] = useState<ConversationSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<MessageCache>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [composerMenu, setComposerMenu] = useState<ComposerMenu>(null);
  const [composerMenuPosition, setComposerMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [isMessageSubmitting, setIsMessageSubmitting] = useState(false);
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [liveAgentActivity, setLiveAgentActivity] = useState<LiveAgentActivity>({ steps: [] });
  const [traceCollapsed, setTraceCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [layoutTransitionReady, setLayoutTransitionReady] = useState(false);
  const [traceHintVisible, setTraceHintVisible] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [activeAssetScope, setActiveAssetScope] = useState<AssetScope | null>(null);
  const [assetNameCache, setAssetNameCache] = useState<Record<string, string>>({});
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const [permissionNotice, setPermissionNotice] = useState<PermissionNotice | null>(null);
  const [cancellingTaskIds, setCancellingTaskIds] = useState<Set<string>>(new Set());
  const messageSubmissionLockRef = useRef(false);
  const streamRef = useRef<{
    requestId: string;
    sessionId: string;
    controller: AbortController;
    agentEnabled: boolean;
    runId?: string;
  } | null>(null);
  const activeTaskStreamsRef = useRef<Map<string, {
    controller: AbortController;
    answerReceived: boolean;
  }>>(new Map());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const kbButtonRef = useRef<HTMLButtonElement | null>(null);
  const modeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const generationQuery = useQuery({
    queryKey: ["settings", "generation", "all"],
    queryFn: () => apiClient.getAllCapabilityConfigs("generation"),
  });

  const agentCapabilitiesQuery = useQuery({
    queryKey: ["conversation", "capabilities"],
    queryFn: () => apiClient.getConversationCapabilities(),
    retry: false,
  });
  const agentAvailable = agentCapabilitiesQuery.data?.agentAvailable === true;

  useEffect(() => {
    let transitionFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      setTheme(getInitialPremiumTheme());
      setThemeHydrated(true);
      setAssetNameCache(readAssetNameCache());
      try {
        setAgentEnabled(window.localStorage.getItem(ASK_AGENT_ENABLED_KEY) === "1");
        setHistoryCollapsed(window.localStorage.getItem(ASK_HISTORY_COLLAPSED_KEY) === "1");
        setTraceCollapsed(window.localStorage.getItem(ASK_TRACE_COLLAPSED_KEY) === "1");
      } catch { /* ignore */ }
      transitionFrame = window.requestAnimationFrame(() => setLayoutTransitionReady(true));
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (transitionFrame !== null) window.cancelAnimationFrame(transitionFrame);
    };
  }, []);

  useEffect(() => {
    if (!agentAvailable && agentCapabilitiesQuery.isFetched) setAgentEnabled(false);
  }, [agentAvailable, agentCapabilitiesQuery.isFetched]);

  const toggleAgent = useCallback(() => {
    if (!agentAvailable) return;
    setAgentEnabled((value) => {
      const next = !value;
      try { window.localStorage.setItem(ASK_AGENT_ENABLED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, [agentAvailable]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        if (window.localStorage.getItem(ASK_TRACE_HINT_SEEN_KEY) !== "1") {
          window.localStorage.setItem(ASK_TRACE_HINT_SEEN_KEY, "1");
          setTraceHintVisible(true);
        }
      } catch {
        setTraceHintVisible(true);
      }
    });

    const timer = window.setTimeout(() => setTraceHintVisible(false), 10_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!themeHydrated) return;

    applyPremiumTheme(theme);
  }, [theme, themeHydrated]);

  const kbs = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
  const kbOptions = useMemo(() => {
    const options = kbs.map((item) => ({ id: item.id, name: item.name }));
    const existingIds = new Set(options.map((item) => item.id));

    if (initialKbId && initialKbName && !existingIds.has(initialKbId)) {
      options.push({ id: initialKbId, name: initialKbName });
    }

    return options;
  }, [initialKbId, initialKbName, kbs]);

  const generationConfigs = useMemo(() => generationQuery.data ?? [], [generationQuery.data]);
  const activeGenerationConfig = useMemo(
    () => generationConfigs.find((item) => item.id === selectedGenerationConfigId)
      ?? generationConfigs.find((item) => item.enabled)
      ?? generationConfigs[0],
    [generationConfigs, selectedGenerationConfigId],
  );

  const selectedKbIds = useMemo(
    () => selectedKbIdsValue ?? kbs.slice(0, 3).map((item) => item.id),
    [kbs, selectedKbIdsValue],
  );

  const selectedKbLabel = useMemo(() => {
    if (selectedKbIds.length === 0) return "选择知识库";
    if (selectedKbIds.length === kbOptions.length && kbOptions.length > 0) return "全部知识库";
    if (selectedKbIds.length === 1) return kbOptions.find((item) => item.id === selectedKbIds[0])?.name ?? "已选知识库";
    return `${selectedKbIds.length} 个知识库`;
  }, [kbOptions, selectedKbIds]);

  const selectedAnswerModeLabel = ANSWER_MODES.find((item) => item.value === selectedAnswerMode)?.label ?? "严格回答";
  const activeMessages = useMemo(
    () => (activeSessionId ? (messagesBySession[activeSessionId] ?? []) : []),
    [activeSessionId, messagesBySession],
  );
  const hasLoadedActiveMessages = activeSessionId
    ? Object.prototype.hasOwnProperty.call(messagesBySession, activeSessionId)
    : false;
  const isStreamingActiveSession = Boolean(activeSessionId && streamingSessionId === activeSessionId);
  const activeTrackedAgentTask = useMemo(() => backgroundTasks
    .filter((task): task is TrackedAgentTask => task.kind === "agent" && task.sessionId === activeSessionId)
    .sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;
      return b.startedAt - a.startedAt;
    })[0], [activeSessionId, backgroundTasks]);
  const trackedAgentInProgress = activeTrackedAgentTask?.status === "running";
  const canCancelActiveQuery = isStreamingActiveSession && streamRef.current?.agentEnabled === true;
  const lastActiveMessageContent = activeMessages.at(-1)?.content;
  const latestAssistantMessage = useMemo(
    () => activeMessages.slice().reverse().find((message) => message.role === "assistant"),
    [activeMessages],
  );
  const activeLiveAgentActivity = liveAgentActivity.sessionId === activeSessionId ? liveAgentActivity : undefined;
  const latestAssistantUsesAgent = latestAssistantMessage?.executionMode === "AGENT"
    || latestAssistantMessage?.executionMode === "AGENT_FALLBACK";
  const latestAgentTask = latestAssistantUsesAgent ? latestAssistantMessage?.agentTask : undefined;
  const latestAgentTaskInProgress = latestAgentTask?.status === "PENDING" || latestAgentTask?.status === "RUNNING";
  const latestAgentTaskCancelling = Boolean(
    latestAgentTask && cancellingTaskIds.has(latestAgentTask.taskId),
  );
  const activityRunId = activeLiveAgentActivity?.runId
    ?? (latestAssistantUsesAgent ? latestAssistantMessage?.agentRunId : undefined);
  const agentActivityQuery = useQuery({
    queryKey: ["agent", "activity", activityRunId],
    queryFn: ({ signal }) => apiClient.getAgentRunActivity(activityRunId!, signal),
    enabled: Boolean(activityRunId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "RUNNING" || status === "AWAITING_TURN" || status === "WAITING_TASK" || latestAgentTaskInProgress ? 2_000 : false;
    },
  });
  const canSubmit = Boolean(query.trim())
    && !isMessageSubmitting
    && !streamingSessionId
    && !latestAgentTaskInProgress
    && !trackedAgentInProgress
    && (Boolean(activeSessionId) || selectedKbIds.length > 0);
  const pendingTaskIds = useMemo(() => Array.from(new Set(
    Object.values(messagesBySession).flat().map((message) => message.agentTask)
      .filter((task): task is AgentTask => Boolean(task && (task.status === "PENDING" || task.status === "RUNNING")))
      .map((task) => task.taskId),
  )), [messagesBySession]);
  const pendingTaskKey = pendingTaskIds.join("|");

  useEffect(() => {
    if (!pendingTaskKey) return;
    const streams = pendingTaskKey.split("|").map((taskId) => {
      const controller = new AbortController();
      const streamState = { controller, answerReceived: false };
      activeTaskStreamsRef.current.set(taskId, streamState);
      const updateTask = (task: AgentTask) => {
        setMessagesBySession((previous) => Object.fromEntries(Object.entries(previous).map(([sessionId, messages]) => [
          sessionId,
          messages.map((message) => message.agentTask?.taskId === task.taskId
            ? applyAgentTask(message, { ...message.agentTask, ...task })
            : message),
        ])) as MessageCache);
        if (task.taskId === latestAgentTask?.taskId) {
          setLiveAgentActivity((previous) => previous.sessionId === activeSessionId
            ? { ...previous, status: statusFromTask(task) }
            : previous);
        }
      };
      const updateAnswer = (update: (current: string) => string) => {
        setMessagesBySession((previous) => Object.fromEntries(Object.entries(previous).map(([sessionId, messages]) => [
          sessionId,
          messages.map((message) => {
            if (message.agentTask?.taskId !== taskId) return message;
            const content = update(message.content);
            return {
              ...message,
              content,
              pending: true,
              agentTask: { ...message.agentTask, answer: content },
            };
          }),
        ])) as MessageCache);
      };
      void apiClient.streamAgentTask(taskId, {
        onTask: updateTask,
        onAnswerReset: (answer) => {
          streamState.answerReceived = true;
          updateAnswer(() => answer);
        },
        onDelta: (delta) => {
          streamState.answerReceived = true;
          updateAnswer((current) => `${current}${delta}`);
        },
        onDone: () => {
          void apiClient.getAgentTask(taskId).then(updateTask).catch(() => undefined);
        },
      }, controller.signal).catch((error) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          // Polling below remains the cross-instance and reconnect fallback.
        }
      }).finally(() => {
        if (activeTaskStreamsRef.current.get(taskId) === streamState) {
          activeTaskStreamsRef.current.delete(taskId);
        }
      });
      return { taskId, streamState };
    });
    return () => streams.forEach(({ taskId, streamState }) => {
      streamState.controller.abort();
      if (activeTaskStreamsRef.current.get(taskId) === streamState) {
        activeTaskStreamsRef.current.delete(taskId);
      }
    });
  }, [pendingTaskKey, latestAgentTask?.taskId, activeSessionId]);

  useEffect(() => {
    if (!pendingTaskKey) return;
    const taskIds = pendingTaskKey.split("|");
    let cancelled = false;
    let timer: number | undefined;
    let delay = 2_000;
    const poll = async () => {
      const results = await Promise.allSettled(taskIds.map((taskId) => apiClient.getAgentTask(taskId)));
      if (cancelled) return;
      const updates = new Map<string, AgentTask>();
      results.forEach((result) => { if (result.status === "fulfilled") updates.set(result.value.taskId, result.value); });
      if (updates.size > 0) {
        setMessagesBySession((previous) => Object.fromEntries(Object.entries(previous).map(([sessionId, messages]) => [
          sessionId,
          messages.map((message) => {
            const task = message.agentTask ? updates.get(message.agentTask.taskId) : undefined;
            if (!task) return message;
            const next = applyAgentTask(message, task);
            const taskIsTerminal = task.status === "SUCCEEDED"
              || task.status === "FAILED"
              || task.status === "CANCELLED";
            const activeStream = activeTaskStreamsRef.current.get(task.taskId);
            if (taskIsTerminal || !activeStream?.answerReceived) return next;
            const snapshotAnswer = task.answer ?? "";
            if (snapshotAnswer.length > message.content.length
              && snapshotAnswer.startsWith(message.content)) return next;
            return {
              ...next,
              content: message.content,
              agentTask: { ...next.agentTask!, answer: message.content },
            };
          }),
        ])) as MessageCache);
        const latestTaskUpdate = latestAgentTask?.taskId ? updates.get(latestAgentTask.taskId) : undefined;
        if (latestTaskUpdate) {
          setLiveAgentActivity((previous) => previous.sessionId === activeSessionId
            ? { ...previous, status: statusFromTask(latestTaskUpdate) }
            : previous);
        }
      }
      delay = Math.min(5_000, delay + 500);
      timer = window.setTimeout(poll, delay);
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [pendingTaskKey, latestAgentTask?.taskId, activeSessionId]);

  const cancelAgentTask = useCallback(async (taskId: string) => {
    setCancellingTaskIds((previous) => new Set(previous).add(taskId));
    try {
      const task = await apiClient.cancelAgentTask(taskId);
      setMessagesBySession((previous) => Object.fromEntries(Object.entries(previous).map(([sessionId, messages]) => [
        sessionId,
        messages.map((message) => message.agentTask?.taskId === taskId
          ? applyAgentTask(message, task)
          : message),
      ])) as MessageCache);
      setScopeNotice(task.status === "CANCELLED" ? "任务已取消" : "任务已结束，无法取消");
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "取消任务失败");
    } finally {
      setCancellingTaskIds((previous) => {
        const next = new Set(previous);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  const cancelActiveQuery = useCallback(async () => {
    const active = streamRef.current;
    if (!active) return;
    if (!active.runId) {
      setStreamError("Agent 运行尚未建立，请稍后重试取消");
      return;
    }
    try {
      const accepted = await apiClient.cancelAgentRun(active.runId);
      if (!accepted) {
        setStreamError("后端未确认取消，正在继续同步任务状态");
        return;
      }
      if (streamRef.current?.requestId !== active.requestId) return;
      streamRef.current = null;
      setStreamingSessionId(null);
      setMessagesBySession((previous) => ({
        ...previous,
        [active.sessionId]: (previous[active.sessionId] ?? []).map((message) => (
          message.pending && !message.agentTask
            ? {
                ...message,
                pending: false,
                content: stripTraceText(message.content) || "查询已取消。",
                answerStatus: "CANCELLED" as const,
                answerFallbackReason: "agent_run_cancelled",
              }
            : message
        )),
      }));
      setScopeNotice("查询已取消");
      setLiveAgentActivity((previous) => previous.sessionId === active.sessionId
        ? {
            ...previous,
            status: "CANCELLED",
            steps: cancelRunningAgentSteps(previous.steps),
          }
        : previous);
      void queryClient.invalidateQueries({ queryKey: ["agent", "activity", active.runId] });
      active.controller.abort();
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "后端查询取消失败");
    }
  }, [queryClient]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setActiveAssetScope(activeSessionId ? readAskAssetScope(activeSessionId) : null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionId]);

  const syncSessionUrl = useCallback((sessionId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (sessionId) {
      params.set("session", sessionId);
    } else {
      params.delete("session");
    }
    params.delete("turn");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `/ask?${nextQuery}` : "/ask", { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    const handoff = consumeAssetScopeHandoff("ask");
    const restored = readPreviewRestoreState<AskPremiumReturnState>("ask");
    if (initialTurnId) {
      clearPreviewRestoreState("ask");
      return;
    }

    if (!restored?.context.returnState) {
      if (handoff?.sessionId) {
        window.requestAnimationFrame(() => {
          setActiveSessionId(handoff.sessionId ?? "");
          setActiveAssetScope(handoff.scope);
        });
      }
      return;
    }

    const state = restored.context.returnState;
    window.requestAnimationFrame(() => {
      setActiveSessionId(handoff?.sessionId ?? state.activeSessionId);
      if (handoff) setActiveAssetScope(handoff.scope);
      setQuery(state.query);
      setSelectedKbIdsValue(state.selectedKbIdsValue);
      setSelectedAnswerMode(state.selectedAnswerMode ?? "STRICT");
      setConversations(state.conversations);
      setNextCursor(state.nextCursor);
      setMessagesBySession(state.messagesBySession);
      setLiveAgentActivity(state.liveAgentActivity ?? { steps: [] });
      setIsLoadingConversations(false);
      setIsLoadingMessages(false);
      clearPreviewRestoreState("ask");

      if (messageScrollRef.current) messageScrollRef.current.scrollTop = state.messageScrollTop;
      if (listScrollRef.current) listScrollRef.current.scrollTop = state.conversationListScrollTop;
    });
  }, [initialTurnId]);

  const loadConversations = useCallback(async (cursor?: string | null, append = false) => {
    if (append) setIsLoadingMoreConversations(true);
    else setIsLoadingConversations(true);
    setConversationError(null);

    try {
      const data = await apiClient.listConversations(CONVERSATION_PAGE_SIZE, cursor);
      setConversations((previous) => mergeConversations(append ? previous : [], data.items ?? []));
      setNextCursor(data.nextCursor ?? null);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : "会话列表加载失败");
    } finally {
      setIsLoadingConversations(false);
      setIsLoadingMoreConversations(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  useEffect(() => {
    if (!openMenuSessionId && !composerMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element) {
        if (event.target.closest("[data-conversation-menu]") || event.target.closest("[data-composer-menu]")) {
          return;
        }
      }

      setOpenMenuSessionId(null);
      setComposerMenu(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openMenuSessionId, composerMenu]);

  const updateComposerMenuPosition = useCallback(() => {
    if (!composerMenu) {
      setComposerMenuPosition(null);
      return;
    }

    const form = composerFormRef.current;
    const trigger = composerMenu === "kb"
      ? kbButtonRef.current
      : composerMenu === "mode"
        ? modeButtonRef.current
        : modelButtonRef.current;

    if (!form || !trigger) return;

    const formRect = form.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(286, window.innerWidth - 28);
    const minLeft = 12;
    const maxLeft = Math.max(minLeft, formRect.width - menuWidth - 12);
    const desiredLeft = triggerRect.left - formRect.left;

    setComposerMenuPosition({
      left: Math.min(Math.max(desiredLeft, minLeft), maxLeft),
      top: triggerRect.top - formRect.top - 10,
    });
  }, [composerMenu]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateComposerMenuPosition);
    if (!composerMenu) {
      return () => window.cancelAnimationFrame(frame);
    }

    window.addEventListener("resize", updateComposerMenuPosition);
    window.addEventListener("scroll", updateComposerMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateComposerMenuPosition);
      window.removeEventListener("scroll", updateComposerMenuPosition, true);
    };
  }, [composerMenu, updateComposerMenuPosition]);

  useEffect(() => {
    if (!activeSessionId || hasLoadedActiveMessages) return;

    let cancelled = false;
    const loadMessages = async () => {
      setIsLoadingMessages(true);
      setMessageError(null);

      try {
        const data = await apiClient.listConversationMessages(activeSessionId, HISTORY_LIMIT);
        if (!cancelled) {
          const nextNameCache = rememberAssetScopes(
            (data.turns ?? []).flatMap((turn) => (
              (turn.citations ?? []).map((citation) => ({
                assetId: citation.assetId,
                fileName: citation.fileName,
              }))
            )),
          );
          setAssetNameCache(nextNameCache);
          setMessagesBySession((previous) => ({
            ...previous,
            [activeSessionId]: turnsToMessages(data.turns ?? []),
          }));
        }
      } catch (error) {
        if (!cancelled) setMessageError(error instanceof Error ? error.message : "历史消息加载失败");
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    };

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, hasLoadedActiveMessages]);

  useEffect(() => {
    if (!activeSessionId || !hasLoadedActiveMessages || !activeTrackedAgentTask || !trackedAgentInProgress) return;
    const trackedTask = activeTrackedAgentTask;
    const frame = window.requestAnimationFrame(() => {
      setMessagesBySession((previous) => {
        const messages = previous[activeSessionId] ?? [];
        const alreadyPresent = messages.some((message) => (
          (trackedTask.runId && message.agentRunId === trackedTask.runId)
          || (trackedTask.turnId && message.turnId === trackedTask.turnId)
          || message.id === `${trackedTask.id}-assistant`
        ));
        if (alreadyPresent) return previous;
        return {
          ...previous,
          [activeSessionId]: [
            ...messages,
            {
              id: `${trackedTask.id}-user`,
              role: "user",
              content: trackedTask.label,
              sessionId: activeSessionId,
              turnId: trackedTask.turnId,
            },
            {
              id: `${trackedTask.id}-assistant`,
              role: "assistant",
              content: "Agent 正在处理回答…",
              sessionId: activeSessionId,
              turnId: trackedTask.turnId,
              answerStatus: "PROCESSING",
              executionMode: "AGENT",
              agentRunId: trackedTask.runId,
              pending: true,
            },
          ],
        };
      });
      setLiveAgentActivity((previous) => previous.sessionId === activeSessionId && previous.runId === trackedTask.runId
        ? previous
        : {
            sessionId: activeSessionId,
            runId: trackedTask.runId,
            status: "RUNNING",
            steps: [],
          });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionId, activeTrackedAgentTask, hasLoadedActiveMessages, trackedAgentInProgress]);

  const reconciledBackgroundTasksRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeSessionId || !hasLoadedActiveMessages || !activeTrackedAgentTask || trackedAgentInProgress) return;
    if (reconciledBackgroundTasksRef.current.has(activeTrackedAgentTask.id)) return;
    reconciledBackgroundTasksRef.current.add(activeTrackedAgentTask.id);
    let cancelled = false;
    void apiClient.listConversationMessages(activeSessionId, HISTORY_LIMIT).then((data) => {
      if (cancelled) return;
      setMessagesBySession((previous) => ({
        ...previous,
        [activeSessionId]: turnsToMessages(data.turns ?? []),
      }));
      setLiveAgentActivity((previous) => previous.sessionId === activeSessionId
        ? {
            ...previous,
            runId: activeTrackedAgentTask.runId ?? previous.runId,
            status: activeTrackedAgentTask.status === "success"
              ? "COMPLETED"
              : activeTrackedAgentTask.status === "cancelled" ? "CANCELLED" : "FAILED",
          }
        : previous);
    }).catch(() => {
      reconciledBackgroundTasksRef.current.delete(activeTrackedAgentTask.id);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, activeTrackedAgentTask, hasLoadedActiveMessages, trackedAgentInProgress]);

  useEffect(() => {
    if (initialTurnId && activeSessionId === initialSessionId) return;
    const scroller = messageScrollRef.current;
    const userMessages = scroller?.querySelectorAll<HTMLElement>(".ask-premium-user-message");
    if (!userMessages?.length) return;
    userMessages.item(userMessages.length - 1)?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [initialTurnId, initialSessionId, activeSessionId, activeMessages.length]);

  useEffect(() => {
    if (!isStreamingActiveSession) return;
    const scroller = messageScrollRef.current;
    if (!scroller) return;
    const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceToBottom > 320) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isStreamingActiveSession, lastActiveMessageContent]);

  useEffect(() => {
    if (!initialTurnId || !initialSessionId || activeSessionId !== initialSessionId || isLoadingMessages) return;
    if (!activeMessages.some((message) => message.turnId === initialTurnId)) return;

    const node = document.querySelector(`[data-turn-id="${CSS.escape(initialTurnId)}"]`);
    if (!node) return;

    node.scrollIntoView({ behavior: "auto", block: "center" });
  }, [initialTurnId, initialSessionId, activeSessionId, isLoadingMessages, activeMessages]);

  const handleConversationListScroll = () => {
    const element = listScrollRef.current;
    if (!element || !nextCursor || isLoadingMoreConversations) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 80) void loadConversations(nextCursor, true);
  };

  const handleNewConversation = () => {
    setActiveSessionId("");
    syncSessionUrl("");
    setMessageError(null);
    setStreamError(null);
    setOpenMenuSessionId(null);
    setRenamingSessionId(null);
    setLiveAgentActivity({ steps: [] });
  };

  function handleSelectConversation(sessionId: string) {
    setActiveSessionId(sessionId);
    syncSessionUrl(sessionId);
    setMessageError(null);
    setStreamError(null);
    setOpenMenuSessionId(null);
    setRenamingSessionId(null);
  }

  const handlePreviewCitation = useCallback((
    message: ChatMessage,
    citation: ConversationCitation,
    citationIndex: number,
    question?: string,
    targetChunk?: CitationChunk,
    citationLabel?: string,
  ) => {
    const selectedChunk = targetChunk ?? citation.chunks?.[0];
    if (!selectedChunk?.segmentId) return;

    const contextKey = savePreviewNavigation<AskPremiumReturnState>({
      source: "ask",
      navigationMode: "CITATION",
      sourceId: message.turnId,
      sessionId: message.sessionId,
      question,
      answer: stripTraceText(message.content),
      citations: normalizeConversationCitations(message.citations),
      returnState: {
        activeSessionId,
        query,
        selectedKbIdsValue,
        selectedAnswerMode,
        conversations,
        nextCursor,
        messagesBySession,
        liveAgentActivity,
        messageScrollTop: messageScrollRef.current?.scrollTop ?? 0,
        conversationListScrollTop: listScrollRef.current?.scrollTop ?? 0,
      },
    });
    const params = new URLSearchParams({
      from: "ask",
      contextKey,
      citationIndex: citationLabel ?? String(citation.citationIndex ?? citationIndex + 1),
    });

    router.push(`/preview/${encodeURIComponent(selectedChunk.segmentId)}?${params.toString()}`);
  }, [
    activeSessionId,
    conversations,
    messagesBySession,
    nextCursor,
    query,
    router,
    selectedAnswerMode,
    selectedKbIdsValue,
    liveAgentActivity,
  ]);

  const sendMessage = async (rawText: string, options: { clearComposer?: boolean } = {}) => {
    const text = rawText.trim();
    if (!text
      || messageSubmissionLockRef.current
      || isMessageSubmitting
      || streamingSessionId
      || latestAgentTaskInProgress
      || trackedAgentInProgress
      || (!activeSessionId && selectedKbIds.length === 0)) return;
    messageSubmissionLockRef.current = true;
    setIsMessageSubmitting(true);
    const requestAssetScope = activeAssetScope;
    const effectiveKbIds = requestAssetScope?.kbId ? [requestAssetScope.kbId] : selectedKbIds;

    if (options.clearComposer) {
      setQuery("");
    }

    setStreamError(null);
    setLiveAgentActivity({ steps: [] });

    let targetSessionId = activeSessionId;
    let backgroundTaskId: string | null = null;
    try {
      if (!targetSessionId) {
        const session = await apiClient.createConversation({
          title: null,
          kbIds: selectedKbIds,
        });
        targetSessionId = session.sessionId;
        setConversations((previous) => mergeConversations([{ ...session, title: session.title || "新对话" }], previous));
        setActiveSessionId(targetSessionId);
        syncSessionUrl(targetSessionId);
      }

      setLiveAgentActivity(agentEnabled
        ? { sessionId: targetSessionId, status: "RUNNING", steps: [] }
        : { steps: [] });

      const userMessage: ChatMessage = {
        id: makeMessageId("user"),
        role: "user",
        content: text,
        sessionId: targetSessionId,
      };
      const assistantMessage: ChatMessage = {
        id: makeMessageId("assistant"),
        role: "assistant",
        content: "",
        sessionId: targetSessionId,
        assetScope: requestAssetScope ? [requestAssetScope.assetId] : [],
        answerMode: selectedAnswerMode,
        executionMode: agentEnabled ? "AGENT" : "TRADITIONAL",
        pending: true,
      };
      const requestId = makeMessageId("stream");
      const controller = new AbortController();
      const isCurrentStream = () => (
        streamRef.current?.requestId === requestId &&
        streamRef.current.sessionId === targetSessionId
      );

      if (agentEnabled) {
        backgroundTaskId = requestId;
        registerAgentTask({
          id: requestId,
          sessionId: targetSessionId,
          label: text,
          startedAt: currentTimestamp(),
        });
      }
      streamRef.current = { requestId, sessionId: targetSessionId, controller, agentEnabled };
      setStreamingSessionId(targetSessionId);
      setMessagesBySession((previous) => ({
        ...previous,
        [targetSessionId]: [...(previous[targetSessionId] ?? []), userMessage, assistantMessage],
      }));
      moveConversationToTop(targetSessionId);

      await apiClient.sendMessageStream(
        targetSessionId,
        {
          query: text,
          kbIds: effectiveKbIds.length > 0 ? effectiveKbIds : undefined,
          assetIdList: requestAssetScope ? [requestAssetScope.assetId] : [],
          answerMode: selectedAnswerMode,
          agentEnabled,
        },
        {
          onTrace: (event) => {
            if (!isCurrentStream()) return;
            if (event.runId && streamRef.current) streamRef.current.runId = event.runId;
            const traceDetails = event.details ?? {};
            if (agentEnabled) {
              updateBackgroundAgentTask(requestId, {
                runId: event.runId,
                turnId: typeof traceDetails.turnId === "string" ? traceDetails.turnId : undefined,
                currentStage: typeof traceDetails.taskStage === "string"
                  ? traceDetails.taskStage
                  : event.message ?? event.stage,
              });
            }
            if (agentEnabled
              && ["agent_thinking", "tool_call", "tool_result", "task_queued"].includes(event.stage ?? "")
              && !(event.stage === "agent_thinking" && event.message === "run_started")) {
              const details = traceDetails;
              const callId = typeof details.callId === "string" ? details.callId : undefined;
              const stepOrder = activityNumber(details.stepOrder);
              const isTool = event.stage === "tool_call" || event.stage === "tool_result";
              const success = activityBoolean(details.success);
              const isStarted = event.stage === "tool_call"
                || event.message === "started"
                || event.message?.endsWith("_started") === true;
              const nextStep: AgentActivityStep = {
                stepOrder: stepOrder ?? 0,
                type: isTool ? "TOOL" : event.stage === "task_queued" ? "TASK_STAGE" : "MODEL_DECISION",
                toolName: typeof details.tool === "string" ? details.tool : undefined,
                callId,
                taskStage: event.stage === "task_queued" ? "QUEUED" : undefined,
                taskType: typeof details.taskType === "string" ? details.taskType : undefined,
                answerType: typeof details.answerType === "string" ? details.answerType : undefined,
                model: typeof details.model === "string" ? details.model : undefined,
                decision: typeof details.decision === "string" ? details.decision : undefined,
                status: isStarted
                  ? "RUNNING"
                  : success === false ? "FAILED" : "COMPLETED",
                attempt: activityNumber(details.attempt) ?? event.attempt,
                progress: activityNumber(details.progress),
                messageCount: activityNumber(details.messageCount),
                plannedToolCallCount: activityNumber(details.toolCallCount),
                evidenceCount: activityNumber(details.evidenceCount),
                documentCount: activityNumber(details.documentCount),
                segmentCount: activityNumber(details.segmentCount),
                batchCount: activityNumber(details.batchCount),
                citationCount: activityNumber(details.citationCount),
                hasMore: activityBoolean(details.hasMore),
                promptTokens: activityNumber(details.promptTokens),
                completionTokens: activityNumber(details.completionTokens),
                modelCallCount: activityNumber(details.modelCallCount),
                modelLatencyMs: activityNumber(details.modelLatencyMs),
                firstTokenMs: activityNumber(details.firstTokenMs),
                streaming: activityBoolean(details.streaming),
                durationMs: activityNumber(details.durationMs),
                createdAt: Date.now(),
                errorCode: typeof details.errorCode === "string" ? details.errorCode : undefined,
              };
              setLiveAgentActivity((previous) => ({
                sessionId: targetSessionId,
                runId: event.runId ?? previous.runId,
                status: event.stage === "task_queued" ? "WAITING_TASK" : previous.status ?? "RUNNING",
                steps: mergeLiveAgentStep(previous.sessionId === targetSessionId ? previous.steps : [], nextStep),
              }));
            }
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: true,
              answerMode: event.answerMode ?? message.answerMode,
              intent: event.intentType ? {
                ...message.intent,
                type: event.intentType,
                confidence: event.confidence,
                retrievalRequired: event.intentType === "KB_QUERY",
              } : message.intent,
              content: message.content || traceText(event.stage),
            }));
          },
          onDelta: (delta) => {
            if (!isCurrentStream()) return;
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: true,
              content: `${stripTraceText(message.content)}${delta}`,
            }));
          },
          onAnswerReset: (answer) => {
            if (!isCurrentStream()) return;
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: true,
              content: answer,
            }));
          },
          onCitations: (citations) => {
            if (!isCurrentStream()) return;
            const nextNameCache = rememberAssetScopes(citations.map((citation) => ({
              assetId: citation.assetId,
              fileName: citation.fileName,
            })));
            setAssetNameCache(nextNameCache);
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              citations,
            }));
          },
          onDone: (event) => {
            if (!isCurrentStream()) return;
            if (agentEnabled) {
              updateBackgroundAgentTask(requestId, {
                runId: event.runId,
                turnId: event.turnId,
                agentTaskId: event.agentTask?.taskId,
                currentStage: event.agentTask?.currentStage ?? undefined,
                status: event.answerStatus === "PROCESSING"
                  ? "running"
                  : event.answerStatus === "CANCELLED"
                    ? "cancelled"
                    : event.answerStatus === "MODEL_FALLBACK" ? "error" : "success",
              });
              setLiveAgentActivity((previous) => ({
                sessionId: targetSessionId,
                runId: event.runId ?? previous.runId,
                status: statusFromDone(event.executionMode, event.answerStatus),
                steps: previous.sessionId === targetSessionId ? previous.steps : [],
              }));
              if (event.runId) {
                void queryClient.invalidateQueries({ queryKey: ["agent", "activity", event.runId] });
              }
            }
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: event.answerStatus === "PROCESSING",
              turnId: event.turnId,
              assetScope: event.assetScope ?? message.assetScope,
              answerMode: event.answerMode ?? message.answerMode,
              answerStatus: event.answerStatus ?? message.answerStatus ?? "ANSWERED",
              answerFallbackReason: event.fallbackReason ?? message.answerFallbackReason,
              intent: event.intentType ? {
                ...message.intent,
                type: event.intentType,
                retrievalRequired: event.retrievalExecuted ?? event.intentType === "KB_QUERY",
              } : message.intent,
              executionMode: event.executionMode,
              agentRunId: event.runId,
              workflowVersion: event.workflowVersion,
              agentTask: event.agentTask,
              content: stripTraceText(message.content) || "未生成回答。",
            }));
            setConversations((previous) => previous.map((item) => (
              item.sessionId === targetSessionId
                ? {
                    ...item,
                    title: event.title || item.title || "新对话",
                    lastMessagePreview: text,
                    kbScope: event.kbScope ?? item.kbScope,
                    updatedAt: Date.now(),
                  }
                : item
            )));
          },
        },
        controller.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const accessDenied = isAccessDeniedError(error);
      if (accessDenied) {
        setPermissionNotice({
          title: "权限不足，无法发送消息",
          message: "当前角色没有发送消息的权限，请切换为具有相应权限的角色后重试。",
        });
      }
      const message = accessDenied
        ? "当前角色没有发送消息的权限"
        : error instanceof Error ? error.message : "消息发送失败";
      setStreamError(accessDenied ? null : message);
      if (agentEnabled) {
        if (backgroundTaskId) updateBackgroundAgentTask(backgroundTaskId, { status: "error" });
        setLiveAgentActivity((previous) => ({ ...previous, status: "FAILED" }));
      }
      if (targetSessionId) {
        setMessagesBySession((previous) => ({
          ...previous,
          [targetSessionId]: accessDenied
            ? (previous[targetSessionId] ?? []).filter((item) => !item.pending)
            : (previous[targetSessionId] ?? []).map((item) => (
                item.pending
                  ? { ...item, pending: false, error: message, content: stripTraceText(item.content) || "回答生成失败。" }
                  : item
              )),
        }));
      }
    } finally {
      if (streamRef.current?.sessionId === targetSessionId) {
        streamRef.current = null;
        setStreamingSessionId(null);
      }
      messageSubmissionLockRef.current = false;
      setIsMessageSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await sendMessage(query, { clearComposer: true });
  };

  const handleSelectGenerationConfig = async (config: CapabilityConfig) => {
    if (config.id === activeGenerationConfig?.id && config.enabled) {
      setComposerMenu(null);
      return;
    }

    setSelectedGenerationConfigId(config.id);
    setComposerMenu(null);

    try {
      await apiClient.selectCapabilityConfig("generation", config.id);
      await queryClient.invalidateQueries({ queryKey: ["settings", "generation", "all"] });
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "模型切换失败");
    }
  };

  const updateAssistantMessage = (
    sessionId: string,
    messageId: string,
    update: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessagesBySession((previous) => ({
      ...previous,
      [sessionId]: (previous[sessionId] ?? []).map((message) => (
        message.id === messageId ? update(message) : message
      )),
    }));
  };

  const moveConversationToTop = (sessionId: string) => {
    setConversations((previous) => {
      const item = previous.find((conversation) => conversation.sessionId === sessionId);
      if (!item) return previous;
      return [item, ...previous.filter((conversation) => conversation.sessionId !== sessionId)];
    });
  };

  const startRename = (conversation: ConversationSession) => {
    setRenamingSessionId(conversation.sessionId);
    setRenameValue(conversation.title || "新对话");
    setOpenMenuSessionId(null);
  };

  const submitRename = async (sessionId: string) => {
    const title = renameValue.trim();
    if (!title) return;

    setConversationError(null);
    const previous = conversations;
    setConversations((items) => items.map((item) => (
      item.sessionId === sessionId ? { ...item, title } : item
    )));
    setRenamingSessionId(null);

    try {
      const updated = await apiClient.renameConversation(sessionId, { title });
      setConversations((items) => items.map((item) => (
        item.sessionId === sessionId ? { ...item, ...updated } : item
      )));
    } catch (error) {
      setConversations(previous);
      const accessDenied = isAccessDeniedError(error);
      if (accessDenied) {
        setPermissionNotice({
          title: "权限不足，无法编辑会话",
          message: "当前角色没有编辑会话的权限，请切换为具有相应权限的角色后重试。",
        });
      }
      setConversationError(accessDenied
        ? null
        : error instanceof Error ? error.message : "重命名失败");
    }
  };

  const deleteConversation = async (sessionId: string) => {
    setConversationError(null);
    const previous = conversations;
    setConversations((items) => items.filter((item) => item.sessionId !== sessionId));
    setOpenMenuSessionId(null);
    setRenamingSessionId(null);

    if (activeSessionId === sessionId) {
      setActiveSessionId("");
      syncSessionUrl("");
      setMessageError(null);
      setStreamError(null);
      setLiveAgentActivity({ steps: [] });
    }

    try {
      await apiClient.deleteConversation(sessionId);
      setMessagesBySession((previousMessages) => {
        const next = { ...previousMessages };
        delete next[sessionId];
        return next;
      });
    } catch (error) {
      setConversations(previous);
      const accessDenied = isAccessDeniedError(error);
      if (accessDenied) {
        setPermissionNotice({
          title: "权限不足，无法删除会话",
          message: "当前角色没有删除会话的权限，请切换为具有相应权限的角色后重试。",
        });
      }
      setConversationError(accessDenied
        ? null
        : error instanceof Error ? error.message : "删除失败");
    }
  };

  const allKbsSelected = kbOptions.length > 0 && selectedKbIds.length === kbOptions.length;
  const clearActiveAssetScope = () => {
    if (activeSessionId) saveAskAssetScope(activeSessionId, null);
    setActiveAssetScope(null);
  };
  const prepareKbScopeChange = () => {
    if (!activeAssetScope) return;
    clearActiveAssetScope();
    setScopeNotice("已关闭“仅此资料”范围，并切换知识库");
  };
  const toggleAllKbs = () => {
    prepareKbScopeChange();
    setSelectedKbIdsValue(allKbsSelected ? [] : kbOptions.map((item) => item.id));
  };
  const toggleKb = (kbId: string) => {
    prepareKbScopeChange();
    if (selectedKbIds.includes(kbId)) {
      setSelectedKbIdsValue(selectedKbIds.filter((item) => item !== kbId));
      return;
    }
    setSelectedKbIdsValue([...selectedKbIds, kbId]);
  };

  return (
    <div className="premium-theme ask-premium-page ask-premium-ask-page ask-premium-entry-page min-h-screen overflow-hidden bg-[#f7f7f2] text-[#111315]" data-theme={theme} data-premium-theme={theme}>
      <div aria-hidden="true" className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(17,19,21,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(17,19,21,0.055)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      {scopeNotice ? (
        <TransientNotice message={scopeNotice} onDismiss={() => setScopeNotice(null)} />
      ) : null}
      {permissionNotice ? (
        <ActionErrorNotice
          title={permissionNotice.title}
          message={permissionNotice.message}
          onDismiss={() => setPermissionNotice(null)}
        />
      ) : null}

      <div className="relative h-screen p-0">
        <div
          className="ask-premium-shell ask-premium-chat-shell grid h-screen grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border-0 bg-white/70 shadow-none backdrop-blur-2xl lg:grid-cols-[60px_280px_minmax(0,1fr)_350px] lg:grid-rows-none"
          data-history-collapsed={historyCollapsed}
          data-layout-transition-ready={layoutTransitionReady}
          data-trace-collapsed={traceCollapsed}
        >
          <PremiumRail />

          <aside
            data-conversation-scroll
            className={[
              "ask-premium-history flex min-h-0 flex-col overflow-y-auto overflow-x-hidden border-b border-black/10 bg-[#f7f7f2]/75 transition-[padding] duration-300 lg:border-b-0 lg:border-r",
              historyCollapsed ? "p-0" : "p-4",
            ].join(" ")}
            ref={listScrollRef}
            onScroll={handleConversationListScroll}
          >
            <div className={historyCollapsed ? "hidden" : "ask-premium-muted mb-4 text-xs font-black text-slate-500"}>
              CONVERSATIONS
            </div>
            <div
              id="ask-premium-history-content"
              className={historyCollapsed ? "hidden" : "flex min-h-0 flex-1 flex-col"}
            >
              <button
                type="button"
                onClick={handleNewConversation}
                className="ask-premium-new-chat mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#111315] px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(17,19,21,0.18)]"
              >
                <Plus size={17} /> 新对话
              </button>
              <div className="min-w-0 flex-1 pr-1 lg:pr-2">
              {isLoadingConversations ? (
                <div className="flex min-h-36 items-center justify-center" aria-label="加载会话">
                  <Loader2 className="animate-spin text-[var(--premium-muted)]" size={22} aria-hidden="true" />
                </div>
              ) : conversations.length ? (
                <div className="grid auto-cols-[minmax(210px,72vw)] grid-flow-col gap-2 overflow-x-auto lg:w-full lg:min-w-0 lg:grid-flow-row lg:auto-cols-auto lg:overflow-x-hidden">
                  {conversations.map((conversation) => (
                    <PremiumConversationItem
                      key={conversation.sessionId}
                      conversation={conversation}
                      active={conversation.sessionId === activeSessionId}
                      menuOpen={openMenuSessionId === conversation.sessionId}
                      renaming={renamingSessionId === conversation.sessionId}
                      renameValue={renameValue}
                      onSelect={() => handleSelectConversation(conversation.sessionId)}
                      onToggleMenu={() => setOpenMenuSessionId((value) => (
                        value === conversation.sessionId ? null : conversation.sessionId
                      ))}
                      onStartRename={() => startRename(conversation)}
                      onRenameValueChange={setRenameValue}
                      onSubmitRename={() => void submitRename(conversation.sessionId)}
                      onCancelRename={() => setRenamingSessionId(null)}
                      onDelete={() => void deleteConversation(conversation.sessionId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="ask-premium-empty-state rounded-[8px] border border-black/10 bg-white/70 p-4 text-sm text-slate-500">暂无历史会话。</div>
              )}
              {isLoadingMoreConversations ? (
                <div className="flex justify-center py-3" aria-label="加载更多会话">
                  <Loader2 className="animate-spin text-[var(--premium-muted)]" size={16} aria-hidden="true" />
                </div>
              ) : nextCursor ? (
                <button type="button" onClick={() => void loadConversations(nextCursor, true)} className="mt-3 h-9 w-full rounded-[8px] text-xs font-bold text-slate-500 hover:bg-white/70">
                  加载更多
                </button>
              ) : null}
              {conversationError ? <div className="ask-premium-error mt-3 rounded-[8px] bg-rose-50 px-3 py-2 text-xs text-rose-700">{conversationError}</div> : null}
              </div>
            </div>
          </aside>

          <main className="ask-premium-main ask-premium-no-ambient-glow relative flex min-h-0 min-w-0 flex-col bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4))]">
            <button
              type="button"
              onClick={() => {
                setOpenMenuSessionId(null);
                setHistoryCollapsed((value) => {
                  const next = !value;
                  try { window.localStorage.setItem(ASK_HISTORY_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
                  return next;
                });
              }}
              className="absolute left-0 top-1/2 z-30 hidden size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--premium-line)] bg-[var(--premium-elevated)] text-[var(--premium-muted)] shadow-[0_8px_24px_rgba(17,19,21,0.14)] transition hover:border-[var(--premium-focus-line)] hover:text-[var(--premium-ink)] lg:grid"
              aria-expanded={!historyCollapsed}
              aria-controls="ask-premium-history-content"
              aria-label={historyCollapsed ? "展开会话历史" : "折叠会话历史"}
              title={historyCollapsed ? "展开会话历史" : "折叠会话历史"}
            >
              {historyCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </button>
            <header className="ask-premium-hero relative grid min-h-[112px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div aria-hidden="true" className="ask-premium-watermark pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05]">
                ASK
              </div>
              <div className="ask-premium-hero-copy relative z-10 min-w-0">
                <p className="ask-premium-kicker ask-premium-mode-kicker mb-1.5 text-[10px] font-black">
                  ASK / {selectedAnswerMode} ANSWER MODE
                </p>
                <h1 className="max-w-[720px] text-[clamp(28px,3.2vw,42px)] font-black leading-none">Anchor Your Answer</h1>
              </div>
              <div className="relative z-20 hidden lg:block">
                <button
                  type="button"
                  className="ask-premium-trace-toggle"
                  onClick={() => {
                    setTraceHintVisible(false);
                    setTraceCollapsed((value) => {
                      const next = !value;
                      try { window.localStorage.setItem(ASK_TRACE_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
                      return next;
                    });
                  }}
                  aria-expanded={!traceCollapsed}
                  aria-label={traceCollapsed ? "展开 Session Context" : "收起 Session Context"}
                  title={traceCollapsed ? "展开 Session Context" : "收起 Session Context"}
                >
                  <SessionContextToggleIcon collapsed={traceCollapsed} />
                </button>
                {traceCollapsed && traceHintVisible ? (
                  <div className="ask-premium-trace-hint" role="status">
                    <span aria-hidden="true" />
                    点击这里展开 Session Context
                  </div>
                ) : null}
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-5 lg:px-5">
              <div
                className="ask-premium-conversation-frame mx-auto flex min-h-0 w-full flex-1 flex-col gap-0 lg:w-[calc(100vw-780px)] lg:max-w-full"
                data-trace-collapsed={traceCollapsed}
              >
                <section ref={messageScrollRef} className="ask-premium-message-scroll min-h-0 flex-1 overflow-auto pr-1 pt-3">
                  <div className="relative grid min-h-full content-start gap-4">
                    {messageError ? (
                      <ErrorBlock message={messageError} />
                    ) : isLoadingMessages ? (
                      <div className="ask-premium-inline-loading absolute inset-0 grid place-items-center" aria-label="加载中">
                        <span className="ask-premium-spinner" aria-hidden="true" />
                      </div>
                    ) : activeMessages.length ? (
                      activeMessages.map((message, index) => (
                        <PremiumChatBubble
                          key={message.id}
                          message={message}
                          theme={theme}
                          question={activeMessages[index - 1]?.role === "user" ? activeMessages[index - 1]?.content : undefined}
                          onPreviewCitation={handlePreviewCitation}
                          onSubmitUserEdit={(value) => sendMessage(value)}
                          canSubmitUserEdit={!isMessageSubmitting && !streamingSessionId && !latestAgentTaskInProgress}
                          assetNameCache={assetNameCache}
                        />
                      ))
                    ) : (
                      <EmptyPremiumChat />
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </section>

                <form
                  ref={composerFormRef}
                  className="ask-premium-composer relative z-20 grid shrink-0 gap-3 rounded-[16px] border border-black/10 bg-white/90 p-3 shadow-[0_14px_38px_rgba(17,19,21,0.1)] backdrop-blur-xl"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmit();
                  }}
                >
                  {streamError ? <div className="ask-premium-error rounded-[8px] bg-rose-50 px-3 py-2 text-sm text-rose-700">{streamError}</div> : null}
                  {activeAssetScope ? (
                    <div className="flex min-w-0 items-center">
                      <AssetScopeChip scope={activeAssetScope} onClear={clearActiveAssetScope} />
                    </div>
                  ) : null}
                  <label className="text-xs font-black text-slate-500" htmlFor="ask-premium-input">
                    MESSAGE
                  </label>
                  <textarea
                    id="ask-premium-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey) return;
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;

                      event.preventDefault();
                      if (canSubmit) void handleSubmit();
                    }}
                    enterKeyHint="send"
                    placeholder={latestAgentTaskInProgress
                      ? latestAgentTaskCancelling
                        ? "正在取消后台任务…"
                        : "后台任务执行中，可编辑草稿；点击 X 取消"
                      : "给 Anchr 发送消息"}
                    className="ask-premium-textarea max-h-40 min-h-[52px] w-full resize-none border-0 bg-transparent text-slate-950 outline-none placeholder:text-slate-400"
                  />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_42px] items-center gap-2.5 max-sm:block max-sm:w-full max-sm:max-w-full">
                    <div className="ask-premium-control-strip flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible pr-1 max-sm:w-full max-sm:max-w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:overflow-y-visible max-sm:py-1 max-sm:pr-[52px] max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden" data-composer-menu>
                      <ComposerButton
                        active={agentEnabled && agentAvailable}
                        disabled={!agentAvailable}
                        icon={<AiStarIcon />}
                        label={agentAvailable ? `Agent · ${agentEnabled ? "开启" : "关闭"}` : "Agent · 后端未开启"}
                        onClick={toggleAgent}
                      />
                      <ComposerButton
                        ref={kbButtonRef}
                        active={composerMenu === "kb"}
                        icon={<KnowledgeControlIcon />}
                        label={`知识库 · ${selectedKbIds.length || 0} 个`}
                        onClick={() => setComposerMenu((value) => (value === "kb" ? null : "kb"))}
                      />
                      <ComposerButton
                        ref={modeButtonRef}
                        active={composerMenu === "mode"}
                        icon={<ModeControlIcon />}
                        label={selectedAnswerModeLabel}
                        onClick={() => setComposerMenu((value) => (value === "mode" ? null : "mode"))}
                      />
                      <ComposerButton
                        ref={modelButtonRef}
                        active={composerMenu === "model"}
                        icon={<ModelControlIcon />}
                        label={activeGenerationConfig?.modelName || activeGenerationConfig?.baseUrl || "选择模型"}
                        onClick={() => setComposerMenu((value) => (value === "model" ? null : "model"))}
                      />
                    </div>
                    <button
                      type={latestAgentTaskInProgress || isStreamingActiveSession ? "button" : "submit"}
                      onClick={latestAgentTaskInProgress && latestAgentTask
                        ? () => void cancelAgentTask(latestAgentTask.taskId)
                        : canCancelActiveQuery ? () => void cancelActiveQuery() : undefined}
                      disabled={latestAgentTaskInProgress
                        ? latestAgentTaskCancelling
                        : isStreamingActiveSession ? !canCancelActiveQuery : !canSubmit}
                      aria-busy={latestAgentTaskCancelling || undefined}
                      className="ask-premium-send-button grid size-[42px] shrink-0 place-items-center rounded-full bg-[#111315] text-white shadow-none transition hover:-translate-y-0.5 hover:scale-[1.03] hover:bg-blue-600 disabled:bg-[#111315] disabled:text-white disabled:opacity-100 disabled:shadow-none max-sm:fixed max-sm:bottom-[76px] max-sm:left-[min(322px,calc(100vw-72px))] max-sm:z-[60] max-sm:size-[42px]"
                      aria-label={latestAgentTaskInProgress
                        ? latestAgentTaskCancelling ? "正在取消后台任务" : "取消后台任务"
                        : canCancelActiveQuery ? "取消查询" : isStreamingActiveSession ? "生成中" : "发送"}
                      title={latestAgentTaskInProgress
                        ? latestAgentTaskCancelling ? "正在取消后台任务" : "点击取消后台任务"
                        : canCancelActiveQuery ? "取消查询" : isStreamingActiveSession ? "生成中" : "发送"}
                    >
                      {latestAgentTaskInProgress ? <X size={20} />
                        : canCancelActiveQuery ? <X size={20} />
                          : isStreamingActiveSession
                            ? <Loader2 className="animate-spin" size={20} />
                            : <SendGlyph />}
                    </button>
                  </div>

                  {composerMenu === "kb" ? (
                    <FloatingMenu position={composerMenuPosition}>
                      <MenuHeader label="KNOWLEDGE BASES" value="MULTI" />
                      <MenuOption selected={allKbsSelected} onClick={toggleAllKbs} checkbox title="全部知识库" detail="发送时覆盖当前可用知识库" />
                      {kbsQuery.isLoading ? (
                        <div className="px-3 py-3 text-sm text-slate-500">加载知识库...</div>
                      ) : kbOptions.length ? (
                        kbOptions.map((item) => (
                          <MenuOption
                            key={item.id}
                            selected={selectedKbIds.includes(item.id)}
                            onClick={() => toggleKb(item.id)}
                            checkbox
                            icon={<Folder size={16} />}
                            title={item.name}
                            detail="知识库范围"
                          />
                        ))
                      ) : (
                        <div className="rounded-[8px] bg-[#f7f7f2] p-3 text-sm text-slate-500">暂无可选知识库</div>
                      )}
                    </FloatingMenu>
                  ) : null}

                  {composerMenu === "mode" ? (
                    <FloatingMenu position={composerMenuPosition}>
                      <MenuHeader label="ANSWER MODE" value="SINGLE" />
                      {ANSWER_MODES.map((mode) => (
                        <MenuOption
                          key={mode.value}
                          selected={selectedAnswerMode === mode.value}
                          onClick={() => {
                            setSelectedAnswerMode(mode.value);
                            setComposerMenu(null);
                          }}
                          title={`${mode.label} · ${mode.value}`}
                          detail={mode.detail}
                        />
                      ))}
                    </FloatingMenu>
                  ) : null}

                  {composerMenu === "model" ? (
                    <FloatingMenu position={composerMenuPosition}>
                      <MenuHeader label="GENERATION MODEL" value="GLOBAL" />
                      {generationQuery.isLoading ? (
                        <div className="px-3 py-3 text-sm text-slate-500">加载模型配置...</div>
                      ) : generationConfigs.length ? (
                        generationConfigs.map((config) => (
                          <MenuOption
                            key={config.id}
                            selected={config.id === activeGenerationConfig?.id}
                            onClick={() => void handleSelectGenerationConfig(config)}
                            title={config.modelName || config.baseUrl || "未命名模型"}
                            detail={`${config.enabled ? "生效中" : "可切换"}`}
                          />
                        ))
                      ) : (
                        <div className="rounded-[8px] bg-[#f7f7f2] p-3 text-sm text-slate-500">暂无可用模型，请先到 Settings 配置</div>
                      )}
                    </FloatingMenu>
                  ) : null}
                </form>
              </div>
            </div>
          </main>

          <TracePanel
            answerMode={selectedAnswerMode}
            selectedKbLabel={selectedKbLabel}
            modelLabel={activeGenerationConfig?.modelName || activeGenerationConfig?.baseUrl || "未配置模型"}
            latestAssistantMessage={latestAssistantMessage}
            liveActivity={activeLiveAgentActivity}
            serverActivity={agentActivityQuery.data}
            activityLoading={agentActivityQuery.isLoading}
            activityError={agentActivityQuery.isError}
            collapsed={traceCollapsed}
          />
        </div>
      </div>
    </div>
  );
}

function TracePanel({
  answerMode,
  selectedKbLabel,
  modelLabel,
  latestAssistantMessage,
  liveActivity,
  serverActivity,
  activityLoading,
  activityError,
  collapsed,
}: {
  answerMode: ConversationAnswerMode;
  selectedKbLabel: string;
  modelLabel: string;
  latestAssistantMessage?: ChatMessage;
  liveActivity?: LiveAgentActivity;
  serverActivity?: AgentRunActivity;
  activityLoading: boolean;
  activityError: boolean;
  collapsed: boolean;
}) {
  const answerModeProgress = {
    STRICT: "100%",
    SUMMARY: "66%",
    EXPLORE: "33%",
  } satisfies Record<ConversationAnswerMode, string>;

  return (
    <aside
      className="ask-premium-trace relative hidden min-h-0 min-w-0 overflow-hidden border-l border-black/10 bg-[#111315] text-white lg:block"
      data-collapsed={collapsed}
      aria-label="Session Context"
    >
      <div className="ask-premium-trace-content">
        <p className="ask-premium-trace-heading flex items-center justify-between text-xs font-black text-white/60">
          SESSION CONTEXT
        </p>
        <section className="ask-premium-trace-hero grid min-w-0 gap-3 overflow-hidden rounded-[8px] border border-white/15 bg-white/10 p-4">
          <span className="text-xs font-black text-white/60">ANSWER MODE</span>
          <strong className="ask-premium-answer-mode-title block min-w-0 max-w-full break-words font-black leading-none">{answerMode}</strong>
          <div className="ask-premium-answer-mode-bar h-2 w-full min-w-0 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-[var(--ask-accent)] transition-[width] duration-300 ease-out"
              style={{ width: answerModeProgress[answerMode] }}
            />
          </div>
        </section>
        <div className="ask-premium-trace-metadata grid min-w-0 grid-cols-2 gap-2">
          <TraceCard label="MODEL" title={modelLabel} detail="Generation capability" />
          <TraceCard label="KNOWLEDGE BASES" title={selectedKbLabel} detail="当前问答范围" />
        </div>
        <AgentActivityCard
          latestAssistantMessage={latestAssistantMessage}
          liveActivity={liveActivity}
          serverActivity={serverActivity}
          loading={activityLoading}
          failed={activityError}
        />
      </div>
    </aside>
  );
}

function AgentActivityCard({
  latestAssistantMessage,
  liveActivity,
  serverActivity,
  loading,
  failed,
}: {
  latestAssistantMessage?: ChatMessage;
  liveActivity?: LiveAgentActivity;
  serverActivity?: AgentRunActivity;
  loading: boolean;
  failed: boolean;
}) {
  const latestUsesAgent = latestAssistantMessage?.executionMode === "AGENT"
    || latestAssistantMessage?.executionMode === "AGENT_FALLBACK";
  const hasLiveAgent = Boolean(liveActivity?.sessionId);
  const isAgent = hasLiveAgent || latestUsesAgent;
  const status = resolveAgentActivityStatus(
    serverActivity?.status,
    liveActivity?.status,
    statusFromTask(latestAssistantMessage?.agentTask),
  );
  const mergedSteps = mergeAgentActivitySteps(serverActivity?.steps ?? [], liveActivity?.steps ?? []);
  const taskSteps = mergeTaskProgressStep(mergedSteps, latestAssistantMessage?.agentTask);
  const steps = status === "CANCELLED" ? cancelRunningAgentSteps(taskSteps) : taskSteps;
  const totalTokens = (serverActivity?.promptTokens ?? 0) + (serverActivity?.completionTokens ?? 0);
  const promptTokens = serverActivity?.promptTokens ?? 0;
  const completionTokens = serverActivity?.completionTokens ?? 0;
  const activityScrollRef = useRef<HTMLDivElement | null>(null);
  const hasRunningStep = steps.some((step) => step.status === "RUNNING");
  const [activityClock, setActivityClock] = useState<number>();

  useEffect(() => {
    if (!hasRunningStep) return;
    const timer = window.setInterval(() => setActivityClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [hasRunningStep]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = activityScrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [steps.length, status, latestAssistantMessage?.agentTask?.progress]);

  return (
    <section className="ask-premium-trace-timeline flex min-h-0 flex-1 flex-col rounded-[8px] border border-white/10 bg-white/10 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black text-white/60">AGENT ACTIVITY</span>
          {isAgent ? (
            <p className="mt-1 text-[10px] text-white/45">
              {serverActivity ? `${serverActivity.toolCallCount} 次工具调用 · 实时指标` : "实时执行时间线"}
            </p>
          ) : null}
        </div>
        {isAgent && status ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-[10px] font-black text-[var(--ask-accent-text)]">
            {status === "RUNNING" || status === "AWAITING_TURN" || status === "WAITING_TASK" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {status !== "RUNNING" && status !== "AWAITING_TURN" && status !== "WAITING_TASK" ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--ask-accent-text)]" /> : null}
            {agentStatusLabel(status)}
          </span>
        ) : null}
      </div>
      {isAgent ? (
        <div className="mb-3 grid shrink-0 grid-cols-[0.8fr_1.35fr_1fr] overflow-hidden rounded-[8px] border border-white/10 bg-black/20">
          <AgentRunMetric label="步骤" value={String(steps.length)} detail="执行节点" />
          <AgentRunMetric
            label="Token"
            value={totalTokens > 0 ? compactNumber(totalTokens) : "—"}
            detail={totalTokens > 0 ? `输入 ${compactNumber(promptTokens)} · 输出 ${compactNumber(completionTokens)}` : "暂无用量"}
          />
          <AgentRunMetric
            label="端到端"
            value={serverActivity?.latencyMs != null ? formatMilliseconds(serverActivity.latencyMs) : "—"}
            detail="完整流程"
          />
        </div>
      ) : null}
      {!latestAssistantMessage && !hasLiveAgent ? (
        <AgentActivityEmpty title="等待提问" detail="Agent 执行流程将在这里展示。" />
      ) : !isAgent ? (
        <AgentActivityEmpty title="本轮使用传统 RAG" detail="未启用 Agent，因此没有工具调用流程。" />
      ) : loading && steps.length === 0 ? (
        <AgentActivityEmpty title="正在加载流程" detail="正在恢复本轮 Agent 执行记录。" loading />
      ) : failed && steps.length === 0 ? (
        <AgentActivityEmpty title="Agent 流程暂不可用" detail="回答与引用不受影响。" />
      ) : (
        <div ref={activityScrollRef} className="ask-premium-activity-scroll grid min-h-0 flex-1 content-start gap-2 overflow-auto pr-1">
          {steps.map((step, index) => (
            <AgentActivityStepItem
              key={agentStepKey(step)}
              step={step}
              position={index + 1}
              ordinal={steps.filter((candidate) => candidate.stepOrder <= step.stepOrder && candidate.type === step.type).length}
              currentTime={activityClock}
              isLast={index === steps.length - 1}
            />
          ))}
          {steps.length === 0 ? (
            <AgentActivityEmpty title="正在执行" detail="等待 Agent 返回第一个安全操作事件。" loading={status === "RUNNING"} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function AgentRunMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex min-h-[68px] min-w-0 flex-col overflow-hidden border-l border-white/10 px-3 py-2.5 first:border-l-0">
      <span className="block shrink-0 text-[9px] font-black uppercase leading-none tracking-[0.1em] text-white/45">{label}</span>
      <strong className="mt-1.5 block shrink-0 truncate text-[15px] leading-none tracking-[-0.02em] text-white/90">{value}</strong>
      {detail ? <span className="mt-2 block shrink-0 whitespace-nowrap text-[8px] leading-none text-white/45">{detail}</span> : null}
    </div>
  );
}

function AgentActivityEmpty({ title, detail, loading = false }: { title: string; detail: string; loading?: boolean }) {
  return (
    <div className="ask-premium-trace-empty rounded-[8px] bg-black/20 p-3 text-xs leading-5 text-white/60">
      <div className="flex items-center gap-2 font-black text-white/85">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ask-accent-text)]" /> : null}
        <span>{title}</span>
      </div>
      <p className="mt-1">{detail}</p>
    </div>
  );
}

function AgentActivityStepItem({
  step,
  position,
  ordinal,
  currentTime,
  isLast,
}: {
  step: AgentActivityStep;
  position: number;
  ordinal: number;
  currentTime?: number;
  isLast: boolean;
}) {
  const progress = displayedAgentStepProgress(step);
  const summary = agentStepSummary(step);
  const metrics = agentStepMetrics(step, currentTime);
  const stepSurface = step.status === "RUNNING"
    ? "bg-[var(--ask-accent-softest)]"
    : step.status === "FAILED" || step.status === "CANCELLED" ? "bg-red-400/[0.05]" : "";
  return (
    <div className="ask-premium-trace-event flex items-stretch gap-2.5">
      <div className="relative flex w-5 shrink-0 justify-center">
        <span className={`relative z-[1] mt-2 flex size-5 items-center justify-center rounded-full p-0 text-center text-[9px] font-black leading-none tabular-nums ${step.status === "FAILED" || step.status === "CANCELLED" ? "bg-red-400/20 text-red-300" : step.status === "RUNNING" ? "bg-[var(--ask-accent-text)] text-[#111315]" : "border border-white/10 bg-black/20 text-white/55"}`}>{String(position).padStart(2, "0")}</span>
        {!isLast ? <span className="absolute bottom-[-8px] top-7 w-px bg-white/10" /> : null}
      </div>
      <div className={`mb-2.5 min-w-0 flex-1 rounded-[7px] px-2.5 py-2 ${stepSurface}`}>
        <div className="flex items-center justify-between gap-3 text-xs font-black text-white/90">
          <span>{agentStepTitle(step, ordinal)}</span>
          <span className="flex shrink-0 items-center gap-1 text-[9px] text-white/45">
            {step.status === "RUNNING" ? <Loader2 className="h-3 w-3 animate-spin text-[var(--ask-accent-text)]" /> : null}
            {agentStepStatusLabel(step.status)}
          </span>
        </div>
        {summary ? <p className="mt-1 break-words text-[11px] leading-[1.55] text-white/60">{summary}</p> : null}
        {metrics.length > 0 ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-white/10 pt-2">
            {metrics.map((metric) => (
              <div
                key={`${metric.label}:${metric.value}`}
                className="flex min-w-0 items-baseline justify-between gap-1.5 text-[9px]"
              >
                <dt className="shrink-0 text-white/45">{metric.label}</dt>
                <dd className={`truncate font-semibold ${metric.tone === "accent" ? "text-[var(--ask-accent-text)]" : metric.tone === "danger" ? "text-red-300" : "text-white/60"}`}>{metric.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {progress != null ? (
          <div className="mt-2.5">
            <div className="mb-1 flex items-center justify-between text-[9px] text-white/45">
              <span>阶段进度</span>
              <strong className="text-white/60">{progress}%</strong>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-[var(--ask-accent)] transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function mergeAgentActivitySteps(persisted: AgentActivityStep[], live: AgentActivityStep[]) {
  const merged = new Map<string, AgentActivityStep>();
  persisted.filter(hasValidAgentStepOrder).forEach((step) => merged.set(agentStepKey(step), step));
  live.filter(hasValidAgentStepOrder).forEach((step) => {
    const key = agentStepKey(step);
    const stored = merged.get(key);
    if (!stored) {
      merged.set(key, step);
    } else if (step.errorCode && !stored.errorCode) {
      merged.set(key, mergeDefinedAgentStep(stored, step));
    } else if (stored.status === "RUNNING" && step.status !== "RUNNING") {
      merged.set(key, mergeDefinedAgentStep(stored, step));
    } else {
      merged.set(key, { ...step, ...stored });
    }
  });
  return Array.from(merged.values())
    .sort(compareAgentSteps)
    .slice(-50);
}

function hasValidAgentStepOrder(step: AgentActivityStep) {
  return Number.isFinite(step.stepOrder) && step.stepOrder > 0;
}

function cancelRunningAgentSteps(steps: AgentActivityStep[]) {
  return steps.map((step) => step.status === "RUNNING"
    ? {
        ...step,
        status: "CANCELLED" as const,
        durationMs: step.durationMs ?? (step.createdAt == null
          ? undefined
          : Math.max(0, Date.now() - step.createdAt)),
      }
    : step);
}

function agentStepKey(step: AgentActivityStep) {
  if (step.callId && step.type === "TOOL") return `tool:${step.callId}`;
  if (step.callId && step.type === "TASK_STAGE") return `task:${step.callId}:${step.taskStage ?? "QUEUED"}`;
  return `${step.type}:${step.stepOrder}:${step.taskStage ?? ""}`;
}

function mergeTaskProgressStep(steps: AgentActivityStep[], task?: AgentTask) {
  if (!task) return steps;
  const taskStage = task.currentStage || (task.status === "PENDING" ? "QUEUED" : undefined);
  if (!taskStage) return steps;
  const status: AgentActivityStep["status"] = task.status === "FAILED"
    ? "FAILED"
    : task.status === "CANCELLED" ? "CANCELLED" : task.status === "SUCCEEDED" ? "COMPLETED" : "RUNNING";
  const index = steps.findIndex((step) => step.type === "TASK_STAGE" && step.taskStage === taskStage);
  if (index >= 0) {
    const next = [...steps];
    next[index] = { ...next[index], progress: task.progress, status };
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

function resolveAgentActivityStatus(
  server?: AgentActivityStatus,
  live?: AgentActivityStatus,
  task?: AgentActivityStatus,
) {
  const terminal = new Set<AgentActivityStatus>(["COMPLETED", "FAILED", "CANCELLED", "AGENT_DEGRADED", "AGENT_FALLBACK"]);
  if (server && terminal.has(server)) return server;
  if (task && terminal.has(task)) return task;
  if (live && terminal.has(live)) return live;
  return task ?? server ?? live;
}

function agentStepTitle(step: AgentActivityStep, ordinal: number) {
  if (step.type === "MODEL_DECISION") {
    if (step.decision === "FINAL_RESPONSE") return "生成最终回答";
    return ordinal === 1 ? "分析用户请求" : "评估工具结果";
  }
  if (step.type === "TASK_STAGE") return taskStageLabel(step.taskStage);
  if (step.type === "FINAL") return step.status === "FAILED" ? "执行失败" : step.status === "CANCELLED" ? "已取消" : "完成";
  if (step.decision === "READ_LIMIT_REACHED") return "停止继续读取";
  return {
    find_documents: "查找文档",
    search_knowledge: "检索知识库",
    read_document: "读取文档",
    summarize_documents: "创建文档任务",
    deliver_answer: "生成回答",
  }[step.toolName ?? ""] ?? step.toolName ?? "执行工具";
}

function agentStepSummary(step: AgentActivityStep) {
  const details: string[] = [];
  if (step.type === "MODEL_DECISION") {
    if (step.messageCount != null) details.push(`读取 ${step.messageCount} 条上下文消息`);
    if (step.decision === "ANALYZING") details.push("正在等待模型决策");
    if (step.decision === "TOOL_SELECTION") details.push(`决定调用 ${step.plannedToolCallCount ?? 1} 个工具`);
    if (step.decision === "FINAL_RESPONSE") details.push("决定生成最终回答");
    if (step.decision === "PROTOCOL_RETRY") details.push("协议校正后重新决策");
  }
  if (step.decision === "READ_LIMIT_REACHED") {
    details.push("已达到单轮连续读取上限，使用现有证据生成回答");
  }
  if (step.answerType) details.push(step.answerType === "KNOWLEDGE" ? "知识回答" : step.answerType === "CHAT" ? "直接回答" : step.answerType);
  if (step.taskType) details.push(step.taskType === "DOCUMENT_SUMMARY" ? "文档总结" : step.taskType);
  if (step.documentCount != null) details.push(`${step.documentCount} 份文档`);
  if (step.evidenceCount != null) details.push(`${step.evidenceCount} 条证据`);
  if (step.segmentCount != null) details.push(`${step.segmentCount} 个片段`);
  if (step.batchCount != null) details.push(`${step.batchCount} 个处理批次`);
  if (step.citationCount != null) details.push(`${step.citationCount} 条引用`);
  if (step.hasMore === true) details.push("仍有后续内容");
  return details.join(" · ");
}

type AgentStepMetric = {
  label: string;
  value: string;
  tone?: "default" | "accent" | "danger";
};

function agentStepMetrics(step: AgentActivityStep, currentTime?: number): AgentStepMetric[] {
  const metrics: AgentStepMetric[] = [];
  const modelLatency = step.modelLatencyMs
    ?? (step.type === "MODEL_DECISION" && step.status !== "RUNNING" ? step.durationMs : undefined);
  if (step.model) metrics.push({ label: "模型", value: step.model });
  if (step.modelCallCount != null && step.modelCallCount > 1) {
    metrics.push({ label: "调用", value: `${step.modelCallCount} 次` });
  }
  if ((step.promptTokens ?? 0) + (step.completionTokens ?? 0) > 0) {
    metrics.push({
      label: "Token",
      value: `↑${compactNumber(step.promptTokens ?? 0)} ↓${compactNumber(step.completionTokens ?? 0)}`,
    });
  }
  if (step.firstTokenMs != null) metrics.push({ label: "首字", value: formatMilliseconds(step.firstTokenMs) });
  if (modelLatency != null) metrics.push({ label: "模型耗时", value: formatMilliseconds(modelLatency) });
  const generationMs = modelLatency != null && step.firstTokenMs != null
    ? modelLatency - step.firstTokenMs
    : undefined;
  if ((step.modelCallCount ?? 1) === 1 && (step.completionTokens ?? 0) > 0 && generationMs != null && generationMs > 0) {
    metrics.push({
      label: "速率",
      value: `${((step.completionTokens ?? 0) * 1000 / generationMs).toFixed(1)} tok/s`,
    });
  }
  if (step.attempt != null && step.attempt > 1) metrics.push({ label: "尝试", value: `第 ${step.attempt} 次` });
  if (step.errorCode) metrics.push({ label: "错误", value: step.errorCode, tone: "danger" });
  if (step.status === "RUNNING" && currentTime != null && step.createdAt != null && currentTime >= step.createdAt) {
    metrics.push({ label: "已用时", value: formatMilliseconds(currentTime - step.createdAt), tone: "accent" });
  } else if (step.durationMs != null && modelLatency !== step.durationMs) {
    metrics.push({
      label: step.type === "FINAL" ? "端到端" : "阶段耗时",
      value: formatMilliseconds(step.durationMs),
    });
  }
  return metrics;
}

function displayedAgentStepProgress(step: AgentActivityStep) {
  if (step.type !== "TASK_STAGE" || step.progress == null) return undefined;
  if (step.status === "COMPLETED") return 100;
  return Math.max(0, Math.min(100, step.progress));
}

function agentStepStatusLabel(status: AgentActivityStep["status"]) {
  return {
    RUNNING: "执行中",
    COMPLETED: "完成",
    FAILED: "失败",
    CANCELLED: "取消",
  }[status];
}

function taskStageLabel(stage?: string | null) {
  return {
    QUEUED: "任务已排队",
    READING: "读取文档",
    MAP_SUMMARY: "分段分析",
    REDUCE_SUMMARY: "汇总分析",
    FINALIZING: "生成最终回答",
    RETRY_WAIT: "等待重试",
    COMPLETED: "任务完成",
    FAILED: "任务失败",
    CANCELLED: "任务已取消",
  }[stage ?? ""] ?? "后台任务处理中";
}

function agentStatusLabel(status: AgentActivityStatus | AgentActivityStep["status"]) {
  return {
    RUNNING: "正在执行",
    AWAITING_TURN: "正在保存回答",
    WAITING_TASK: "后台任务处理中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
    FAILED: "执行失败",
    AGENT_DEGRADED: "Agent 降级完成",
    AGENT_FALLBACK: "已回退传统 RAG",
  }[status] ?? status;
}

function formatMilliseconds(durationMs: number) {
  return durationMs >= 1_000 ? `${(durationMs / 1_000).toFixed(1)}s` : `${Math.max(0, Math.round(durationMs))}ms`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}

function SessionContextToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="4" />
      {collapsed ? (
        <path d="M17 7v10" />
      ) : (
        <path d="M15 4.5v15" />
      )}
    </svg>
  );
}

function TraceCard({ label, title, detail }: { label: string; title: string; detail: string }) {
  return (
    <article className="ask-premium-trace-card grid min-w-0 content-start gap-1.5 rounded-[8px] bg-white/10 p-3">
      <span className="text-[10px] font-bold text-white/60">{label}</span>
      <strong className="min-w-0 break-words text-[13px] leading-5">{title}</strong>
      <p className="text-[10px] leading-4 text-white/65">{detail}</p>
    </article>
  );
}

function KnowledgeControlIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M7 12h10" />
      <path d="M10 17h4" />
    </svg>
  );
}

function ModeControlIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M6 8h12" />
      <path d="M8 16h8" />
    </svg>
  );
}

function ModelControlIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 15 9l7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />
    </svg>
  );
}

function AiStarIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.5c0 6.2-3.3 9.5-9.5 9.5 6.2 0 9.5 3.3 9.5 9.5 0-6.2 3.3-9.5 9.5-9.5-6.2 0-9.5-3.3-9.5-9.5Z" />
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M3.5 20.2 21 12 3.5 3.8 5 10.6 13 12 5 13.4l-1.5 6.8Z" />
    </svg>
  );
}

const ComposerButton = forwardRef<HTMLButtonElement, {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}>(function ComposerButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "ask-premium-control-button inline-flex h-[34px] min-h-[34px] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 border px-2.5 transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        active ? "border-blue-600/30 bg-[#111315] text-white" : "border-black/10 bg-[#f7f7f2]/90 text-[#111315] hover:border-blue-600/30 hover:bg-[#111315] hover:text-white",
      ].join(" ")}
      aria-expanded={active}
    >
      {icon}
      <span className="max-w-[154px] truncate max-sm:max-w-28">{label}</span>
    </button>
  );
});

function FloatingMenu({ children, position }: { children: React.ReactNode; position: { left: number; top: number } | null }) {
  return (
    <div
      data-composer-menu
      className="ask-premium-floating-menu absolute z-50 grid w-[286px] max-w-[calc(100vw-28px)] gap-1 rounded-[8px] border border-black/10 bg-white/95 p-2 shadow-[0_24px_64px_rgba(17,19,21,0.18)] backdrop-blur-xl"
      style={{
        left: position ? `${position.left}px` : "12px",
        top: position ? `${position.top}px` : "0px",
      }}
      role="listbox"
    >
      {children}
    </div>
  );
}

function MenuHeader({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1 text-[11px] font-black text-slate-500">
      {label} <span>{value}</span>
    </div>
  );
}

function MenuOption({
  selected,
  onClick,
  title,
  detail,
  checkbox = false,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail: string;
  checkbox?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex min-h-11 w-full items-center gap-3 rounded-[8px] p-2 text-left text-sm transition hover:translate-x-0.5 hover:bg-blue-50",
        selected ? "text-blue-700" : "text-slate-700",
      ].join(" ")}
      role="option"
      aria-selected={selected}
    >
      <span
        className={[
          "grid size-4 shrink-0 place-items-center border text-white",
          checkbox ? "rounded-[5px]" : "rounded-full",
          selected ? "border-blue-600 bg-blue-600" : "border-black/15 bg-white text-transparent",
        ].join(" ")}
        aria-hidden="true"
      >
        <Check size={12} strokeWidth={2.4} />
      </span>
      {icon ? <span className="shrink-0 text-slate-500">{icon}</span> : null}
      <span className="min-w-0">
        <strong className="block truncate text-xs text-[#111315]">{title}</strong>
        <small className="mt-0.5 block truncate text-[11px] text-slate-500">{detail}</small>
      </span>
    </button>
  );
}

function PremiumConversationItem({
  conversation,
  active,
  menuOpen,
  renaming,
  renameValue,
  onSelect,
  onToggleMenu,
  onStartRename,
  onRenameValueChange,
  onSubmitRename,
  onCancelRename,
  onDelete,
}: {
  conversation: ConversationSession;
  active: boolean;
  menuOpen: boolean;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onToggleMenu: () => void;
  onStartRename: () => void;
  onRenameValueChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);

  if (renaming) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitRename();
        }}
        className="ask-premium-rename rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] p-2"
      >
        <input
          value={renameValue}
          onChange={(event) => onRenameValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancelRename();
          }}
          autoFocus
          className="h-10 w-full rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] px-2 text-sm text-[var(--premium-ink)] outline-none placeholder:text-[var(--premium-muted)] focus:border-[var(--premium-focus-line)] focus:shadow-[0_0_0_3px_var(--premium-focus-ring)]"
        />
      </form>
    );
  }

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onSelect}
        className={[
          "ask-premium-conversation-item",
          "flex min-h-[48px] w-full items-center rounded-[12px] border p-3 text-left transition",
          active ? "border-black/10 bg-white/80 text-[#111315]" : "border-transparent text-slate-700 hover:bg-white/70",
        ].join(" ")}
      >
        <span className="flex min-w-0 flex-1 items-center">
          <strong className="min-w-0 flex-1 truncate pr-7 text-sm leading-5" title={conversation.title || "新对话"}>
            {conversation.title || "新对话"}
          </strong>
        </span>
      </button>
      <button
        type="button"
        data-conversation-menu
        onClick={(event) => {
          setConfirmingDelete(false);
          const triggerRect = event.currentTarget.getBoundingClientRect();
          const menuWidth = 128;
          const menuHeight = 82;
          const viewportPadding = 8;
          const opensUpward = window.innerHeight - triggerRect.bottom < menuHeight + viewportPadding;
          setMenuPosition({
            left: Math.max(viewportPadding, Math.min(triggerRect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding)),
            top: opensUpward
              ? Math.max(viewportPadding, triggerRect.top - menuHeight - 4)
              : triggerRect.bottom + 4,
          });
          onToggleMenu();
        }}
        className="ask-premium-conversation-more absolute right-2 top-2 grid size-8 place-items-center bg-transparent text-slate-500 opacity-0 transition hover:text-[var(--premium-ink)] group-hover:opacity-100"
        aria-label="会话操作"
      >
        <MoreHorizontal size={16} />
      </button>
      {menuOpen && menuPosition ? createPortal(
        <div
          data-conversation-menu
          className="ask-premium-conversation-menu fixed z-[100] grid w-32 gap-1 rounded-[12px] border border-black/10 bg-white p-1 shadow-[0_12px_34px_rgba(15,23,42,0.14)]"
          style={menuPosition}
        >
          {confirmingDelete ? (
            <>
              <button type="button" onClick={onDelete} className="flex h-9 items-center gap-2 rounded-[6px] px-2 text-sm font-bold text-rose-600 hover:bg-rose-50"><Trash2 size={15} />确认删除</button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="ask-premium-conversation-delete-cancel h-9 rounded-[6px] px-2 text-left text-sm text-slate-700 hover:bg-slate-50">取消</button>
            </>
          ) : (
            <>
              <button type="button" onClick={onStartRename} className="ask-premium-conversation-rename-action flex h-9 items-center gap-2 rounded-[6px] px-2 text-sm text-slate-700 hover:bg-slate-50"><Edit3 size={15} />重命名</button>
              <button type="button" onClick={() => setConfirmingDelete(true)} className="flex h-9 items-center gap-2 rounded-[6px] px-2 text-sm text-rose-600 hover:bg-rose-50"><Trash2 size={15} />删除</button>
            </>
          )}
        </div>,
        document.querySelector<HTMLElement>(".ask-premium-page") ?? document.body,
      ) : null}
    </div>
  );
}

function PremiumChatBubble({
  message,
  theme,
  question,
  onPreviewCitation,
  onSubmitUserEdit,
  canSubmitUserEdit = true,
  assetNameCache,
}: {
  message: ChatMessage;
  theme: ThemeMode;
  question?: string;
  onPreviewCitation: (
    message: ChatMessage,
    citation: ConversationCitation,
    citationIndex: number,
    question?: string,
    targetChunk?: CitationChunk,
    citationLabel?: string,
  ) => void;
  onSubmitUserEdit: (value: string) => void | Promise<void>;
  canSubmitUserEdit?: boolean;
  assetNameCache: Record<string, string>;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const copyTimerRef = useRef<number | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) {
      const frame = window.requestAnimationFrame(() => setDraft(message.content));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [editing, message.content]);

  useEffect(() => () => {
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!editing) return;

    const frame = window.requestAnimationFrame(() => {
      editTextareaRef.current?.focus();
      editTextareaRef.current?.setSelectionRange(draft.length, draft.length);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [draft.length, editing]);

  const copyMessage = async () => {
    await copyTextToClipboard(message.content);
    setCopied(true);

    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }

    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const cancelEdit = () => {
    setDraft(message.content);
    setEditing(false);
  };

  const submitEdit = () => {
    const value = draft.trim();
    if (!value || !canSubmitUserEdit) return;

    setEditing(false);
    void onSubmitUserEdit(value);
  };

  if (isUser) {
    return (
      <article data-turn-id={message.turnId} className={["ask-premium-message-enter ask-premium-user-message flex justify-end", editing ? "is-editing" : ""].join(" ")}>
        <div className="relative max-w-[680px]">
          {editing ? (
            <form
              className="ask-premium-user-editor grid gap-3 rounded-[8px] px-3 py-2.5 text-[14px] font-normal leading-6 text-[#111315]"
              onSubmit={(event) => {
                event.preventDefault();
                submitEdit();
              }}
            >
              <textarea
                ref={editTextareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEdit();
                  }

                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submitEdit();
                  }
                }}
                className="ask-premium-user-edit-textarea min-h-[76px] w-full resize-y border-0 bg-transparent p-0 text-[14px] font-normal leading-6 text-[#111315] outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="ask-premium-user-edit-button ask-premium-user-edit-cancel h-8 rounded-[8px] px-3 text-xs font-black"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!draft.trim() || !canSubmitUserEdit}
                  className="ask-premium-user-edit-button ask-premium-user-edit-send h-8 rounded-[8px] px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45"
                >
                  发送
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="ask-premium-user-text max-w-[680px] whitespace-pre-wrap break-words text-left text-[14px] font-normal leading-6 text-[#111315]">
                {message.content}
              </div>
              <div className="ask-premium-user-actions" aria-label="消息操作">
                <button
                  type="button"
                  onClick={() => void copyMessage()}
                  className={["ask-premium-user-action-button", copied ? "is-copied" : ""].join(" ")}
                  aria-label={copied ? "已复制" : "复制消息"}
                  title={copied ? "已复制" : "复制"}
                >
                  {copied ? <Check size={15} strokeWidth={2.5} /> : <Copy size={15} strokeWidth={2.2} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(message.content);
                    setEditing(true);
                  }}
                  className="ask-premium-user-action-button"
                  aria-label="编辑消息"
                  title="编辑"
                >
                  <Edit3 size={15} strokeWidth={2.2} />
                </button>
              </div>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <article data-turn-id={message.turnId} className="ask-premium-assistant-message ask-premium-message-enter flex gap-2.5">
      <div className="ask-premium-assistant-avatar grid size-8 shrink-0 place-items-center rounded-full bg-[#111315] text-white shadow-none">
        <AiStarIcon />
      </div>
      <div className="ask-premium-assistant-content min-w-0 flex-1 py-1">
        <div className="mb-2 flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <strong className="text-[13px]">Anchr</strong>
            {message.executionMode === "AGENT" ? (
              <span
                className="ask-premium-agent-status ask-premium-agent-label inline-flex min-h-6 items-center rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 text-[10px] font-black text-violet-700 dark:text-violet-200"
                title="此回答由 Agent 执行"
              >
                Agent
              </span>
            ) : null}
            {message.executionMode === "AGENT_FALLBACK" ? (
              <span
                className="inline-flex min-h-6 items-center rounded-full border border-orange-500/20 bg-orange-500/10 px-2.5 text-[10px] font-black text-orange-700 dark:text-orange-200"
                title="Agent 执行失败后已降级为传统回答"
              >
                Agent 降级
              </span>
            ) : null}
            {message.answerMode ? (
              <span
                className="inline-flex min-h-6 items-center rounded-full border border-blue-500/15 bg-blue-500/10 px-2.5 text-[10px] font-black text-blue-700 dark:text-blue-200"
                title={theme === "dark" ? `Answer mode: ${message.answerMode.toUpperCase()}` : `回答模式：${message.answerMode}`}
              >
                {theme === "dark" ? message.answerMode.toUpperCase() : answerModeDisplayName(message.answerMode)}
              </span>
            ) : null}
            {message.answerStatus === "NO_EVIDENCE" ? (
              <span className="inline-flex min-h-6 items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 text-[10px] font-black text-amber-700 dark:text-amber-200">
                证据不足
              </span>
            ) : null}
            {message.answerStatus === "MODEL_FALLBACK" ? (
              <span className="inline-flex min-h-6 items-center rounded-full border border-orange-500/20 bg-orange-500/10 px-2.5 text-[10px] font-black text-orange-700 dark:text-orange-200">
                降级回答
              </span>
            ) : null}
            {message.answerStatus === "PROCESSING" && message.agentTask ? (
              <span className="ask-premium-agent-status inline-flex min-h-6 items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 text-[10px] font-black text-blue-700 dark:text-blue-200">
                {message.agentTask.currentStage || "处理中"} · {message.agentTask.progress}%
              </span>
            ) : null}
            {message.answerStatus === "CANCELLED" ? (
              <span className="inline-flex min-h-6 items-center rounded-full border border-slate-500/20 bg-slate-500/10 px-2.5 text-[10px] font-black text-slate-600 dark:text-slate-300">
                已取消
              </span>
            ) : null}
          </div>
          {message.pending ? (
            <span className="ask-premium-streaming-indicator inline-flex size-4 items-center justify-center rounded-full bg-[var(--ask-accent-soft)]" aria-label="流式回答中" title="流式回答中">
              <span className="ask-premium-streaming-dot size-1.5 rounded-full bg-[var(--ask-accent-dot)]" aria-hidden="true" />
            </span>
          ) : null}
        </div>
        {message.assetScope?.length ? (
          <div className="mb-3 flex flex-wrap gap-2" aria-label="本轮资料范围">
            {message.assetScope.map((assetId) => (
              <AssetScopeChip
                key={assetId}
                compact
                label="本轮资料"
                scope={{
                  assetId,
                  fileName: assetNameCache[assetId]
                    ?? message.citations?.find((citation) => citation.assetId === assetId)?.fileName
                    ?? assetId,
                }}
              />
            ))}
          </div>
        ) : null}
        <div className="ask-premium-answer-text break-words text-[14px] leading-7 text-slate-700">
          {message.pending && !stripTraceText(message.content) ? (
            "正在生成回答..."
          ) : (
            <MarkdownAnswer
              content={normalizeMarkdownAnswer(stripTraceText(message.content), Boolean(message.agentTask))}
              citationLabels={conversationCitationLabels(message.citations)}
              onCitation={(citationLabel) => {
                const resolved = resolveConversationCitation(message.citations, citationLabel);
                if (resolved) {
                  onPreviewCitation(
                    message,
                    resolved.citation,
                    resolved.citationPosition,
                    question,
                    resolved.chunk,
                    resolved.label,
                  );
                }
              }}
            />
          )}
        </div>
        {message.answerStatus === "NO_EVIDENCE" ? (
          <div className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-200">当前检索内容不足以支持可靠回答，可补充关键词或限定资料范围后重试。</div>
        ) : null}
        {message.answerStatus === "MODEL_FALLBACK" ? (
          <div className="mt-2 text-xs font-semibold text-orange-700 dark:text-orange-200">模型生成发生降级，以下内容仅基于当前可确认的证据整理。</div>
        ) : null}
        {message.error ? <div className="mt-3 text-sm text-rose-600">{message.error}</div> : null}
        {message.answerStatus !== "NO_EVIDENCE" && message.citations?.length ? (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="引用来源">
            {message.citations.map((citation, index) => {
              const citationFileName = citation.fileName?.trim()
                || (citation.assetId ? assetNameCache[citation.assetId]?.trim() : undefined)
                || "引用来源";
              return (
                <button
                  type="button"
                  key={`${citation.assetId ?? citationFileName ?? index}-${index}`}
                  onClick={() => onPreviewCitation(message, citation, index, question)}
                  disabled={!citation.chunks?.length}
                  className="ask-premium-citation inline-flex min-h-[30px] items-center gap-2 rounded-full border border-black/10 bg-[#f7f7f2]/85 px-2.5 text-[11px] font-normal text-[#111315] transition hover:-translate-y-0.5 hover:bg-[#111315] hover:text-white disabled:opacity-60"
                  title={`[${citation.citationIndex ?? index + 1}] ${citationFileName}${citation.chunks?.length > 1 ? ` · ${citation.chunks.length} 处` : ""}`}
                >
                  <span className="min-w-0 truncate">
                    [{citation.citationIndex ?? index + 1}] {citationFileName}
                    {citation.chunks?.length > 1 ? ` · ${citation.chunks.length} 处` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function EmptyPremiumChat() {
  return (
    <div className="ask-premium-empty-chat absolute inset-0 grid place-items-center px-6 text-center">
      <p className="max-w-[460px] text-sm font-medium leading-7 text-[var(--premium-muted)]">
        在已选择的知识范围内提问。回答将保留可追溯引用
        <br />
        与执行上下文。
      </p>
    </div>
  );
}

function turnsToMessages(turns: ConversationTurn[]) {
  return turns.flatMap((turn) => {
    const messages: ChatMessage[] = [];

    if (turn.query) {
      messages.push({
        id: `${turn.turnId}-user`,
        role: "user",
        content: turn.query,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
      });
    }

    messages.push({
      id: `${turn.turnId}-assistant`,
      role: "assistant",
      content: turn.answer || "未生成回答。",
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      citations: turn.citations ?? [],
      assetScope: turn.assetScope ?? [],
      answerMode: turn.answerMode,
      answerStatus: turn.answerStatus ?? "ANSWERED",
      answerFallbackReason: turn.answerFallbackReason,
      intent: turn.intent,
      executionMode: turn.executionMode,
      agentRunId: turn.agentRunId,
      workflowVersion: turn.workflowVersion,
      agentTask: turn.agentTask,
      pending: turn.answerStatus === "PROCESSING"
        && (turn.executionMode === "AGENT"
          || Boolean(turn.agentTask && (turn.agentTask.status === "PENDING" || turn.agentTask.status === "RUNNING"))),
    });

    return messages;
  });
}

function answerModeDisplayName(answerMode: string) {
  const normalizedMode = answerMode.toUpperCase();
  const option = ANSWER_MODES.find((item) => item.value === normalizedMode);

  return option ? `${option.label} · ${option.value}` : answerMode;
}

function mergeConversations(primary: ConversationSession[], secondary: ConversationSession[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((item) => {
    if (seen.has(item.sessionId)) return false;
    seen.add(item.sessionId);
    return true;
  });
}

function makeMessageId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function currentTimestamp() {
  return Date.now();
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function traceText(stage?: string) {
  if (stage === "routing") return "__TRACE__正在判断问题类型...";
  if (stage === "chat_generation") return "__TRACE__正在生成回复...";
  if (stage === "retrieval") return "__TRACE__正在检索知识库...";
  if (stage === "agent_thinking") return "__TRACE__正在思考...";
  if (stage === "tool_call") return "__TRACE__正在调用知识工具...";
  if (stage === "tool_result") return "__TRACE__正在整理工具结果...";
  if (stage === "task_queued") return "__TRACE__已创建文档处理任务...";
  return "__TRACE__正在生成回答...";
}

function normalizeMarkdownAnswer(content: string, unwrapPlainFence: boolean) {
  const trimmed = content.trim();
  const language = unwrapPlainFence ? "(?:markdown|md)?" : "(?:markdown|md)";
  const match = new RegExp("^```[ \\t]*" + language + "[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```[ \\t]*$", "i").exec(trimmed);
  return match ? match[1].trim() : content;
}

type MarkdownAstNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownAstNode[];
};

function MarkdownAnswer({
  content,
  citationLabels,
  onCitation,
}: {
  content: string;
  citationLabels: string[];
  onCitation: (citationLabel: string) => void;
}) {
  const validCitationLabels = new Set(citationLabels);
  return (
    <div className="ask-premium-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkInlineCitations]}
        components={{
          a: ({ children, href, ...props }) => {
            const citationMatch = href?.match(/^#anchr-citation-(\d+(?:-\d+)?)$/);
            if (citationMatch) {
              const citationLabel = citationMatch[1];
              if (!validCitationLabels.has(citationLabel)) {
                return <>{children}</>;
              }
              return (
                <button
                  type="button"
                  className="ask-premium-inline-citation"
                  onClick={() => onCitation(citationLabel)}
                  aria-label={`查看引用 ${citationLabel}`}
                >
                  {children}
                </button>
              );
            }
            return (
              <a {...props} href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function remarkInlineCitations() {
  return (tree: unknown) => {
    if (isMarkdownNode(tree) && tree.children) transformCitationTextNodes(tree);
  };
}

function transformCitationTextNodes(parent: MarkdownAstNode) {
  if (!parent.children) return;
  const transformed: MarkdownAstNode[] = [];

  parent.children.forEach((node) => {
    if (node.type === "text" && node.value) {
      transformed.push(...splitCitationText(node.value));
      return;
    }
    if (node.children && node.type !== "link" && node.type !== "linkReference") {
      transformCitationTextNodes(node);
    }
    transformed.push(node);
  });

  parent.children = transformed;
}

function splitCitationText(value: string) {
  const nodes: MarkdownAstNode[] = [];
  const citationPattern = /\[(\d+(?:-\d+)?)]/g;
  let cursor = 0;
  let match = citationPattern.exec(value);

  while (match) {
    if (match.index > cursor) nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    nodes.push({
      type: "link",
      url: `#anchr-citation-${match[1]}`,
      children: [{ type: "text", value: match[0] }],
    });
    cursor = match.index + match[0].length;
    match = citationPattern.exec(value);
  }

  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", value }];
}

function isMarkdownNode(value: unknown): value is MarkdownAstNode {
  return typeof value === "object" && value !== null && "type" in value;
}

function stripTraceText(value: string) {
  return value.startsWith("__TRACE__") ? "" : value;
}
