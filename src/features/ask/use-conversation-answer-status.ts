"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { getAccessTokenIdentityKey, getConfiguredAccessToken } from "@/lib/api-client";
import {
  createConversationAnswerStatusState,
  markConversationAnswerViewed,
  parseConversationAnswerStatusState,
  recordConversationAnswerCompleted,
  unreadConversationSessionIds,
  type ConversationAnswerStatusState,
} from "./conversation-answer-status";

const STORAGE_KEY_PREFIX = "anchr.ask.conversation-answer-status.v1";
const STATUS_CHANGED_EVENT = "anchr:conversation-answer-status-changed";
const EMPTY_STATE = createConversationAnswerStatusState(0);
let cachedStorageKey: string | null = null;
let cachedRawValue: string | null = null;
let cachedState = EMPTY_STATE;

export function useConversationAnswerStatus() {
  const storageKey = `${STORAGE_KEY_PREFIX}.${getAccessTokenIdentityKey(getConfiguredAccessToken())}`;
  const subscribe = useCallback((onStoreChange: () => void) => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) onStoreChange();
    };
    const handleLocalChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === storageKey) onStoreChange();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(STATUS_CHANGED_EVENT, handleLocalChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(STATUS_CHANGED_EVENT, handleLocalChange);
    };
  }, [storageKey]);
  const getSnapshot = useCallback(() => readStoredState(storageKey), [storageKey]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = state.initializedAt > 0;

  useEffect(() => {
    if (!hydrated) writeStoredState(storageKey, createConversationAnswerStatusState(currentTimestamp()));
  }, [hydrated, storageKey]);

  const updateState = useCallback((
    update: (current: ConversationAnswerStatusState) => ConversationAnswerStatusState,
  ) => {
    if (!hydrated) return;
    const current = readStoredState(storageKey);
    const next = update(current);
    if (next !== current) writeStoredState(storageKey, next);
  }, [hydrated, storageKey]);

  const recordAnswerCompleted = useCallback((sessionId: string, answeredAt: number, viewed: boolean) => {
    updateState((current) => recordConversationAnswerCompleted(current, sessionId, answeredAt, viewed));
  }, [updateState]);

  const markAnswerViewed = useCallback((sessionId: string) => {
    updateState((current) => markConversationAnswerViewed(current, sessionId));
  }, [updateState]);

  return {
    hydrated,
    unreadSessionIds: useMemo(() => unreadConversationSessionIds(state), [state]),
    recordAnswerCompleted,
    markAnswerViewed,
  };
}

function getServerSnapshot() {
  return EMPTY_STATE;
}

function readStoredState(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (cachedStorageKey === storageKey && cachedRawValue === raw) return cachedState;
    cachedStorageKey = storageKey;
    cachedRawValue = raw;
    cachedState = raw ? parseStoredValue(raw) : EMPTY_STATE;
    return cachedState;
  } catch {
    return cachedStorageKey === storageKey ? cachedState : EMPTY_STATE;
  }
}

function parseStoredValue(raw: string) {
  try {
    return parseConversationAnswerStatusState(JSON.parse(raw) as unknown, 0);
  } catch {
    return EMPTY_STATE;
  }
}

function writeStoredState(storageKey: string, state: ConversationAnswerStatusState) {
  const raw = JSON.stringify(state);
  cachedStorageKey = storageKey;
  cachedRawValue = raw;
  cachedState = state;
  try {
    window.localStorage.setItem(storageKey, raw);
  } catch {
    // The status still works in-memory when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(STATUS_CHANGED_EVENT, { detail: storageKey }));
}

function currentTimestamp() {
  return Date.now();
}
