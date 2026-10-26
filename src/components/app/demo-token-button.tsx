"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const HINT_KEY = "anchr.demo.hintSeen";

function subscribeHint(callback: () => void) {
  window.addEventListener(HINT_KEY, callback);
  return () => window.removeEventListener(HINT_KEY, callback);
}
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
 * Unclaimed: an explicit button, so nobody spends a trial just by looking around.
 * Claimed: a compact readout of time left and credits left, which is otherwise invisible.
 */
export function DemoTokenButton() {
  const { hasToken, usage, openDialog, phase } = useDemoToken();
  const countdown = useCountdown(usage?.expiresAt);
  const [hintDismissed, setHintDismissed] = useState(false);
  // Reading localStorage through useSyncExternalStore keeps server rendering consistent: the
  // server snapshot is the "already seen" state, and the client value arrives without an effect.
  const hintSeen = useSyncExternalStore(
    subscribeHint,
    () => {
      try {
        return window.localStorage.getItem(HINT_KEY) === "1";
      } catch {
        return true;
      }
    },
    () => true,
  );

  const showHint = !hasToken && !hintSeen && !hintDismissed;

  const dismissHint = () => {
    setHintDismissed(true);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Ignore: the hint simply shows again next time.
    }
    window.dispatchEvent(new Event(HINT_KEY));
  };

  if (!hasToken) {
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
            "flex min-h-11 w-10 shrink-0 flex-col items-center justify-center gap-1 rounded-[8px] border p-1 text-[9px] font-bold leading-none transition",
            closed
              ? "border-white/15 bg-transparent text-white/30"
              : "border-[var(--premium-accent)] bg-[var(--premium-accent)]/15 text-[var(--premium-accent)] hover:bg-[var(--premium-accent)]/25",
          ].join(" ")}
        >
          <span className="text-[13px] leading-none" aria-hidden="true">⚡</span>
          <span className="whitespace-nowrap">{closed ? "已关闭" : "领取"}</span>
        </button>

        {showHint && !closed ? (
          <div
            role="status"
            className="absolute bottom-0 left-[52px] z-40 w-[210px] rounded-[10px] border border-white/15 bg-[#1d2024] p-3 text-[11px] leading-relaxed text-white/85 shadow-lg lg:bottom-auto lg:top-0"
          >
            <p className="font-black text-white">还没有演示令牌</p>
            <p className="mt-1 text-white/65">
              点击这里领取，即可搜索、提问和上传文档。
            </p>
            <button
              type="button"
              onClick={dismissHint}
              className="mt-2 text-[10px] text-white/45 underline hover:text-white/70"
            >
              知道了
            </button>
          </div>
        ) : null}
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
          ? "border-rose-400/40 bg-rose-500/10 text-rose-300"
          : "border-white/15 bg-white/5 text-white/75",
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
          <span className="text-[11px] leading-none tabular-nums text-[var(--premium-accent)]">
            {remaining ?? "–"}
          </span>
          <span className="whitespace-nowrap tabular-nums text-white/55">{countdown || "–"}</span>
        </>
      )}
    </div>
  );
}
