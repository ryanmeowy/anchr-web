"use client";

export type AssetScope = {
  assetId: string;
  fileName: string;
  kbId?: string;
};

type AssetScopeHandoff = {
  destination: "ask" | "search";
  scope: AssetScope;
  sessionId?: string;
};

const SEARCH_SCOPE_KEY = "anchr.asset-scope.search";
const ASK_SCOPE_PREFIX = "anchr.asset-scope.ask.";
const ASSET_NAME_CACHE_KEY = "anchr.asset-scope.names";
const HANDOFF_KEY = "anchr.asset-scope.handoff";
const MAX_ASSET_NAME_CACHE_SIZE = 200;

export function readSearchAssetScope() {
  return readStoredScope(SEARCH_SCOPE_KEY);
}

export function saveSearchAssetScope(scope: AssetScope | null) {
  writeStoredScope(SEARCH_SCOPE_KEY, scope);
  if (scope) rememberAssetScopes([scope]);
}

export function readAskAssetScope(sessionId: string) {
  return sessionId ? readStoredScope(`${ASK_SCOPE_PREFIX}${sessionId}`) : null;
}

export function saveAskAssetScope(sessionId: string, scope: AssetScope | null) {
  if (!sessionId || typeof window === "undefined") return;
  writeStoredScope(`${ASK_SCOPE_PREFIX}${sessionId}`, scope);
  if (scope) rememberAssetScopes([scope]);
}

export function saveAssetScopeHandoff(handoff: AssetScopeHandoff) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  rememberAssetScopes([handoff.scope]);
}

export function consumeAssetScopeHandoff(destination: AssetScopeHandoff["destination"]) {
  if (typeof window === "undefined") return null;

  const handoff = readJson<AssetScopeHandoff>(window.sessionStorage.getItem(HANDOFF_KEY));
  if (!handoff || handoff.destination !== destination || !isAssetScope(handoff.scope)) {
    return null;
  }

  window.sessionStorage.removeItem(HANDOFF_KEY);
  return handoff;
}

export function rememberAssetScopes(scopes: Array<Partial<AssetScope> | null | undefined>) {
  if (typeof window === "undefined") return {};

  const cache = readAssetNameCache();
  let changed = false;
  scopes.forEach((scope) => {
    const assetId = scope?.assetId?.trim();
    const fileName = scope?.fileName?.trim();
    if (!assetId || !fileName || cache[assetId] === fileName) return;
    cache[assetId] = fileName;
    changed = true;
  });

  if (changed) {
    const assetIds = Object.keys(cache);
    assetIds.slice(0, Math.max(0, assetIds.length - MAX_ASSET_NAME_CACHE_SIZE)).forEach((assetId) => {
      delete cache[assetId];
    });
    window.localStorage.setItem(ASSET_NAME_CACHE_KEY, JSON.stringify(cache));
  }
  return cache;
}

export function clearAllAssetScopeState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SEARCH_SCOPE_KEY);
  window.localStorage.removeItem(ASSET_NAME_CACHE_KEY);
  Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(ASK_SCOPE_PREFIX)))
    .forEach((key) => window.localStorage.removeItem(key));
  window.sessionStorage.removeItem(HANDOFF_KEY);
}

export function readAssetNameCache() {
  if (typeof window === "undefined") return {} as Record<string, string>;
  return readJson<Record<string, string>>(window.localStorage.getItem(ASSET_NAME_CACHE_KEY)) ?? {};
}

function readStoredScope(key: string) {
  if (typeof window === "undefined") return null;
  const scope = readJson<AssetScope>(window.localStorage.getItem(key));
  return isAssetScope(scope) ? scope : null;
}

function writeStoredScope(key: string, scope: AssetScope | null) {
  if (typeof window === "undefined") return;
  if (!scope) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(scope));
}

function isAssetScope(value: unknown): value is AssetScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<AssetScope>;
  return typeof scope.assetId === "string"
    && Boolean(scope.assetId.trim())
    && typeof scope.fileName === "string";
}

function readJson<T>(raw: string | null) {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
