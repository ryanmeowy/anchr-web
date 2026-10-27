"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDemoToken } from "@/components/app/demo-token-context";
import { loadAliyunCaptcha } from "@/lib/aliyun-captcha";

const ELEMENT_ID = "anchr-claim-captcha-element";
const TRIGGER_ID = "anchr-claim-captcha-trigger";

/**
 * The demo bubble: guide, status and exhausted in one place, anchored to the rail button.
 *
 * A claim happens here rather than in a centred modal, so the visitor never leaves the page they
 * were browsing. The human check only appears when they ask to claim.
 */
export function DemoClaimDialog() {
  const {
    dialogOpen, closeDialog, claim, usage, phase, rawSceneId, encryptedSceneId,
    captchaPrefix, captchaRegion, role,
  } = useDemoToken();
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [now, setNow] = useState(0);
  const startedRef = useRef(false);

  // The clock starts on the first tick rather than during render, which keeps render pure.
  useEffect(() => {
    const id = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(id);
      window.clearInterval(timer);
    };
  }, []);

  const claimed = role === "ADMIN" || role === "USER";
  const remaining = usage?.remaining ?? null;
  const exhausted = claimed && remaining === 0;
  const busy = phase.kind === "verifying" || claiming;

  // The check is only needed while the guide pane is showing and the visitor has not claimed.
  const needsCheck = dialogOpen && !claimed && phase.kind !== "closed";

  useEffect(() => {
    if (!needsCheck || !rawSceneId) return;
    startedRef.current = false;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setReady(false);
      setWidgetError(null);
    });

    void loadAliyunCaptcha(captchaRegion, captchaPrefix ?? "")
      .then(() => {
        const init = window.initAliyunCaptcha;
        if (cancelled || !init) return;
        const start = () => {
          if (cancelled || startedRef.current) return;
          startedRef.current = true;
          init({
            SceneId: rawSceneId,
            ...(encryptedSceneId ? { EncryptedSceneId: encryptedSceneId } : {}),
            mode: "popup",
            element: `#${ELEMENT_ID}`,
            button: `#${TRIGGER_ID}`,
            success: (param: string) => {
              setClaiming(true);
              void claim(param).finally(() => setClaiming(false));
            },
            fail: () => setWidgetError("人机校验未通过，请重试。"),
            getInstance: () => window.setTimeout(() => setReady(true), 0),
            onError: (info: { code?: string }) =>
              setWidgetError(`人机校验加载失败${info?.code ? `（${info.code}）` : ""}。请重试。`),
            language: "cn",
          });
        };
        if (document.getElementById(ELEMENT_ID) && document.getElementById(TRIGGER_ID)) start();
        else window.requestAnimationFrame(start);
      })
      .catch(() => {
        if (!cancelled) setWidgetError("人机校验脚本加载失败。请检查网络后重试。");
      });

    return () => {
      cancelled = true;
    };
  }, [needsCheck, rawSceneId, encryptedSceneId, captchaPrefix, captchaRegion, claim, attempt]);

  if (!dialogOpen || typeof document === "undefined") return null;

  const openPuzzle = () => {
    const button = document.getElementById(TRIGGER_ID);
    if (button) (button as HTMLButtonElement).click();
    else setWidgetError("人机校验尚未就绪，请稍后重试。");
  };

  const mode = exhausted ? "exhausted" : claimed ? "status" : "guide";

  return createPortal(
    <div className="demo-bubble" role="dialog" aria-modal="false" aria-label="演示令牌" data-mode={mode}>
      <div className="demo-bubble-top">
        <span className="demo-bubble-eyebrow">
          <span className="demo-eyebrow-dot" aria-hidden="true" />
          演示令牌
        </span>
        <button type="button" className="demo-bubble-close" onClick={closeDialog} aria-label="关闭">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {mode === "guide" ? (
        <>
          <h3 className="demo-bubble-title">想直接问它？</h3>
          <p className="demo-bubble-text">浏览知识库免费。领取一枚演示令牌，就能提问和上传文档。</p>
          <p className="demo-bubble-meta">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            需完成一次人机校验
          </p>

          {phase.kind === "closed" ? (
            <p className="demo-bubble-meta">{phase.reason}</p>
          ) : null}
          {phase.kind === "error" ? (
            <p className="demo-bubble-meta" style={{ color: "#ffb9b9" }}>{phase.reason}</p>
          ) : null}
          {widgetError ? (
            <p className="demo-bubble-meta" style={{ color: "#ffb9b9" }}>
              {widgetError}
              <button type="button" className="demo-btn-quiet" onClick={() => setAttempt((v) => v + 1)}>
                重试
              </button>
            </p>
          ) : null}

          <div id={ELEMENT_ID} />
          <button type="button" id={TRIGGER_ID} aria-hidden="true" tabIndex={-1} style={{ display: "none" }} />

          <div className="demo-bubble-actions">
            <button
              type="button"
              className="demo-btn-primary"
              disabled={busy || !ready || phase.kind === "closed"}
              onClick={openPuzzle}
            >
              {busy ? "正在领取…" : ready ? "领取演示令牌" : "正在准备…"}
            </button>
            <button type="button" className="demo-btn-quiet" onClick={closeDialog}>
              先逛逛
            </button>
          </div>
        </>
      ) : null}

      {mode === "status" ? (
        <>
          <h3 className="demo-bubble-title">
            剩余 <span className="num">{remaining ?? "–"}</span> 次
          </h3>
          <p className="demo-bubble-text">
            有效期 <span className="mono">{usage?.expiresAt && now ? formatLeft(usage.expiresAt - now) : "–"}</span>
            {" · "}可用于提问和上传文档。
          </p>
          <DemoTimebar expiresAt={usage?.expiresAt} now={now} />
          <div className="demo-bubble-actions">
            <button type="button" className="demo-btn-primary" onClick={closeDialog}>
              开始提问
            </button>
            <button type="button" className="demo-btn-quiet" onClick={closeDialog}>
              收起
            </button>
          </div>
        </>
      ) : null}

      {mode === "exhausted" ? (
        <>
          <h3 className="demo-bubble-title">额度已用完</h3>
          <p className="demo-bubble-text">重新领取一枚，就能继续提问和上传文档。</p>
          <p className="demo-bubble-meta">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            需重新完成一次人机校验
          </p>
          <div id={ELEMENT_ID} />
          <button type="button" id={TRIGGER_ID} aria-hidden="true" tabIndex={-1} style={{ display: "none" }} />
          <div className="demo-bubble-actions">
            <button type="button" className="demo-btn-primary" disabled={busy || !ready} onClick={openPuzzle}>
              {busy ? "正在领取…" : "重新领取"}
            </button>
            <button type="button" className="demo-btn-quiet" onClick={closeDialog}>
              继续浏览
            </button>
          </div>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function formatLeft(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function DemoTimebar({ expiresAt, now }: { expiresAt?: number; now: number }) {
  const totalMs = 5 * 60 * 60 * 1000;
  const progress = expiresAt && now ? Math.max(0, Math.min(1, (expiresAt - now) / totalMs)) : 0;
  return (
    <div className="demo-timebar" aria-hidden="true">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
