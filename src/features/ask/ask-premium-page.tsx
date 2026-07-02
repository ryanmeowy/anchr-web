"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Database,
  Edit3,
  Folder,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PremiumRail } from "@/components/app/premium-rail";
import { AssetScopeChip } from "@/components/shared/asset-scope-chip";
import { TransientNotice } from "@/components/shared/transient-notice";
import { ErrorBlock } from "@/components/ui/query-state";
import { ApiError, apiClient } from "@/lib/api-client";
import {
  consumeAssetScopeHandoff,
  readAskAssetScope,
  readAssetNameCache,
  rememberAssetScopes,
  saveAskAssetScope,
  type AssetScope,
} from "@/lib/asset-scope";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import {
  clearPreviewRestoreState,
  normalizeConversationCitations,
  readPreviewRestoreState,
  savePreviewNavigation,
} from "@/lib/preview-context";
import type {
  CapabilityConfig,
  ConversationAnswerMode,
  ConversationCitation,
  ConversationSession,
  ConversationTurn,
} from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sessionId: string;
  turnId?: string;
  citations?: ConversationCitation[];
  assetScope?: string[];
  pending?: boolean;
  error?: string;
};

type MessageCache = Record<string, ChatMessage[]>;
type ComposerMenu = "kb" | "mode" | "model" | null;
type ThemeMode = PremiumThemeMode;
type TraceEventType = "request" | "trace" | "delta" | "citations" | "done" | "error" | "model";

type TraceEvent = {
  id: string;
  type: TraceEventType;
  label: string;
  detail: string;
  at: number;
};

type AskPremiumReturnState = {
  activeSessionId: string;
  query: string;
  selectedKbIdsValue: string[] | null;
  selectedAnswerMode: ConversationAnswerMode;
  conversations: ConversationSession[];
  nextCursor: string | null;
  messagesBySession: MessageCache;
  traceEvents: TraceEvent[];
  messageScrollTop: number;
  conversationListScrollTop: number;
};

