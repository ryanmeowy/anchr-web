"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PremiumRail } from "@/components/app/premium-rail";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import { apiClient } from "@/lib/api-client";
import { AssetPreviewContent } from "./preview-premium-page";

export function AssetPreviewPremiumPage({ assetId }: { assetId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [theme, setTheme] = useState<PremiumThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const decodedAssetId = useMemo(() => decodeURIComponent(assetId), [assetId]);
  const kbId = searchParams.get("kbId")?.trim() ?? "";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTheme(getInitialPremiumTheme());
      setThemeHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (themeHydrated) applyPremiumTheme(theme);
  }, [theme, themeHydrated]);

  const previewQuery = useQuery({
    queryKey: ["preview", "asset", kbId, decodedAssetId],
    queryFn: () => apiClient.previewAsset(kbId, decodedAssetId),
    enabled: Boolean(kbId && decodedAssetId),
    refetchOnWindowFocus: false,
  });

  const handleBack = () => {
    router.replace(kbId ? `/library?kbId=${encodeURIComponent(kbId)}` : "/library");
  };

  const errorMessage = !kbId
    ? "缺少知识库参数，无法确认文档归属。请从 Library 文档列表重新进入。"
    : previewQuery.error instanceof Error
      ? previewQuery.error.message
      : "请稍后重试";

  return (
    <div
      className="premium-theme ask-premium-page preview-premium-page min-h-screen overflow-x-hidden bg-[#f7f7f2] text-[#111315]"
      data-theme={theme}
      data-premium-theme={theme}
    >
      <div
        aria-hidden="true"
        className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(var(--premium-bg-grid)_1px,transparent_1px),linear-gradient(90deg,var(--premium-bg-grid)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]"
      />
      <div
        aria-hidden="true"
        className="ask-premium-glow-bg pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_78%_8%,var(--premium-glow-primary),transparent_28rem),radial-gradient(circle_at_14%_92%,var(--premium-glow-secondary),transparent_30rem)]"
      />

      <div className="relative min-h-screen overflow-x-hidden p-0 lg:p-6">
        <div className="ask-premium-shell grid min-h-screen overflow-hidden border border-black/15 bg-white/70 shadow-[var(--premium-shadow)] backdrop-blur-2xl lg:h-[calc(100vh-48px)] lg:min-h-0 lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-[8px]">
          <PremiumRail theme={theme} onThemeChange={setTheme} />

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
            <header className="ask-premium-hero relative grid h-[112px] overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]"
              >
                DOCUMENT
              </div>
              <div className="relative z-10 flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3.5 text-xs font-black text-[var(--premium-ink)] shadow-[0_10px_26px_rgba(17,19,21,0.08)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white"
                >
                  <ChevronLeft size={16} />
                  返回
                </button>
                <section className="min-w-0">
                  <p className="ask-premium-kicker mb-1.5 flex items-center gap-2 text-[10px] font-black text-blue-700">
                    <span className="size-1.5 rounded-full bg-[var(--premium-accent)] shadow-[0_0_0_5px_rgba(187,255,102,0.2)]" />
                    LIBRARY / DOCUMENT SOURCE
                  </p>
                  <h1 className="max-w-[900px] truncate text-[clamp(18px,2.6vw,36px)] font-black leading-none text-[var(--premium-ink)]">
                    {previewQuery.data?.fileName ?? "文档预览"}
                  </h1>
                  <p className="mt-1.5 truncate text-[11px] font-bold text-[var(--premium-muted)]">
                    {previewQuery.data?.kbName ?? previewQuery.data?.kbId ?? "知识库"} · Library 文档资产
                  </p>
                </section>
              </div>
            </header>

            <main className="preview-premium-main min-h-0 min-w-0 overflow-auto bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)] dark:bg-[radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.08),transparent_26rem),#070908]">
              {!kbId || previewQuery.isError ? (
                <AssetPreviewError message={errorMessage} onRetry={kbId ? () => void previewQuery.refetch() : undefined} />
              ) : previewQuery.isLoading ? (
                <AssetPreviewState />
              ) : previewQuery.data ? (
                <AssetPreviewContent
                  asset={previewQuery.data}
                  onRefresh={() => void previewQuery.refetch()}
                  isRefreshing={previewQuery.isFetching}
                />
              ) : (
                <AssetPreviewError message="暂无可预览内容" onRetry={() => void previewQuery.refetch()} />
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetPreviewState() {
  return (
    <div className="grid min-h-[calc(100vh-112px)] place-items-center p-6 lg:min-h-[calc(100vh-160px)]">
      <div className="premium-surface grid min-h-40 w-full max-w-[420px] place-items-center rounded-[8px] p-6 text-center">
        <span className="size-7 animate-spin rounded-full border-2 border-[var(--premium-line)] border-t-[var(--premium-blue)]" />
        <p className="mt-3 text-sm font-black text-[var(--premium-ink-soft)]">正在加载完整文档</p>
      </div>
    </div>
  );
}

function AssetPreviewError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="grid min-h-[calc(100vh-112px)] place-items-center p-6 lg:min-h-[calc(100vh-160px)]">
      <div className="premium-surface w-full max-w-[480px] rounded-[8px] p-6 text-center">
        <p className="text-[10px] font-black text-[var(--premium-blue)]">DOCUMENT PREVIEW</p>
        <h2 className="mt-2 text-lg font-black text-[var(--premium-ink)]">预览加载失败</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">{message}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--premium-ink)] px-4 text-sm font-black text-[var(--premium-bg)]"
          >
            重试
          </button>
        ) : null}
      </div>
    </div>
  );
}
