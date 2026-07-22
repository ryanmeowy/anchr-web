"use client";

import type {
  ApiResult,
  CapabilityConfig,
  CapabilityConfigUpdateRequest,
  CapabilityConnectionTestRequest,
  CapabilityConnectionTestResult,
  CapabilityParams,
  ConversationAnswerMode,
  ConversationAnswerStatus,
  ConversationCitation,
  ConversationIntentType,
  ConversationMessageList,
  AgentRunActivity,
  AgentRuntimeSnapshot,
  AgentRunSummary,
  AgentTask,
  ConversationCapabilities,
  ConversationExecutionMode,
  ConversationSession,
  ConversationSessionList,
  ConversationTurn,
  ElasticsearchHealth,
  IngestionCapability,
  IngestionTaskList,
  IngestionTask,
  KnowledgeBase,
  KnowledgeBaseDocumentList,
  KnowledgeBaseHealth,
  KnowledgeBaseListResponse,
  KnowledgeBaseQueryRequest,
  KnowledgeBaseStats,
  KnowledgeBaseUpdateRequest,
  AssetPreview,
  PagedList,
  PreviewRequest,
  PreviewSegment,
  RecentCitationList,
  RecentQuestionList,
  RecentSearchList,
  SearchRequest,
  SearchPage,
  SegmentIndexStatus,
  StorageConfig,
  StorageConfigUpdateRequest,
  StorageConnectionTestResult,
  StsToken,
  UploadIngestionItem,
} from "./types";

export const ACCESS_TOKEN_STORAGE_KEY = "anchr.accessToken";
export const ACCESS_TOKEN_ROLE_STORAGE_KEY = "anchr.accessTokenRole";
const TOKEN_KEY = ACCESS_TOKEN_STORAGE_KEY;
const TOKEN_ROLE_KEY = ACCESS_TOKEN_ROLE_STORAGE_KEY;
const DEFAULT_GUEST_ACCESS_TOKEN = "xIu-ZTIfGSjRcWZpw23Le0c7SwAv1sjI";
export const ACCESS_TOKEN_CHANGED_EVENT = "anchr:access-token-changed";

export type AccessTokenRole = "ADMIN" | "USER" | "GUEST";
export type TokenValidationResult = { valid: boolean; role: AccessTokenRole };

type ApiErrorMetadata = {
  traceId?: string;
  errorId?: string;
  retryable?: boolean;
  requestAccepted?: boolean;
  uploadCleanupAllowed?: boolean;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
};

type StreamMessageCallbacks = {
  onTrace?: (event: { stage?: string; message?: string; runId?: string; turnId?: string; attempt?: number; answerMode?: ConversationAnswerMode | string; intentType?: ConversationIntentType; confidence?: number; details?: Record<string, unknown> }) => void;
  onDelta?: (text: string) => void;
  onAnswerReset?: (text: string) => void;
  onCitations?: (citations: ConversationCitation[]) => void;
  onDone?: (event: { turnId?: string; kbScope?: string[]; assetScope?: string[]; title?: string | null; answerMode?: ConversationAnswerMode | string; answerStatus?: ConversationAnswerStatus; fallbackReason?: string | null; citationCount?: number; intentType?: ConversationIntentType; retrievalExecuted?: boolean; executionMode?: ConversationExecutionMode; runId?: string; workflowVersion?: string; agentTask?: AgentTask }) => void;
};

type AgentTaskStreamCallbacks = {
  onTask?: (task: AgentTask) => void;
  onDelta?: (text: string) => void;
  onAnswerReset?: (text: string) => void;
  onDone?: () => void;
};

type ConversationMessageRequest = {
  query: string;
  limit?: number;
  kbIds?: string[];
  assetIdList?: string[];
  answerMode?: ConversationAnswerMode;
  preferredModalities?: Array<"TEXT" | "IMAGE" | "MIXED">;
  debug?: boolean;
  stream?: boolean;
  agentEnabled?: boolean;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly traceId?: string;
  readonly errorId?: string;
  readonly retryable?: boolean;
  readonly requestAccepted?: boolean;
  readonly uploadCleanupAllowed?: boolean;

  constructor(message: string, status: number, code?: string, metadata: ApiErrorMetadata = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.traceId = metadata.traceId;
    this.errorId = metadata.errorId;
    this.retryable = metadata.retryable;
    this.requestAccepted = metadata.requestAccepted;
    this.uploadCleanupAllowed = metadata.uploadCleanupAllowed;
  }
}

export function isUploadCleanupAllowed(error: unknown) {
  return error instanceof ApiError && error.uploadCleanupAllowed === true;
}