const CONVERSATION_PAGE_SIZE = 50;
const HISTORY_LIMIT = 100;
const ANSWER_MODES: Array<{ value: ConversationAnswerMode; label: string; detail: string }> = [
  { value: "STRICT", label: "严格回答", detail: "证据门槛最高，证据不足时拒答" },
  { value: "SUMMARY", label: "摘要回答", detail: "更短输出，保留核心证据" },
  { value: "EXPLORE", label: "探索回答", detail: "允许建议方向，事实仍需引用" },
];

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
  const [activeSessionId, setActiveSessionId] = useState("");
  const [conversations, setConversations] = useState<ConversationSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<MessageCache>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [composerMenu, setComposerMenu] = useState<ComposerMenu>(null);
  const [composerMenuPosition, setComposerMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [activeAssetScope, setActiveAssetScope] = useState<AssetScope | null>(null);
  const [assetNameCache, setAssetNameCache] = useState<Record<string, string>>({});
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const streamRef = useRef<{ requestId: string; sessionId: string } | null>(null);
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTheme(getInitialPremiumTheme());
      setThemeHydrated(true);
      setAssetNameCache(readAssetNameCache());
    });

    return () => window.cancelAnimationFrame(frame);
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
  const lastActiveMessageContent = activeMessages.at(-1)?.content;
  const citationCount = activeMessages.reduce((total, message) => total + (message.citations?.length ?? 0), 0);
  const canSubmit = Boolean(query.trim()) && !streamingSessionId && (Boolean(activeSessionId) || selectedKbIds.length > 0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setActiveAssetScope(activeSessionId ? readAskAssetScope(activeSessionId) : null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionId]);

  const addTraceEvent = useCallback((event: Omit<TraceEvent, "id" | "at">) => {
    setTraceEvents((previous) => [
      ...previous.slice(-11),
      {
        ...event,
        id: makeMessageId(event.type),
        at: Date.now(),
      },
    ]);
  }, []);

  useEffect(() => {
    const handoff = consumeAssetScopeHandoff("ask");
    const restored = readPreviewRestoreState<AskPremiumReturnState>("ask");
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
      setTraceEvents(state.traceEvents ?? []);
      setIsLoadingConversations(false);
      setIsLoadingMessages(false);
      clearPreviewRestoreState("ask");

      if (messageScrollRef.current) messageScrollRef.current.scrollTop = state.messageScrollTop;
      if (listScrollRef.current) listScrollRef.current.scrollTop = state.conversationListScrollTop;
    });
  }, []);

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeSessionId, activeMessages.length, lastActiveMessageContent]);

  useEffect(() => {
    if (!initialSessionId || initialSessionId === activeSessionId) return;

    const frame = window.requestAnimationFrame(() => {
      handleSelectConversation(initialSessionId);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialSessionId, activeSessionId]);

  useEffect(() => {
    if (!initialTurnId || !initialSessionId || activeSessionId !== initialSessionId || isLoadingMessages) return;
    if (!activeMessages.some((message) => message.turnId === initialTurnId)) return;

    const node = document.querySelector(`[data-turn-id="${CSS.escape(initialTurnId)}"]`);
    if (!node) return;

    node.scrollIntoView({ behavior: "smooth", block: "center" });
    const frame = window.requestAnimationFrame(() => setHighlightedTurnId(initialTurnId));
    const timer = window.setTimeout(() => setHighlightedTurnId(null), 2500);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [initialTurnId, initialSessionId, activeSessionId, isLoadingMessages, activeMessages]);

  const handleConversationListScroll = () => {
    const element = listScrollRef.current;
    if (!element || !nextCursor || isLoadingMoreConversations) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 80) void loadConversations(nextCursor, true);
  };

  const handleNewConversation = () => {
    setActiveSessionId("");
    setMessageError(null);
    setStreamError(null);
    setOpenMenuSessionId(null);
    setRenamingSessionId(null);
    setTraceEvents([]);
  };

  function handleSelectConversation(sessionId: string) {
    setActiveSessionId(sessionId);
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
  ) => {
    if (!citation.segmentId) return;

    const contextKey = savePreviewNavigation<AskPremiumReturnState>({
      source: "ask",
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
        traceEvents,
        messageScrollTop: messageScrollRef.current?.scrollTop ?? 0,
        conversationListScrollTop: listScrollRef.current?.scrollTop ?? 0,
      },
    });
    const params = new URLSearchParams({
      from: "ask",
      contextKey,
      citationIndex: String(citationIndex + 1),
    });

    router.push(`/preview/${encodeURIComponent(citation.segmentId)}?${params.toString()}`);
  }, [
    activeSessionId,
    conversations,
    messagesBySession,
    nextCursor,
    query,
    router,
    selectedAnswerMode,
    selectedKbIdsValue,
    traceEvents,
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
    setTraceEvents([]);
    addTraceEvent({
      type: "request",
      label: "request",
      detail: `${selectedAnswerMode} · ${selectedKbLabel}`,
    });

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
      }

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
        pending: true,
      };
      const requestId = makeMessageId("stream");
      const isCurrentStream = () => (
        streamRef.current?.requestId === requestId &&
        streamRef.current.sessionId === targetSessionId
      );

      streamRef.current = { requestId, sessionId: targetSessionId };
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
        },
        {
          onTrace: (event) => {
            if (!isCurrentStream()) return;
            addTraceEvent({
              type: "trace",
              label: event.stage ?? "trace",
              detail: `${event.message ?? "started"} · ${event.answerMode ?? selectedAnswerMode}`,
            });
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: true,
              content: message.content || traceText(event.stage),
            }));
          },
          onDelta: (delta) => {
            if (!isCurrentStream()) return;
            addTraceEvent({
              type: "delta",
              label: "delta",
              detail: `${delta.length || 0} chars`,
            });
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
            addTraceEvent({
              type: "citations",
              label: "citations",
              detail: `${citations.length} sources`,
            });
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              citations,
            }));
          },
          onDone: (event) => {
            if (!isCurrentStream()) return;
            addTraceEvent({
              type: "done",
              label: "done",
              detail: `${event.turnId ?? "turn"} · ${event.answerMode ?? selectedAnswerMode}`,
            });
            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: false,
              turnId: event.turnId,
              assetScope: event.assetScope ?? message.assetScope,
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
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "消息发送失败";
      const code = error instanceof ApiError ? error.code : undefined;
      setStreamError(message);
      addTraceEvent({
        type: "error",
        label: code ?? "error",
        detail: message,
      });
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
    addTraceEvent({
      type: "model",
      label: "generation",
      detail: `切换为 ${config.modelName || config.baseUrl}`,
    });

    try {
      await apiClient.selectCapabilityConfig("generation", config.id);
      await queryClient.invalidateQueries({ queryKey: ["settings", "generation", "all"] });
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "模型切换失败");
      addTraceEvent({
        type: "error",
        label: "model",
        detail: error instanceof Error ? error.message : "模型切换失败",
      });
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
      setMessageError(null);
      setStreamError(null);
      setTraceEvents([]);
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
        <div className="ask-premium-shell grid h-screen grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-black/15 bg-white/70 shadow-[0_24px_80px_rgba(17,19,21,0.12)] backdrop-blur-2xl lg:h-[calc(100vh-48px)] lg:grid-cols-[72px_300px_minmax(0,1fr)_350px] lg:grid-rows-none lg:rounded-[8px]">
          <PremiumRail theme={theme} onThemeChange={setTheme} />

          <aside className="ask-premium-history flex min-h-0 flex-col border-b border-black/10 bg-[#f7f7f2]/75 p-4 lg:border-b-0 lg:border-r">
            <p className="ask-premium-muted mb-4 flex items-center justify-between text-xs font-black text-slate-500">
              CONVERSATIONS <span>{conversations.length}</span>
            </p>
            <button
              type="button"
              onClick={handleNewConversation}
              className="ask-premium-new-chat mb-4 flex min-h-12 w-full items-center justify-between rounded-[8px] bg-[#111315] px-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(17,19,21,0.18)]"
            >
              新对话 <Plus size={18} />
            </button>
            <div className="min-h-0 flex-1 overflow-auto pr-1 lg:pr-2" ref={listScrollRef} onScroll={handleConversationListScroll}>
              {isLoadingConversations ? (
                <div className="flex min-h-36 items-center justify-center" aria-label="加载会话">
                  <Loader2 className="animate-spin text-[var(--premium-muted)]" size={22} aria-hidden="true" />
                </div>
              ) : conversations.length ? (
                <div className="grid auto-cols-[minmax(210px,72vw)] grid-flow-col gap-2 overflow-x-auto lg:grid-flow-row lg:auto-cols-auto lg:overflow-x-visible">
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
          </aside>

          <main className="ask-premium-main flex min-h-0 min-w-0 flex-col bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)]">
            <header className="ask-premium-hero relative grid min-h-[112px] items-center gap-3 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-5">
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
              <div className="ask-premium-scope-chip relative z-10 inline-flex h-10 max-w-full items-center gap-2.5 rounded-full border border-black/10 bg-white/80 px-3.5 text-xs font-bold text-slate-700 shadow-[0_10px_24px_rgba(17,19,21,0.07)]">
                <Database size={15} />
                <span className="truncate">{selectedKbLabel} · {selectedAnswerModeLabel}</span>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5 lg:px-5">
              <div className="mx-auto flex min-h-0 w-full max-w-[980px] flex-1 flex-col gap-4">
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
                          highlighted={highlightedTurnId != null && highlightedTurnId === message.turnId}
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
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSubmit();
                      }
                    }}
                    placeholder="给 Anchr 发送消息"
                    className="ask-premium-textarea max-h-40 min-h-[76px] w-full resize-y border-0 bg-transparent text-slate-950 outline-none placeholder:text-slate-400"
                  />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px] items-center gap-3 max-sm:block max-sm:w-full max-sm:max-w-full">
                    <div className="ask-premium-control-strip flex min-w-0 flex-wrap items-center gap-2 overflow-visible pr-1 max-sm:w-full max-sm:max-w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:overflow-y-hidden max-sm:pr-[58px] max-sm:pb-0 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden" data-composer-menu>
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
                      type="submit"
                      disabled={!canSubmit}
                      className="ask-premium-send-button grid size-12 shrink-0 place-items-center rounded-full bg-[#111315] text-white shadow-[0_18px_40px_rgba(17,19,21,0.22)] transition hover:-translate-y-[3px] hover:scale-[1.04] hover:bg-blue-600 disabled:bg-[#111315] disabled:text-white disabled:opacity-100 disabled:shadow-[0_18px_40px_rgba(17,19,21,0.22)] max-sm:fixed max-sm:bottom-[76px] max-sm:left-[min(322px,calc(100vw-72px))] max-sm:z-[60] max-sm:size-[46px]"
                      aria-label={isStreamingActiveSession ? "生成中" : "发送"}
                    >
                      {isStreamingActiveSession ? <Loader2 className="animate-spin" size={20} /> : <SendGlyph />}
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
                            title={config.modelName || config.baseUrl}
                            detail={`${config.enabled ? "生效中" : "可切换"} · 全局生效`}
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
            citationCount={citationCount}
            traceEvents={traceEvents}
            streaming={Boolean(streamingSessionId)}
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
  citationCount,
  traceEvents,
  streaming,
}: {
  answerMode: ConversationAnswerMode;
  selectedKbLabel: string;
  modelLabel: string;
  citationCount: number;
  traceEvents: TraceEvent[];
  streaming: boolean;
}) {
  const answerModeProgress = {
    STRICT: "100%",
    SUMMARY: "66%",
    EXPLORE: "33%",
  } satisfies Record<ConversationAnswerMode, string>;

  return (
    <aside className="ask-premium-trace hidden min-h-0 min-w-0 flex-col gap-4 border-l border-black/10 bg-[#111315] p-5 text-white lg:flex">
      <p className="flex items-center justify-between text-xs font-black text-white/60">
        SESSION CONTEXT <span>{streaming ? "LIVE" : "READY"}</span>
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
      <TraceCard label="MODEL" title={modelLabel} detail="Generation capability · 全局生效" />
      <TraceCard label="KNOWLEDGE BASES" title={selectedKbLabel} detail="发送问题时作为当前问答范围" />
      <TraceCard label="CITATIONS" title={`${citationCount} sources`} detail="来自 SSE citations 事件与历史消息" />
      <section className="ask-premium-trace-timeline min-h-0 flex-1 rounded-[8px] border border-white/10 bg-white/10 p-4">
        <div className="mb-3 text-xs font-black text-white/60">
          TRACE TIMELINE
        </div>
        <div className="grid max-h-full gap-2 overflow-auto pr-1">
          {traceEvents.length ? traceEvents.slice().reverse().map((event) => (
            <div key={event.id} className="ask-premium-trace-event rounded-[8px] bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-black text-[#bbff66]">
                <span>{event.label}</span>
                <span className="text-white/40">{new Date(event.at).toLocaleTimeString()}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-white/70">{event.detail}</p>
            </div>
          )) : (
            <div className="ask-premium-trace-empty rounded-[8px] bg-white/10 p-3 text-xs leading-5 text-white/60">
              发送问题后展示 trace、delta、citations、done 或 error。
            </div>
          )}
        </div>
      </section>
      <div className="flex gap-2 overflow-hidden border-t border-white/10 pt-4 text-xs text-white/70">
        {["trace", "delta", "citation", "preview", "done"].map((item) => (
          <span key={item} className="rounded-full bg-white/10 px-3 py-2">{item}</span>
        ))}
      </div>
    </aside>
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
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}>(function ComposerButton({
  active,
  icon,
  label,
  onClick,
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={[
        "ask-premium-control-button inline-flex min-h-[38px] min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 transition hover:-translate-y-0.5",
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
    <div className="group relative">
      <button
        type="button"
        onClick={onSelect}
        className={[
          "ask-premium-conversation-item",
          "grid min-h-[72px] w-full gap-1 rounded-[8px] border p-3 text-left transition hover:translate-x-0.5",
          active ? "border-black/10 bg-white/80 text-[#111315]" : "border-transparent text-slate-700 hover:bg-white/70",
        ].join(" ")}
      >
        <span className="flex min-w-0 items-center justify-between gap-2">
          <strong className="truncate text-sm">{conversation.title || "新对话"}</strong>
          {active ? <i className="size-2 rounded-full bg-[#bbff66] shadow-[0_0_0_5px_rgba(187,255,102,0.22)]" /> : null}
        </span>
        <span className="truncate text-xs text-slate-500">{conversation.lastMessagePreview || "继续追问这个会话"}</span>
      </button>
      <button
        type="button"
        data-conversation-menu
        onClick={() => {
          setConfirmingDelete(false);
          onToggleMenu();
        }}
        className="ask-premium-conversation-more absolute right-2 top-2 grid size-8 place-items-center rounded-[8px] bg-white/80 text-slate-500 opacity-0 shadow-sm transition group-hover:opacity-100"
        aria-label="会话操作"
      >
        <MoreHorizontal size={16} />
      </button>
      {menuOpen ? (
        <div data-conversation-menu className="ask-premium-conversation-menu absolute right-2 top-10 z-40 grid w-32 gap-1 rounded-[8px] border border-black/10 bg-white p-1 shadow-[0_12px_34px_rgba(15,23,42,0.14)]">
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
        </div>
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
  highlighted,
  assetNameCache,
}: {
  message: ChatMessage;
  question?: string;
  onPreviewCitation: (
    message: ChatMessage,
    citation: ConversationCitation,
    citationIndex: number,
    question?: string,
  ) => void;
  onSubmitUserEdit: (value: string) => void | Promise<void>;
  canSubmitUserEdit?: boolean;
  highlighted?: boolean;
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
      <article data-turn-id={message.turnId} className={["ask-premium-user-message flex justify-end", editing ? "is-editing" : ""].join(" ")}>
        <div className="relative max-w-[680px]">
          {editing ? (
            <form
              className="ask-premium-user-editor grid gap-3 rounded-[8px] px-3 py-2.5 text-[14px] font-semibold leading-6 text-[#111315]"
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
                className="ask-premium-user-edit-textarea min-h-[76px] w-full resize-y border-0 bg-transparent p-0 text-[14px] font-semibold leading-6 text-[#111315] outline-none"
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
              <div className="ask-premium-user-text max-w-[680px] whitespace-pre-wrap break-words pb-8 pl-8 text-right text-[14px] font-semibold leading-6 text-[#111315]">
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
    <article data-turn-id={message.turnId} className={["flex gap-2.5", highlighted ? "rounded-[10px] ring-2 ring-blue-500/70" : ""].join(" ")}>
      <div className="ask-premium-assistant-avatar grid size-8 shrink-0 place-items-center rounded-full bg-[#111315] text-white shadow-none">
        <Sparkles size={15} />
      </div>
      <div className="ask-premium-assistant-content min-w-0 flex-1 py-1">
        <div className="mb-2 flex items-center justify-between gap-4">
          <strong className="text-[13px]">Anchr Answer</strong>
          {message.pending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#bbff66]/25 px-2.5 py-1 text-[11px] font-black text-[#4e7b13]">
              <span className="size-1.5 animate-pulse rounded-full bg-[#4e7b13]" />
              流式回答中
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
        <div className="ask-premium-answer-text whitespace-pre-wrap break-words text-[14px] leading-7 text-slate-700">
          {message.pending && !stripTraceText(message.content) ? "正在生成回答..." : stripTraceText(message.content)}
        </div>
        {message.error ? <div className="mt-3 text-sm text-rose-600">{message.error}</div> : null}
        {message.citations?.length ? (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="引用来源">
            {message.citations.map((citation, index) => (
              <button
                type="button"
                key={`${citation.segmentId ?? citation.fileName ?? index}-${index}`}
                onClick={() => onPreviewCitation(message, citation, index, question)}
                disabled={!citation.segmentId}
                className="ask-premium-citation inline-flex min-h-[30px] items-center gap-2 rounded-full border border-black/10 bg-[#f7f7f2]/85 px-2.5 text-[11px] font-black text-[#111315] transition hover:-translate-y-0.5 hover:bg-[#111315] hover:text-white disabled:opacity-60"
              >
                [{index + 1}] {citation.fileName ?? "引用来源"} {citation.pageNo ? `第 ${citation.pageNo} 页` : ""}
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
    });

    return messages;
  });
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
  if (stage === "retrieval") return "__TRACE__正在检索知识库...";
  return "__TRACE__正在生成回答...";
}

function stripTraceText(value: string) {
  return value.startsWith("__TRACE__") ? "" : value;
}
