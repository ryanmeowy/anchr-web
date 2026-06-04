"use client";

import type {
  ApiResult,
  ConversationCitation,
  ConversationMessage,
  ConversationMessageList,
  ConversationSession,
  ConversationSessionList,
  DocumentAsset,
  HomeSummary,
  IngestionCapability,
  IngestionTaskList,
  IngestionTask,
  KnowledgeBase,
  PagedList,
  Preference,
  PreviewSegment,
  RecentCitationList,
  RecentQuestionList,
  ProviderList,
  SearchPage,
  SearchSetting,
  UploadIngestionItem,
} from "./types";

const TOKEN_KEY = "anchr.accessToken";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
};

type StreamMessageCallbacks = {
  onTrace?: (event: { stage?: string; message?: string }) => void;
  onDelta?: (text: string) => void;
  onCitations?: (citations: ConversationCitation[]) => void;
  onDone?: (event: { turnId?: string; kbScope?: string[]; title?: string | null }) => void;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function getAccessToken() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function saveAccessToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearAccessToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const basePath = process.env.NEXT_PUBLIC_API_BASE_PATH ?? "/backend";
  const token = options.token ?? getAccessToken();
  const response = await fetch(`${basePath}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Access-Token": token } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !payload || payload.code < 200 || payload.code >= 300) {
    throw new ApiError(
      payload?.message ?? `请求失败：${response.status}`,
      response.status,
      payload?.errorCode,
    );
  }

  return payload.data;
}

function normalizePreviewSegmentId(segmentId: string) {
  return segmentId.replace(/%253A/gi, ":").replace(/%3A/gi, ":");
}

function activityQuery(limit: number, cursor?: string | null) {
  const params = new URLSearchParams({ limit: String(limit) });

  if (cursor) {
    params.set("cursor", cursor);
  }

  return params.toString();
}

function conversationListQuery(limit: number, cursor?: string | null) {
  const params = new URLSearchParams({ limit: String(limit) });

  if (cursor) {
    params.set("cursor", cursor);
  }

  return params.toString();
}

function conversationMessagesQuery(limit: number, beforeTurnId?: string | null) {
  const params = new URLSearchParams({ limit: String(limit) });

  if (beforeTurnId) {
    params.set("beforeTurnId", beforeTurnId);
  }

  return params.toString();
}

function parseSseJson<T>(data: string): T | null {
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function dispatchSseEvent(eventName: string, data: string, callbacks: StreamMessageCallbacks) {
  if (!data) {
    return;
  }

  if (eventName === "trace") {
    callbacks.onTrace?.(parseSseJson<{ stage?: string; message?: string }>(data) ?? {});
    return;
  }

  if (eventName === "delta") {
    const event = parseSseJson<{ text?: string }>(data);
    callbacks.onDelta?.(event?.text ?? "");
    return;
  }

  if (eventName === "citations") {
    callbacks.onCitations?.(parseSseJson<ConversationCitation[]>(data) ?? []);
    return;
  }

  if (eventName === "done") {
    callbacks.onDone?.(parseSseJson<{ turnId?: string; kbScope?: string[]; title?: string | null }>(data) ?? {});
    return;
  }

  if (eventName === "error") {
    const event = parseSseJson<{ code?: string; message?: string }>(data);
    throw new ApiError(event?.message ?? "流式回答失败", 200, event?.code);
  }
}

function consumeSseChunk(chunk: string, callbacks: StreamMessageCallbacks) {
  const lines = chunk.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      return;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  });

  dispatchSseEvent(eventName, dataLines.join("\n"), callbacks);
}

export const apiClient = {
  homeSummary: () => request<HomeSummary>("/api/v1/home/summary"),
  recentQuestions: (limit = 10, cursor?: string | null) =>
    request<RecentQuestionList>(`/api/v1/activity/recent-questions?${activityQuery(limit, cursor)}`),
  recentCitations: (limit = 10, cursor?: string | null) =>
    request<RecentCitationList>(`/api/v1/activity/recent-citations?${activityQuery(limit, cursor)}`),
  listKnowledgeBases: (page = 1, size = 20) =>
    request<PagedList<KnowledgeBase>>(`/api/v1/kbs?page=${page}&size=${size}`),
  createKnowledgeBase: (body: { name: string; description?: string }) =>
    request<KnowledgeBase>("/api/v1/kbs", { method: "POST", body }),
  listDocuments: (kbId: string, page = 1, size = 20) =>
    request<PagedList<DocumentAsset>>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/documents?page=${page}&size=${size}`,
    ),
  ingestionCapabilities: () =>
    request<IngestionCapability>("/api/v1/ingestion/capabilities"),
  listIngestionTasks: (kbId: string, size = 10) =>
    request<IngestionTaskList>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/ingestion-tasks?limit=${size}`,
    ),
  createUrlIngestionTask: (kbId: string, body: { sourceUrl: string; fileName: string; fileType: string; dedupeStrategy: string }) =>
    request<IngestionTask>(`/api/v1/kbs/${encodeURIComponent(kbId)}/ingestion-tasks`, {
      method: "POST",
      body: {
        sourceType: "URL",
        dedupeStrategy: body.dedupeStrategy,
        items: [
          {
            sourceUrl: body.sourceUrl,
            fileName: body.fileName,
            fileType: body.fileType,
          },
        ],
      },
    }),
  createUploadIngestionTask: (kbId: string, body: { dedupeStrategy: string; items: UploadIngestionItem[] }) =>
    request<IngestionTask>(`/api/v1/kbs/${encodeURIComponent(kbId)}/ingestion-tasks`, {
      method: "POST",
      body: {
        sourceType: "UPLOAD",
        dedupeStrategy: body.dedupeStrategy,
        items: body.items,
      },
    }),
  retryFailedIngestionTask: (kbId: string, taskId: string) =>
    request<IngestionTask>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/ingestion-tasks/${encodeURIComponent(taskId)}/retry-failed`,
      { method: "POST" },
    ),
  encryptedSts: () => request<string>("/api/v1/auth/sts"),
  searchKnowledgeBase: (body: { query: string; kbIds: string[]; limit: number; withAnswer: boolean }) =>
    request<SearchPage>("/api/v1/search/kb", { method: "POST", body }),
  listConversations: (limit = 50, cursor?: string | null) =>
    request<ConversationSessionList>(`/api/conversations?${conversationListQuery(limit, cursor)}`),
  getConversation: (sessionId: string) =>
    request<ConversationSession>(`/api/conversations/${encodeURIComponent(sessionId)}`),
  createConversation: (body: { title?: string | null; kbIds?: string[] }) =>
    request<ConversationSession>("/api/conversations", {
      method: "POST",
      body,
    }),
  renameConversation: (sessionId: string, body: { title: string }) =>
    request<ConversationSession>(`/api/conversations/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body,
    }),
  deleteConversation: (sessionId: string) =>
    request<null>(`/api/conversations/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),
  sendMessage: (sessionId: string, body: { query: string; kbIds: string[]; answerMode: string }) =>
    request<ConversationMessage>(`/api/conversations/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body,
    }),
  sendMessageStream: async (
    sessionId: string,
    body: { query: string; kbIds?: string[]; answerMode?: string; stream?: boolean },
    callbacks: StreamMessageCallbacks,
    signal?: AbortSignal,
  ) => {
    const basePath = process.env.NEXT_PUBLIC_API_BASE_PATH ?? "/backend";
    const token = getAccessToken();
    const response = await fetch(`${basePath}/api/conversations/${encodeURIComponent(sessionId)}/messages/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { "X-Access-Token": token } : {}),
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });

    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as ApiResult<null> | null;
      throw new ApiError(
        payload?.message ?? `请求失败：${response.status}`,
        response.status,
        payload?.errorCode,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";

      chunks.forEach((chunk) => consumeSseChunk(chunk, callbacks));

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      consumeSseChunk(buffer, callbacks);
    }
  },
  listConversationMessages: (sessionId: string, limit = 100, beforeTurnId?: string | null) =>
    request<ConversationMessageList>(
      `/api/conversations/${encodeURIComponent(sessionId)}/messages?${conversationMessagesQuery(limit, beforeTurnId)}`,
    ),
  previewSegment: (segmentId: string) =>
    request<PreviewSegment>(`/api/v1/preview/segments/${normalizePreviewSegmentId(segmentId)}`),
  previewNeighbors: (segmentId: string) =>
    request<{ items?: PreviewSegment["surroundingChunks"] }>(
      `/api/v1/preview/segments/${normalizePreviewSegmentId(segmentId)}/neighbors?before=2&after=2`,
    ),
  providers: () => request<ProviderList>("/api/v1/settings/providers"),
  searchSetting: () => request<SearchSetting>("/api/v1/settings/search"),
  preferences: () => request<Preference>("/api/v1/settings/preferences"),
};
