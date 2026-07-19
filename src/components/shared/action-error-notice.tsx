"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";

export function ActionErrorNotice({
  title,
  message,
  onDismiss,
  duration = 3000,
}: {
  title: string;
  message: string;
  onDismiss: () => void;
  duration?: number;
}) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timeoutId);
  }, [duration, message, title]);

  return (
    <div
      className="fixed right-4 top-4 z-[200] w-[min(390px,calc(100vw-32px))] rounded-[12px] border border-[#fde98a]/35 bg-[#fde98a]/10 p-4 text-[#fde98a] shadow-[0_22px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:right-5 sm:top-5"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#fde98a]/12">
          <AlertTriangle size={20} strokeWidth={2.3} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-black tracking-[0.01em]">{title}</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#fde98a]/80">{message}</p>
        </div>
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-full text-[#fde98a]/70 transition hover:text-[#fde98a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fde98a]"
          aria-label="关闭权限提示"
          onClick={onDismiss}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
