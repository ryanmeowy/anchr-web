import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateMessageEdgeScrollbarMetrics,
  scrollTopFromMessageEdgeThumb,
} from "./message-edge-scrollbar.ts";

test("hides the edge scrollbar when the conversation does not overflow", () => {
  const metrics = calculateMessageEdgeScrollbarMetrics({
    scrollHeight: 400,
    clientHeight: 400,
    scrollTop: 0,
    trackHeight: 608,
  });

  assert.equal(metrics.scrollable, false);
  assert.equal(metrics.maxScrollTop, 0);
});

test("maps the original conversation viewport onto the full-height edge track", () => {
  const metrics = calculateMessageEdgeScrollbarMetrics({
    scrollHeight: 2400,
    clientHeight: 400,
    scrollTop: 1000,
    trackHeight: 608,
  });

  assert.equal(metrics.scrollable, true);
  assert.equal(metrics.thumbHeight, 608 / 6);
  assert.equal(metrics.thumbTop, (608 - 608 / 6) / 2);
});

test("maps the bottom of the edge track to the bottom of the conversation", () => {
  const metrics = calculateMessageEdgeScrollbarMetrics({
    scrollHeight: 2400,
    clientHeight: 400,
    scrollTop: 2000,
    trackHeight: 608,
  });

  assert.equal(metrics.thumbTop, metrics.maxThumbTop);
  assert.equal(scrollTopFromMessageEdgeThumb(metrics), 2000);
});
