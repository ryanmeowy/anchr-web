"use client";

import type {
  ApiResult,
  ConversationMessage,
  DocumentAsset,
  HomeSummary,
  IngestionCapability,
  IngestionTaskList,
  IngestionTask,
  KnowledgeBase,
  PagedList,
  Preference,
  PreviewSegment,
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

export const apiClient = {
  homeSummary: () => request<HomeSummary>("/api/v1/home/summary"),
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
  createConversation: (body: { title: string; kbIds: string[] }) =>
    request<{ sessionId: string; title: string }>("/api/conversations", {
      method: "POST",
      body,
    }),
  sendMessage: (sessionId: string, body: { query: string; kbIds: string[]; answerMode: string }) =>
    request<ConversationMessage>(`/api/conversations/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body,
    }),
  previewSegment: (segmentId: string) =>
    request<PreviewSegment>(`/api/v1/preview/segments/${encodeURIComponent(segmentId)}`),
  previewNeighbors: (segmentId: string) =>
    request<{ items?: PreviewSegment["surroundingChunks"] }>(
      `/api/v1/preview/segments/${encodeURIComponent(segmentId)}/neighbors?before=2&after=2`,
    ),
  providers: () => request<ProviderList>("/api/v1/settings/providers"),
  searchSetting: () => request<SearchSetting>("/api/v1/settings/search"),
  preferences: () => request<Preference>("/api/v1/settings/preferences"),
};
