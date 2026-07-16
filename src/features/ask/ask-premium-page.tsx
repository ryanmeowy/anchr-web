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
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PremiumRail } from "@/components/app/premium-rail";
import { AssetScopeChip } from "@/components/shared/asset-scope-chip";
import { TransientNotice } from "@/components/shared/transient-notice";
import { ErrorBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
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
  return { ...message, agentTask: task, pending: true };
}

function activityNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function activityBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function mergeLiveAgentStep(steps: AgentActivityStep[], next: AgentActivityStep) {
  const key = next.callId ? `call:${next.callId}` : `${next.type}:${next.stepOrder}`;
  const index = steps.findIndex((step) => (
    step.callId ? `call:${step.callId}` : `${step.type}:${step.stepOrder}`
  ) === key);
  if (index < 0) return [...steps, next].sort((a, b) => a.stepOrder - b.stepOrder).slice(-50);
  const merged = [...steps];
  merged[index] = { ...merged[index], ...next };
  return merged.sort((a, b) => a.stepOrder - b.stepOrder).slice(-50);
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
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [liveAgentActivity, setLiveAgentActivity] = useState<LiveAgentActivity>({ steps: [] });
  const [traceCollapsed, setTraceCollapsed] = useState(true);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [traceHintVisible, setTraceHintVisible] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [activeAssetScope, setActiveAssetScope] = useState<AssetScope | null>(null);
  const [assetNameCache, setAssetNameCache] = useState<Record<string, string>>({});
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const [cancellingTaskIds, setCancellingTaskIds] = useState<Set<string>>(new Set());
  const streamRef = useRef<{
    requestId: string;
    sessionId: string;
    controller: AbortController;
    agentEnabled: boolean;
    runId?: string;
  } | null>(null);
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
    const frame = window.requestAnimationFrame(() => {
      setTheme(getInitialPremiumTheme());
      setThemeHydrated(true);
      setAssetNameCache(readAssetNameCache());
      try { setAgentEnabled(window.localStorage.getItem(ASK_AGENT_ENABLED_KEY) === "1"); } catch { /* ignore */ }
    });

    return () => window.cancelAnimationFrame(frame);
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
  const activityRunId = activeLiveAgentActivity?.runId
    ?? (latestAssistantUsesAgent ? latestAssistantMessage?.agentRunId : undefined);
  const agentActivityQuery = useQuery({
    queryKey: ["agent", "activity", activityRunId],
    queryFn: ({ signal }) => apiClient.getAgentRunActivity(activityRunId!, signal),
    enabled: Boolean(activityRunId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "RUNNING" || status === "WAITING_TASK" || latestAgentTaskInProgress ? 2_000 : false;
    },
  });
  const canSubmit = Boolean(query.trim()) && !streamingSessionId && (Boolean(activeSessionId) || selectedKbIds.length > 0);
  const pendingTaskIds = useMemo(() => Array.from(new Set(
    Object.values(messagesBySession).flat().map((message) => message.agentTask)
      .filter((task): task is AgentTask => Boolean(task && (task.status === "PENDING" || task.status === "RUNNING")))
      .map((task) => task.taskId),
  )), [messagesBySession]);

  useEffect(() => {
    if (pendingTaskIds.length === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    let delay = 2_000;
    const poll = async () => {
      const results = await Promise.allSettled(pendingTaskIds.map((taskId) => apiClient.getAgentTask(taskId)));
      if (cancelled) return;
      const updates = new Map<string, AgentTask>();
      results.forEach((result) => { if (result.status === "fulfilled") updates.set(result.value.taskId, result.value); });
      if (updates.size > 0) {
        setMessagesBySession((previous) => Object.fromEntries(Object.entries(previous).map(([sessionId, messages]) => [
          sessionId,
          messages.map((message) => {
            const task = message.agentTask ? updates.get(message.agentTask.taskId) : undefined;
            if (!task) return message;
            return applyAgentTask(message, task);
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
  }, [pendingTaskIds.join("|"), latestAgentTask?.taskId, activeSessionId]);

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
    const runCancellation = active.runId
      ? apiClient.cancelAgentRun(active.runId)
      : Promise.resolve(false);
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
    setLiveAgentActivity((previous) => (
      previous.sessionId === active.sessionId ? { ...previous, status: "CANCELLED" } : previous
    ));
    try {
      await runCancellation;
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "后端查询取消失败");
    } finally {
      active.controller.abort();
    }
  }, []);

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
    if (!text || streamingSessionId || (!activeSessionId && selectedKbIds.length === 0)) return;
    const requestAssetScope = activeAssetScope;
    const effectiveKbIds = requestAssetScope?.kbId ? [requestAssetScope.kbId] : selectedKbIds;

    if (options.clearComposer) {
      setQuery("");
    }

    setStreamError(null);
    setLiveAgentActivity({ steps: [] });

    let targetSessionId = activeSessionId;
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
        pending: true,
      };
      const requestId = makeMessageId("stream");
      const controller = new AbortController();
      const isCurrentStream = () => (
        streamRef.current?.requestId === requestId &&
        streamRef.current.sessionId === targetSessionId
      );

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
            if (agentEnabled
              && ["agent_thinking", "tool_call", "tool_result", "task_queued"].includes(event.stage ?? "")
              && !(event.stage === "agent_thinking" && event.message === "started")) {
              const details = event.details ?? {};
              const callId = typeof details.callId === "string" ? details.callId : undefined;
              const stepOrder = activityNumber(details.stepOrder);
              const fallbackOrder = activityNumber(details.toolCallOrder) ?? Date.now();
              const isTool = event.stage === "tool_call" || event.stage === "tool_result";
              const success = activityBoolean(details.success);
              const nextStep: AgentActivityStep = {
                stepOrder: stepOrder ?? fallbackOrder,
                type: isTool ? "TOOL" : event.stage === "task_queued" ? "TASK_STAGE" : "MODEL_DECISION",
                toolName: typeof details.tool === "string" ? details.tool : undefined,
                callId,
                taskStage: event.stage === "task_queued" ? "QUEUED" : undefined,
                taskType: typeof details.taskType === "string" ? details.taskType : undefined,
                answerType: typeof details.answerType === "string" ? details.answerType : undefined,
                decision: typeof details.decision === "string" ? details.decision : undefined,
                status: event.stage === "tool_call" || event.message === "started"
                  ? "RUNNING"
                  : success === false ? "FAILED" : "COMPLETED",
                attempt: activityNumber(details.attempt),
                progress: activityNumber(details.progress),
                messageCount: activityNumber(details.messageCount),
                plannedToolCallCount: activityNumber(details.toolCallCount),
                evidenceCount: activityNumber(details.evidenceCount),
                documentCount: activityNumber(details.documentCount),
                segmentCount: activityNumber(details.segmentCount),
                batchCount: activityNumber(details.batchCount),
                citationCount: activityNumber(details.citationCount),
                hasMore: activityBoolean(details.hasMore),
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
      const message = error instanceof Error ? error.message : "消息发送失败";
      setStreamError(message);
      if (agentEnabled) {
        setLiveAgentActivity((previous) => ({ ...previous, status: "FAILED" }));
      }
      if (targetSessionId) {
        setMessagesBySession((previous) => ({
          ...previous,
          [targetSessionId]: (previous[targetSessionId] ?? []).map((item) => (
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
    }
  };

  const handleSubmit = async () => {
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
      setConversationError(error instanceof Error ? error.message : "重命名失败");
    }
  };

  const deleteConversation = async (sessionId: string) => {
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
      setConversationError(error instanceof Error ? error.message : "删除失败");
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
    <div className="premium-theme ask-premium-page min-h-screen overflow-hidden bg-[#f7f7f2] text-[#111315]" data-theme={theme} data-premium-theme={theme}>
      <div aria-hidden="true" className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(17,19,21,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(17,19,21,0.055)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div aria-hidden="true" className="ask-premium-glow-bg pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_78%_8%,rgba(187,255,102,0.34),transparent_28rem),radial-gradient(circle_at_14%_92%,rgba(49,88,255,0.15),transparent_30rem)]" />
      {scopeNotice ? (
        <TransientNotice message={scopeNotice} onDismiss={() => setScopeNotice(null)} />
      ) : null}

      <div className="relative min-h-screen p-0 lg:p-6">
        <div
          className="ask-premium-shell ask-premium-chat-shell grid h-screen grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-black/15 bg-white/70 shadow-[0_24px_80px_rgba(17,19,21,0.12)] backdrop-blur-2xl lg:h-[calc(100vh-48px)] lg:grid-cols-[60px_280px_minmax(0,1fr)_350px] lg:grid-rows-none lg:rounded-[8px]"
          data-history-collapsed={historyCollapsed}
          data-trace-collapsed={traceCollapsed}
        >
          <PremiumRail theme={theme} onThemeChange={setTheme} />

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
                className="ask-premium-new-chat mb-4 flex min-h-12 w-full items-center justify-between rounded-[8px] bg-[#111315] px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(17,19,21,0.18)]"
              >
                新对话 <Plus size={18} />
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

          <main className="ask-premium-main relative flex min-h-0 min-w-0 flex-col bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)]">
            <button
              type="button"
              onClick={() => {
                setOpenMenuSessionId(null);
                setHistoryCollapsed((value) => !value);
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
              <div className="relative z-10 min-w-0">
                <p className="ask-premium-kicker mb-1.5 inline-flex items-center gap-2 text-[10px] font-black text-blue-700">
                  <span className="size-1.5 rounded-full bg-[#bbff66] shadow-[0_0_0_5px_rgba(187,255,102,0.2)]" />
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
                    setTraceCollapsed((value) => !value);
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

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5 lg:px-5">
              <div
                className="ask-premium-conversation-frame mx-auto flex min-h-0 w-full flex-1 flex-col gap-4"
                data-trace-collapsed={traceCollapsed}
              >
                <section ref={messageScrollRef} className="min-h-0 flex-1 overflow-auto pr-1">
                  <div className="relative grid gap-4">
                    {messageError ? (
                      <ErrorBlock message={messageError} />
                    ) : isLoadingMessages ? (
                      <div className="ask-premium-inline-loading flex min-h-[280px] items-center justify-center" aria-label="加载中">
                        <span className="ask-premium-spinner" aria-hidden="true" />
                      </div>
                    ) : activeMessages.length ? (
                      activeMessages.map((message, index) => (
                        <PremiumChatBubble
                          key={message.id}
                          message={message}
                          question={activeMessages[index - 1]?.role === "user" ? activeMessages[index - 1]?.content : undefined}
                          onPreviewCitation={handlePreviewCitation}
                          onSubmitUserEdit={(value) => sendMessage(value)}
                          canSubmitUserEdit={!streamingSessionId}
                          assetNameCache={assetNameCache}
                          onCancelAgentTask={(taskId) => void cancelAgentTask(taskId)}
                          cancellingAgentTask={Boolean(message.agentTask && cancellingTaskIds.has(message.agentTask.taskId))}
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
                  className="ask-premium-composer relative z-20 grid shrink-0 gap-3 rounded-[8px] border border-black/10 bg-white/90 p-3 shadow-[0_14px_38px_rgba(17,19,21,0.1)] backdrop-blur-xl"
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
                  <label className="flex items-center justify-between text-xs font-black text-slate-500" htmlFor="ask-premium-input">
                    MESSAGE <span>{selectedAnswerMode}</span>
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
                    placeholder="给 Anchr 发送消息"
                    className="ask-premium-textarea max-h-40 min-h-[52px] w-full resize-y border-0 bg-transparent text-slate-950 outline-none placeholder:text-slate-400"
                  />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px] items-center gap-3 max-sm:block max-sm:w-full max-sm:max-w-full">
                    <div className="ask-premium-control-strip flex min-w-0 flex-wrap items-center gap-2 overflow-visible pr-1 max-sm:w-full max-sm:max-w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:overflow-y-visible max-sm:py-1 max-sm:pr-[58px] max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden" data-composer-menu>
                      <ComposerButton
                        active={agentEnabled && agentAvailable}
                        disabled={!agentAvailable}
                        icon={<Sparkles size={15} />}
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
                      type={isStreamingActiveSession ? "button" : "submit"}
                      onClick={canCancelActiveQuery ? () => void cancelActiveQuery() : undefined}
                      disabled={isStreamingActiveSession ? !canCancelActiveQuery : !canSubmit}
                      className="ask-premium-send-button grid size-12 shrink-0 place-items-center rounded-full bg-[#111315] text-white shadow-[0_18px_40px_rgba(17,19,21,0.22)] transition hover:-translate-y-[3px] hover:scale-[1.04] hover:bg-blue-600 disabled:bg-[#111315] disabled:text-white disabled:opacity-100 disabled:shadow-[0_18px_40px_rgba(17,19,21,0.22)] max-sm:fixed max-sm:bottom-[76px] max-sm:left-[min(322px,calc(100vw-72px))] max-sm:z-[60] max-sm:size-[46px]"
                      aria-label={canCancelActiveQuery ? "取消查询" : isStreamingActiveSession ? "生成中" : "发送"}
                      title={canCancelActiveQuery ? "取消查询" : isStreamingActiveSession ? "生成中" : "发送"}
                    >
                      {canCancelActiveQuery ? <X size={20} /> : isStreamingActiveSession
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
              className="block h-full rounded-full bg-[#bbff66] transition-[width] duration-300 ease-out"
              style={{ width: answerModeProgress[answerMode] }}
            />
          </div>
        </section>
        <TraceCard label="MODEL" title={modelLabel} detail="Generation capability" />
        <TraceCard label="KNOWLEDGE BASES" title={selectedKbLabel} detail="发送问题时作为当前问答范围" />
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
  const mergedSteps = mergeAgentActivitySteps(serverActivity?.steps ?? [], liveActivity?.steps ?? []);
  const steps = mergeTaskProgressStep(mergedSteps, latestAssistantMessage?.agentTask);
  const status = resolveAgentActivityStatus(
    serverActivity?.status,
    liveActivity?.status,
    statusFromTask(latestAssistantMessage?.agentTask),
  );
  const totalTokens = (serverActivity?.promptTokens ?? 0) + (serverActivity?.completionTokens ?? 0);
  const promptTokens = serverActivity?.promptTokens ?? 0;
  const completionTokens = serverActivity?.completionTokens ?? 0;
  const activityScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = activityScrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [steps.length, status, latestAssistantMessage?.agentTask?.progress]);

  return (
    <section className="ask-premium-trace-timeline flex min-h-0 flex-1 flex-col rounded-[8px] border border-white/10 bg-white/10 p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs font-black text-white/60">
        <span>AGENT ACTIVITY</span>
        {isAgent && status ? <span className="text-[#bbff66]">{agentStatusLabel(status)}</span> : null}
      </div>
      {isAgent ? (
        <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] text-white/55">
          <span className="rounded-full bg-black/20 px-2 py-1">{steps.length} 个节点</span>
          {serverActivity ? <span className="rounded-full bg-black/20 px-2 py-1">{serverActivity.toolCallCount} 次工具调用</span> : null}
          {totalTokens > 0 ? (
            <span className="rounded-full bg-black/20 px-2 py-1">Token 总计 {totalTokens.toLocaleString()}</span>
          ) : null}
          {totalTokens > 0 ? (
            <span className="rounded-full bg-black/20 px-2 py-1">输入 {promptTokens.toLocaleString()} · 输出 {completionTokens.toLocaleString()}</span>
          ) : null}
          {serverActivity?.latencyMs != null ? <span className="rounded-full bg-black/20 px-2 py-1">端到端 {formatMilliseconds(serverActivity.latencyMs)}</span> : null}
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
        <div ref={activityScrollRef} className="grid min-h-0 flex-1 content-start gap-2 overflow-auto pr-1">
          {steps.map((step, index) => (
            <AgentActivityStepItem
              key={agentStepKey(step)}
              step={step}
              position={index + 1}
              ordinal={steps.filter((candidate) => candidate.stepOrder <= step.stepOrder && candidate.type === step.type).length}
            />
          ))}
          {steps.length === 0 ? (
            <AgentActivityEmpty title="正在执行" detail="等待 Agent 返回第一个安全操作事件。" loading={status === "RUNNING"} />
          ) : null}
          {status && status !== "RUNNING" && status !== "WAITING_TASK" ? (
            <div className="mt-1 border-t border-white/10 pt-3 text-xs text-white/60">
              <strong className="text-[#bbff66]">{agentStatusLabel(status)}</strong>
              <span> · {serverActivity?.stepCount ?? steps.length} steps · {serverActivity?.toolCallCount ?? steps.filter((step) => step.type === "TOOL").length} tools{formatDuration(serverActivity?.latencyMs)}</span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AgentActivityEmpty({ title, detail, loading = false }: { title: string; detail: string; loading?: boolean }) {
  return (
    <div className="ask-premium-trace-empty rounded-[8px] bg-black/20 p-3 text-xs leading-5 text-white/60">
      <div className="flex items-center gap-2 font-black text-white/85">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#bbff66]" /> : null}
        <span>{title}</span>
      </div>
      <p className="mt-1">{detail}</p>
    </div>
  );
}

function AgentActivityStepItem({ step, position, ordinal }: { step: AgentActivityStep; position: number; ordinal: number }) {
  const progress = displayedAgentStepProgress(step);
  return (
    <div className="ask-premium-trace-event rounded-[8px] bg-black/20 p-3">
      <div className="flex items-start gap-2">
        <span className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[9px] font-black ${step.status === "FAILED" || step.status === "CANCELLED" ? "bg-red-400/20 text-red-300" : "bg-[#bbff66]/15 text-[#bbff66]"}`}>{String(position).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-xs font-black text-white/90">
            <span>{agentStepTitle(step, ordinal)}</span>
            <span className="flex shrink-0 items-center gap-1 text-[9px] text-white/45">
              {step.status === "RUNNING" ? <Loader2 className="h-3 w-3 animate-spin text-[#bbff66]" /> : null}
              {agentStepStatusLabel(step.status)}
            </span>
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-white/60">{agentStepDetail(step)}</p>
          {progress != null ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-[#bbff66] transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function mergeAgentActivitySteps(persisted: AgentActivityStep[], live: AgentActivityStep[]) {
  const merged = new Map<string, AgentActivityStep>();
  persisted.forEach((step) => merged.set(agentStepKey(step), step));
  live.forEach((step) => {
    const key = agentStepKey(step);
    const stored = merged.get(key);
    if (!stored) {
      merged.set(key, step);
    } else if (stored.status === "RUNNING" && step.status !== "RUNNING") {
      merged.set(key, { ...stored, ...step });
    } else {
      merged.set(key, { ...step, ...stored });
    }
  });
  return Array.from(merged.values())
    .sort((a, b) => a.stepOrder - b.stepOrder || (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .slice(-50);
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
  const terminal = new Set<AgentActivityStatus>(["COMPLETED", "FAILED", "CANCELLED", "AGENT_FALLBACK"]);
  if (server && terminal.has(server)) return server;
  if (task && terminal.has(task)) return task;
  if (live && terminal.has(live)) return live;
  return task ?? server ?? live;
}

function agentStepTitle(step: AgentActivityStep, ordinal: number) {
  if (step.type === "MODEL_DECISION") return ordinal === 1 ? "分析用户请求" : "评估工具结果";
  if (step.type === "TASK_STAGE") return taskStageLabel(step.taskStage);
  if (step.type === "FINAL") return step.status === "FAILED" ? "执行失败" : step.status === "CANCELLED" ? "已取消" : "完成";
  return {
    find_documents: "查找文档",
    search_knowledge: "检索知识库",
    read_document: "读取文档",
    summarize_documents: "创建文档任务",
    deliver_answer: "生成回答",
  }[step.toolName ?? ""] ?? step.toolName ?? "执行工具";
}

function agentStepDetail(step: AgentActivityStep) {
  const details: string[] = [];
  const progress = displayedAgentStepProgress(step);
  if (step.type === "MODEL_DECISION") {
    if (step.messageCount != null) details.push(`读取 ${step.messageCount} 条上下文消息`);
    if (step.decision === "TOOL_SELECTION") details.push(`决定调用 ${step.plannedToolCallCount ?? 1} 个工具`);
    if (step.decision === "FINAL_RESPONSE") details.push("决定生成最终回答");
    if (step.decision === "PROTOCOL_RETRY") details.push("协议校正后重新决策");
  }
  if (step.toolName) details.push(step.toolName);
  if (step.answerType) details.push(step.answerType === "KNOWLEDGE" ? "知识回答" : step.answerType === "CHAT" ? "直接回答" : step.answerType);
  if (step.taskType) details.push(step.taskType === "DOCUMENT_SUMMARY" ? "文档总结" : step.taskType);
  if (step.documentCount != null) details.push(`${step.documentCount} 份文档`);
  if (step.evidenceCount != null) details.push(`${step.evidenceCount} 条证据`);
  if (step.segmentCount != null) details.push(`${step.segmentCount} 个片段`);
  if (step.batchCount != null) details.push(`${step.batchCount} 个处理批次`);
  if (step.citationCount != null) details.push(`${step.citationCount} 条引用`);
  if ((step.promptTokens ?? 0) + (step.completionTokens ?? 0) > 0) {
    details.push(`Token 输入 ${(step.promptTokens ?? 0).toLocaleString()} / 输出 ${(step.completionTokens ?? 0).toLocaleString()}`);
  }
  if (progress != null) details.push(`进度 ${progress}%`);
  if (step.hasMore === true) details.push("仍有后续内容");
  if (step.attempt != null && step.attempt > 1) details.push(`第 ${step.attempt} 次尝试`);
  if (step.errorCode) details.push(`错误 ${step.errorCode}`);
  if (step.durationMs != null) details.push(`${formatMilliseconds(step.durationMs)}`);
  if (details.length) return details.join(" · ");
  return step.status === "RUNNING" ? "正在执行" : step.status === "COMPLETED" ? "已完成" : agentStatusLabel(step.status);
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
    WAITING_TASK: "后台任务处理中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
    FAILED: "执行失败",
    AGENT_FALLBACK: "已回退传统 RAG",
  }[status] ?? status;
}

function formatMilliseconds(durationMs: number) {
  return durationMs >= 1_000 ? `${(durationMs / 1_000).toFixed(1)}s` : `${Math.max(0, Math.round(durationMs))}ms`;
}

function formatDuration(durationMs?: number | null) {
  return durationMs == null ? "" : ` · ${formatMilliseconds(durationMs)}`;
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
        <rect x="15" y="7" width="3" height="10" rx="1.5" />
      ) : (
        <path d="M15 4.5v15" />
      )}
    </svg>
  );
}

function TraceCard({ label, title, detail }: { label: string; title: string; detail: string }) {
  return (
    <article className="ask-premium-trace-card grid gap-2 rounded-[8px] bg-white/10 p-4">
      <span className="text-xs text-white/60">{label}</span>
      <strong className="break-words text-sm">{title}</strong>
      <p className="text-xs leading-5 text-white/65">{detail}</p>
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
        "ask-premium-control-button inline-flex h-[38px] min-h-[38px] min-w-0 shrink-0 cursor-pointer items-center gap-2 border px-3 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
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
          "flex min-h-[48px] w-full items-center rounded-[8px] border p-3 text-left transition",
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
          className="ask-premium-conversation-menu fixed z-[100] grid w-32 gap-1 rounded-[8px] border border-black/10 bg-white p-1 shadow-[0_12px_34px_rgba(15,23,42,0.14)]"
          style={menuPosition}
        >
          {confirmingDelete ? (
            <>
              <button type="button" onClick={onDelete} className="flex h-9 items-center gap-2 rounded-[6px] px-2 text-sm font-bold text-rose-600 hover:bg-rose-50"><Trash2 size={15} />确认删除</button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="h-9 rounded-[6px] px-2 text-left text-sm text-slate-700 hover:bg-slate-50">取消</button>
            </>
          ) : (
            <>
              <button type="button" onClick={onStartRename} className="flex h-9 items-center gap-2 rounded-[6px] px-2 text-sm text-slate-700 hover:bg-slate-50"><Edit3 size={15} />重命名</button>
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
  question,
  onPreviewCitation,
  onSubmitUserEdit,
  canSubmitUserEdit = true,
  assetNameCache,
  onCancelAgentTask,
  cancellingAgentTask = false,
}: {
  message: ChatMessage;
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
  onCancelAgentTask: (taskId: string) => void;
  cancellingAgentTask?: boolean;
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
      <article data-turn-id={message.turnId} className={["ask-premium-user-message flex justify-end", editing ? "is-editing" : ""].join(" ")}>
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
    <article data-turn-id={message.turnId} className="flex gap-2.5">
      <div className="ask-premium-assistant-avatar grid size-8 shrink-0 place-items-center rounded-full bg-[#111315] text-white shadow-none">
        <Sparkles size={15} />
      </div>
      <div className="ask-premium-assistant-content min-w-0 flex-1 py-1">
        <div className="mb-2 flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <strong className="text-[13px]">Anchr</strong>
            {message.answerMode ? (
              <span
                className="inline-flex min-h-6 items-center rounded-full border border-blue-500/15 bg-blue-500/10 px-2.5 text-[10px] font-black text-blue-700 dark:text-blue-200"
                title={`回答模式：${message.answerMode}`}
              >
                {answerModeDisplayName(message.answerMode)}
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
              <>
                <span className="inline-flex min-h-6 items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 text-[10px] font-black text-blue-700 dark:text-blue-200">
                  {message.agentTask.currentStage || "处理中"} · {message.agentTask.progress}%
                </span>
                <button
                  type="button"
                  onClick={() => onCancelAgentTask(message.agentTask!.taskId)}
                  disabled={cancellingAgentTask}
                  className="inline-flex min-h-6 items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 text-[10px] font-black text-rose-700 transition hover:bg-rose-500/15 disabled:cursor-wait disabled:opacity-60 dark:text-rose-200"
                >
                  {cancellingAgentTask ? <Loader2 size={11} className="animate-spin" /> : null}
                  {cancellingAgentTask ? "正在取消" : "取消任务"}
                </button>
              </>
            ) : null}
            {message.answerStatus === "CANCELLED" ? (
              <span className="inline-flex min-h-6 items-center rounded-full border border-slate-500/20 bg-slate-500/10 px-2.5 text-[10px] font-black text-slate-600 dark:text-slate-300">
                已取消
              </span>
            ) : null}
          </div>
          {message.pending ? (
            <span className="ask-premium-streaming-indicator inline-flex size-4 items-center justify-center rounded-full bg-[#bbff66]/15" aria-label="流式回答中" title="流式回答中">
              <span className="ask-premium-streaming-dot size-1.5 rounded-full bg-[#68a313]" aria-hidden="true" />
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
            {message.citations.map((citation, index) => (
              <button
                type="button"
                key={`${citation.assetId ?? citation.fileName ?? index}-${index}`}
                onClick={() => onPreviewCitation(message, citation, index, question)}
                disabled={!citation.chunks?.length}
                className="ask-premium-citation inline-flex min-h-[30px] items-center gap-2 rounded-full border border-black/10 bg-[#f7f7f2]/85 px-2.5 text-[11px] font-normal text-[#111315] transition hover:-translate-y-0.5 hover:bg-[#111315] hover:text-white disabled:opacity-60"
                title={`[${citation.citationIndex ?? index + 1}] ${citation.fileName ?? "引用来源"}${citation.chunks?.length > 1 ? ` · ${citation.chunks.length} 处` : ""}`}
              >
                <span className="min-w-0 truncate">
                  [{citation.citationIndex ?? index + 1}] {citation.fileName ?? "引用来源"}
                  {citation.chunks?.length > 1 ? ` · ${citation.chunks.length} 处` : ""}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function EmptyPremiumChat() {
  return null;
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
        && Boolean(turn.agentTask && (turn.agentTask.status === "PENDING" || turn.agentTask.status === "RUNNING")),
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
