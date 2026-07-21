import assert from "node:assert/strict";
import test from "node:test";

import {
  nearestQuestionMarkerIndex,
  questionMarkerCenter,
  questionNavigatorNaturalHeight,
  questionWaveInfluence,
  resolveActiveQuestionIndex,
  resolveQuestionPreviewId,
} from "./question-navigator-model.ts";

test("places question markers at the two ends and midpoint of a track", () => {
  const options = { count: 3, trackHeight: 212, markerHeight: 12 };

  assert.equal(questionMarkerCenter({ ...options, index: 0 }), 6);
  assert.equal(questionMarkerCenter({ ...options, index: 1 }), 106);
  assert.equal(questionMarkerCenter({ ...options, index: 2 }), 206);
});

test("maps pointer movement to the nearest question marker", () => {
  const options = { count: 3, trackHeight: 212, markerHeight: 12 };

  assert.equal(nearestQuestionMarkerIndex({ ...options, pointerY: 0 }), 0);
  assert.equal(nearestQuestionMarkerIndex({ ...options, pointerY: 105 }), 1);
  assert.equal(nearestQuestionMarkerIndex({ ...options, pointerY: 212 }), 2);
});

test("creates a smooth local wave and leaves distant markers unchanged", () => {
  assert.equal(questionWaveInfluence({ pointerY: 100, markerY: 100 }), 1);
  assert.equal(questionWaveInfluence({ pointerY: 100, markerY: 144 }), 0);
  assert.ok(questionWaveInfluence({ pointerY: 100, markerY: 122 }) > 0);
});

test("keeps ten pixels of visible space between natural question markers", () => {
  const trackHeight = questionNavigatorNaturalHeight({ count: 5 });
  const firstCenter = questionMarkerCenter({ index: 0, count: 5, trackHeight });
  const secondCenter = questionMarkerCenter({ index: 1, count: 5, trackHeight });

  assert.equal(trackHeight, 64);
  assert.equal(questionNavigatorNaturalHeight({ count: 2 }), 25);
  assert.equal(secondCenter - firstCenter - 3, 10);
});

test("lets pointer preview follow markers even while a button owns keyboard focus", () => {
  assert.equal(resolveQuestionPreviewId({
    hoveredId: "hovered-question",
    keyboardFocusedId: "focused-question",
  }), "hovered-question");
  assert.equal(resolveQuestionPreviewId({
    hoveredId: null,
    keyboardFocusedId: "focused-question",
  }), "focused-question");
});

test("keeps the existing reading-anchor behavior away from the bottom", () => {
  assert.equal(resolveActiveQuestionIndex({
    questionTops: [0, 500, 1200],
    scrollTop: 450,
    clientHeight: 500,
    scrollHeight: 1700,
  }), 1);
});

test("selects the final question when the conversation reaches the bottom", () => {
  const geometry = {
    questionTops: [0, 500, 1200],
    clientHeight: 500,
    scrollHeight: 1500,
  };

  assert.equal(resolveActiveQuestionIndex({ ...geometry, scrollTop: 1000 }), 2);
  assert.equal(resolveActiveQuestionIndex({ ...geometry, scrollTop: 999.5 }), 2);
  assert.equal(resolveActiveQuestionIndex({ ...geometry, scrollTop: 998 }), 1);
});

test("treats a fully visible conversation as already at the bottom", () => {
  assert.equal(resolveActiveQuestionIndex({
    questionTops: [0, 160, 320],
    scrollTop: 0,
    clientHeight: 600,
    scrollHeight: 480,
  }), 2);
});
