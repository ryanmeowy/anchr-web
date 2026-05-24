export function formatNumber(value?: number) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

export function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatFileSize(value?: number) {
  if (!value) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function statusText(status?: string) {
  const map: Record<string, string> = {
    ACTIVE: "可用",
    ARCHIVED: "已归档",
    PENDING: "等待中",
    RUNNING: "处理中",
    SUCCESS: "成功",
    PARTIAL_SUCCESS: "部分成功",
    FAILED: "失败",
    PARSED: "已解析",
    INDEXED: "已索引",
  };

  return status ? (map[status] ?? status) : "-";
}
