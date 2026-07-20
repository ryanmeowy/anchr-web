"use client";

import type { CitationChunk, ConversationCitation, PreviewRequest, RecentCitation, SearchAnswer } from "./types";
import { normalizeCitationLabel, parseAssetCitationIndex } from "./citation-reference";

const STORAGE_PREFIX = "anchr.preview.context.";
const RESTORE_PREFIX = "anchr.preview.restore.";
const PREVIEW_CONTEXT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_PREVIEW_CONTEXTS = 8;

export type PreviewSource = "ask" | "search" | "library";
export type PreviewNavigationMode = "CITATION" | "NONE";

export type PreviewCitation = {
  citationIndex?: number;
  assetId?: string;
  kbId?: string;
  fileName?: string;
  reason?: string;
  chunks: CitationChunk[];
};

export function buildChunkNavigation(citation: PreviewCitation | undefined, segmentId: string) {
  const chunks = [...(citation?.chunks ?? [])].sort(compareChunkPosition);
  const currentPosition = chunks.findIndex((chunk) => chunk.segmentId === segmentId);

  return {
    chunks,
    currentPosition,
    previous: currentPosition > 0 ? chunks[currentPosition - 1] : undefined,
    next: currentPosition >= 0 && currentPosition < chunks.length - 1
      ? chunks[currentPosition + 1]
      : undefined,
  };
}

function compareChunkPosition(left: CitationChunk, right: CitationChunk) {
  return compareOptionalPosition(left.pageNo ?? left.anchor?.pageNo, right.pageNo ?? right.anchor?.pageNo)
    || compareOptionalPosition(left.chunkOrder ?? left.anchor?.chunkOrder, right.chunkOrder ?? right.anchor?.chunkOrder)
    || left.segmentId.localeCompare(right.segmentId);
}

