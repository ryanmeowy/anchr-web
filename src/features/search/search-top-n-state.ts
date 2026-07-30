import type { SearchTopNResponse } from "@/lib/types";

export const SEARCH_SESSION_STATE_VERSION = 2;

export function isSearchTopNResponse(value: unknown): value is SearchTopNResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SearchTopNResponse>;
  return Array.isArray(candidate.items)
    && typeof candidate.returnedCount === "number"
    && Number.isInteger(candidate.returnedCount)
    && candidate.returnedCount >= 0
    && candidate.returnedCount === candidate.items.length;
}
