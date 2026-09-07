import type { AssetScope } from "@/lib/asset-scope";

export const MAX_TURN_MATERIALS = 3;

export function toggleTurnMaterial(materials: AssetScope[], scope: AssetScope) {
  if (materials.some((item) => item.assetId === scope.assetId)) {
    return materials.filter((item) => item.assetId !== scope.assetId);
  }
  return materials.length < MAX_TURN_MATERIALS ? [...materials, scope] : materials;
}

export function resolveTurnMaterialScope(materials: AssetScope[], pinnedScope: AssetScope | null, selectedKbIds: string[]) {
  const scopes = materials.length ? materials : pinnedScope ? [pinnedScope] : [];
  const scopedKbIds = scopes.flatMap((scope) => scope.kbId ? [scope.kbId] : []);
  return {
    assetIds: [...new Set(scopes.map((scope) => scope.assetId))],
    kbIds: scopedKbIds.length ? [...new Set(scopedKbIds)] : selectedKbIds,
  };
}
