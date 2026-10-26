"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, saveAccessToken, type DemoStatus } from "@/lib/api-client";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type GateState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "closed"; reason: string }
  | { kind: "error"; reason: string };

/**
 * Blocks the workspace until the visitor holds a demo token.
 *
 * The token is single-purpose: it is stored through the same helper the settings page used, so
 * every existing request keeps its `X-Access-Token` header with no further change.
 */
export function DemoTokenGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Ask the API what the demo looks like before rendering anything else.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .demoStatus()
      .then((value) => {
        if (cancelled) return;
        setStatus(value);
        if (!value.enabled) {
          setState({ kind: "closed", reason: "演示环境暂未开放。" });
        } else if (value.closed) {
          setState({ kind: "closed", reason: "演示环境暂时关闭，请稍后再试。" });
        } else {
          setState({ kind: "ready" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "error", reason: "无法连接演示服务，请刷新重试。" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const issue = useCallback(async (turnstileToken: string) => {
    setIssuing(true);
    setWidgetError(null);
    try {
      const issued = await apiClient.issueDemoToken(turnstileToken);
      saveAccessToken(issued.token, issued.role);
      // saveAccessToken fires the change event that recreates the query cache.
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "DEMO_QUOTA_EXHAUSTED" || code === "DEMO_DAILY_LIMIT_REACHED") {
        setState({ kind: "error", reason: "今日演示额度已用完，请明天再来。" });
      } else if (code === "DEMO_ISSUE_TOO_FREQUENT") {
        setState({ kind: "error", reason: "刚领取过凭证，请稍后再试。" });
      } else if (code === "DEMO_DISABLED") {
        setState({ kind: "closed", reason: "演示环境暂时关闭，请稍后再试。" });
      } else if (code === "DEMO_VERIFICATION_FAILED") {
        setWidgetError("人机校验未通过。若安装了广告拦截扩展，请对本站放行后重试。");
        widgetIdRef.current = null;
      } else {
        setWidgetError("领取失败，请稍后重试。");
      }
    } finally {
      setIssuing(false);
    }
  }, []);

  // Render the Turnstile widget once the status allows it.
  useEffect(() => {
    if (state.kind !== "ready" || !status?.siteKey) return;
    let cancelled = false;

    const mount = () => {
      if (cancelled || !window.turnstile || !containerRef.current || widgetIdRef.current) return;
      containerRef.current.innerHTML = "";
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: status.siteKey,
        callback: (token: string) => void issue(token),
        "error-callback": () => {
          setWidgetError("人机校验加载失败。请关闭拦截本站的扩展后重试。");
        },
        "expired-callback": () => {
          widgetIdRef.current = null;
        },
      });
    };

    if (window.turnstile) {
      mount();
      return () => {
        cancelled = true;
      };
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
    return () => {
      cancelled = true;
    };
  }, [state.kind, status?.siteKey, issue]);

  if (state.kind === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#111315] px-6 text-white">
      <div className="w-full max-w-[420px] rounded-[12px] border border-white/10 bg-white/5 p-8">
        <h1 className="text-[22px] font-black leading-tight">Anchr 演示</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-white/70">
          无需注册。点击下方按钮即可获得一次试用凭证，可直接搜索、提问和上传文档。
        </p>

        {state.kind === "checking" ? (
          <p className="mt-6 text-[13px] text-white/60">正在检查演示状态…</p>
        ) : null}

        {state.kind === "closed" || state.kind === "error" ? (
          <p className="mt-6 rounded-[8px] bg-amber-500/15 px-3 py-2 text-[13px] text-amber-200">
            {state.reason}
          </p>
        ) : null}

        <div className="mt-6 min-h-[66px]" ref={containerRef} />

        {widgetError ? (
          <p className="mt-3 rounded-[8px] bg-rose-500/15 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {widgetError}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setWidgetError(null);
                widgetIdRef.current = null;
                if (window.turnstile && widgetIdRef.current === null && containerRef.current) {
                  containerRef.current.innerHTML = "";
                }
                window.location.reload();
              }}
            >
              重试
            </button>
          </p>
        ) : null}

        {issuing ? <p className="mt-3 text-[12px] text-white/60">正在领取…</p> : null}
      </div>
    </div>
  );
}
