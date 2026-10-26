"use client";

import { useEffect, useRef, useState } from "react";
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
 * Claim dialog. A Turnstile pass alone does not issue a token: the visitor confirms here, so
 * someone who only wants to look around never consumes a trial.
 */
export function DemoClaimDialog() {
  const { dialogOpen, closeDialog, claim, status, phase, setPhase } = useDemoToken();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const siteKey = status?.siteKey;
  const blocked = phase.kind === "closed";

  useEffect(() => {
    if (!dialogOpen || !siteKey || blocked) return;
    let cancelled = false;

    const timeout = window.setTimeout(() => {
      if (cancelled || widgetIdRef.current) return;
      setWidgetError("人机校验没有加载出来。请关闭拦截本站的扩展后重试。");
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
        callback: (value: string) => void claim(value),
        "error-callback": (errorCode?: string) => {
          widgetIdRef.current = null;
          setWidgetError(errorCode
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
        setWidgetError("人机校验脚本被拦截。请允许加载 challenges.cloudflare.com 后重试。");
      }
    };
    document.head.appendChild(script);
    return unmount;
  }, [dialogOpen, siteKey, blocked, claim, nonce]);

  if (!dialogOpen) return null;

  const retry = () => {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
    }
    widgetIdRef.current = null;
    setWidgetError(null);
    setPhase({ kind: "idle" });
    setNonce((value) => value + 1);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[460px] rounded-[12px] border border-white/10 bg-[#181b1e] p-7 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-black leading-tight">领取演示令牌</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/65">
              完成一次人机校验后领取，可搜索、提问和上传文档。
            </p>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            className="shrink-0 text-[12px] text-white/50 underline hover:text-white/80"
          >
            关闭
          </button>
        </div>

        {phase.kind === "closed" ? (
          <p className="mt-5 rounded-[8px] bg-amber-500/15 px-3 py-2 text-[12px] text-amber-200">
            {phase.reason}
          </p>
        ) : null}

        {phase.kind === "error" ? (
          <p className="mt-5 rounded-[8px] bg-rose-500/15 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {phase.reason}
          </p>
        ) : null}

        {!blocked ? (
          <>
            <div className="mt-5 min-h-[70px]" ref={containerRef} />
            {widgetError ? (
              <p className="mt-3 rounded-[8px] bg-rose-500/15 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
                {widgetError}
                <button type="button" className="ml-2 underline" onClick={retry}>
                  重试
                </button>
              </p>
            ) : null}
            {phase.kind === "verifying" ? (
              <p className="mt-3 text-[12px] text-white/60">正在领取…</p>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={retry}
            className="mt-5 rounded-[8px] bg-white/10 px-4 py-2 text-[12px] font-bold text-white/80"
          >
            重新检查
          </button>
        )}
      </div>
    </div>
  );
}
