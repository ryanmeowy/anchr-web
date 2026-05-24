"use client";

import type { KnowledgeBase } from "@/lib/types";

export function KbSelect({
  items,
  value,
  onChange,
  compact = false,
}: {
  items: KnowledgeBase[];
  value?: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className={compact ? "field h-10 text-sm" : "field"}
    >
      <option value="">选择知识库</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}
