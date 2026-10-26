"use client";

import { useEffect, useRef } from "react";
import { useDemoToken } from "@/components/app/demo-token-context";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_RENDER_TIMEOUT_MS = 10_000;

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Runs the human check on first entry, not on claim.
 *
 * The check answers "is this a person", so it belongs at the door: bots are stopped before they
 * touch the API, and a verified visitor can claim a token with one click instead of sitting
 * through a second challenge. The check alone issues nothing.
 */
export function DemoVerificationGate({ children }: { children: React.ReactNode }) {
  const { verified, verifying, siteKey, phase, statusLoaded, verify, retryVerify } = useDemoToken();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const blocked = phase.kind === "closed";

  useEffect(() => {
    if (verified || blocked || !siteKey) return;
    let cancelled = false;

    const timeout = window.setTimeout(() => {
      if (cancelled || widgetIdRef.current) return;
      retryVerify("人机校验没有加载出来。请关闭拦截本站的扩展后重试。");
    }, TURNSTILE_RENDER_TIMEOUT_MS);

    const unmount = () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };

    const mount = () => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (value: string) => void verify(value),
        "error-callback": (errorCode?: string) => {
          widgetIdRef.current = null;
          retryVerify(errorCode
            ? `人机校验加载失败（Cloudflare 错误码 ${errorCode}）。请关闭拦截本站的扩展后重试。`
            : "人机校验加载失败。请关闭拦截本站的扩展后重试。");
        },
        "expired-callback": () => {
          widgetIdRef.current = null;
        },
      });
    };

    if (window.turnstile) {
      mount();
      return unmount;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = mount;
    script.onerror = () => {
      if (!cancelled) {
        retryVerify("人机校验脚本被拦截。请允许加载 challenges.cloudflare.com 后重试。");
      }
    };
    document.head.appendChild(script);
    return unmount;
  }, [verified, blocked, siteKey, verify, retryVerify]);

  if (verified) return <>{children}</>;

  return (
    <div className="grid min-h-screen place-items-center bg-[#111315] px-6 text-white">
      <div className="w-full max-w-[440px] rounded-[12px] border border-white/10 bg-white/5 p-8">
        <h1 className="text-[22px] font-black leading-tight">Anchr 演示</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-white/70">
          无需注册。完成一次人机校验即可进入，之后随时可以领取试用令牌。
        </p>

        {!statusLoaded ? (
          <p className="mt-6 text-[13px] text-white/60">正在检查演示状态…</p>
        ) : null}

        {blocked ? (
          <p className="mt-6 rounded-[8px] bg-amber-500/15 px-3 py-2 text-[13px] text-amber-200">
            {phase.kind === "closed" ? phase.reason : ""}
          </p>
        ) : (
          <div className="mt-6 min-h-[70px]" ref={containerRef} />
        )}

        {phase.kind === "error" ? (
          <p className="mt-3 rounded-[8px] bg-rose-500/15 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {phase.reason}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                if (window.turnstile && widgetIdRef.current) {
                  window.turnstile.remove(widgetIdRef.current);
                }
                widgetIdRef.current = null;
                retryVerify(null);
              }}
            >
              重试
            </button>
          </p>
        ) : null}

        {verifying && !siteKey ? null : null}
      </div>
    </div>
  );
}
