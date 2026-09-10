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


test("hierarchical references require exact segments across traditional, Agent and task results; legacy labels remain readable", () => {
  const citations = [{ citationIndex: 1, chunks: [
    { segmentId: "seg-1", citationLabel: "1-1" },
    { segmentId: "seg-2", citationLabel: "1-2" },
  ] }];
  assert.equal(resolveConversationCitation(citations, "1-2")?.chunk.segmentId, "seg-2");
  assert.equal(resolveConversationCitation(citations, "1-9"), undefined);
  assert.equal(resolveConversationCitation(citations, "1")?.chunk.segmentId, "seg-1");
  assert.equal(resolveConversationCitation(citations, "1-9"), undefined);
});


test("all historical or asynchronous sources remain addressable beyond five documents", () => {
  const citations = Array.from({ length: 8 }, (_, index) => ({
    citationIndex: index + 1,
    chunks: [{ segmentId: `s${index}`, citationLabel: `${index + 1}-1` }],
  }));
  assert.equal(resolveConversationCitation(citations, "8-1")?.chunk.segmentId, "s7");
  assert.equal(conversationCitationLabels(citations).length, 8);
});