export function isAccessDeniedError(error: unknown) {
  if (!error) return false;

  const message = error instanceof Error ? error.message.toUpperCase() : "";
  const code = error instanceof ApiError ? error.code?.toUpperCase() : undefined;
  return (
    (error instanceof ApiError && error.status === 403) ||
    Boolean(code?.includes("ACCESS_DENIED")) ||
    message.includes("CURRENT ROLE ACCESS DENIED")
  );
}

export function isAuthenticationError(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  const code = error.code?.toUpperCase();
  return error.status === 401 || code === "AUTH_TOKEN_INVALID";
}

function isBuiltinGuestAccessToken(token: string) {
  return token.trim() === DEFAULT_GUEST_ACCESS_TOKEN;
}

export function getConfiguredAccessToken() {
  if (typeof window === "undefined") {
    return "";
  }

  const storedToken = window.localStorage.getItem(TOKEN_KEY)?.trim() ?? "";
  if (isBuiltinGuestAccessToken(storedToken)) {
    return "";
  }

  return storedToken;
}

export function getAccessToken() {
  return getConfiguredAccessToken() || DEFAULT_GUEST_ACCESS_TOKEN;
}

export function getConfiguredAccessTokenRole(): AccessTokenRole {
  if (typeof window === "undefined") return "GUEST";
  const role = window.localStorage.getItem(TOKEN_ROLE_KEY)?.trim().toUpperCase();
  return role === "ADMIN" || role === "USER" ? role : "GUEST";
}

export function getAccessTokenIdentityKey(token: string | null | undefined) {
  const identity = token?.trim() || "guest";
  let primaryHash = 2166136261;
  let secondaryHash = 5381;
  for (let index = 0; index < identity.length; index += 1) {
    const character = identity.charCodeAt(index);
    primaryHash ^= character;
    primaryHash = Math.imul(primaryHash, 16777619);
    secondaryHash = Math.imul(secondaryHash, 33) ^ character;
  }
  return `${(primaryHash >>> 0).toString(36)}-${(secondaryHash >>> 0).toString(36)}`;
}

export function saveAccessToken(token: string, role: AccessTokenRole) {
  const normalizedToken = token.trim();
  if (!normalizedToken || isBuiltinGuestAccessToken(normalizedToken) || role === "GUEST") {
    clearAccessToken();
    return;
  }
  const currentToken = window.localStorage.getItem(TOKEN_KEY)?.trim() ?? "";
  const currentRole = window.localStorage.getItem(TOKEN_ROLE_KEY)?.trim().toUpperCase() ?? "";
  if (currentToken === normalizedToken && currentRole === role) return;

  window.localStorage.setItem(TOKEN_KEY, normalizedToken);
  window.localStorage.setItem(TOKEN_ROLE_KEY, role);
  emitAccessTokenChanged();
}

export function clearAccessToken() {
  if (!window.localStorage.getItem(TOKEN_KEY) && !window.localStorage.getItem(TOKEN_ROLE_KEY)) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_ROLE_KEY);
  emitAccessTokenChanged();
}

function emitAccessTokenChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACCESS_TOKEN_CHANGED_EVENT));
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
    signal: options.signal,
  });

  const payload = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !payload || payload.code < 200 || payload.code >= 300) {
    throw apiErrorFromPayload(payload, response.status, `请求失败：${response.status}`);
  }

  return payload.data;
}

function apiErrorFromPayload(
  payload: ApiResult<unknown> | null,
  status: number,
  fallbackMessage: string,
) {
  return new ApiError(
    payload?.message ?? fallbackMessage,
    status,
    payload?.errorCode,
    {
      traceId: payload?.traceId,
      errorId: payload?.errorId,
      retryable: payload?.retryable,
      requestAccepted: payload?.requestAccepted,
      uploadCleanupAllowed: payload?.uploadCleanupAllowed,
    },
  );
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
    callbacks.onTrace?.(parseSseJson<{
      stage?: string; message?: string; runId?: string; turnId?: string; attempt?: number; answerMode?: ConversationAnswerMode | string;
      intentType?: ConversationIntentType; confidence?: number; details?: Record<string, unknown>;
    }>(data) ?? {});
    return;
  }

  if (eventName === "delta") {
    const event = parseSseJson<{ text?: string }>(data);
    callbacks.onDelta?.(event?.text ?? "");
    return;
  }

  if (eventName === "answer_reset") {
    const event = parseSseJson<{ text?: string }>(data);
    callbacks.onAnswerReset?.(event?.text ?? "");
    return;
  }

  if (eventName === "citations") {
    callbacks.onCitations?.(parseSseJson<ConversationCitation[]>(data) ?? []);
    return;
  }

  if (eventName === "done") {
    callbacks.onDone?.(parseSseJson<{
      turnId?: string; kbScope?: string[]; assetScope?: string[]; title?: string | null;
      answerMode?: ConversationAnswerMode | string; answerStatus?: ConversationAnswerStatus;
      fallbackReason?: string | null; citationCount?: number; intentType?: ConversationIntentType;
      retrievalExecuted?: boolean; executionMode?: ConversationExecutionMode; runId?: string;
      workflowVersion?: string; agentTask?: AgentTask;
    }>(data) ?? {});
    return;
  }

  if (eventName === "error") {
    const event = parseSseJson<{ code?: string; message?: string }>(data);
    throw new ApiError(event?.message ?? "流式回答失败", 200, event?.code);
  }
}

