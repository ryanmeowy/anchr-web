"use client";

import { useEffect, useRef, useState } from "react";
import { useDemoToken } from "@/components/app/demo-token-context";
import { loadAliyunCaptcha } from "@/lib/aliyun-captcha";

const RENDER_TIMEOUT_MS = 12_000;
const ELEMENT_ID = "anchr-captcha-element";
const TRIGGER_ID = "anchr-captcha-trigger";

/**
 * Runs the human check on first entry, not on claim.
 *
 * The check answers "is this a person", so it belongs at the door: bots are stopped before they
 * touch the API, and a verified visitor can claim a token with one click instead of sitting
 * through a second challenge. The check alone issues nothing.
 *
 * Uses Alibaba Cloud CAPTCHA 2.0 (puzzle), served from mainland China.
 */
export function DemoVerificationGate({ children }: { children: React.ReactNode }) {
  const { verified, sceneId, encryptedSceneId, captchaPrefix, captchaRegion, phase, statusLoaded, verify, retryVerify } =
    useDemoToken();
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const instanceRef = useRef<{ show?: () => void } | null>(null);
  const userClickedRef = useRef(false);
  const initialisedRef = useRef(false);

  const blocked = phase.kind === "closed";

  useEffect(() => {
    if (verified || blocked || !sceneId) return;
    // The SDK binds to the element/button ids once and consumes them. Re-running init on the
    // same ids logs "element/button invalid" and can tear down a working widget, so it happens
    // exactly once per mount; retry resets this flag.
    if (initialisedRef.current) return;
    initialisedRef.current = true;
    let cancelled = false;

    const timeout = window.setTimeout(() => {
      if (!cancelled && !ready) {
        setWidgetError("人机校验没有加载出来。请检查网络后重试。");
      }
    }, RENDER_TIMEOUT_MS);

    void loadAliyunCaptcha(captchaRegion, captchaPrefix ?? "")
      .then(() => {
        const init = window.initAliyunCaptcha;
        if (cancelled || !init || !sceneId) return;
        // The SDK resolves element and button by id, so both must exist in the document before
        // this call. They are rendered unconditionally by this component.
        if (!document.getElementById(ELEMENT_ID) || !document.getElementById(TRIGGER_ID)) {
          return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
            .then(() => {
              if (cancelled) return;
              mountCaptcha();
            });
        }
        mountCaptcha();
      })
      .catch(() => {
        if (!cancelled) {
          setWidgetError("人机校验脚本被拦截或加载失败。请检查网络后重试。");
        }
      });

    function mountCaptcha() {
      const init = window.initAliyunCaptcha;
      if (cancelled || !init || !sceneId) return;
      // The SDK resolves these with `t[0] === "#" ? querySelector(t) : null`, so the value must be
      // a CSS selector starting with "#". A bare id resolves to null and fails validation.
      // In encryption mode the server hands out an AES token. The SDK has a dedicated parameter
      // for it; putting the token in SceneId leaves the widget stuck at "preparing" with no
      // request ever leaving the browser.
      const encrypted = encryptedSceneId;
      init({
        ...(encrypted ? { EncryptedSceneId: encrypted } : { SceneId: sceneId }),
        mode: "popup",
        element: `#${ELEMENT_ID}`,
        button: `#${TRIGGER_ID}`,
        // Documented callback names: success receives the parameter to verify server-side.
        success: (captchaVerifyParam: string) => {
          // Logged because the SDK has been observed invoking success without any interaction,
          // which would let a bot through and skip the visible check.
          // Only accept a pass that follows a real user action. The SDK fires success straight
          // after init on some hosts, which would wave a bot through and skip the challenge.
          if (!userClickedRef.current) {
            return;
          }
          void verify(captchaVerifyParam);
        },
        fail: () => {
          setWidgetError("人机校验未通过，请重试。");
        },
        getInstance: (instance: unknown) => {
          instanceRef.current = instance as { show?: () => void } | null;
          window.setTimeout(() => setReady(true), 0);
        },
        onError: (errorInfo: { code?: string; msg?: string }) => {
          setWidgetError(`人机校验加载失败${errorInfo?.code ? `（${errorInfo.code}）` : ""}。请重试。`);
        },
        language: "cn",
      });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [verified, blocked, sceneId, captchaRegion, captchaPrefix, verify, attempt, ready]);

  const trigger = () => {
    userClickedRef.current = true;
    if (instanceRef.current?.show) {
      instanceRef.current.show();
      return;
    }
    const button = document.getElementById(TRIGGER_ID);
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

        {/* Reserved containers the SDK binds to. They must exist before init runs. */}
        <div id={ELEMENT_ID} />
        <button type="button" id={TRIGGER_ID} aria-hidden="true" tabIndex={-1} style={{ display: "none" }} />

        {blocked ? (
          <p className="mt-6 rounded-[8px] bg-amber-500/15 px-3 py-2 text-[13px] text-amber-200">
            {phase.kind === "closed" ? phase.reason : ""}
          </p>
        ) : (
          <button
            type="button"
            onClick={trigger}
            disabled={!ready}
            className={[
              "mt-6 w-full rounded-[8px] px-4 py-2.5 text-[13px] font-black transition",
              ready
                ? "bg-[#bbff66] text-[#111315] hover:brightness-110"
                : "cursor-wait bg-white/10 text-white/45",
            ].join(" ")}
          >
            {ready ? "开始人机校验" : "正在准备校验…"}
          </button>
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
                initialisedRef.current = false;
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
