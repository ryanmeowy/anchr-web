import assert from "node:assert/strict";
import test from "node:test";
import { resolveTurnMaterialScope, toggleTurnMaterial } from "./turn-material-scope.ts";

test("caps selection at three across knowledge bases and allows removing and replacing a selected item", () => {
  const scopes = ["a", "b", "c", "d"].map((assetId) => ({ assetId, fileName: `${assetId}.pdf`, kbId: assetId }));
  let selected = [];
  for (const scope of scopes) selected = toggleTurnMaterial(selected, scope);
  assert.deepEqual(selected, scopes.slice(0, 3));
  selected = toggleTurnMaterial(selected, scopes[1]);
  selected = toggleTurnMaterial(selected, scopes[3]);
  assert.deepEqual(selected, [scopes[0], scopes[2], scopes[3]]);
});

test("sends selected documents and their knowledge bases without broadening to other selected libraries", () => {
  assert.deepEqual(resolveTurnMaterialScope([
    { assetId: "a", fileName: "A.pdf", kbId: "kb1" },
    { assetId: "b", fileName: "B.pdf", kbId: "kb2" },
    { assetId: "c", fileName: "C.pdf", kbId: "kb1" },
  ], { assetId: "old", fileName: "Old.pdf", kbId: "old-kb" }, ["kb1", "kb2", "kb3"]), {
    assetIds: ["a", "b", "c"], kbIds: ["kb1", "kb2"],
  });
});

test("preserves the existing document handoff when no turn materials were picked", () => {
  assert.deepEqual(resolveTurnMaterialScope([], { assetId: "a", fileName: "A.pdf", kbId: "kb1" }, ["kb2"]), {
    assetIds: ["a"], kbIds: ["kb1"],
  });
});

test("returns to the knowledge base scope after the one-turn selection is cleared", () => {
  assert.deepEqual(resolveTurnMaterialScope([], null, ["kb1", "kb2"]), {
    assetIds: [], kbIds: ["kb1", "kb2"],
  });
});

test("uses selected knowledge bases for legacy scopes without a knowledge base id", () => {
  assert.deepEqual(resolveTurnMaterialScope([], { assetId: "a", fileName: "A.pdf" }, ["kb1"]), {
    assetIds: ["a"], kbIds: ["kb1"],
  });
});
