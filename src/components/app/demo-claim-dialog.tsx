"use client";

import { useDemoToken } from "@/components/app/demo-token-context";

/**
 * Claim dialog. The human check already happened at the door, so this is a single confirmation:
 * verified visitors decide here whether to spend a trial, instead of spending one on arrival.
 */
export function DemoClaimDialog() {
  const { dialogOpen, closeDialog, claim, usage, phase } = useDemoToken();

  if (!dialogOpen) return null;

  const blocked = phase.kind === "closed";
  const busy = phase.kind === "verifying";
  const empty = usage?.remaining === 0;

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
                : "人机校验已通过。领取后可搜索、提问和上传文档。"}
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

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={blocked || busy}
            onClick={() => void claim()}
            className={[
              "rounded-[8px] px-4 py-2 text-[13px] font-black transition",
              blocked || busy
                ? "cursor-not-allowed bg-white/10 text-white/35"
                : "bg-[var(--premium-accent)] text-[#111315] hover:brightness-110",
            ].join(" ")}
          >
            {busy ? "正在领取…" : "确认领取"}
          </button>
          <span className="text-[11px] text-white/45">
            有效期数小时，过期后重新领取即可。
          </span>
        </div>
      </div>
    </div>
  );
}
