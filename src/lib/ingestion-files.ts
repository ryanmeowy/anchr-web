import type { StsToken, SupportedFormat, UploadIngestionItem } from "./types";

const FALLBACK_TYPES: Record<string, string> = {
  pdf: "PDF",
  txt: "TXT",
  md: "MD",
  markdown: "MD",
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  webp: "IMAGE",
};

export function inferFileType(input: string, mimeType?: string, formats: SupportedFormat[] = []) {
  const extension = extensionOf(input);
  const byExtension = formats.find((format) =>
    format.extensions.some((item) => item.toLowerCase() === extension),
  );
  if (byExtension) return byExtension.fileType;

  const byMime = formats.find((format) =>
    format.mimeTypes.some((item) => item.toLowerCase() === mimeType?.toLowerCase()),
  );
  if (byMime) return byMime.fileType;

  return FALLBACK_TYPES[extension] ?? "URL";
}

export function buildDisplayNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname.split("/").filter(Boolean).at(-1) || url.hostname;
  } catch {
    return value.split("/").filter(Boolean).at(-1) || "remote-url";
  }
}

export async function uploadFilesToOss(
  files: File[],
  token: StsToken,
  formats: SupportedFormat[],
): Promise<UploadIngestionItem[]> {
  const { default: OSS } = await import("ali-oss/dist/aliyun-oss-sdk.min.js");
  const endpoint = normalizeEndpoint(token.endpoint);
  const client = new OSS({
    bucket: token.bucket,
    endpoint,
    accessKeyId: token.accessKeyId,
    accessKeySecret: token.accessKeySecret,
    stsToken: token.securityToken,
    secure: true,
  });

  const items: UploadIngestionItem[] = [];
  for (const file of files) {
    const objectKey = buildObjectKey(token.prefix, file.name);
    await client.put(objectKey, file, {
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    items.push({
      fileName: file.name,
      title: file.name,
      fileType: inferFileType(file.name, file.type, formats),
      mimeType: file.type || undefined,
      sizeBytes: file.size,
      objectKey,
      fileHash: await sha256(file),
    });
  }
  return items;
}

function normalizeEndpoint(rawEndpoint: string) {
  const trimmed = rawEndpoint.trim().replace(/\/+$/g, "");
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return trimmed;
  }
}

function extensionOf(value: string) {
  const cleanValue = value.split("?")[0]?.split("#")[0] ?? value;
  const fileName = cleanValue.split("/").filter(Boolean).at(-1) ?? cleanValue;
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : "";
  return extension?.toLowerCase() ?? "";
}

function buildObjectKey(prefix: string, fileName: string) {
  const cleanPrefix = prefix.trim().replace(/^\/+|\/+$/g, "");
  const cleanName = fileName.replace(/[^\w.-]+/g, "_");
  const key = `${crypto.randomUUID()}_${cleanName}`;
  return cleanPrefix ? `${cleanPrefix}/${key}` : key;
}

async function sha256(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
