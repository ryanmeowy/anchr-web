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

export function inferFileType(input: string, mimeType?: string, formats: SupportedFormat[] = []): string | null {
  const extension = extensionOf(input);
  const byExtension = formats.find((format) =>
    format.extensions.some((item) => item.toLowerCase() === extension),
  );
  if (byExtension) return byExtension.fileType;

  const byMime = formats.find((format) =>
    format.mimeTypes.some((item) => item.toLowerCase() === mimeType?.toLowerCase()),
  );
  if (byMime) return byMime.fileType;

  return FALLBACK_TYPES[extension] ?? null;
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
  onFileUploaded?: (completedCount: number, totalCount: number, fileName: string) => void,
  onPrepared?: (items: UploadIngestionItem[]) => void,
): Promise<UploadIngestionItem[]> {
  const batchId = createUploadBatchId();
  const prepared: Array<{ file: File; item: UploadIngestionItem }> = [];
  for (const [index, file] of files.entries()) {
    const fileType = inferFileType(file.name, file.type, formats);
    if (fileType === null) {
      throw new Error(`${file.name} 格式不支持，请选择支持的文件格式。`);
    }
    prepared.push({
      file,
      item: {
        fileName: file.name,
        title: file.name,
        fileType,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        objectKey: buildObjectKey(token.prefix, batchId, index, file.name),
        fileHash: await sha256(file),
      },
    });
  }

  onPrepared?.(prepared.map((entry) => ({ ...entry.item })));

  const client = await createOssClient(token);
  const uploadedObjectKeys: string[] = [];
  try {
    for (const [index, entry] of prepared.entries()) {
      await client.put(entry.item.objectKey, entry.file, {
        headers: { "Content-Type": entry.file.type || "application/octet-stream" },
      });
      uploadedObjectKeys.push(entry.item.objectKey);
      onFileUploaded?.(index + 1, prepared.length, entry.file.name);
    }
  } catch (error) {
    await deleteOssObjects(client, uploadedObjectKeys);
    throw error;
  }
  return prepared.map((entry) => entry.item);
}

export async function deleteUploadedFilesFromOss(token: StsToken, items: UploadIngestionItem[]) {
  if (items.length === 0) return;
  const client = await createOssClient(token);
  await deleteOssObjects(client, items.map((item) => item.objectKey));
}

async function createOssClient(token: StsToken) {
  const { default: OSS } = await import("ali-oss/dist/aliyun-oss-sdk.min.js");
  return new OSS({
    bucket: token.bucket,
    endpoint: normalizeEndpoint(token.endpoint),
    accessKeyId: token.accessKeyId,
    accessKeySecret: token.accessKeySecret,
    stsToken: token.securityToken,
    secure: true,
  });
}

async function deleteOssObjects(client: { delete: (objectKey: string) => Promise<unknown> }, objectKeys: string[]) {
  await Promise.allSettled(objectKeys.map((objectKey) => client.delete(objectKey)));
}

function normalizeEndpoint(rawEndpoint: string) {
  const trimmed = rawEndpoint.trim().replace(/\/+$/g, "");
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${url.protocol}//${url.host}`;
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

function buildObjectKey(prefix: string, batchId: string, index: number, fileName: string) {
  const cleanPrefix = prefix.trim().replace(/^\/+|\/+$/g, "");
  const cleanName = fileName.trim().replace(/[\\/]+/g, "_");
  const key = `${String(index + 1).padStart(3, "0")}-${cleanName || "untitled"}`;
  const batchKey = `${batchId}/${key}`;
  return cleanPrefix ? `${cleanPrefix}/${batchKey}` : batchKey;
}

function createUploadBatchId() {
  const uuid = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `upload-${uuid}`;
}

async function sha256(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
