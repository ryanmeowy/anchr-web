import {
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Link2,
} from "lucide-react";

export function FileTypeIcon({
  fileName,
  sourceType,
  compact = false,
  className = "",
  palette = "default",
}: {
  fileName: string;
  sourceType?: string;
  compact?: boolean;
  className?: string;
  palette?: "default" | "imports" | "document";
}) {
  const type = sourceType === "URL" ? "URL" : inferIconType(fileName, sourceType);
  const size = compact ? "size-5" : "size-11";
  const iconSize = compact ? 14 : 24;
  const shared = `${size} grid place-items-center rounded-[8px] ${className}`;
  const paletteColor = palette === "imports" || palette === "document" ? fileTypeColor(type) : undefined;
  const paletteStyle = paletteColor ? {
    color: paletteColor,
    borderColor: `color-mix(in srgb, ${paletteColor} 28%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${paletteColor} 12%, transparent)`,
  } : undefined;

  if (type === "PDF") {
    return (
      <span className={`${shared} border border-red-200 bg-red-50 text-red-500`} style={paletteStyle}>
        <FileText size={iconSize} />
      </span>
    );
  }
  if (type === "DOCX") {
    return (
      <span className={`${shared} border border-blue-200 bg-blue-50 text-blue-600`}>
        <FileType2 size={iconSize} />
      </span>
    );
  }
  if (type === "XLSX" || type === "CSV") {
    return (
      <span className={`${shared} border border-emerald-200 bg-emerald-50 text-emerald-600`}>
        <FileSpreadsheet size={iconSize} />
      </span>
    );
  }
  if (type === "IMAGE") {
    return (
      <span className={`${shared} border border-violet-200 bg-violet-50 text-violet-600`} style={paletteStyle}>
        <FileImage size={iconSize} />
      </span>
    );
  }
  if (type === "ZIP") {
    return (
      <span className={`${shared} border border-amber-200 bg-amber-50 text-amber-600`}>
        <FileArchive size={iconSize} />
      </span>
    );
  }
  if (type === "URL") {
    return (
      <span className={`${shared} border border-slate-200 bg-slate-100 text-slate-600`}>
        <Link2 size={iconSize} />
      </span>
    );
  }

  return (
    <span className={`${shared} border border-slate-200 bg-slate-50 text-slate-600`} style={paletteStyle}>
      <FileText size={iconSize} />
    </span>
  );
}

export function fileTypeColor(type: string) {
  const normalizedType = type.toUpperCase();
  if (normalizedType === "PDF") return "#819fd9";
  if (normalizedType === "MD" || normalizedType === "MARKDOWN") return "#3158ff";
  if (normalizedType === "IMAGE") return "#fac75e";
  if (normalizedType === "TXT" || normalizedType === "TEXT") return "#aab2ac";
  return undefined;
}

export function inferIconType(fileName: string, sourceType?: string) {
  if (sourceType && sourceType !== "UPLOAD") {
    return sourceType;
  }

  const extension =
    fileName.split("?")[0]?.split("#")[0]?.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "pdf") return "PDF";
  if (extension === "docx" || extension === "doc") return "DOCX";
  if (extension === "xlsx" || extension === "xls" || extension === "csv") return "XLSX";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "IMAGE";
  if (extension === "zip") return "ZIP";
  if (extension === "md" || extension === "markdown") return "MD";

  return "TEXT";
}

export function normalizeExtension(extension: string) {
  return extension.trim().replace(/^\./, "").toLowerCase();
}