function compareOptionalPosition(left?: number | null, right?: number | null) {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

export type PreviewNavigationPayload<TReturnState = unknown> = {
  source: PreviewSource;
  navigationMode: PreviewNavigationMode;
  recordId?: string;
  sourceType?: PreviewRequest["sourceType"];
  sourceId?: string;
  sessionId?: string;
  question?: string;
  answer?: string;
  citations?: PreviewCitation[];
  returnState?: TReturnState;
};

export type PreviewNavigationContext<TReturnState = unknown> = PreviewNavigationPayload<TReturnState> & {
  version: 3;
  createdAt: number;
};

export function savePreviewNavigation<TReturnState>(payload: PreviewNavigationPayload<TReturnState>) {
  if (typeof window === "undefined") {
    return "";
  }

  const now = Date.now();
  prunePreviewNavigation(now);
  const key = `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const context: PreviewNavigationContext<TReturnState> = {
    ...payload,
    version: 3,
    createdAt: now,
  };

  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(context));
    window.sessionStorage.setItem(`${RESTORE_PREFIX}${payload.source}`, key);
  } catch {
    prunePreviewNavigation(now, true);
    try {
      window.sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(context));
      window.sessionStorage.setItem(`${RESTORE_PREFIX}${payload.source}`, key);
    } catch {
      return "";
    }
  }

  return key;
}

export function readPreviewNavigation<TReturnState = unknown>(key: string | null) {
  if (typeof window === "undefined" || !key) {
    return null;
  }

  const context = readJson<PreviewNavigationContext<TReturnState>>(`${STORAGE_PREFIX}${key}`);
  if (context?.version !== 3 || Date.now() - context.createdAt > PREVIEW_CONTEXT_MAX_AGE_MS) {
    removePreviewContext(key);
    return null;
  }
  return context;
}

export function readPreviewRestoreState<TReturnState = unknown>(source: PreviewSource) {
  if (typeof window === "undefined") {
    return null;
  }

  const key = window.sessionStorage.getItem(`${RESTORE_PREFIX}${source}`);
  const context = readPreviewNavigation<TReturnState>(key);
  if (!context || context.source !== source) {
    return null;
  }

  return { key: key ?? "", context };
}

export function clearPreviewRestoreState(source: PreviewSource) {
  if (typeof window === "undefined") {
    return;
  }

  const restoreKey = `${RESTORE_PREFIX}${source}`;
  const contextKey = window.sessionStorage.getItem(restoreKey);
  window.sessionStorage.removeItem(restoreKey);
  if (contextKey) window.sessionStorage.removeItem(`${STORAGE_PREFIX}${contextKey}`);
}

export function clearAllPreviewNavigation() {
  if (typeof window === "undefined") return;
  storageKeysWithPrefix(STORAGE_PREFIX).forEach((key) => window.sessionStorage.removeItem(key));
  storageKeysWithPrefix(RESTORE_PREFIX).forEach((key) => window.sessionStorage.removeItem(key));
}

function prunePreviewNavigation(now: number, removeAll = false) {
  const entries = storageKeysWithPrefix(STORAGE_PREFIX).map((storageKey) => {
    const context = readJson<PreviewNavigationContext>(storageKey);
    return {
      storageKey,
      contextKey: storageKey.slice(STORAGE_PREFIX.length),
      createdAt: context?.version === 3 ? context.createdAt : 0,
    };
  });
  const validEntries = entries
    .filter((entry) => !removeAll && entry.createdAt > 0 && now - entry.createdAt <= PREVIEW_CONTEXT_MAX_AGE_MS)
    .sort((left, right) => right.createdAt - left.createdAt);
  const keep = new Set(validEntries.slice(0, MAX_PREVIEW_CONTEXTS - 1).map((entry) => entry.storageKey));
  entries.forEach((entry) => {
    if (!keep.has(entry.storageKey)) removePreviewContext(entry.contextKey);
  });
}

function removePreviewContext(contextKey: string) {
  window.sessionStorage.removeItem(`${STORAGE_PREFIX}${contextKey}`);
  (["ask", "search", "library"] as const).forEach((source) => {
    const restoreKey = `${RESTORE_PREFIX}${source}`;
    if (window.sessionStorage.getItem(restoreKey) === contextKey) {
      window.sessionStorage.removeItem(restoreKey);
    }
  });
}

function storageKeysWithPrefix(prefix: string) {
  return Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(prefix)));
}

export function normalizeConversationCitations(citations: ConversationCitation[] | undefined) {
  return (citations ?? []).map((item, index) => ({
    citationIndex: item.citationIndex ?? index + 1,
    assetId: item.assetId,
    kbId: item.kbId,
    fileName: item.fileName,
    chunks: item.chunks ?? [],
  }));
}

export function normalizeSearchCitations(citations: SearchAnswer["citations"] | undefined) {
  return (citations ?? []).map((item, index) => ({
    citationIndex: item.citationIndex ?? index + 1,
    assetId: item.assetId,
    kbId: item.kbId,
    fileName: item.fileName,
    chunks: item.chunks ?? [],
  }));
}

export function buildPreviewRequest({
  source,
  segmentId,
  citationIndex,
  context,
}: {
  source: PreviewSource;
  segmentId: string;
  citationIndex?: string;
  context: PreviewNavigationContext | null;
}): PreviewRequest {
  const sourceContext = context?.source === source ? context : null;

  if (source !== "search" && !sourceContext) {
    return {};
  }

  const normalizedCitationLabel = normalizeCitationLabel(citationIndex);
  const assetCitationIndex = parseAssetCitationIndex(normalizedCitationLabel);
  const citation = sourceContext?.citations?.find(
    (item) => item.citationIndex === assetCitationIndex && item.chunks.some((chunk) => chunk.segmentId === segmentId),
  )
    ?? sourceContext?.citations?.find((item) => item.chunks.some((chunk) => chunk.segmentId === segmentId))
    ?? sourceContext?.citations?.find((item) => item.citationIndex === assetCitationIndex);
  const chunk = citation?.chunks.find((item) => item.segmentId === segmentId) ?? citation?.chunks[0];
  const why = chunk?.why;
  const reason = why?.reason ?? why?.matchSummary ?? citation?.reason;
  const sourceType = sourceContext?.sourceType
    ?? (source === "search" ? "SEARCH" : source === "ask" ? "ASK" : undefined);

  return {
    ...(sourceContext?.recordId ? { recordId: sourceContext.recordId } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(sourceContext?.sourceId ? { sourceId: sourceContext.sourceId } : {}),
    ...(sourceContext?.sessionId ? { sessionId: sourceContext.sessionId } : {}),
    ...(sourceContext?.question ? { question: sourceContext.question } : {}),
    citationInfo: {
      segmentId,
      citationIndex: chunk?.citationLabel ?? normalizedCitationLabel,
      ...(reason ? { reason } : {}),
      ...(citation?.chunks?.length ? { chunks: citation.chunks } : {}),
    },
  };
}

export function saveRecentCitationPreviewNavigation(item: RecentCitation, index: number) {
  const citationLabel = normalizeCitationLabel(item.citationIndex, String(index + 1));
  const citationIndex = parseAssetCitationIndex(citationLabel, index + 1);
  const normalizedSourceType = item.sourceType?.trim().toUpperCase();
  const sourceType = normalizedSourceType === "ASK" || normalizedSourceType === "SEARCH"
    ? normalizedSourceType
    : undefined;
  const chunks = item.chunks?.length
    ? item.chunks
    : [{
        segmentId: item.segmentId,
        snippet: item.snippet ?? undefined,
        pageNo: item.anchor?.pageNo,
        chunkOrder: item.anchor?.chunkOrder,
        anchor: item.anchor ?? undefined,
      }];
  const indexedChunks = chunks.map((chunk) => chunk.segmentId === item.segmentId && !chunk.citationLabel
    ? { ...chunk, citationLabel }
    : chunk);
  const contextKey = savePreviewNavigation({
    source: "library",
    navigationMode: chunks.length > 1 ? "CITATION" : "NONE",
    recordId: item.recordId,
    sourceType,
    sourceId: item.sourceId ?? undefined,
    sessionId: item.sessionId ?? undefined,
    question: item.question ?? undefined,
    citations: [{
      citationIndex,
      assetId: item.assetId ?? undefined,
      kbId: item.kbId ?? undefined,
      fileName: item.fileName ?? undefined,
      reason: item.citationReason ?? undefined,
      chunks: indexedChunks,
    }],
  });
  const params = new URLSearchParams({
    from: "library",
    contextKey,
    citationIndex: citationLabel,
  });

  return `/preview/${encodeURIComponent(item.segmentId)}?${params.toString()}`;
}

function readJson<T>(key: string) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
