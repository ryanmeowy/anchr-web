"use client";

import type { CitationChunk, ConversationCitation, PreviewRequest, RecentCitation, SearchAnswer } from "./types";

const STORAGE_PREFIX = "anchr.preview.context.";
const RESTORE_PREFIX = "anchr.preview.restore.";

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

  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const context: PreviewNavigationContext<TReturnState> = {
    ...payload,
    version: 3,
    createdAt: Date.now(),
  };

  window.sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(context));
  window.sessionStorage.setItem(`${RESTORE_PREFIX}${payload.source}`, key);

  return key;
}

export function readPreviewNavigation<TReturnState = unknown>(key: string | null) {
  if (typeof window === "undefined" || !key) {
    return null;
  }

  const context = readJson<PreviewNavigationContext<TReturnState>>(`${STORAGE_PREFIX}${key}`);
  return context?.version === 3 ? context : null;
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

  window.sessionStorage.removeItem(`${RESTORE_PREFIX}${source}`);
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
  citationIndex?: number;
  context: PreviewNavigationContext | null;
}): PreviewRequest {
  const sourceContext = context?.source === source ? context : null;

  if (source !== "search" && !sourceContext) {
    return {};
  }

  const normalizedCitationIndex = typeof citationIndex === "number"
    && Number.isFinite(citationIndex)
    && citationIndex > 0
    ? citationIndex
    : 1;
  const citation = sourceContext?.citations?.find(
    (item) => item.citationIndex === normalizedCitationIndex && item.chunks.some((chunk) => chunk.segmentId === segmentId),
  )
    ?? sourceContext?.citations?.find((item) => item.chunks.some((chunk) => chunk.segmentId === segmentId))
    ?? sourceContext?.citations?.find((item) => item.citationIndex === normalizedCitationIndex);
  const chunk = citation?.chunks.find((item) => item.segmentId === segmentId) ?? citation?.chunks[0];
  const why = chunk?.why;
  const hasWhy = why?.score != null
    || Boolean(why?.hitSources?.length)
    || Boolean(why?.matchSummary);
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
      citationIndex: String(citation?.citationIndex ?? normalizedCitationIndex),
      ...(citation?.reason ? { reason: citation.reason } : {}),
      ...(hasWhy
        ? {
            why: {
              ...(why?.score != null ? { score: String(why.score) } : {}),
              ...(why?.hitSources?.length ? { hitSources: why.hitSources } : {}),
              ...(why?.matchSummary ? { matchSummary: why.matchSummary } : {}),
            },
          }
        : {}),
    },
  };
}

export function saveRecentCitationPreviewNavigation(item: RecentCitation, index: number) {
  const fallbackCitationIndex = index + 1;
  const parsedCitationIndex = Number(item.citationIndex);
  const citationIndex = Number.isFinite(parsedCitationIndex) && parsedCitationIndex > 0
    ? parsedCitationIndex
    : fallbackCitationIndex;
  const normalizedSourceType = item.sourceType?.trim().toUpperCase();
  const sourceType = normalizedSourceType === "ASK" || normalizedSourceType === "SEARCH"
    ? normalizedSourceType
    : undefined;
  const contextKey = savePreviewNavigation({
    source: "library",
    navigationMode: "NONE",
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
      chunks: [{
        segmentId: item.segmentId,
        snippet: item.snippet ?? undefined,
      }],
    }],
  });
  const params = new URLSearchParams({
    from: "library",
    contextKey,
    citationIndex: String(citationIndex),
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
