"use client";

import { useQuery } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { apiClient } from "@/lib/api-client";
import type { PremiumThemeMode } from "@/lib/premium-theme";
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
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const multiEmbeddingQuery = useQuery({
    queryKey: ["settings", "multi-embedding"],
    queryFn: () => apiClient.getCapabilityConfig("MULTI_EMBEDDING"),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const generationQuery = useQuery({
    queryKey: ["settings", "generation"],
    queryFn: () => apiClient.getCapabilityConfig("GENERATION"),
    enabled: requireGeneration,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const hasEmbedding =
    (embeddingQuery.isSuccess && (embeddingQuery.data?.length ?? 0) > 0) ||
    (multiEmbeddingQuery.isSuccess && (multiEmbeddingQuery.data?.length ?? 0) > 0);
  const hasGeneration =
    !requireGeneration ||
    (generationQuery.isSuccess && (generationQuery.data?.length ?? 0) > 0);

  return {
    isLoading:
      embeddingQuery.isPending ||
      embeddingQuery.isFetching ||
      multiEmbeddingQuery.isPending ||
      multiEmbeddingQuery.isFetching ||
      (requireGeneration && (generationQuery.isPending || generationQuery.isFetching)),
    missing: {
      embedding: !hasEmbedding,
      generation: !hasGeneration,
    },
  };
}

export function PremiumConfigurationShell({
  theme,
  onThemeChange,
  children,
}: {
  theme: PremiumThemeMode;
  onThemeChange: (theme: PremiumThemeMode) => void;
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
        <div className="ask-premium-shell grid min-h-screen overflow-hidden border border-black/15 bg-white/70 shadow-[0_24px_80px_rgba(17,19,21,0.12)] backdrop-blur-2xl lg:min-h-[calc(100vh-48px)] lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-[8px]">
          <PremiumRail theme={theme} onThemeChange={onThemeChange} />
          {children}
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
