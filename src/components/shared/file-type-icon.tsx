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
}: {
  fileName: string;
  sourceType?: string;
  compact?: boolean;
  className?: string;
}) {
  const type = sourceType === "URL" ? "URL" : inferIconType(fileName, sourceType);
  const size = compact ? "size-5" : "size-11";
  const iconSize = compact ? 14 : 24;
  const shared = `${size} grid place-items-center rounded-[8px] ${className}`;

  if (type === "PDF") {
    return (
      <span className={`${shared} border border-red-200 bg-red-50 text-red-500`}>
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
      <span className={`${shared} border border-violet-200 bg-violet-50 text-violet-600`}>
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
    <span className={`${shared} border border-slate-200 bg-slate-50 text-slate-600`}>
      <FileText size={iconSize} />
    </span>
  );
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
