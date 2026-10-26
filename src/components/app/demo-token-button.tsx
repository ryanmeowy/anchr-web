"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDemoToken } from "@/components/app/demo-token-context";

function useCountdown(expiresAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return "";
  const left = Math.max(0, expiresAt - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  if (left === 0) return "已过期";
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Sidebar entry point for the demo token.
 *
 * Unclaimed: a call to action in the page's own palette, with a hint that reappears on every
 * visit because the point is to be noticed, not to be dismissed forever.
 * Claimed: a compact readout of credits left and time remaining.
 */
export function DemoTokenButton() {
  const { role, usage, openDialog, phase } = useDemoToken();
  // Every visitor holds a read-only guest token, so "has a token" is no longer the question:
  // only a claimed USER token unlocks asking and uploading.
  const claimed = role === "ADMIN" || role === "USER";
  const countdown = useCountdown(usage?.expiresAt);
  const [hintDismissed, setHintDismissed] = useState(false);

  // Deliberately not remembered: unclaimed visitors should be told on every visit that asking
  // and uploading need a token, because that is the only way in and it is easy to miss.
  const showHint = !claimed && !hintDismissed;

  const dismissHint = () => setHintDismissed(true);

  if (!claimed) {
    const closed = phase.kind === "closed";
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            dismissHint();
            openDialog();
          }}
          disabled={closed}
          aria-label="领取演示令牌"
          title={closed ? "演示环境暂时关闭" : "领取演示令牌"}
          className={[
            "demo-claim-cta flex min-h-[52px] w-10 shrink-0 flex-col items-center justify-center gap-1 rounded-[8px] border text-[9px] font-bold leading-none transition",
            closed
              ? "border-white/12 bg-transparent text-white/30"
              : "border-white bg-white text-[#111315] hover:bg-white/90",
          ].join(" ")}
        >
          <span className="demo-claim-cta-icon text-[15px] leading-none" aria-hidden="true">⚡</span>
          <span className="whitespace-nowrap">{closed ? "已关闭" : "领取"}</span>
        </button>

        {showHint && !closed && typeof document !== "undefined"
          ? createPortal(
              <div
                role="status"
                className="demo-claim-hint fixed bottom-[84px] left-[68px] z-[60] w-[264px] rounded-[10px] border border-white/12 bg-[#181b1e] p-4 text-white shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
              >
                <p className="text-[13px] font-black leading-tight text-white">解锁提问与上传</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">
                  领取演示令牌后可提问、上传文档。现在可以自由浏览知识库。
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      dismissHint();
                      openDialog();
                    }}
                    className="rounded-[6px] bg-white px-3 py-1.5 text-[11px] font-black text-[#111315] transition hover:bg-white/90"
                  >
                    立即领取
                  </button>
                  <button
                    type="button"
                    onClick={dismissHint}
                    className="text-[10px] text-white/40 underline hover:text-white/70"
                  >
                    稍后
                  </button>
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }

  const remaining = usage?.remaining;
  const empty = remaining === 0;
  return (
    <div
      className={[
        "flex min-h-11 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[8px] border text-[8px] font-bold leading-none transition",
        empty
          ? "border-rose-400/30 bg-rose-500/10 text-rose-300"
          : "border-white/15 bg-white/6 text-white/75",
      ].join(" ")}
      title={empty
        ? "试用次数已用完，点击重新领取"
        : `剩余 ${remaining ?? "?"} 次 · 剩余时间 ${countdown}`}
      aria-label={empty
        ? "试用次数已用完，点击重新领取"
        : `剩余 ${remaining ?? "?"} 次，剩余时间 ${countdown}`}
    >
      {empty ? (
        <button
          type="button"
          onClick={openDialog}
          className="grid place-items-center gap-0.5"
          aria-label="重新领取演示令牌"
        >
          <span className="text-[13px] leading-none" aria-hidden="true">↻</span>
          <span className="whitespace-nowrap">重领</span>
        </button>
      ) : (
        <>
          <span className="text-[11px] leading-none tabular-nums text-white">{remaining ?? "–"}</span>
          <span className="whitespace-nowrap tabular-nums text-white/45">{countdown || "–"}</span>
        </>
      )}
    </div>
  );
}
