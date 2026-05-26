"use client";

const STORAGE_SETTINGS_KEY = "anchr.storageSettings";
const SECURITY_SETTINGS_KEY = "anchr.securitySettings";

export type StorageSettings = {
  ossBucket: string;
  ossEndpoint: string;
  ossPrefix: string;
};

export type SecuritySettings = {
  encryptKey: string;
  encryptIv: string;
};

const DEFAULT_STORAGE_SETTINGS: StorageSettings = {
  ossBucket: "",
  ossEndpoint: "",
  ossPrefix: "uploads/anchr",
};

const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  encryptKey: "",
  encryptIv: "",
};

export function getStorageSettings() {
  return readSettings(STORAGE_SETTINGS_KEY, DEFAULT_STORAGE_SETTINGS);
}

export function saveStorageSettings(settings: StorageSettings) {
  writeSettings(STORAGE_SETTINGS_KEY, settings);
}

export function getSecuritySettings() {
  return readSettings(SECURITY_SETTINGS_KEY, DEFAULT_SECURITY_SETTINGS);
}

export function saveSecuritySettings(settings: SecuritySettings) {
  writeSettings(SECURITY_SETTINGS_KEY, settings);
}

function readSettings<T>(key: string, defaults: T) {
  if (typeof window === "undefined") {
    return defaults;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return defaults;
  }

  try {
    return { ...defaults, ...JSON.parse(raw) } as T;
  } catch {
    return defaults;
  }
}

function writeSettings<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}
