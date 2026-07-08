"use client";

import { Info } from "lucide-react";
import { useEffect } from "react";

export function TransientNotice({
  message,
  onDismiss,
  duration = 3000,
  placement = "floating",
}: {
  message: string;
  onDismiss: () => void;
  duration?: number;
  placement?: "floating" | "inline" | "card";
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onDismiss]);

  return (
    <div
      role="status"
      className={placement === "inline"
        ? "mb-2 flex items-start gap-1.5 rounded-[6px] border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[10px] font-bold leading-4 text-blue-700 dark:text-blue-200"
        : placement === "card"
          ? "flex w-fit max-w-full items-center gap-2 rounded-full border border-white/15 bg-[#111315]/95 px-4 py-2.5 text-xs font-bold text-white shadow-[0_14px_40px_rgba(17,19,21,0.28)] backdrop-blur-md"
          : "fixed bottom-6 left-1/2 z-[100] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-[#111315]/95 px-4 py-2.5 text-xs font-bold text-white shadow-[0_14px_40px_rgba(17,19,21,0.28)] backdrop-blur-md"}
    >
      <Info
        size={placement === "inline" ? 13 : 15}
        className={placement === "inline" ? "mt-0.5 shrink-0" : "shrink-0 text-[#c9ff50]"}
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  );
}
