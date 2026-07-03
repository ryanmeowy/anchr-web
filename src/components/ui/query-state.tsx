import { AlertCircle, RefreshCcw } from "lucide-react";

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="premium-surface flex min-h-36 items-center justify-between gap-4 rounded-[8px] px-5">
      <div className="flex items-center gap-3 text-sm text-rose-700 dark:text-rose-200">
        <AlertCircle size={20} />
        <span>{message}</span>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 transition hover:bg-rose-50 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/20"
        >
          <RefreshCcw size={16} />
          重试
        </button>
      ) : null}
    </div>
  );
}
