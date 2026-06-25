"use client";

import type { ConversationCitation, SearchAnswer } from "./types";

const STORAGE_PREFIX = "anchr.preview.context.";
const RESTORE_PREFIX = "anchr.preview.restore.";

export type PreviewSource = "ask" | "search";

export type PreviewCitation = {
  citationIndex?: number;
  segmentId?: string;
  assetId?: string;
  kbId?: string;
  fileName?: string;
  pageNo?: number;
  snippet?: string;
};

export type PreviewNavigationPayload<TReturnState = unknown> = {
  source: PreviewSource;
  question?: string;
  answer?: string;
  citations?: PreviewCitation[];
  returnState?: TReturnState;
};

export type PreviewNavigationContext<TReturnState = unknown> = PreviewNavigationPayload<TReturnState> & {
  version: 1;
  createdAt: number;
};

export function savePreviewNavigation<TReturnState>(payload: PreviewNavigationPayload<TReturnState>) {
  if (typeof window === "undefined") {
    return "";
  }

  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const context: PreviewNavigationContext<TReturnState> = {
    ...payload,
    version: 1,
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

  return readJson<PreviewNavigationContext<TReturnState>>(`${STORAGE_PREFIX}${key}`);
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
    citationIndex: index + 1,
    segmentId: item.segmentId,
    assetId: item.assetId,
    fileName: item.fileName,
    pageNo: item.pageNo,
    snippet: item.snippet,
  }));
}

export function normalizeSearchCitations(citations: SearchAnswer["citations"] | undefined) {
  return (citations ?? []).map((item, index) => ({
    citationIndex: item.citationIndex ?? index + 1,
    segmentId: item.segmentId,
    assetId: item.assetId,
    kbId: item.kbId,
    fileName: item.fileName,
    pageNo: item.pageNo,
    snippet: item.snippet,
  }));
}

function readJson<T>(key: string) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
