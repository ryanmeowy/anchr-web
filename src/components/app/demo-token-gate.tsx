"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  DEMO_EXHAUSTED_EVENT,
  apiClient,
  clearAccessToken,
  getConfiguredAccessToken,
  saveAccessToken,
  type DemoStatus,
} from "@/lib/api-client";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** How long to wait for the widget before treating it as blocked. */
const TURNSTILE_RENDER_TIMEOUT_MS = 10_000;

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
  | { kind: "entry" }
  | { kind: "granted" }
  | { kind: "closed"; reason: string }
  | { kind: "blocked"; reason: string };

function subscribeToken(callback: () => void) {
  window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getServerToken() {
  return "";
}

/**
 * Holds the workspace until the visitor carries a token.
 *
 * The token lands in the same storage the settings page used, so every existing request keeps
 * sending `X-Access-Token` with no further change.
 */
export function DemoTokenGate({ children }: { children: React.ReactNode }) {
  const token = useSyncExternalStore(subscribeToken, getConfiguredAccessToken, getServerToken);
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const handledTokenRef = useRef<string | null>(null);

  // A token appearing in storage means the visitor may proceed; the status check only runs once.
  useEffect(() => {
    if (token && handledTokenRef.current !== token) {
      handledTokenRef.current = token;
      setState({ kind: "granted" });
    }
  }, [token]);

  useEffect(() => {
    if (token) return;
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
          setState({ kind: "entry" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "blocked", reason: "无法连接演示服务，请刷新重试。" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // An ordinary workspace call can exhaust the credits or lose the token; return to the entry
  // card instead of leaving the visitor on a workspace that only produces errors.
  useEffect(() => {
    const onExhausted = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      clearAccessToken();
      handledTokenRef.current = null;
      setState({
        kind: "blocked",
        reason: reason === "expired"
          ? "访问凭证已过期，可重新领取。"
          : "本次试用次数已用完，可重新领取。",
      });
    };
    window.addEventListener(DEMO_EXHAUSTED_EVENT, onExhausted);
    return () => window.removeEventListener(DEMO_EXHAUSTED_EVENT, onExhausted);
  }, []);

  const issue = useCallback(async (turnstileToken: string) => {
    setIssuing(true);
    setWidgetError(null);
    try {
      const issued = await apiClient.issueDemoToken(turnstileToken);
      saveAccessToken(issued.token, issued.role);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // A Turnstile token is single use, so every failure needs a fresh challenge. Keep the
      // widget id and reset it; discarding the id would leave the visitor without a way back.
      const resetChallenge = () => {
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
        }
      };
      if (code === "DEMO_QUOTA_EXHAUSTED") {
        setWidgetError("本次试用次数已用完，可再次领取。");
        setState({ kind: "blocked", reason: "这份凭证的试用次数已用完。" });
        resetChallenge();
      } else if (code === "DEMO_DAILY_LIMIT_REACHED") {
        setState({ kind: "closed", reason: "今日演示额度已用完，请明天再来。" });
      } else if (code === "DEMO_ISSUE_TOO_FREQUENT") {
        setState({ kind: "blocked", reason: "刚领取过凭证，请稍后再试。" });
        resetChallenge();
      } else if (code === "DEMO_DISABLED") {
        setState({ kind: "closed", reason: "演示环境暂时关闭，请稍后再试。" });
      } else if (code === "DEMO_VERIFICATION_FAILED") {
        setWidgetError("人机校验未通过。若安装了广告拦截扩展，请对本站放行后重试。");
        resetChallenge();
      } else {
        setWidgetError("领取失败，请稍后重试。");
        resetChallenge();
      }
    } finally {
      setIssuing(false);
    }
  }, []);

  // Render the widget only while waiting for a token.
  useEffect(() => {
    if ((state.kind !== "entry" && state.kind !== "blocked") || !status?.siteKey) return;
    let cancelled = false;

    // An extension can let the script load but stop the widget from rendering, which would leave
    // a blank card. Treat "nothing rendered" as a failure with a way out.
    const timeout = window.setTimeout(() => {
      // A rendered widget always has an id, so an id means the card is not stuck.
      if (cancelled || widgetIdRef.current) return;
      setWidgetError("人机校验没有加载出来。请关闭拦截本站的扩展后重试。");
    }, TURNSTILE_RENDER_TIMEOUT_MS);

    const mount = () => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      if (widgetIdRef.current) return;
      containerRef.current.innerHTML = "";
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: status.siteKey,
        callback: (value: string) => void issue(value),
        "error-callback": () => {
          widgetIdRef.current = null;
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
        window.clearTimeout(timeout);
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
      window.clearTimeout(timeout);
    };
  }, [state.kind, status?.siteKey, issue]);

  if (state.kind === "granted") {
    return <>{children}</>;
  }

  // A missing sitekey is a deployment mistake, not a visitor problem: say so instead of showing
  // an endless blank card.
  const visibleError = status && !status.siteKey
    ? "演示站点配置缺失（sitekey），请联系维护者。"
    : widgetError;

  return (
    <div className="grid min-h-screen place-items-center bg-[#111315] px-6 text-white">
      <div className="w-full max-w-[440px] rounded-[12px] border border-white/10 bg-white/5 p-8">
        <h1 className="text-[22px] font-black leading-tight">Anchr 演示</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-white/70">
          无需注册。完成一次人机校验即可获得试用凭证，随后可搜索、提问和上传文档。
        </p>

        {state.kind === "checking" ? (
          <p className="mt-6 text-[13px] text-white/60">正在检查演示状态…</p>
        ) : null}

        {state.kind === "closed" || state.kind === "blocked" ? (
          <p className="mt-6 rounded-[8px] bg-amber-500/15 px-3 py-2 text-[13px] text-amber-200">
            {state.reason}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                // Re-ask the server: the quota resets on a boundary the client cannot see, and
                // an operator may have flipped the switch back on.
                setState({ kind: "checking" });
                setWidgetError(null);
                void apiClient
                  .demoStatus()
                  .then((value) => {
                    setStatus(value);
                    if (!value.enabled || value.closed) {
                      setState({ kind: "closed", reason: "演示环境暂时关闭，请稍后再试。" });
                    } else {
                      setState({ kind: "entry" });
                    }
                  })
                  .catch(() => {
                    setState({ kind: "blocked", reason: "无法连接演示服务，请稍后重试。" });
                  });
              }}
            >
              重新检查
            </button>
          </p>
        ) : null}

        <div className="mt-6 min-h-[70px]" ref={containerRef} />

        {visibleError ? (
          <p className="mt-3 rounded-[8px] bg-rose-500/15 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {visibleError}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                widgetIdRef.current = null;
                setWidgetError(null);
                setState({ kind: "entry" });
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
