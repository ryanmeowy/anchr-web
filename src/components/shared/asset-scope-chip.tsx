"use client";

import { FileText, X } from "lucide-react";
import type { AssetScope } from "@/lib/asset-scope";

export function AssetScopeChip({
  scope,
  onClear,
  label = "仅此资料",
  compact = false,
}: {
  scope: AssetScope;
  onClear?: () => void;
  label?: string;
  compact?: boolean;
}) {
  return (
    <span
      title={scope.fileName || scope.assetId}
      className={[
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 font-black text-blue-700 dark:text-blue-200",
        compact ? "min-h-6 px-2 text-[10px]" : "min-h-8 px-2.5 text-[11px]",
      ].join(" ")}
    >
      <FileText size={compact ? 12 : 14} aria-hidden="true" />
      <span className="shrink-0">{label}</span>
      <span className="max-w-[220px] truncate font-bold opacity-75">{scope.fileName || scope.assetId}</span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-0.5 grid size-5 shrink-0 place-items-center rounded-full text-current transition hover:bg-blue-600 hover:text-white"
          aria-label={`关闭资料范围：${scope.fileName || scope.assetId}`}
          title="关闭资料范围"
        >
          <X size={12} />
        </button>
      ) : null}
    </span>
  );
}
