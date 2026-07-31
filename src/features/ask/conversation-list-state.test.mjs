import assert from "node:assert/strict";
import test from "node:test";

import { apiClient } from "../../lib/api-client.ts";
import {
  mergeConversationMessageMetadata,
  shouldRecoverConversationCursor,
} from "./conversation-list-state.ts";

const session = {
  sessionId: "cvs_1",
  userId: "single_user",
  title: "手动标题",
  status: "ACTIVE",
  kbScope: [],
  assetScope: [],
  createdAt: 1_000,
  updatedAt: 3_000,
};

test("does not let an older message completion overwrite a newer manual title", () => {
  const merged = mergeConversationMessageMetadata(
    session,
    { title: "旧自动标题", sessionUpdatedAt: 2_000 },
    "最新问题",
    4_000,
  );

  assert.equal(merged.title, "手动标题");
  assert.equal(merged.updatedAt, 3_000);
  assert.equal(merged.lastMessagePreview, "最新问题");
});

test("applies current message metadata and keeps legacy events compatible", () => {
  const current = mergeConversationMessageMetadata(
    { ...session, title: null, updatedAt: 1_000 },
    { title: "自动标题", sessionUpdatedAt: 2_000, kbScope: ["kb_1"] },
    "问题",
  );
  const legacy = mergeConversationMessageMetadata(
    { ...session, title: null, updatedAt: 1_000 },
    { title: "旧服务标题" },
    "问题",
    2_500,
  );

  assert.equal(current.title, "自动标题");
  assert.equal(current.updatedAt, 2_000);
  assert.deepEqual(current.kbScope, ["kb_1"]);
  assert.equal(legacy.title, "旧服务标题");
  assert.equal(legacy.updatedAt, 2_500);
});

test("passes an opaque conversation cursor through without decoding it", async () => {
  const originalFetch = globalThis.fetch;
  const cursor = "eyJ2ZXJzaW9uIjoxLCJ1cGRhdGVkQXQiOjIwMDAsInNlc3Npb25JZCI6ImN2c18xIn0";
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      code: 200,
      message: "Success",
      data: { items: [], nextCursor: null },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await apiClient.listConversations(50, cursor);
    const url = new URL(requestedUrl, "http://localhost");
    assert.equal(url.searchParams.get("cursor"), cursor);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recovers an invalid cursor only for the current append generation", () => {
  const invalidCursorError = { status: 400, code: "INVALID_REQUEST" };

  assert.equal(shouldRecoverConversationCursor(invalidCursorError, true, 3, 3), true);
  assert.equal(shouldRecoverConversationCursor(invalidCursorError, true, 2, 3), false);
  assert.equal(shouldRecoverConversationCursor(invalidCursorError, false, 3, 3), false);
  assert.equal(shouldRecoverConversationCursor({ status: 500, code: "INTERNAL_ERROR" }, true, 3, 3), false);
});