function consumeSseChunk(
  chunk: string,
  callbacks: StreamMessageCallbacks,
) {
  const { eventName, data } = parseSseChunk(chunk);
  if (eventName === "delta") {
    callbacks.onDelta?.(parseSseJson<{ text?: string }>(data)?.text ?? "");
    return eventName;
  }
  if (eventName === "answer_reset") {
    callbacks.onAnswerReset?.(parseSseJson<{ text?: string }>(data)?.text ?? "");
    return eventName;
  }
  dispatchSseEvent(eventName, data, callbacks);
  return eventName;
}

function parseSseChunk(chunk: string) {
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

  return { eventName, data: dataLines.join("\n") };
}

function consumeAgentTaskSseChunk(
  chunk: string,
  callbacks: AgentTaskStreamCallbacks,
) {
  const { eventName, data } = parseSseChunk(chunk);
  if (!data) return eventName;
  if (eventName === "task") {
    const task = parseSseJson<AgentTask>(data);
    if (task) {
      callbacks.onTask?.(task);
    }
  }
  if (eventName === "delta") {
    callbacks.onDelta?.(parseSseJson<{ text?: string }>(data)?.text ?? "");
  }
  if (eventName === "answer_reset") {
    callbacks.onAnswerReset?.(parseSseJson<{ text?: string }>(data)?.text ?? "");
  }
  if (eventName === "done") callbacks.onDone?.();
  return eventName;
}

