import assert from "node:assert/strict";
import test from "node:test";

import {
  clampPreviewMessageScrollTop,
  resolvePreviewMessageScrollTop,
} from "./preview-message-restore.ts";

test("restores the source message to its saved viewport offset", () => {
  assert.equal(resolvePreviewMessageScrollTop({
    currentScrollTop: 900,
    scrollHeight: 3000,
    clientHeight: 800,
    messageTopInViewport: 240,
    messageHeight: 360,
    savedViewportOffset: 80,
  }), 1060);
});

test("centers the source message when an older restore state has no viewport offset", () => {
  assert.equal(resolvePreviewMessageScrollTop({
    currentScrollTop: 900,
    scrollHeight: 3000,
    clientHeight: 800,
    messageTopInViewport: 240,
    messageHeight: 360,
  }), 920);
});

test("clamps restored positions to the available scroll range", () => {
  assert.equal(clampPreviewMessageScrollTop(-120, 3000, 800), 0);
  assert.equal(clampPreviewMessageScrollTop(2500, 3000, 800), 2200);
});
