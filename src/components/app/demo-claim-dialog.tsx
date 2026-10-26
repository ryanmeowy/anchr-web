"use client";

import { useEffect, useRef, useState } from "react";
import { useDemoToken } from "@/components/app/demo-token-context";
import { loadAliyunCaptcha } from "@/lib/aliyun-captcha";

const ELEMENT_ID = "anchr-claim-captcha-element";
const TRIGGER_ID = "anchr-claim-captcha-trigger";

/**
 * Claim dialog: the one place the human check runs.
 *
 * Browsing needs no check because the built-in token only reads. Claiming unlocks asking and
 * uploading, which cost money, so that is where the puzzle belongs.
 */
export function DemoClaimDialog() {
  const {
    dialogOpen, closeDialog, claim, usage, phase, rawSceneId, encryptedSceneId,
    captchaPrefix, captchaRegion, setPhase,
  } = useDemoToken();
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);

  const blocked = phase.kind === "closed";
  const busy = phase.kind === "verifying";
  const empty = usage?.remaining === 0;

  useEffect(() => {
    if (!dialogOpen || blocked || !rawSceneId) return;
    startedRef.current = false;
    let cancelled = false;
    // Reset on the next tick: a synchronous set inside an effect cascades renders.
    queueMicrotask(() => {
      if (cancelled) return;
      setReady(false);
      setWidgetError(null);
    });

    void loadAliyunCaptcha(captchaRegion, captchaPrefix ?? "")
      .then(() => {
        const init = window.initAliyunCaptcha;
        if (cancelled || !init) return;
        // Both ids must exist in the DOM before init; the dialog renders them unconditionally.
        const start = () => {
          if (cancelled || startedRef.current) return;
          startedRef.current = true;
          init({
            SceneId: rawSceneId,
            ...(encryptedSceneId ? { EncryptedSceneId: encryptedSceneId } : {}),
            mode: "popup",
            element: `#${ELEMENT_ID}`,
            button: `#${TRIGGER_ID}`,
            success: (captchaVerifyParam: string) => {
              void claim(captchaVerifyParam);
            },
            fail: () => setWidgetError("人机校验未通过，请重试。"),
            getInstance: () => window.setTimeout(() => setReady(true), 0),
            onError: (info: { code?: string }) =>
              setWidgetError(`人机校验加载失败${info?.code ? `（${info.code}）` : ""}。请重试。`),
            language: "cn",
          });
        };
        if (document.getElementById(ELEMENT_ID) && document.getElementById(TRIGGER_ID)) {
          start();
        } else {
          window.requestAnimationFrame(start);
        }
      })
      .catch(() => {
        if (!cancelled) setWidgetError("人机校验脚本加载失败。请检查网络后重试。");
      });

    return () => {
      cancelled = true;
    };
  }, [dialogOpen, blocked, rawSceneId, encryptedSceneId, captchaPrefix, captchaRegion, claim, attempt]);

  if (!dialogOpen) return null;

  const openPuzzle = () => {
    const button = document.getElementById(TRIGGER_ID);
    if (button) (button as HTMLButtonElement).click();
    else setWidgetError("人机校验尚未就绪，请稍后重试。");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[460px] rounded-[12px] border border-white/10 bg-[#181b1e] p-7 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-black leading-tight">
              {empty ? "重新领取演示令牌" : "领取演示令牌"}
            </h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/65">
              {empty
                ? "上一份凭证的次数已用完，领取新的一份即可继续。"
                : "完成人机校验后可提问、上传文档。"}
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

        <div id={ELEMENT_ID} />
        <button type="button" id={TRIGGER_ID} aria-hidden="true" tabIndex={-1} style={{ display: "none" }} />

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

        {widgetError ? (
          <p className="mt-3 rounded-[8px] bg-rose-500/15 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {widgetError}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setWidgetError(null);
                setAttempt((value) => value + 1);
              }}
            >
              重试
            </button>
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={blocked || busy || !ready}
            onClick={openPuzzle}
            className={[
              "rounded-[8px] px-4 py-2 text-[13px] font-black transition",
              blocked || busy || !ready
                ? "cursor-not-allowed bg-white/10 text-white/35"
                : "bg-white text-[#111315] hover:bg-white/90",
            ].join(" ")}
          >
            {busy ? "正在领取…" : ready ? "开始人机校验" : "正在准备…"}
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="text-[11px] text-white/45 underline"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
