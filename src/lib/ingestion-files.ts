"use client";

import CryptoJS from "crypto-js";
import type { SupportedFormat, UploadIngestionItem } from "./types";

export type OssUploadConfig = {
  bucket: string;
  endpoint: string;
  keyPrefix: string;
  encryptKey: string;
  encryptIv: string;
};

type StsCredential = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
};

type OssClient = {
  put: (
    objectKey: string,
    file: File,
    options: { headers: Record<string, string> },
  ) => Promise<unknown>;
};

const FALLBACK_TYPES: Record<string, string> = {
  pdf: "PDF",
  txt: "TXT",
  md: "MD",
  markdown: "MD",
  docx: "DOCX",
  xlsx: "XLSX",
  xls: "XLSX",
  csv: "CSV",
  html: "HTML",
  htm: "HTML",
  pptx: "PPTX",
  zip: "ZIP",
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

  if (byExtension) {
    return byExtension.fileType;
  }

  const byMime = formats.find((format) =>
    format.mimeTypes.some((item) => item.toLowerCase() === mimeType?.toLowerCase()),
  );

  if (byMime) {
    return byMime.fileType;
  }

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
  encryptedCredential: string,
  config: OssUploadConfig,
  formats: SupportedFormat[],
) {
  const credential = decryptCredential(encryptedCredential, config.encryptKey, config.encryptIv);
  const { default: OSS } = await import("ali-oss/dist/aliyun-oss-sdk.min.js");
  const endpoint = normalizeEndpoint(config.endpoint, config.bucket);
  const client = new OSS({
    bucket: config.bucket,
    endpoint,
    accessKeyId: credential.accessKeyId,
    accessKeySecret: credential.accessKeySecret,
    stsToken: credential.securityToken,
    secure: endpoint.startsWith("https") || window.location.protocol === "https:",
  }) as OssClient;

  const items: UploadIngestionItem[] = [];

  for (const file of files) {
    const objectKey = buildObjectKey(config.keyPrefix, file.name);
    try {
      await client.put(objectKey, file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });
    } catch (error) {
      throw buildUploadError(error, config.bucket, endpoint, objectKey);
    }

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

function normalizeEndpoint(rawEndpoint: string, bucket: string) {
  const trimmed = rawEndpoint.trim().replace(/\/+$/g, "");

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const bucketPrefix = `${bucket}.`;
    if (url.hostname.startsWith(bucketPrefix)) {
      url.hostname = url.hostname.substring(bucketPrefix.length);
    }

    return `${url.protocol}//${url.hostname}`;
  } catch {
    return trimmed.startsWith(bucket) ? trimmed.substring(`${bucket}.`.length) : trimmed;
  }
}

function buildUploadError(error: unknown, bucket: string, endpoint: string, objectKey: string) {
  const message = error instanceof Error ? error.message : String(error);
  const maybeNetworkOrCors = message.includes("XHR error") || message.includes("status -1") || message.includes("-1");

  if (maybeNetworkOrCors) {
    return new Error(
      [
        "OSS 直传失败：浏览器没有拿到 OSS 响应，通常是 Bucket CORS 未放行当前前端域名，或 Endpoint/网络不可达。",
        `当前 Origin：${window.location.origin}`,
        `Bucket：${bucket}`,
        `Endpoint：${endpoint}`,
        `ObjectKey：${objectKey}`,
        "请在 OSS Bucket CORS 中允许 PUT/OPTIONS，AllowedHeader 建议先用 *，ExposeHeader 至少包含 ETag 和 x-oss-request-id。",
      ].join("\n"),
    );
  }

  return new Error(`OSS 直传失败：${message}`);
}

function decryptCredential(encrypted: string, keyBase64: string, ivBase64: string) {
  const key = CryptoJS.enc.Base64.parse(keyBase64);
  const iv = CryptoJS.enc.Base64.parse(ivBase64);
  const ciphertext = CryptoJS.enc.Base64.parse(encrypted);
  const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext });
  const plain = CryptoJS.AES.decrypt(cipherParams, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);

  if (!plain) {
    throw new Error("STS 解密失败，请检查 APP_ENCRYPT_KEY 和 APP_ENCRYPT_IV。");
  }

  const credential = JSON.parse(plain) as StsCredential;
  if (!credential.accessKeyId || !credential.accessKeySecret || !credential.securityToken) {
    throw new Error("STS 凭证字段不完整。");
  }

  return credential;
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
