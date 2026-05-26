import { AlertCircle, Loader2, RefreshCcw } from "lucide-react";

export function LoadingBlock({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="panel flex min-h-36 items-center justify-center gap-2 text-sm text-slate-500">
      <Loader2 size={18} className="animate-spin" />
      {label}
    </div>
  );
}

export function EmptyBlock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="panel flex min-h-36 flex-col items-center justify-center px-6 text-center">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</div>
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="panel flex min-h-36 items-center justify-between gap-4 px-5">
      <div className="flex items-center gap-3 text-sm text-rose-700">
        <AlertCircle size={20} />
        <span>{message}</span>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
        >
          <RefreshCcw size={16} />
          重试
        </button>
      ) : null}
    </div>
  );
}
