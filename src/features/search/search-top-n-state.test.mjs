import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_SESSION_STATE_VERSION,
  isSearchTopNResponse,
} from "./search-top-n-state.ts";

test("accepts the Top-N response contract", () => {
  assert.equal(SEARCH_SESSION_STATE_VERSION, 2);
  assert.equal(isSearchTopNResponse({
    items: [{ assetId: "asset-1" }],
    returnedCount: 1,
    windowFacets: { assetTypes: [{ value: "PDF", count: 1 }] },
  }), true);
});

test("rejects legacy and internally inconsistent search responses", () => {
  assert.equal(isSearchTopNResponse({
    items: [{ assetId: "asset-1" }],
    total: 1,
    facets: {},
  }), false);
  assert.equal(isSearchTopNResponse({
    items: [{ assetId: "asset-1" }],
    returnedCount: 2,
    windowFacets: {},
  }), false);
});
