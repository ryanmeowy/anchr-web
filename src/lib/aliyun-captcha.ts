"use client";

/**
 * Alibaba Cloud CAPTCHA 2.0 client (V3 architecture).
 *
 * The SDK is loaded from Alibaba's CDN and renders a puzzle. On success it hands back a
 * `captchaVerifyParam`, which is only a claim: the server must exchange it for a verdict.
 *
 * This replaced Cloudflare Turnstile because the Turnstile script lives outside mainland China
 * and is unreliable for visitors without a proxy.
 */

const SDK_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";

type InitOptions = {
  SceneId: string;
  prefix: string;
  mode: "popup" | "embed";
  element?: string;
  button?: string;
  captchaVerifyCallback: (param: string) => Promise<{ captchaResult: boolean; bizResult: boolean }>;
  onBizResultCallback?: () => void;
  getInstance?: (instance: unknown) => void;
  slideStyle?: Record<string, string>;
  language?: string;
  region?: string;
};

type AliyunCaptchaGlobal = {
  initAliyunCaptcha: (options: InitOptions) => void;
};

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region?: string; prefix?: string };
    initAliyunCaptcha?: AliyunCaptchaGlobal["initAliyunCaptcha"];
  }
}

let loading: Promise<void> | null = null;

/** Loads the SDK once per page; concurrent callers share the same promise. */
export function loadAliyunCaptcha(region: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (loading) return loading;

  // The SDK reads this global before the script runs, so it has to be set first.
  window.AliyunCaptchaConfig = { region };

  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("captcha sdk failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("captcha sdk failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type { InitOptions };
