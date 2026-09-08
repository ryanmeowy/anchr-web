import assert from "node:assert/strict";
import test from "node:test";

import { conversationCitationLabels, resolveConversationCitation } from "./citation-reference.ts";

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

test("keeps asset-level labels for historical citations", () => {
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


test("traditional hierarchical references require the exact segment while legacy and Agent behavior remain compatible", () => {
  const citations = [{ citationIndex: 1, chunks: [
    { segmentId: "seg-1", citationLabel: "1-1" },
    { segmentId: "seg-2", citationLabel: "1-2" },
  ] }];
  assert.equal(resolveConversationCitation(citations, "1-2", true)?.chunk.segmentId, "seg-2");
  assert.equal(resolveConversationCitation(citations, "1-9", true), undefined);
  assert.equal(resolveConversationCitation(citations, "1", true)?.chunk.segmentId, "seg-1");
  assert.equal(resolveConversationCitation(citations, "1-9")?.chunk.segmentId, "seg-1");
});
