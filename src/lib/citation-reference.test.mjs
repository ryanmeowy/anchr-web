import assert from "node:assert/strict";
import test from "node:test";

import { conversationCitationLabels } from "./citation-reference.ts";

test("uses only hierarchical chunk labels when they are available", () => {
  const labels = conversationCitationLabels([
    {
      citationIndex: 1,
      chunks: [
        { segmentId: "seg-1", citationLabel: "1-1" },
        { segmentId: "seg-2", citationLabel: "1-2" },
      ],
    },
  ]);

  assert.deepEqual(labels, ["1-1", "1-2"]);
  assert.equal(labels.includes("1"), false);
});

test("keeps asset-level labels for traditional citations", () => {
  assert.deepEqual(conversationCitationLabels([
    {
      citationIndex: 3,
      chunks: [{ segmentId: "seg-1" }],
    },
  ]), ["3"]);
});

test("deduplicates hierarchical labels without exposing a mixed group fallback", () => {
  assert.deepEqual(conversationCitationLabels([
    {
      citationIndex: 1,
      chunks: [
        { segmentId: "seg-1", citationLabel: "1-1" },
        { segmentId: "seg-1-copy", citationLabel: "1-1" },
        { segmentId: "legacy-segment" },
      ],
    },
  ]), ["1-1"]);
});
