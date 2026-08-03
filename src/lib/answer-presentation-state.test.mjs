import assert from "node:assert/strict";
import test from "node:test";

import { resolveAnswerEventPosition } from "./answer-presentation-state.ts";

test("rejects duplicate and out-of-order events in the same revision", () => {
  const current = { revision: 2, lastSequence: 8 };
  assert.equal(resolveAnswerEventPosition(current, { revision: 2, sequence: 8 }).accepted, false);
  assert.equal(resolveAnswerEventPosition(current, { revision: 2, sequence: 7 }).accepted, false);
  assert.deepEqual(resolveAnswerEventPosition(current, { revision: 2, sequence: 9 }), {
    revision: 2,
    lastSequence: 9,
    accepted: true,
    startsNewRevision: false,
  });
});

test("accepts a retry as a new revision and rejects stale previous attempts", () => {
  const current = { revision: 1, lastSequence: 20 };
  assert.deepEqual(resolveAnswerEventPosition(current, { revision: 2, sequence: 1 }), {
    revision: 2,
    lastSequence: 1,
    accepted: true,
    startsNewRevision: true,
  });
  const retried = { revision: 2, lastSequence: 1 };
  assert.equal(resolveAnswerEventPosition(retried, { revision: 1, sequence: 21 }).accepted, false);
});
