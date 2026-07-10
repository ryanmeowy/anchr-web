"use client";

import { useQuery } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { apiClient } from "@/lib/api-client";
import {
  applyPremiumTheme,
  getInitialPremiumTheme,
  type PremiumThemeMode,
} from "@/lib/premium-theme";
import {
  getIndexCompatibilityIssue,
  hasIndexRebuildFailed,
  isIndexFullyOperational,
} from "@/lib/index-status";
import type { SegmentIndexStatus } from "@/lib/types";
import { PremiumRail } from "./premium-rail";

const PREMIUM_CONFIGURATION_FONT_STACK =
  '"Sora", "Outfit", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const SETTINGS_BUTTON_CLASS =
  "imports-primary-action inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-[#111315] px-3.5 text-[12px] font-black text-white shadow-[0_16px_38px_rgba(17,19,21,0.2)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white dark:bg-white dark:text-[#111315] dark:hover:bg-[var(--premium-blue)] dark:hover:text-white";

export type PremiumConfigurationStatus = {
  label: string;
  missing: boolean;
};

export function usePremiumModelConfiguration({ requireGeneration = true }: { requireGeneration?: boolean } = {}) {
  const embeddingQuery = useQuery({
    queryKey: ["settings", "embedding"],
    queryFn: () => apiClient.getCapabilityConfig("EMBEDDING"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const multiEmbeddingQuery = useQuery({
    queryKey: ["settings", "multi-embedding"],
    queryFn: () => apiClient.getCapabilityConfig("MULTI_EMBEDDING"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const generationQuery = useQuery({
    queryKey: ["settings", "generation"],
    queryFn: () => apiClient.getCapabilityConfig("GENERATION"),
    enabled: requireGeneration,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const indexStatusQuery = useQuery({
    queryKey: ["index", "status"],
    queryFn: () => apiClient.getIndexStatus(),
    retry: false,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      const status = query.state.data?.status;
      if (status === "INITIALIZING" || status === "REBUILDING") return 2000;
      if (status === "NOT_READY") return 5000;
      return 30000;
    },
  });

  const hasEmbedding =
    (embeddingQuery.isSuccess && (embeddingQuery.data?.length ?? 0) > 0) ||
    (multiEmbeddingQuery.isSuccess && (multiEmbeddingQuery.data?.length ?? 0) > 0);
  const hasGeneration =
    !requireGeneration ||
    (generationQuery.isSuccess && (generationQuery.data?.length ?? 0) > 0);

  const indexStatus = indexStatusQuery.data;
  const indexReady = isIndexFullyOperational(indexStatus);

  return {
    isLoading:
      embeddingQuery.isPending ||
      embeddingQuery.isFetching ||
      multiEmbeddingQuery.isPending ||
      multiEmbeddingQuery.isFetching ||
      (requireGeneration && (generationQuery.isPending || generationQuery.isFetching)) ||
      indexStatusQuery.isPending,
    missing: {
      embedding: !hasEmbedding,
      generation: !hasGeneration,
    },
    indexReady,
    indexStatus,
    indexStatusError: indexStatusQuery.isError,
    refetchIndexStatus: indexStatusQuery.refetch,
  };
}

export function usePremiumSystemConfiguration() {
  const storageQuery = useQuery({
    queryKey: ["settings", "storage"],
    queryFn: () => apiClient.getStorageConfig(),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const rerankQuery = useQuery({
    queryKey: ["settings", "rerank"],
    queryFn: () => apiClient.getCapabilityConfig("RERANK"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const embeddingQuery = useQuery({
    queryKey: ["settings", "embedding"],
    queryFn: () => apiClient.getCapabilityConfig("EMBEDDING"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const multiEmbeddingQuery = useQuery({
    queryKey: ["settings", "multi-embedding"],
    queryFn: () => apiClient.getCapabilityConfig("MULTI_EMBEDDING"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const generationQuery = useQuery({
    queryKey: ["settings", "generation"],
    queryFn: () => apiClient.getCapabilityConfig("GENERATION"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const indexStatusQuery = useQuery({
    queryKey: ["index", "status"],
    queryFn: () => apiClient.getIndexStatus(),
    retry: false,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      const status = query.state.data?.status;
      if (status === "INITIALIZING" || status === "REBUILDING") return 2000;
      if (status === "NOT_READY") return 5000;
      return 30000;
    },
  });

  const isLoading =
    storageQuery.isPending ||
    rerankQuery.isPending ||
    embeddingQuery.isPending ||
    multiEmbeddingQuery.isPending ||
    generationQuery.isPending ||
    indexStatusQuery.isPending;

  const hasStorage = storageQuery.isSuccess && storageQuery.data != null;
  const hasRerank = rerankQuery.isSuccess && (rerankQuery.data?.length ?? 0) > 0;
  const hasEmbedding =
    (embeddingQuery.isSuccess && (embeddingQuery.data?.length ?? 0) > 0) ||
    (multiEmbeddingQuery.isSuccess && (multiEmbeddingQuery.data?.length ?? 0) > 0);
  const hasGeneration = generationQuery.isSuccess && (generationQuery.data?.length ?? 0) > 0;

  const missingAny = !hasStorage || !hasRerank || !hasEmbedding || !hasGeneration;

  const indexStatus = indexStatusQuery.data;
  const indexReady = isIndexFullyOperational(indexStatus);

  return {
    isLoading,
    missingAny,
    indexReady,
    indexStatus,
    indexStatusError: indexStatusQuery.isError,
    refetchIndexStatus: indexStatusQuery.refetch,
  };
}

/**
 * Keeps protected page components unmounted until the prerequisite checks pass.
 * This is intentionally a component boundary rather than a visual overlay: hooks
 * in the protected page cannot start business requests while access is blocked.
 */
export function PremiumSystemConfigurationBoundary({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<PremiumThemeMode>("light");
  const systemConfig = usePremiumSystemConfiguration();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nextTheme = getInitialPremiumTheme();
      setTheme(nextTheme);
      applyPremiumTheme(nextTheme);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (systemConfig.isLoading) {
    return (
      <PremiumConfigurationShell theme={theme} onThemeChange={setTheme}>
        <PremiumConfigurationLoading
          theme={theme}
          title="正在检查系统配置"
          description="稍等片刻，系统正在确认各项能力配置状态。"
        />
      </PremiumConfigurationShell>
    );
  }

  if (systemConfig.indexStatusError || !systemConfig.indexStatus) {
    return (
      <PremiumConfigurationShell theme={theme} onThemeChange={setTheme}>
        <PremiumIndexStatusError
          theme={theme}
          onRetry={() => void systemConfig.refetchIndexStatus()}
        />
      </PremiumConfigurationShell>
    );
  }

  if (systemConfig.missingAny) {
    return (
      <PremiumConfigurationShell theme={theme} onThemeChange={setTheme}>
        <PremiumSystemConfigurationGate theme={theme} />
      </PremiumConfigurationShell>
    );
  }

  if (!systemConfig.indexReady && systemConfig.indexStatus) {
    return (
      <PremiumConfigurationShell theme={theme} onThemeChange={setTheme}>
        <PremiumIndexGate theme={theme} indexStatus={systemConfig.indexStatus} />
      </PremiumConfigurationShell>
    );
  }

  return children;
}

export function PremiumConfigurationShell({
  theme,
  onThemeChange,
  scrollContent = false,
  children,
}: {
  theme: PremiumThemeMode;
  onThemeChange: (theme: PremiumThemeMode) => void;
  scrollContent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="premium-theme ask-premium-page imports-premium-page min-h-screen overflow-x-hidden bg-[#f7f7f2] tracking-normal text-[#111315]"
      data-theme={theme}
      data-premium-theme={theme}
      style={{ fontFamily: PREMIUM_CONFIGURATION_FONT_STACK }}
    >
      <div aria-hidden="true" className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(var(--premium-bg-grid)_1px,transparent_1px),linear-gradient(90deg,var(--premium-bg-grid)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div aria-hidden="true" className="ask-premium-glow-bg pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_78%_8%,var(--premium-glow-primary),transparent_28rem),radial-gradient(circle_at_14%_92%,var(--premium-glow-secondary),transparent_30rem)]" />
      <div className="relative min-h-screen overflow-x-hidden p-0 lg:p-6">
        <div
          className={[
            "ask-premium-shell grid min-h-screen overflow-hidden border border-black/15 bg-white/70 shadow-[0_24px_80px_rgba(17,19,21,0.12)] backdrop-blur-2xl lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-[8px]",
            scrollContent ? "lg:h-[calc(100vh-48px)] lg:min-h-0" : "lg:min-h-[calc(100vh-48px)]",
          ].join(" ")}
        >
          <PremiumRail theme={theme} onThemeChange={onThemeChange} />
          {scrollContent ? (
            <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
              {children}
            </div>
          ) : children}
        </div>
      </div>
    </div>
  );
}

export function PremiumConfigurationLoading({
  theme,
  title,
  description,
}: {
  theme: PremiumThemeMode;
  title: string;
  description: string;
}) {
  return (
    <PremiumConfigurationState
      theme={theme}
      icon={<Loader2 size={24} className="animate-spin" />}
      title={title}
      description={description}
    />
  );
}

export function PremiumConfigurationGate({
  theme,
  description,
  statuses,
}: {
  theme: PremiumThemeMode;
  description: string;
  statuses: PremiumConfigurationStatus[];
}) {
  return (
    <div className={`grid min-h-0 min-w-0 place-items-center px-4 ${statePageBackgroundClass(theme)}`}>
      <div className="premium-surface w-full max-w-[460px] rounded-[8px] p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-[8px] bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
          <Info size={24} />
        </div>
        <h1 className="text-xl font-black leading-none text-[var(--premium-ink)]">需要先完成配置</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">{description}</p>
        <div className="mx-auto mt-4 grid max-w-[280px] gap-2 text-left text-sm font-bold text-[var(--premium-ink-soft)]">
          {statuses.map((status) => (
            <PremiumConfigurationStatusRow key={status.label} {...status} />
          ))}
        </div>
        <Link href="/settings" className={`${SETTINGS_BUTTON_CLASS} mt-5 justify-center`}>
          <span className="text-white dark:text-[#111315]">前往设置</span>
        </Link>
      </div>
    </div>
  );
}

export function PremiumSystemConfigurationGate({ theme }: { theme: PremiumThemeMode }) {
  return (
    <div className={`grid min-h-0 min-w-0 place-items-center px-4 ${statePageBackgroundClass(theme)}`}>
      <div className="premium-surface w-full max-w-[460px] rounded-[8px] p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-[8px] bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
          <Info size={24} />
        </div>
        <h1 className="text-xl font-black leading-none text-[var(--premium-ink)]">需要先完成配置</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">前往设置页完成模型和对象存储配置，完成后即可正常使用。</p>
        <Link href="/settings" className={`${SETTINGS_BUTTON_CLASS} mt-5 justify-center`}>
          <span className="text-white dark:text-[#111315]">前往设置</span>
        </Link>
      </div>
    </div>
  );
}

export function PremiumIndexGate({
  theme,
  indexStatus,
}: {
  theme: PremiumThemeMode;
  indexStatus: SegmentIndexStatus;
}) {
  const isRebuilding = indexStatus.status === "REBUILDING";
  const isInitializing = indexStatus.status === "INITIALIZING";
  const isFailed = indexStatus.status === "NOT_READY" && Boolean(indexStatus.lastError);
  const isRebuildFailed = hasIndexRebuildFailed(indexStatus);
  const needsRebuild =
    indexStatus.status === "READY" &&
    Boolean(indexStatus.pendingRebuild || getIndexCompatibilityIssue(indexStatus));
  const rebuildPhaseLabel =
    indexStatus.rebuildProgress?.phase === "PREPARING"
      ? "准备重建中"
      : indexStatus.rebuildProgress?.phase === "MIGRATING"
        ? "迁移数据中"
        : indexStatus.rebuildProgress?.phase === "SWITCHING_ALIAS"
          ? "切换索引中"
          : indexStatus.rebuildProgress?.phase === "COMPLETED"
            ? "重建完成"
            : indexStatus.rebuildProgress?.phase === "FAILED"
              ? "重建失败"
              : null;

  const title = isRebuilding
    ? "索引重建中"
    : isInitializing
      ? "索引初始化中"
      : isFailed
        ? "索引初始化失败"
        : isRebuildFailed
          ? "索引重建失败"
          : needsRebuild
            ? "索引等待重建"
            : indexStatus.status === "READY"
              ? "索引暂不可用"
              : "索引未就绪";
  const description = isRebuilding
    ? "系统正在迁移存量文档向量，请稍候。"
    : isInitializing
      ? "系统正在创建搜索索引，请稍候。"
      : isFailed
        ? `索引初始化失败。请在设置页重试。`
        : isRebuildFailed
          ? "最近一次索引重建失败，请前往设置页重试。"
          : needsRebuild
            ? "检测到待确认的索引重建任务，请前往设置页确认。"
            : indexStatus.status === "READY"
              ? "索引当前不可读写，请前往设置页检查。"
              : "索引尚未就绪。";

  return (
    <div className={`grid min-h-0 min-w-0 place-items-center px-4 ${statePageBackgroundClass(theme)}`}>
      <div className="premium-surface w-full max-w-[460px] rounded-[8px] p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-[8px] bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
          <Info size={24} />
        </div>
        <h1 className="text-xl font-black leading-none text-[var(--premium-ink)]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">{description}</p>
        {isRebuilding && indexStatus.rebuildProgress ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-[#343a36]" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-[linear-gradient(90deg,var(--premium-blue),var(--premium-accent))] shadow-[0_0_18px_rgba(49,88,255,0.28)]"
                style={{ width: `${indexStatus.rebuildProgress.total > 0 ? Math.round((indexStatus.rebuildProgress.migrated / indexStatus.rebuildProgress.total) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--premium-muted)]">
              {rebuildPhaseLabel ? `${rebuildPhaseLabel} · ` : ""}
              {indexStatus.rebuildProgress.migrated} / {indexStatus.rebuildProgress.total}
            </p>
          </div>
        ) : null}
        <Link href="/settings" className={`${SETTINGS_BUTTON_CLASS} mt-5 justify-center`}>
          <span className="text-white dark:text-[#111315]">前往设置</span>
        </Link>
      </div>
    </div>
  );
}

function PremiumIndexStatusError({
  theme,
  onRetry,
}: {
  theme: PremiumThemeMode;
  onRetry: () => void;
}) {
  return (
    <div className={`grid min-h-0 min-w-0 place-items-center px-4 ${statePageBackgroundClass(theme)}`}>
      <div className="premium-surface w-full max-w-[460px] rounded-[8px] p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-[8px] bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
          <Info size={24} />
        </div>
        <h1 className="text-xl font-black leading-none text-[var(--premium-ink)]">索引状态未知</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">
          暂时无法读取索引状态。为避免业务请求失败，页面已暂停加载。
        </p>
        <button type="button" onClick={onRetry} className={`${SETTINGS_BUTTON_CLASS} mt-5`}>
          重新检查
        </button>
      </div>
    </div>
  );
}

function PremiumConfigurationState({
  theme,
  icon,
  title,
  description,
}: {
  theme: PremiumThemeMode;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className={`grid min-h-0 min-w-0 place-items-center px-4 ${statePageBackgroundClass(theme)}`}>
      <div className="premium-surface grid w-full max-w-[420px] place-items-center rounded-[8px] p-6 text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-[8px] bg-[#111315] text-white dark:bg-white dark:text-[#111315]">
          {icon}
        </div>
        <h1 className="text-xl font-black leading-none text-[var(--premium-ink)]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">{description}</p>
      </div>
    </div>
  );
}

function PremiumConfigurationStatusRow({ label, missing }: PremiumConfigurationStatus) {
  return (
    <div className="flex items-center justify-between rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-3 py-2">
      <span>{label}</span>
      <span className={missing ? "text-rose-600 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}>
        {missing ? "未配置" : "已就绪"}
      </span>
    </div>
  );
}

function statePageBackgroundClass(theme: PremiumThemeMode) {
  return theme === "dark"
    ? "bg-[#070908]"
    : "bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)]";
}
