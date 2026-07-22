import type {
  IngestionCreateItem,
  IngestionCreateRequest,
  IngestionTask,
} from "./types";

type ApiErrorLike = Error & {
  status: number;
  code?: string;
  requestAccepted?: boolean;
  uploadCleanupAllowed?: boolean;
};

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export class IngestionCreatePersistenceError extends Error {
  constructor() {
    super("无法保存任务恢复信息，已停止提交。请检查浏览器存储权限或可用空间后重试。");
    this.name = "IngestionCreatePersistenceError";
  }
}

export type IngestionCreateRecoveryApi = {
  findByClientRequestId: (kbId: string, clientRequestId: string) => Promise<IngestionTask>;
  create: (kbId: string, request: IngestionCreateRequest) => Promise<IngestionTask>;
};

export type IngestionCreateRecoveryResult =
  | { state: "resolved"; task: IngestionTask; source: "lookup" | "create" }
  | { state: "confirming"; error: unknown }
  | { state: "failed"; error: unknown };

export async function recoverIngestionCreate(
  api: IngestionCreateRecoveryApi,
  kbId: string,
  request: IngestionCreateRequest,
): Promise<IngestionCreateRecoveryResult> {
  try {
    const task = requireUsableIngestionTask(await api.findByClientRequestId(kbId, request.clientRequestId));
    return {
      state: "resolved",
      task,
      source: "lookup",
    };
  } catch (error) {
    if (!isIngestionTaskNotFound(error)) {
      return { state: "confirming", error };
    }
  }

  try {
    const task = requireUsableIngestionTask(await api.create(kbId, request));
    return {
      state: "resolved",
      task,
      source: "create",
    };
  } catch (error) {
    return isUncertainIngestionCreateError(error)
      ? { state: "confirming", error }
      : { state: "failed", error };
  }
}

export async function submitPersistedIngestionCreate<T>(
  persistRecoveryState: () => boolean,
  submit: () => Promise<T>,
  cleanupBeforeSubmit?: () => Promise<unknown>,
) {
  if (!persistRecoveryState()) {
    if (cleanupBeforeSubmit) {
      await cleanupBeforeSubmit().catch(() => undefined);
    }
    throw new IngestionCreatePersistenceError();
  }
  return submit();
}

export function isIngestionCreatePersistenceError(error: unknown) {
  return error instanceof IngestionCreatePersistenceError;
}

export function isIngestionTaskNotFound(error: unknown) {
  return isApiErrorLike(error)
    && error.status === 404
    && error.code === "INGESTION_TASK_NOT_FOUND";
}

export function isUncertainIngestionCreateError(error: unknown) {
  if (!isApiErrorLike(error)) return true;
  if (isIdempotencyKeyReused(error)) return false;
  if (error.requestAccepted === false || error.uploadCleanupAllowed === true) return false;
  return true;
}

export function isIdempotencyKeyReused(error: unknown) {
  return isApiErrorLike(error)
    && error.code === "IDEMPOTENCY_KEY_REUSED";
}

export function shouldCleanupRejectedIngestionCreate(error: unknown) {
  return isApiErrorLike(error)
    && error.uploadCleanupAllowed === true
    && !isIdempotencyKeyReused(error);
}

export function normalizePersistedIngestionCreateRequest(
  value: unknown,
): IngestionCreateRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Partial<IngestionCreateRequest>;
  const sourceType = request.sourceType;
  if (!isValidClientRequestId(request.clientRequestId)
    || (sourceType !== "UPLOAD" && sourceType !== "URL")
    || !hasText(request.dedupeStrategy)
    || !Array.isArray(request.items)
    || request.items.length === 0
    || request.items.length > 50) {
    return null;
  }

  const items = request.items.map((item) => normalizeCreateItem(item, sourceType));
  if (items.some((item) => item === null)) return null;

  return {
    clientRequestId: request.clientRequestId,
    sourceType,
    dedupeStrategy: request.dedupeStrategy,
    items: items as IngestionCreateItem[],
  };
}

function normalizeCreateItem(value: unknown, sourceType: IngestionCreateRequest["sourceType"]) {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<IngestionCreateItem>;
  if (!hasText(item.fileType)) return null;
  if (sourceType === "UPLOAD" && (!hasText(item.fileName) || !hasText(item.objectKey))) return null;
  if (sourceType === "URL" && !hasText(item.sourceUrl)) return null;
  if (item.sizeBytes !== undefined && (!Number.isFinite(item.sizeBytes) || item.sizeBytes < 0)) return null;

  return {
    ...(typeof item.fileName === "string" ? { fileName: item.fileName } : {}),
    ...(typeof item.title === "string" ? { title: item.title } : {}),
    fileType: item.fileType,
    ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
    ...(typeof item.sizeBytes === "number" ? { sizeBytes: item.sizeBytes } : {}),
    ...(typeof item.objectKey === "string" ? { objectKey: item.objectKey } : {}),
    ...(typeof item.fileHash === "string" ? { fileHash: item.fileHash } : {}),
    ...(typeof item.sourceUrl === "string" ? { sourceUrl: item.sourceUrl } : {}),
  } satisfies IngestionCreateItem;
}

function requireUsableIngestionTask(value: unknown): IngestionTask {
  if (!value || typeof value !== "object") throw invalidIngestionTaskResponse();
  const task = value as Partial<IngestionTask>;
  if (!hasText(task.taskId)
    || !hasText(task.kbId)
    || !hasText(task.sourceType)
    || !hasText(task.status)
    || !isNonNegativeNumber(task.totalCount)
    || !isNonNegativeNumber(task.successCount)
    || !isNonNegativeNumber(task.failureCount)
    || !isNonNegativeNumber(task.runningCount)
    || (task.items !== undefined && !Array.isArray(task.items))) {
    throw invalidIngestionTaskResponse();
  }
  return task as IngestionTask;
}

function invalidIngestionTaskResponse() {
  return new Error("ingestion task response is incomplete.");
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidClientRequestId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_REQUEST_ID_PATTERN.test(value);
}

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  return error instanceof Error
    && typeof (error as Partial<ApiErrorLike>).status === "number";
}
