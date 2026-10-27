"use client";

import { useEffect, useState } from "react";
import { useDemoToken } from "@/components/app/demo-token-context";

const CIRCUMFERENCE = 2 * Math.PI * 18;

function formatLeft(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useTick(active: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(id);
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

/**
 * The rail's demo instrument: a ticket glyph before claiming, a credits gauge after.
 *
 * The gauge ring doubles as a countdown, so remaining credits and remaining time are readable
 * without opening anything. The bubble this button opens owns the whole flow.
 */
export function DemoTokenButton() {
  const { role, usage, dialogOpen, openDialog, closeDialog } = useDemoToken();
  const claimed = role === "ADMIN" || role === "USER";
  const remaining = usage?.remaining ?? null;
  const exhausted = claimed && remaining === 0;
  const state = !claimed ? "unclaimed" : exhausted ? "exhausted" : "claimed";

  const now = useTick(claimed && Boolean(usage?.expiresAt));

  const totalMs = 5 * 60 * 60 * 1000;
  const left = usage?.expiresAt && now ? Math.max(0, usage.expiresAt - now) : 0;
  const progress = usage?.expiresAt ? Math.max(0, Math.min(1, left / totalMs)) : 0;

  const label = state === "claimed"
    ? `演示令牌，剩余 ${remaining ?? 0} 次，${formatLeft(left)} 后过期`
    : state === "exhausted"
      ? "演示令牌已用完，重新领取"
      : "领取演示令牌";

  return (
    <div className="rail-demo">
      <button
        type="button"
        className="demo-btn"
        data-state={state}
        aria-label={label}
        aria-expanded={dialogOpen}
        title={label}
        onClick={() => (dialogOpen ? closeDialog() : openDialog())}
      >
        {state === "unclaimed" ? (
          <span className="demo-face face-unclaimed" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
              <path d="M13 5v2" /><path d="M13 11v2" /><path d="M13 17v2" />
            </svg>
            <span className="demo-alert-dot" />
          </span>
        ) : null}

        {state === "claimed" ? (
          <span className="demo-face face-claimed" aria-hidden="true">
            <svg className="demo-gauge" viewBox="0 0 40 40">
              <circle className="demo-gauge-track" cx="20" cy="20" r="18" />
              <circle className="demo-gauge-fill" cx="20" cy="20" r="18"
                style={{ strokeDashoffset: String(CIRCUMFERENCE * (1 - progress)) }} />
            </svg>
            <span className="demo-count">{remaining ?? "–"}</span>
            <span className="demo-unit">次</span>
          </span>
        ) : null}

        {state === "exhausted" ? (
          <span className="demo-face face-exhausted" aria-hidden="true">
            <svg className="demo-gauge" viewBox="0 0 40 40">
              <circle className="demo-gauge-track" cx="20" cy="20" r="18" />
              <circle className="demo-gauge-alert" cx="20" cy="20" r="18" />
            </svg>
            <span className="demo-count">0</span>
            <span className="demo-unit">次</span>
          </span>
        ) : null}
      </button>
    </div>
  );
}
