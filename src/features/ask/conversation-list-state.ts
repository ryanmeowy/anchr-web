import type { ConversationSession } from "@/lib/types";

export type ConversationMessageSessionMetadata = {
  title?: string | null;
  sessionUpdatedAt?: number;
  kbScope?: string[];
};

export function shouldRecoverConversationCursor(
  error: unknown,
  append: boolean,
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  if (!append || requestGeneration !== currentGeneration || error == null || typeof error !== "object") {
    return false;
  }
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 400 && candidate.code === "INVALID_REQUEST";
}

export function mergeConversationMessageMetadata(
  session: ConversationSession,
  event: ConversationMessageSessionMetadata,
  lastMessagePreview: string,
  fallbackNow = Date.now(),
): ConversationSession {
  const currentUpdatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt as number : 0;
  const eventUpdatedAt = Number.isFinite(event.sessionUpdatedAt)
    ? event.sessionUpdatedAt as number
    : fallbackNow;
  const eventIsStale = event.sessionUpdatedAt != null
    && Number.isFinite(event.sessionUpdatedAt)
    && eventUpdatedAt < currentUpdatedAt;

  return {
    ...session,
    title: eventIsStale ? session.title : event.title || session.title || "新对话",
    lastMessagePreview,
    kbScope: event.kbScope ?? session.kbScope,
    updatedAt: Math.max(currentUpdatedAt, eventUpdatedAt),
  };
}
