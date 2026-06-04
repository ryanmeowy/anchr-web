"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  Database,
  Edit3,
  Folder,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import type { ConversationCitation, ConversationSession, ConversationTurn } from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sessionId: string;
  turnId?: string;
  citations?: ConversationCitation[];
  pending?: boolean;
  error?: string;
};

type MessageCache = Record<string, ChatMessage[]>;

const CONVERSATION_PAGE_SIZE = 50;
const HISTORY_LIMIT = 100;

export function AskPage() {
  const searchParams = useSearchParams();
  const initialKbId = searchParams.get("kbId") ?? "";
  const initialKbName = searchParams.get("kbName") ?? "";
  const [query, setQuery] = useState("");
  const [kbId, setKbId] = useState(initialKbId);
  const [activeSessionId, setActiveSessionId] = useState("");
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
  const [isKbMenuOpen, setIsKbMenuOpen] = useState(false);
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [conversationSlot, setConversationSlot] = useState<HTMLElement | null>(null);
  const streamRef = useRef<{ requestId: string; sessionId: string } | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const kbs = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
  const kbOptions = useMemo(() => {
    const options = kbs.map((item) => ({ id: item.id, name: item.name }));
    const existingIds = new Set(options.map((item) => item.id));

    if (initialKbId && initialKbName && !existingIds.has(initialKbId)) {
      options.push({ id: initialKbId, name: initialKbName });
    }

    return options;
  }, [initialKbId, initialKbName, kbs]);

  const selectedKbIds = useMemo(() => {
    if (kbId) {
      return [kbId];
    }

    return kbs.slice(0, 3).map((item) => item.id);
  }, [kbId, kbs]);

  const selectedKbLabel = useMemo(() => {
    if (!kbId) {
      return "全部知识库";
    }

    return kbOptions.find((item) => item.id === kbId)?.name ?? "已选知识库";
  }, [kbId, kbOptions]);

  const activeMessages = activeSessionId ? (messagesBySession[activeSessionId] ?? []) : [];
  const hasLoadedActiveMessages = activeSessionId
    ? Object.prototype.hasOwnProperty.call(messagesBySession, activeSessionId)
    : false;
  const activeConversation = activeSessionId ? conversations.find((item) => item.sessionId === activeSessionId) : undefined;
  const isStreamingActiveSession = Boolean(activeSessionId && streamingSessionId === activeSessionId);
  const lastActiveMessageContent = activeMessages.at(-1)?.content;
  const canSubmit = Boolean(query.trim()) && !streamingSessionId && (Boolean(activeSessionId) || selectedKbIds.length > 0);

  const loadConversations = useCallback(async (cursor?: string | null, append = false) => {
    if (append) {
      setIsLoadingMoreConversations(true);
    } else {
      setIsLoadingConversations(true);
    }

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
    const timer = window.setTimeout(() => {
      void loadConversations();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setConversationSlot(document.getElementById("ask-conversations-slot"));
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!activeSessionId || hasLoadedActiveMessages) {
      return;
    }

    let cancelled = false;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      setMessageError(null);

      try {
        const data = await apiClient.listConversationMessages(activeSessionId, HISTORY_LIMIT);
        if (!cancelled) {
          setMessagesBySession((previous) => ({
            ...previous,
            [activeSessionId]: turnsToMessages(data.turns ?? []),
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setMessageError(error instanceof Error ? error.message : "历史消息加载失败");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMessages(false);
        }
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

  const handleConversationListScroll = () => {
    const element = listScrollRef.current;
    if (!element || !nextCursor || isLoadingMoreConversations) {
      return;
    }

    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom < 80) {
      void loadConversations(nextCursor, true);
    }
  };

  const handleNewConversation = () => {
    setActiveSessionId("");
    setMessageError(null);
    setStreamError(null);
    setOpenMenuSessionId(null);
    setRenamingSessionId(null);
  };

  const handleSelectConversation = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessageError(null);
    setStreamError(null);
    setOpenMenuSessionId(null);
    setRenamingSessionId(null);
  };

  const handleSubmit = async () => {
    const text = query.trim();
    if (!text || streamingSessionId || (!activeSessionId && selectedKbIds.length === 0)) {
      return;
    }

    setQuery("");
    setStreamError(null);

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
          kbIds: selectedKbIds.length > 0 ? selectedKbIds : undefined,
          answerMode: "STRICT",
        },
        {
          onTrace: (event) => {
            if (!isCurrentStream()) {
              return;
            }

            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: true,
              content: message.content || traceText(event.stage),
            }));
          },
          onDelta: (delta) => {
            if (!isCurrentStream()) {
              return;
            }

            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: true,
              content: `${stripTraceText(message.content)}${delta}`,
            }));
          },
          onCitations: (citations) => {
            if (!isCurrentStream()) {
              return;
            }

            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              citations,
            }));
          },
          onDone: (event) => {
            if (!isCurrentStream()) {
              return;
            }

            updateAssistantMessage(targetSessionId, assistantMessage.id, (message) => ({
              ...message,
              pending: false,
              turnId: event.turnId,
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
      setStreamError(message);
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
      if (!item) {
        return previous;
      }

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
    if (!title) {
      return;
    }

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

  const conversationList = (
    <>
      <button
        type="button"
        onClick={handleNewConversation}
        className="mb-3 flex h-10 w-full items-center gap-2 rounded-[8px] border border-[var(--line)] px-3 text-left text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:text-slate-200"
      >
        <Plus size={17} />
        新对话
      </button>

      <div className="muted-scrollbar min-h-0 flex-1 overflow-y-auto pr-1" ref={listScrollRef} onScroll={handleConversationListScroll}>
        {isLoadingConversations ? (
          <div className="px-3 py-4">
            <LoadingBlock label="加载会话" />
          </div>
        ) : conversations.length > 0 ? (
          <div className="space-y-1">
            {conversations.map((conversation) => (
              <ConversationListItem
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
          <div className="px-3 py-8 text-sm text-slate-500 dark:text-slate-400">
            暂无历史会话。
          </div>
        )}

        {isLoadingMoreConversations ? (
          <div className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">加载更多...</div>
        ) : nextCursor ? (
          <button
            type="button"
            onClick={() => void loadConversations(nextCursor, true)}
            className="mt-3 h-9 w-full rounded-[8px] text-xs font-medium text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400"
          >
            加载更多
          </button>
        ) : null}

        {conversationError ? (
          <div className="mt-3 rounded-[8px] bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
            {conversationError}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <>
      {conversationSlot ? createPortal(conversationList, conversationSlot) : null}
      <div className="flex h-[calc(100vh-68px)] min-h-[560px] overflow-hidden lg:h-[calc(100vh-82px)]">
        <section className="flex min-w-0 flex-1 flex-col bg-[var(--background)]">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 dark:border-[var(--line)] dark:bg-[var(--surface)] sm:px-6">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
                {activeConversation?.title || "新对话"}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {activeSessionId ? "历史消息会自动保存" : "选择知识库后直接开始提问"}
              </div>
            </div>
            <KnowledgeBasePicker
              kbOptions={kbOptions}
              selectedKbId={kbId}
              selectedLabel={selectedKbLabel}
              isOpen={isKbMenuOpen}
              isLoading={kbsQuery.isLoading}
              onToggle={() => setIsKbMenuOpen((open) => !open)}
              onClose={() => setIsKbMenuOpen(false)}
              onSelect={setKbId}
            />
          </header>

          <div className="muted-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10">
            <div className="mx-auto flex min-h-full max-w-[860px] flex-col">
              {messageError ? (
                <ErrorBlock message={messageError} />
              ) : isLoadingMessages ? (
                <div className="flex flex-1 items-center justify-center">
                  <LoadingBlock label="加载历史消息" />
                </div>
              ) : activeMessages.length > 0 ? (
                <div className="space-y-7">
                  {activeMessages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              ) : (
                <EmptyChat />
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-[var(--line)] bg-[var(--background)] px-4 py-4 dark:border-[var(--line)] sm:px-6 lg:px-10">
            <div className="mx-auto max-w-[860px]">
              {streamError ? (
                <div className="mb-3 rounded-[8px] bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {streamError}
                </div>
              ) : null}
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[0_12px_36px_rgba(15,23,42,0.08)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.24)]">
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder="给 Anchr 发送消息"
                  className="max-h-[180px] min-h-[48px] w-full resize-none border-0 bg-transparent px-3 py-3 text-[15px] leading-7 text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-2 py-2 dark:border-[var(--line)]">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Database size={15} />
                    <span className="truncate">{selectedKbLabel}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-[0_8px_20px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none dark:disabled:bg-slate-700"
                    aria-label={isStreamingActiveSession ? "生成中" : "发送"}
                  >
                    {streamingSessionId ? <Loader2 className="animate-spin" size={19} /> : <Send size={19} fill="currentColor" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function ConversationListItem({
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
  if (renaming) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitRename();
        }}
        className="rounded-[8px] bg-blue-50 p-2 dark:bg-blue-500/15"
      >
        <input
          value={renameValue}
          onChange={(event) => onRenameValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onCancelRename();
            }
          }}
          autoFocus
          className="h-9 w-full rounded-[7px] border border-blue-200 bg-white px-2 text-sm text-slate-900 outline-none ring-0 focus:border-blue-400 dark:border-blue-500/40 dark:bg-[var(--surface)] dark:text-slate-100"
        />
      </form>
    );
  }

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onSelect}
        className={[
          "flex min-h-12 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left transition",
          active
            ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
            : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300 dark:hover:bg-[var(--surface-hover)]",
        ].join(" ")}
      >
        <MessageCircle size={16} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{conversation.title || "新对话"}</span>
          {conversation.lastMessagePreview ? (
            <span className="mt-0.5 block truncate text-xs opacity-70">{conversation.lastMessagePreview}</span>
          ) : null}
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleMenu}
        className={[
          "absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[7px] text-slate-500 transition",
          menuOpen ? "bg-[var(--surface)] opacity-100 shadow-sm" : "opacity-0 hover:bg-[var(--surface)] group-hover:opacity-100",
        ].join(" ")}
        aria-label="会话操作"
      >
        <MoreHorizontal size={17} />
      </button>

      {menuOpen ? (
        <div className="absolute right-1 top-[calc(100%-4px)] z-20 w-32 overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[0_12px_34px_rgba(15,23,42,0.14)] dark:border-[var(--line)] dark:bg-[var(--surface)]">
          <button
            type="button"
            onClick={onStartRename}
            className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-sm text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-200"
          >
            <Edit3 size={15} />
            重命名
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/15"
          >
            <Trash2 size={15} />
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

function KnowledgeBasePicker({
  kbOptions,
  selectedKbId,
  selectedLabel,
  isOpen,
  isLoading,
  onToggle,
  onClose,
  onSelect,
}: {
  kbOptions: Array<{ id: string; name: string }>;
  selectedKbId: string;
  selectedLabel: string;
  isOpen: boolean;
  isLoading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (kbId: string) => void;
}) {
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-9 max-w-[210px] items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Database size={16} />
        <span className="hidden truncate sm:block">{selectedLabel}</span>
        <ChevronDown size={15} />
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-[260px] overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-[var(--line)] dark:bg-[var(--surface)]"
          role="listbox"
        >
          <button
            type="button"
            onClick={() => {
              onSelect("");
              onClose();
            }}
            className={[
              "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm",
              !selectedKbId
                ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300",
            ].join(" ")}
            role="option"
            aria-selected={!selectedKbId}
          >
            <Database size={16} />
            全部知识库
          </button>

          {isLoading ? (
            <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">加载知识库...</div>
          ) : kbOptions.length > 0 ? (
            kbOptions.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onClose();
                }}
                className={[
                  "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm",
                  selectedKbId === item.id
                    ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                    : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300",
                ].join(" ")}
                role="option"
                aria-selected={selectedKbId === item.id}
              >
                <Folder size={16} />
                <span className="truncate">{item.name}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">暂无可选知识库</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={["flex gap-3", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {!isUser ? (
        <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-blue-600 text-white">
          <Sparkles size={16} />
        </div>
      ) : null}
      <div className={["min-w-0", isUser ? "max-w-[76%]" : "max-w-[86%] flex-1"].join(" ")}>
        <div
          className={[
            "whitespace-pre-wrap break-words rounded-[14px] px-4 py-3 text-[15px] leading-7",
            isUser
              ? "bg-blue-600 text-white shadow-[0_8px_22px_rgba(37,99,235,0.22)]"
              : "border border-[var(--line)] bg-[var(--surface)] text-slate-900 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-100",
          ].join(" ")}
        >
          {message.pending && !stripTraceText(message.content) ? (
            <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="animate-spin" size={16} />
              正在生成回答...
            </span>
          ) : (
            stripTraceText(message.content)
          )}
        </div>
        {message.error ? (
          <div className="mt-2 text-sm text-rose-600 dark:text-rose-300">{message.error}</div>
        ) : null}
        {!isUser && message.citations?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.citations.map((citation, index) => (
              <Link
                key={`${citation.segmentId ?? citation.fileName ?? index}-${index}`}
                href={citation.segmentId ? `/preview/${citation.segmentId}` : "/ask"}
                className="rounded-[8px] border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/15 dark:text-blue-200 dark:hover:bg-blue-500/20"
              >
                [{index + 1}] {citation.fileName ?? "引用来源"} {citation.pageNo ? `第 ${citation.pageNo} 页` : ""}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-1 items-center justify-center py-14 text-center">
      <div className="max-w-[520px]">
        <div className="mx-auto grid size-12 place-items-center rounded-[14px] bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
          <MessageCircle size={24} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-slate-950 dark:text-slate-100">开始一个新对话</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          从你的知识库里提问，回答会保存在会话记录中，并附带可点击的引用来源。
        </p>
      </div>
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
    });

    return messages;
  });
}

function mergeConversations(primary: ConversationSession[], secondary: ConversationSession[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((item) => {
    if (seen.has(item.sessionId)) {
      return false;
    }

    seen.add(item.sessionId);
    return true;
  });
}

function makeMessageId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function traceText(stage?: string) {
  if (stage === "retrieval") {
    return "__TRACE__正在检索知识库...";
  }

  return "__TRACE__正在生成回答...";
}

function stripTraceText(value: string) {
  return value.startsWith("__TRACE__") ? "" : value;
}
