"use client";

import { useEffect, useId, useState } from "react";
import { useDemoToken } from "@/components/app/demo-token-context";
import { loadAliyunCaptcha } from "@/lib/aliyun-captcha";

const RENDER_TIMEOUT_MS = 12_000;

/**
 * Runs the human check on first entry, not on claim.
 *
 * The check answers "is this a person", so it belongs at the door: bots are stopped before they
 * touch the API, and a verified visitor can claim a token with one click instead of sitting
 * through a second challenge. The check alone issues nothing.
 *
 * Uses Alibaba Cloud CAPTCHA 2.0 (puzzle) because it is served from mainland China, unlike
 * Cloudflare Turnstile which is unreachable for visitors without a proxy.
 */
export function DemoVerificationGate({ children }: { children: React.ReactNode }) {
  const {
    verified, sceneId, captchaPrefix, captchaRegion, phase, statusLoaded, verify, retryVerify,
  } = useDemoToken();
  // A stable id is required by the SDK so it can bind to our button. Generated once with
  // useId, not during render, which React 19 forbids.
  const buttonId = useId();
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const blocked = phase.kind === "closed";

  useEffect(() => {
    if (verified || blocked || !sceneId) return;
    let cancelled = false;

    const timeout = window.setTimeout(() => {
      if (cancelled || ready) return;
      setWidgetError("人机校验没有加载出来。请检查网络后重试。");
    }, RENDER_TIMEOUT_MS);

    void loadAliyunCaptcha(captchaRegion)
      .then(() => {
        if (cancelled || !window.initAliyunCaptcha) return;
        window.initAliyunCaptcha({
          SceneId: sceneId,
          prefix: captchaPrefix ?? "",
          mode: "popup",
          // A hidden button is the documented way to share one instance and trigger it from our
          // own UI; the SDK opens its popup when this element is clicked.
          button: buttonId,
          captchaVerifyCallback: async (captchaVerifyParam: string) => {
            await verify(captchaVerifyParam);
            return { captchaResult: true, bizResult: true };
          },
          onBizResultCallback: () => undefined,
          // Signalled by the SDK once the instance exists.
          getInstance: () => window.setTimeout(() => setReady(true), 0),
          language: "zh",
          region: captchaRegion,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWidgetError("人机校验脚本被拦截或加载失败。请检查网络后重试。");
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [verified, blocked, sceneId, captchaPrefix, captchaRegion, verify, attempt, ready, buttonId]);

  const trigger = () => {
    const button = document.getElementById(buttonId);
    if (button) {
      (button as HTMLButtonElement).click();
    } else {
      setWidgetError("人机校验尚未就绪，请稍后重试。");
    }
  };

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
          <div className="mt-6">
            <button
              type="button"
              id={buttonId}
              onClick={trigger}
              className="w-full rounded-[8px] bg-[var(--premium-accent)] px-4 py-2.5 text-[13px] font-black text-[#111315] transition hover:brightness-110"
            >
              开始人机校验
            </button>
          </div>
        )}

        {widgetError ? (
          <p className="mt-3 rounded-[8px] bg-rose-500/15 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {widgetError}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setWidgetError(null);
                setReady(false);
                setAttempt((value) => value + 1);
                retryVerify(null);
              }}
            >
              重试
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
