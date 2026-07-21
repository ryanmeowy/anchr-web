import assert from "node:assert/strict";
import test from "node:test";

import {
  createConversationAnswerStatusState,
  markConversationAnswerViewed,
  mergeConversationAnswerStatusStates,
  parseConversationAnswerStatusState,
  recordConversationAnswerCompleted,
  unreadConversationSessionIds,
} from "./conversation-answer-status.ts";

test("does not mark tasks completed before the first status baseline as unread", () => {
  const baseline = createConversationAnswerStatusState(1_000);
  const next = recordConversationAnswerCompleted(baseline, "old-session", 900, false);

  assert.equal(next, baseline);
  assert.deepEqual([...unreadConversationSessionIds(next)], []);
});

test("marks a newly completed background answer unread until its conversation is viewed", () => {
  const baseline = createConversationAnswerStatusState(1_000);
  const completed = recordConversationAnswerCompleted(baseline, "session-1", 1_100, false);
  assert.deepEqual([...unreadConversationSessionIds(completed)], ["session-1"]);

  const viewed = markConversationAnswerViewed(completed, "session-1");
  assert.deepEqual([...unreadConversationSessionIds(viewed)], []);
  assert.deepEqual(viewed.sessions["session-1"], { answeredAt: 1_100, viewedAt: 1_100 });
  assert.equal(markConversationAnswerViewed(viewed, "session-1"), viewed);
});

test("keeps a visible answer viewed when recording its completion", () => {
  const baseline = createConversationAnswerStatusState(1_000);
  const completed = recordConversationAnswerCompleted(baseline, "session-1", 1_100, true);

  assert.deepEqual([...unreadConversationSessionIds(completed)], []);
});

test("merges cross-tab completion and view cursors by freshness", () => {
  const left = recordConversationAnswerCompleted(
    createConversationAnswerStatusState(1_000),
    "session-1",
    1_100,
    false,
  );
  const right = recordConversationAnswerCompleted(left, "session-1", 1_200, true);
  const newerCompletion = recordConversationAnswerCompleted(left, "session-1", 1_300, false);
  const merged = mergeConversationAnswerStatusStates(right, newerCompletion);

  assert.deepEqual(merged.sessions["session-1"], { answeredAt: 1_300, viewedAt: 1_200 });
  assert.deepEqual([...unreadConversationSessionIds(merged)], ["session-1"]);
});

test("repeated view effects settle after one semantic update", () => {
  const unread = recordConversationAnswerCompleted(
    createConversationAnswerStatusState(1_000),
    "session-1",
    1_100,
    false,
  );
  const viewed = markConversationAnswerViewed(unread, "session-1");

  assert.notEqual(viewed, unread);
  assert.equal(markConversationAnswerViewed(viewed, "session-1"), viewed);
});

test("does not erase the initialized baseline when merging a server snapshot", () => {
  const serverSnapshot = createConversationAnswerStatusState(0);
  const browserSnapshot = createConversationAnswerStatusState(1_000);

  assert.equal(
    mergeConversationAnswerStatusStates(serverSnapshot, browserSnapshot).initializedAt,
    1_000,
  );
});

test("drops malformed persisted entries without losing a valid baseline", () => {
  const parsed = parseConversationAnswerStatusState({
    initializedAt: 1_000,
    sessions: {
      valid: { answeredAt: 1_100, viewedAt: 0 },
      invalid: { answeredAt: "soon", viewedAt: 0 },
    },
  }, 2_000);

  assert.deepEqual(parsed.sessions, { valid: { answeredAt: 1_100, viewedAt: 0 } });
});
