export type ConversationAnswerStatusEntry = {
  answeredAt: number;
  viewedAt: number;
};

export type ConversationAnswerStatusState = {
  initializedAt: number;
  sessions: Record<string, ConversationAnswerStatusEntry>;
};

const MAX_TRACKED_SESSIONS = 100;

export function createConversationAnswerStatusState(now: number): ConversationAnswerStatusState {
  return { initializedAt: now, sessions: {} };
}

export function parseConversationAnswerStatusState(
  value: unknown,
  fallbackNow: number,
): ConversationAnswerStatusState {
  if (!value || typeof value !== "object") return createConversationAnswerStatusState(fallbackNow);
  const candidate = value as Partial<ConversationAnswerStatusState>;
  if (!Number.isFinite(candidate.initializedAt) || !candidate.sessions || typeof candidate.sessions !== "object") {
    return createConversationAnswerStatusState(fallbackNow);
  }

  const sessions = Object.fromEntries(Object.entries(candidate.sessions).flatMap(([sessionId, entry]) => {
    if (!sessionId || !entry || typeof entry !== "object") return [];
    const status = entry as Partial<ConversationAnswerStatusEntry>;
    if (!Number.isFinite(status.answeredAt) || !Number.isFinite(status.viewedAt)) return [];
    return [[sessionId, {
      answeredAt: Math.max(0, status.answeredAt ?? 0),
      viewedAt: Math.max(0, status.viewedAt ?? 0),
    }]];
  }));

  return trimConversationAnswerStatusState({
    initializedAt: Math.max(0, candidate.initializedAt ?? fallbackNow),
    sessions,
  });
}

export function recordConversationAnswerCompleted(
  state: ConversationAnswerStatusState,
  sessionId: string,
  answeredAt: number,
  viewed: boolean,
): ConversationAnswerStatusState {
  if (!sessionId || !Number.isFinite(answeredAt)) return state;
  const existing = state.sessions[sessionId];
  // Establishing the feature must not turn historical completed tasks into unread answers.
  if (!existing && answeredAt <= state.initializedAt) return state;

  const nextAnsweredAt = Math.max(existing?.answeredAt ?? 0, answeredAt);
  const nextViewedAt = viewed
    ? Math.max(existing?.viewedAt ?? 0, answeredAt)
    : existing?.viewedAt ?? 0;
  if (existing?.answeredAt === nextAnsweredAt && existing.viewedAt === nextViewedAt) return state;

  return trimConversationAnswerStatusState({
    ...state,
    sessions: {
      ...state.sessions,
      [sessionId]: { answeredAt: nextAnsweredAt, viewedAt: nextViewedAt },
    },
  });
}

export function markConversationAnswerViewed(
  state: ConversationAnswerStatusState,
  sessionId: string,
): ConversationAnswerStatusState {
  const existing = state.sessions[sessionId];
  if (!existing || existing.viewedAt >= existing.answeredAt) return state;
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [sessionId]: { ...existing, viewedAt: existing.answeredAt },
    },
  };
}

export function mergeConversationAnswerStatusStates(
  left: ConversationAnswerStatusState,
  right: ConversationAnswerStatusState,
): ConversationAnswerStatusState {
  const sessionIds = new Set([...Object.keys(left.sessions), ...Object.keys(right.sessions)]);
  const sessions = Object.fromEntries(Array.from(sessionIds).map((sessionId) => {
    const leftEntry = left.sessions[sessionId];
    const rightEntry = right.sessions[sessionId];
    return [sessionId, {
      answeredAt: Math.max(leftEntry?.answeredAt ?? 0, rightEntry?.answeredAt ?? 0),
      viewedAt: Math.max(leftEntry?.viewedAt ?? 0, rightEntry?.viewedAt ?? 0),
    }];
  }));
  const merged = trimConversationAnswerStatusState({
    initializedAt: earliestInitializedAt(left.initializedAt, right.initializedAt),
    sessions,
  });
  return equalConversationAnswerStatusStates(left, merged) ? left : merged;
}

function earliestInitializedAt(left: number, right: number) {
  if (left <= 0) return right;
  if (right <= 0) return left;
  return Math.min(left, right);
}

export function unreadConversationSessionIds(state: ConversationAnswerStatusState) {
  return new Set(Object.entries(state.sessions)
    .filter(([, entry]) => entry.answeredAt > entry.viewedAt)
    .map(([sessionId]) => sessionId));
}

function trimConversationAnswerStatusState(state: ConversationAnswerStatusState) {
  const sessions = Object.fromEntries(Object.entries(state.sessions)
    .sort(([, left], [, right]) => Math.max(right.answeredAt, right.viewedAt) - Math.max(left.answeredAt, left.viewedAt))
    .slice(0, MAX_TRACKED_SESSIONS));
  return { ...state, sessions };
}

function equalConversationAnswerStatusStates(
  left: ConversationAnswerStatusState,
  right: ConversationAnswerStatusState,
) {
  if (left.initializedAt !== right.initializedAt) return false;
  const leftSessionIds = Object.keys(left.sessions);
  const rightSessionIds = Object.keys(right.sessions);
  if (leftSessionIds.length !== rightSessionIds.length) return false;
  return leftSessionIds.every((sessionId) => {
    const leftEntry = left.sessions[sessionId];
    const rightEntry = right.sessions[sessionId];
    return rightEntry
      && leftEntry.answeredAt === rightEntry.answeredAt
      && leftEntry.viewedAt === rightEntry.viewedAt;
  });
}