export const apiClient = {
  validateAccessToken: (token: string) =>
    request<TokenValidationResult>("/api/v1/auth/validate-token", { token }),
  recentQuestions: (limit = 10, cursor?: string | null) =>
    request<RecentQuestionList>(`/api/v1/activity/recent-questions?${activityQuery(limit, cursor)}`),
  recentCitations: (limit = 10, cursor?: string | null) =>
    request<RecentCitationList>(`/api/v1/activity/recent-citations?${activityQuery(limit, cursor)}`),
  recentSearch: (limit = 10, cursor?: string | null) =>
    request<RecentSearchList>(`/api/v1/activity/recent-search?${activityQuery(limit, cursor)}`),
  listKnowledgeBases: (page = 1, size = 20) =>
    request<PagedList<KnowledgeBase>>("/api/v1/kbs/search", { method: "POST", body: { page, size, status: "0" } }),
  queryKnowledgeBases: (body: KnowledgeBaseQueryRequest) =>
    request<KnowledgeBaseListResponse>("/api/v1/kbs/search", { method: "POST", body }),
  getKnowledgeBase: (kbId: string) =>
    request<KnowledgeBase>(`/api/v1/kbs/${encodeURIComponent(kbId)}`),
  getKnowledgeBaseStats: (kbIds: string[]) =>
    request<KnowledgeBaseStats[]>("/api/v1/kbs/stats", { method: "POST", body: { kbIds } }),
  getKnowledgeBaseHealth: (kbId: string) =>
    request<KnowledgeBaseHealth>(`/api/v1/kbs/${encodeURIComponent(kbId)}/health`),
  listKnowledgeBaseDocuments: (
    kbId: string,
    query: { page: number; size: number; keyword?: string; fileType?: string },
  ) => {
    const params = new URLSearchParams({
      page: String(query.page),
      size: String(query.size),
    });
    if (query.keyword) params.set("keyword", query.keyword);
    if (query.fileType) params.set("fileType", query.fileType);
    return request<KnowledgeBaseDocumentList>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/documents?${params.toString()}`,
    );
  },
  previewAsset: (kbId: string, assetId: string) =>
    request<AssetPreview>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(assetId)}/preview`,
    ),
  deleteKnowledgeBaseDocument: (kbId: string, assetId: string) =>
    request<null>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(assetId)}`,
      { method: "DELETE" },
    ),
  getElasticsearchHealth: () =>
    request<ElasticsearchHealth>("/api/v1/health/elasticsearch"),
  createKnowledgeBase: (body: { name: string; description?: string }) =>
    request<KnowledgeBase>("/api/v1/kbs", { method: "POST", body }),
  updateKnowledgeBase: (kbId: string, body: KnowledgeBaseUpdateRequest) =>
    request<KnowledgeBase>(`/api/v1/kbs/${encodeURIComponent(kbId)}`, { method: "PATCH", body }),
  archiveKnowledgeBase: (kbId: string) =>
    request<null>(`/api/v1/kbs/${encodeURIComponent(kbId)}`, { method: "DELETE" }),
  ingestionCapabilities: () =>
    request<IngestionCapability>("/api/v1/ingestion/capabilities"),
  listIngestionTasks: (kbId: string, size = 10) =>
    request<IngestionTaskList>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/ingestion-tasks?limit=${size}`,
    ),
  getIngestionTask: (kbId: string, taskId: string) =>
    request<IngestionTask>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/ingestion-tasks/${encodeURIComponent(taskId)}`,
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
  retryIngestionTaskItem: (kbId: string, taskId: string, itemId: string) =>
    request<IngestionTask>(
      `/api/v1/kbs/${encodeURIComponent(kbId)}/ingestion-tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}/retry`,
      { method: "POST" },
    ),
  getStsToken: () => request<StsToken>("/api/v1/auth/sts"),
  searchKnowledgeBase: (body: SearchRequest) =>
    request<SearchPage>("/api/v1/search/kb", { method: "POST", body }),
  listConversations: (limit = 50, cursor?: string | null) =>
    request<ConversationSessionList>(`/api/v1/conversations?${conversationListQuery(limit, cursor)}`),
  getConversationCapabilities: () =>
    request<ConversationCapabilities>("/api/v1/conversations/capabilities"),
  getAgentTask: (taskId: string) =>
    request<AgentTask>(`/api/v1/agent/tasks/${encodeURIComponent(taskId)}`),
  streamAgentTask: async (
    taskId: string,
    callbacks: AgentTaskStreamCallbacks,
    signal?: AbortSignal,
  ) => {
    const basePath = process.env.NEXT_PUBLIC_API_BASE_PATH ?? "/backend";
    const token = getAccessToken();
    const response = await fetch(`${basePath}/api/v1/agent/tasks/${encodeURIComponent(taskId)}/stream`, {
      headers: {
        Accept: "text/event-stream",
        ...(token ? { "X-Access-Token": token } : {}),
      },
      signal,
      cache: "no-store",
    });
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as ApiResult<null> | null;
      throw apiErrorFromPayload(payload, response.status, `任务流连接失败：${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";
      for (let index = 0; index < chunks.length; index += 1) {
        consumeAgentTaskSseChunk(chunks[index], callbacks);
      }
      if (done) break;
    }
    if (buffer.trim()) consumeAgentTaskSseChunk(buffer, callbacks);
  },
  cancelAgentTask: (taskId: string) =>
    request<AgentTask>(`/api/v1/agent/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" }),
  cancelAgentRun: (runId: string) =>
    request<boolean>(`/api/v1/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  getAgentRunActivity: (runId: string, signal?: AbortSignal) =>
    request<AgentRunActivity>(`/api/v1/agent/runs/${encodeURIComponent(runId)}/activity`, { signal }),
  getAgentRuntimeSnapshot: (runId: string, afterVersion = 0, signal?: AbortSignal) =>
    request<AgentRuntimeSnapshot | null>(
      `/api/v1/agent/runs/${encodeURIComponent(runId)}/runtime-snapshot?afterVersion=${Math.max(0, afterVersion)}`,
      { signal },
    ),
  listRecoverableAgentRuns: (limit = 10) =>
    request<AgentRunSummary[]>(`/api/v1/agent/runs/recoverable?limit=${limit}`),
  createConversation: (body: { title?: string | null; kbIds?: string[]; assetIdList?: string[] }) =>
    request<ConversationSession>("/api/v1/conversations", {
      method: "POST",
      body,
    }),
  renameConversation: (sessionId: string, body: { title: string }) =>
    request<ConversationSession>(`/api/v1/conversations/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body,
    }),
  deleteConversation: (sessionId: string) =>
    request<null>(`/api/v1/conversations/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),
  getConversationMessage: (sessionId: string, turnId: string, signal?: AbortSignal) =>
    request<ConversationTurn>(
      `/api/v1/conversations/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(turnId)}`,
      { signal },
    ),
  sendMessageStream: async (
    sessionId: string,
    body: ConversationMessageRequest,
    callbacks: StreamMessageCallbacks,
    signal?: AbortSignal,
  ) => {
    const basePath = process.env.NEXT_PUBLIC_API_BASE_PATH ?? "/backend";
    const token = getAccessToken();
    const response = await fetch(`${basePath}/api/v1/conversations/${encodeURIComponent(sessionId)}/messages/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { "X-Access-Token": token } : {}),
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as ApiResult<null> | null;
      throw apiErrorFromPayload(payload, response.status, `请求失败：${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";

      for (let index = 0; index < chunks.length; index += 1) {
        consumeSseChunk(chunks[index], callbacks);
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      consumeSseChunk(buffer, callbacks);
    }
  },
  listConversationMessages: (
    sessionId: string,
    limit = 100,
    beforeTurnId?: string | null,
    signal?: AbortSignal,
  ) =>
    request<ConversationMessageList>(
      `/api/v1/conversations/${encodeURIComponent(sessionId)}/messages?${conversationMessagesQuery(limit, beforeTurnId)}`,
      { signal },
    ),
  previewSegment: (segmentId: string, body: PreviewRequest = {}) =>
    request<PreviewSegment>(`/api/v1/preview/segments/${normalizePreviewSegmentId(segmentId)}`, {
      method: "POST",
      body,
    }),
  refreshSegmentPreview: (segmentId: string, body: PreviewRequest = {}) =>
    request<PreviewSegment>(`/api/v1/preview/segments/${normalizePreviewSegmentId(segmentId)}/refresh`, {
      method: "POST",
      body,
    }),
  // ── settings: capability config ──────────────────────────────────────

  getCapabilityConfig: (capability: string) =>
    request<CapabilityConfig[]>(`/api/v1/settings/${encodeURIComponent(capability)}`),
  getAllCapabilityConfigs: (capability: string) =>
    request<CapabilityConfig[]>(`/api/v1/settings/${encodeURIComponent(capability)}/all`),
  createCapabilityConfig: (capability: string, body: CapabilityConfigUpdateRequest) =>
    request<CapabilityConfig>(`/api/v1/settings/${encodeURIComponent(capability)}`, { method: "POST", body }),
  updateCapabilityConfig: (capability: string, id: number, body: CapabilityConfigUpdateRequest) =>
    request<CapabilityConfig>(`/api/v1/settings/${encodeURIComponent(capability)}/${id}`, { method: "PATCH", body }),
  selectCapabilityConfig: (capability: string, id: number) =>
    request<null>(`/api/v1/settings/${encodeURIComponent(capability)}/${id}/select`, { method: "PUT" }),
  getIndexStatus: () =>
    request<SegmentIndexStatus>("/api/v1/index/status"),
  retryIndexCreate: () =>
    request<boolean>("/api/v1/index/retry", { method: "POST" }),
  prepareIndexRebuild: () =>
    request<string | null>("/api/v1/index/rebuild/prepare", { method: "POST" }),
  confirmIndexRebuild: (taskId: string) =>
    request<boolean>("/api/v1/index/rebuild/confirm", { method: "POST", body: { taskId } }),
 deleteCapabilityConfig: (capability: string, id: number) =>
    request<null>(`/api/v1/settings/${encodeURIComponent(capability)}/${id}`, { method: "DELETE" }),
  getCapabilityParams: (capability: string) =>
    request<CapabilityParams>(`/api/v1/settings/${encodeURIComponent(capability)}/params`),

  testConnection: (body: CapabilityConnectionTestRequest) =>
    request<CapabilityConnectionTestResult>("/api/v1/settings/test-connection", { method: "POST", body }),

  // ── settings: storage ────────────────────────────────────────────────

  getStorageConfig: () =>
    request<StorageConfig | null>("/api/v1/settings/storage"),
  updateStorageConfig: (body: StorageConfigUpdateRequest) =>
    request<StorageConfig>("/api/v1/settings/storage", { method: "PATCH", body }),
  deleteStorageConfig: (id: number) =>
    request<null>(`/api/v1/settings/storage/${id}`, { method: "DELETE" }),
  testStorage: (body: { endpoint: string; accessKey?: string; secretKey?: string; bucket: string; configId?: number }) =>
    request<StorageConnectionTestResult>("/api/v1/settings/storage/test", { method: "POST", body }),
};
