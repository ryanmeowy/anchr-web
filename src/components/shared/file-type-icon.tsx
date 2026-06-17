"use client";

import { FileImage, FileText, FileType, Hash } from "lucide-react";

type FileTypeIconProps = {
  fileName?: string | null;
  sourceType?: string | null;
  compact?: boolean;
  className?: string;
};

const TYPE_STYLES: Record<string, string> = {
  PDF: "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20",
  IMAGE: "bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/20",
  TXT: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/20",
  MD: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20",
  MARKDOWN: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20",
};

export function normalizeExtension(value: string) {
  return value.trim().replace(/^\./, "").toLowerCase();
}

export function FileTypeIcon({ fileName, sourceType, compact = false, className = "" }: FileTypeIconProps) {
  const type = inferType(fileName, sourceType);
  const label = labelForType(type);
  const sizeClass = compact ? "h-6 px-2 text-[11px]" : "h-9 px-3 text-xs";
  const iconSize = compact ? 13 : 16;

  return (
    <span className={[
      "inline-flex shrink-0 items-center gap-1.5 rounded-[7px] font-bold ring-1",
      TYPE_STYLES[type] ?? "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/20",
      sizeClass,
      className,
    ].join(" ")}
    >
      <FileTypeGlyph type={type} size={iconSize} />
      {label}
    </span>
  );
}

function inferType(fileName?: string | null, sourceType?: string | null) {
  const explicit = sourceType?.trim().toUpperCase();
  if (explicit) {
    return explicit;
  }

  const extension = normalizeExtension(fileName?.split(".").pop() ?? "");
  if (extension === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"].includes(extension)) return "IMAGE";
  if (extension === "md" || extension === "markdown") return "MD";
  if (extension === "txt") return "TXT";
  return extension ? extension.toUpperCase() : "FILE";
}

function FileTypeGlyph({ type, size }: { type: string; size: number }) {
  if (type === "PDF" || type === "TXT") return <FileText size={size} />;
  if (type === "IMAGE") return <FileImage size={size} />;
  if (type === "MD" || type === "MARKDOWN") return <Hash size={size} />;
  return <FileType size={size} />;
}

function labelForType(type: string) {
  if (type === "IMAGE") return "图片";
  if (type === "MD" || type === "MARKDOWN") return "MD";
  return type || "FILE";
}
