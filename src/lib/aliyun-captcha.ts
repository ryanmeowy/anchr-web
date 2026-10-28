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
  /** Plain scenario id. Mutually exclusive with EncryptedSceneId. */
  SceneId?: string;
  /**
   * Encryption mode: the server-side AES token. When present the SDK sends this instead of
   * SceneId, and the service decrypts it to recover the scenario and its expiry.
   */
  EncryptedSceneId?: string;
  mode: "popup" | "embed";
  /**
   * Required: a CSS selector beginning with "#". The SDK only resolves values that start with
   * "#", so a bare id or an element reference fails validation.
   */
  element: string;
  /** Required: same selector rule as element. */
  button: string;
  /** Called with the parameter that must be verified server-side. */
  success: (captchaVerifyParam: string) => void;
  fail?: (errorCode?: string) => void;
  getInstance?: (instance: unknown) => void;
  onError?: (errorInfo: { code?: string; msg?: string }) => void;
  onClose?: () => void;
  slideStyle?: Record<string, unknown>;
  language?: string;
  timeout?: number;
  rem?: number;
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

/**
 * Loads the SDK once per page; concurrent callers share the same promise.
 *
 * {@code prefix} is mandatory in {@code AliyunCaptchaConfig}: without it the SDK builds request
 * URLs against the literal host {@code undefined.captcha-open.aliyuncs.com} and the service
 * answers IllegalUserTag, which surfaces only as a generic INIT_FAIL.
 */
export function loadAliyunCaptcha(region: string, prefix: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (loading) return loading;
  // A reload with a different identity must not reuse the previous global.
  if (window.AliyunCaptchaConfig && window.AliyunCaptchaConfig.prefix !== prefix) {
    window.AliyunCaptchaConfig = { region, prefix };
  }

  // The SDK reads this global before the script runs, so it has to be set first.
  window.AliyunCaptchaConfig = { region, prefix };

  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      // A tag that already failed will never fire load or error again, so attaching another
      // listener would hang this promise forever and leave the retry button stuck on
      // "preparing". Drop it and build a fresh one instead.
      existing.remove();
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      // Must also leave the DOM: without this the next attempt finds a dead tag and silently
      // waits on events that already happened.
      script.remove();
      reject(new Error("captcha sdk failed"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type { InitOptions };
