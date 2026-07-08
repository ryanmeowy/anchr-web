"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  MessageCircle,
  Minus,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PremiumRail } from "@/components/app/premium-rail";
import { ErrorBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import {
  saveAskAssetScope,
  saveAssetScopeHandoff,
  saveSearchAssetScope,
  type AssetScope,
} from "@/lib/asset-scope";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import {
  buildPreviewRequest,
  clearPreviewRestoreState,
  readPreviewNavigation,
  type PreviewCitation,
  type PreviewNavigationContext,
  type PreviewSource,
} from "@/lib/preview-context";
import type { PreviewBBox, PreviewBBoxRecord, PreviewSegment } from "@/lib/types";
import styles from "./preview-premium-page.module.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy["getPage"]>>;
type PdfPageSize = { width: number; height: number; widthPt: number; heightPt: number };
type PdfRenderTask = ReturnType<PdfPageProxy["render"]>;
type PdfFitMode = "auto" | "width" | "manual";
type PreviewSurroundingChunk = NonNullable<PreviewSegment["surroundingChunks"]>[number];
type PreviewOverflow = { horizontal: boolean; vertical: boolean };
type TransientBBoxHighlight = {
  id: number;
  records: PreviewBBoxRecord[];
};

const DEFAULT_PDF_SCALE = 1.23;
const MIN_AUTO_PDF_SCALE = 0.25;
const MIN_PDF_SCALE = 0.55;
const MAX_PDF_SCALE = 2.2;
const PREVIEW_OVERFLOW_TOLERANCE = 2;
const CONTEXT_HIGHLIGHT_DURATION_MS = 2400;

export function PreviewPremiumPage({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [theme, setTheme] = useState<PremiumThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const decodedSegmentId = useMemo(() => decodeURIComponent(segmentId), [segmentId]);
  const fromParam = searchParams.get("from");
  const from: PreviewSource = fromParam === "search"
    ? "search"
    : fromParam === "library"
      ? "library"
      : "ask";
  const contextKey = searchParams.get("contextKey");
  const citationIndexFromUrl = Number(searchParams.get("citationIndex") ?? "");
  const context = useMemo(() => readPreviewNavigation(contextKey), [contextKey]);
  const previewRequest = useMemo(
    () => buildPreviewRequest({
      source: from,
      segmentId: decodedSegmentId,
      citationIndex: citationIndexFromUrl,
      context,
    }),
    [citationIndexFromUrl, context, decodedSegmentId, from],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTheme(getInitialPremiumTheme());
      setThemeHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (themeHydrated) {
      applyPremiumTheme(theme);
    }
  }, [theme, themeHydrated]);

  const previewQuery = useQuery({
    queryKey: ["preview", decodedSegmentId, from, contextKey, citationIndexFromUrl],
    queryFn: () => apiClient.previewSegment(decodedSegmentId, previewRequest),
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiClient.refreshSegmentPreview(decodedSegmentId, previewRequest),
    onSuccess: () => {
      void previewQuery.refetch();
    },
  });

  const item = refreshMutation.data ?? previewQuery.data;
  const citationIndex = citationIndexFromUrl || item?.citationContext?.citationIndex || 1;

  const handleCitationSelect = useCallback((citation: PreviewCitation, fallbackIndex: number) => {
    if (!citation.segmentId) {
      return;
    }

    const nextCitationIndex = citation.citationIndex ?? fallbackIndex;
    if (citation.segmentId === decodedSegmentId && nextCitationIndex === citationIndex) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("from", from);
    params.set("citationIndex", String(nextCitationIndex));
    refreshMutation.reset();
    router.push(`/preview/${encodeURIComponent(citation.segmentId)}?${params.toString()}`);
  }, [
    citationIndex,
    decodedSegmentId,
    from,
    refreshMutation,
    router,
    searchParams,
  ]);

  const handleContinueWithAsset = useCallback((previewItem: PreviewSegment) => {
    if (!previewItem.assetId || from === "library") return;

    const scope: AssetScope = {
      assetId: previewItem.assetId,
      fileName: previewItem.fileName ?? previewItem.title ?? previewItem.assetId,
      ...(previewItem.kbId ? { kbId: previewItem.kbId } : {}),
    };

    if (from === "ask") {
      const sessionId = context?.sessionId ?? "";
      if (sessionId) {
        saveAskAssetScope(sessionId, scope);
      }
      saveAssetScopeHandoff({ destination: "ask", scope, sessionId: sessionId || undefined });
      router.push(sessionId ? `/ask?session=${encodeURIComponent(sessionId)}` : "/ask");
      return;
    }

    saveSearchAssetScope(scope);
    saveAssetScopeHandoff({ destination: "search", scope });
    clearPreviewRestoreState("search");
    router.push("/search");
  }, [context?.sessionId, from, router]);

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push(from === "search" ? "/search" : from === "library" ? "/library" : "/ask");
  };

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
        <div className="ask-premium-shell grid min-h-screen overflow-hidden border border-black/15 bg-white/70 shadow-[var(--premium-shadow)] backdrop-blur-2xl lg:min-h-0 lg:scale-[0.96] lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-[8px]">
          <PremiumRail theme={theme} onThemeChange={setTheme} />

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
            <header className="ask-premium-hero relative grid h-[112px] overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]"
              >
                PREVIEW
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
                    <span className={`${styles.pulse} size-1.5 rounded-full bg-[var(--premium-accent)] shadow-[0_0_0_5px_rgba(187,255,102,0.2)]`} />
                    PREVIEW / CITATION SOURCE
                  </p>
                  <h1 className="max-w-[900px] truncate text-[clamp(18px,2.6vw,36px)] font-black leading-none text-[var(--premium-ink)]">
                    {item?.fileName ?? "引用预览"}
                  </h1>
                  <p className="mt-1.5 truncate text-[11px] font-bold text-[var(--premium-muted)]">
                    {item?.kbName ?? item?.kbId ?? "知识库"} · 来自{from === "search" ? " Search" : from === "library" ? " Library Recent Citations" : " Ask"} 引用
                  </p>
                </section>
              </div>
            </header>

            <main className="preview-premium-main min-h-0 min-w-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)] dark:bg-[radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.08),transparent_26rem),#070908]">
              {previewQuery.isLoading ? (
                <PreviewState label="正在加载预览" />
              ) : previewQuery.isError ? (
                <PreviewError
                  message={(previewQuery.error as Error).message}
                  onRetry={() => void previewQuery.refetch()}
                />
              ) : item ? (
                <PreviewContent
                  key={item.segmentId}
                  item={item}
                  context={context}
                  citationIndex={citationIndex}
                  from={from}
                  onCitationSelect={handleCitationSelect}
                  onContinueWithAsset={handleContinueWithAsset}
                  onRefresh={() => refreshMutation.mutate()}
                  isRefreshing={refreshMutation.isPending}
                />
              ) : (
                <PreviewState label="暂无可预览内容" />
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewContent({
  item,
  context,
  citationIndex,
  from,
  onCitationSelect,
  onContinueWithAsset,
  onRefresh,
  isRefreshing,
}: {
  item: PreviewSegment;
  context: PreviewNavigationContext | null;
  citationIndex: number;
  from: PreviewSource;
  onCitationSelect: (citation: PreviewCitation, fallbackIndex: number) => void;
  onContinueWithAsset: (item: PreviewSegment) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const previewType = getPreviewType(item);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const contextHighlightTimerRef = useRef<number | null>(null);
  const contextHighlightSequenceRef = useRef(0);
  const [sidebarHeight, setSidebarHeight] = useState<number | null>(null);
  const [pdfPage, setPdfPage] = useState(item.anchor?.pageNo ?? 1);
  const [pdfScale, setPdfScale] = useState(DEFAULT_PDF_SCALE);
  const [pdfFitMode, setPdfFitMode] = useState<PdfFitMode>("auto");
  const [activeChunkSegmentId, setActiveChunkSegmentId] = useState(item.segmentId);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [previewFrameSize, setPreviewFrameSize] = useState({ width: 0, height: 0 });
  const [previewOverflow, setPreviewOverflow] = useState<PreviewOverflow>({
    horizontal: false,
    vertical: false,
  });
  const [contextHighlight, setContextHighlight] = useState<TransientBBoxHighlight | null>(null);

  const pageNumbers = useMemo(() => {
    if (previewType !== "PDF") {
      return [item.anchor?.pageNo ?? 1];
    }
    const total = pdfPageCount ?? Math.max(pdfPage, item.anchor?.pageNo ?? 1);
    return Array.from({ length: total }, (_, index) => index + 1);
  }, [item.anchor?.pageNo, pdfPage, pdfPageCount, previewType]);

  const getPdfWidthScale = useCallback(() => {
    if (!pdfPageSize || !previewFrameSize.width) {
      return DEFAULT_PDF_SCALE;
    }

    return clampScale(previewFrameSize.width / pdfPageSize.widthPt, MIN_AUTO_PDF_SCALE);
  }, [pdfPageSize, previewFrameSize.width]);

  const getPdfAutoScale = useCallback(() => {
    return Math.min(DEFAULT_PDF_SCALE, getPdfWidthScale());
  }, [getPdfWidthScale]);

  useEffect(() => {
    const scroller = previewScrollerRef.current;
    if (!scroller) {
      return;
    }

    const updateFrameSize = () => {
      const nextSize = getPreviewFrameSize(scroller);
      setPreviewFrameSize((size) => (
        Math.abs(size.width - nextSize.width) < 1 && Math.abs(size.height - nextSize.height) < 1
          ? size
          : nextSize
      ));
    };

    updateFrameSize();
    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(scroller);
    window.addEventListener("resize", updateFrameSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateFrameSize);
    };
  }, []);

  const updatePreviewOverflow = useCallback(() => {
    const scroller = previewScrollerRef.current;
    if (!scroller) {
      return;
    }

    const nextOverflow = {
      horizontal: scroller.scrollWidth - scroller.clientWidth > PREVIEW_OVERFLOW_TOLERANCE,
      vertical: scroller.scrollHeight - scroller.clientHeight > PREVIEW_OVERFLOW_TOLERANCE,
    };

    if (!nextOverflow.horizontal && scroller.scrollLeft !== 0) {
      scroller.scrollLeft = 0;
    }
    if (!nextOverflow.vertical && scroller.scrollTop !== 0) {
      scroller.scrollTop = 0;
    }

    setPreviewOverflow((currentOverflow) => (
      currentOverflow.horizontal === nextOverflow.horizontal
        && currentOverflow.vertical === nextOverflow.vertical
        ? currentOverflow
        : nextOverflow
    ));
  }, []);

  useEffect(() => {
    const scroller = previewScrollerRef.current;
    if (!scroller) {
      return;
    }

    let frame = window.requestAnimationFrame(updatePreviewOverflow);
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePreviewOverflow);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    const mutationObserver = new MutationObserver(scheduleUpdate);

    resizeObserver.observe(scroller);
    mutationObserver.observe(scroller, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [updatePreviewOverflow]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updatePreviewOverflow);
    return () => window.cancelAnimationFrame(frame);
  }, [item.segmentId, pdfPage, pdfPageSize, pdfScale, updatePreviewOverflow]);

  useEffect(() => () => {
    if (contextHighlightTimerRef.current !== null) {
      window.clearTimeout(contextHighlightTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (previewType !== "PDF" || pdfFitMode === "manual") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const nextScale = pdfFitMode === "width" ? getPdfWidthScale() : getPdfAutoScale();
      setPdfScale((scale) => (Math.abs(scale - nextScale) < 0.01 ? scale : nextScale));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [getPdfAutoScale, getPdfWidthScale, pdfFitMode, previewType]);

  const fitPdfToWidth = useCallback(() => {
    setPdfFitMode("width");
    setPdfScale(getPdfWidthScale());
  }, [getPdfWidthScale]);

  const toggleFullscreen = useCallback(() => {
    const shell = previewShellRef.current;
    if (!shell) {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void shell.requestFullscreen();
  }, []);

  const handleChunkSelect = useCallback((chunk: PreviewSurroundingChunk) => {
    const isCurrent = chunk.relation === "current" || chunk.segmentId === item.segmentId;
    setActiveChunkSegmentId(chunk.segmentId);
    const bboxRecords = (chunk.bbox ?? []).filter((record) => Boolean(record.bbox));

    if (contextHighlightTimerRef.current !== null) {
      window.clearTimeout(contextHighlightTimerRef.current);
      contextHighlightTimerRef.current = null;
    }

    if (bboxRecords.length) {
      contextHighlightSequenceRef.current += 1;
      setContextHighlight({
        id: contextHighlightSequenceRef.current,
        records: bboxRecords,
      });
      contextHighlightTimerRef.current = window.setTimeout(() => {
        setContextHighlight(null);
        contextHighlightTimerRef.current = null;
      }, CONTEXT_HIGHLIGHT_DURATION_MS);
    } else {
      setContextHighlight(null);
    }

    if (previewType === "PDF") {
      const targetPage = chunk.pageNo
        ?? bboxRecords.find((record) => record.pageNo)?.pageNo
        ?? (isCurrent ? item.anchor?.pageNo : undefined);
      if (targetPage) {
        setPdfPage(targetPage);
      }
      return;
    }

    if (previewType === "IMAGE") {
      return;
    }

    const scroller = previewScrollerRef.current;
    const target = Array.from(
      scroller?.querySelectorAll<HTMLElement>("[data-preview-segment-id]") ?? [],
    ).find((element) => element.dataset.previewSegmentId === chunk.segmentId);

    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [item.anchor?.pageNo, item.segmentId, previewType]);

  const handleSidebarHeightChange = useCallback((height: number) => {
    setSidebarHeight((currentHeight) => (
      currentHeight === height ? currentHeight : height
    ));
  }, []);

  return (
    <div
      ref={previewShellRef}
      style={sidebarHeight ? { height: `${sidebarHeight}px` } : undefined}
      className="grid min-h-0 min-w-0 grid-cols-[132px_minmax(0,1fr)_minmax(320px,390px)] overflow-hidden max-[1240px]:!h-auto max-[1240px]:min-h-[760px] max-[1240px]:grid-cols-[116px_minmax(0,1fr)] max-[860px]:block max-[860px]:overflow-visible"
    >
      <aside
        aria-label="页面缩略图"
        className="preview-premium-thumbnails grid min-h-0 content-start gap-3.5 overflow-auto border-r border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-4 max-[860px]:grid-flow-col max-[860px]:grid-cols-none max-[860px]:auto-cols-[88px] max-[860px]:overflow-x-auto max-[860px]:border-r-0 max-[860px]:border-b"
      >
        {pageNumbers.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => setPdfPage(page)}
            disabled={previewType !== "PDF"}
            className="grid gap-2 border-0 bg-transparent text-center text-[var(--premium-muted)]"
          >
            <span className={[
              "grid h-[124px] w-[88px] place-items-center overflow-hidden rounded-[8px] border bg-white shadow-[0_12px_28px_rgba(16,18,20,0.10)] transition",
              page === pdfPage
                ? "border-[var(--premium-blue)] shadow-[0_18px_40px_rgba(36,89,255,0.18)] -translate-y-[3px]"
                : "border-[var(--premium-line)] hover:-translate-y-[3px] hover:border-[var(--premium-blue)]",
            ].join(" ")}
            >
              {previewType === "PDF" ? (
                <PdfThumbnail pdfDoc={pdfDoc} pageNo={page} isActive={page === pdfPage} />
              ) : (
                <FileText size={20} />
              )}
            </span>
            <span className="text-xs font-black">{page}</span>
          </button>
        ))}
      </aside>

      <section
        aria-label="预览工作区"
        className="preview-premium-workspace grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-[radial-gradient(circle_at_18%_10%,rgba(36,89,255,0.08),transparent_24rem),rgba(16,18,20,0.04)] dark:bg-[radial-gradient(circle_at_18%_10%,rgba(49,88,255,0.12),transparent_24rem),rgba(255,255,255,0.03)] max-[860px]:min-h-[760px]"
      >
        <div
          aria-label="预览工具栏"
          className="preview-premium-toolbar flex min-h-16 items-center justify-between gap-3 border-b border-[var(--premium-line)] bg-[var(--premium-panel)] px-4 py-2.5 backdrop-blur-xl max-[860px]:items-start max-[860px]:flex-col"
        >
          <div className="flex flex-wrap items-center gap-2 max-[500px]:w-full max-[500px]:items-stretch max-[500px]:flex-col">
            <ToolButton
              label="上一页"
              disabled={previewType !== "PDF" || pdfPage <= 1}
              onClick={() => setPdfPage((page) => Math.max(1, page - 1))}
            >
              <ChevronLeft size={17} />
            </ToolButton>
            <span className="inline-flex min-h-[38px] items-center rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-[13px] font-black text-[var(--premium-ink-soft)]">
              {previewType === "PDF"
                ? `${pdfPage} / ${pdfPageCount ?? "-"}`
                : item.anchor?.pageNo
                  ? `第 ${item.anchor.pageNo} 页`
                  : "预览"}
            </span>
            <ToolButton
              label="下一页"
              disabled={previewType !== "PDF" || (pdfPageCount !== null && pdfPage >= pdfPageCount)}
              onClick={() => setPdfPage((page) => Math.min(pdfPageCount ?? page + 1, page + 1))}
            >
              <ChevronRight size={17} />
            </ToolButton>
          </div>

          <div className="flex flex-wrap items-center gap-2 max-[500px]:w-full max-[500px]:items-stretch max-[500px]:flex-col">
            <ToolButton
              label="缩小"
              disabled={previewType !== "PDF"}
              onClick={() => {
                setPdfFitMode("manual");
                setPdfScale((scale) => clampScale(scale - 0.1));
              }}
            >
              <Minus size={16} />
            </ToolButton>
            <span className="inline-flex min-h-[38px] items-center rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-[13px] font-black text-[var(--premium-ink-soft)]">
              {Math.round(pdfScale * 100)}%
            </span>
            <ToolButton
              label="放大"
              disabled={previewType !== "PDF"}
              onClick={() => {
                setPdfFitMode("manual");
                setPdfScale((scale) => clampScale(scale + 0.1));
              }}
            >
              <Plus size={16} />
            </ToolButton>
            <button
              type="button"
              disabled={previewType !== "PDF"}
              onClick={fitPdfToWidth}
              className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-[13px] font-black text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              适宽
            </button>
            <ToolButton label="刷新预览地址" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
            </ToolButton>
            <ToolButton label="全屏" onClick={toggleFullscreen}>
              <Maximize2 size={17} />
            </ToolButton>
          </div>
        </div>

        <div
          ref={previewScrollerRef}
          className={[
            "min-h-0 min-w-0 p-8 max-[860px]:px-3.5 max-[860px]:py-[18px]",
            previewOverflow.horizontal ? "overflow-x-auto" : "overflow-x-hidden",
            previewOverflow.vertical ? "overflow-y-auto" : "overflow-y-hidden",
          ].join(" ")}
        >
          {previewType === "PDF" && item.previewUrl ? (
            <PdfPreview
              item={item}
              pageNo={pdfPage}
              scale={pdfScale}
              citationIndex={citationIndex}
              contextHighlight={contextHighlight}
              onPageCountChange={setPdfPageCount}
              onPageNoChange={setPdfPage}
              onPageSizeChange={setPdfPageSize}
              onDocumentChange={setPdfDoc}
            />
          ) : previewType === "IMAGE" && item.previewUrl ? (
            <ImagePreview
              item={item}
              citationIndex={citationIndex}
              contextHighlight={contextHighlight}
            />
          ) : (
            <TextPreview item={item} citationIndex={citationIndex} />
          )}
        </div>
      </section>

      <CitationSidebar
        item={item}
        context={context}
        citationIndex={citationIndex}
        from={from}
        onCitationSelect={onCitationSelect}
        onContinueWithAsset={onContinueWithAsset}
        activeChunkSegmentId={activeChunkSegmentId}
        onChunkSelect={handleChunkSelect}
        onHeightChange={handleSidebarHeightChange}
      />
    </div>
  );
}

function CitationSidebar({
  item,
  context,
  citationIndex,
  from,
  onCitationSelect,
  onContinueWithAsset,
  activeChunkSegmentId,
  onChunkSelect,
  onHeightChange,
}: {
  item: PreviewSegment;
  context: PreviewNavigationContext | null;
  citationIndex: number;
  from: PreviewSource;
  onCitationSelect: (citation: PreviewCitation, fallbackIndex: number) => void;
  onContinueWithAsset: (item: PreviewSegment) => void;
  activeChunkSegmentId: string;
  onChunkSelect: (chunk: PreviewSurroundingChunk) => void;
  onHeightChange: (height: number) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const citations = context?.citations ?? [];
  const fallbackCitation: PreviewCitation = { citationIndex, segmentId: item.segmentId };
  const currentCitation = citations.find(
    (citation) => citation.segmentId === item.segmentId && citation.citationIndex === citationIndex,
  )
    ?? citations.find((citation) => citation.segmentId === item.segmentId)
    ?? fallbackCitation;
  const displayedCitations = from === "library"
    ? [currentCitation]
    : citations.length
      ? citations
      : [fallbackCitation];
  const previewType = getPreviewType(item);
  const reason = item.citationContext?.citationReason
    ?? "该片段命中当前检索或问答引用，可作为原文证据查看。";

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const updateHeight = () => {
      onHeightChange(content.scrollHeight + 32);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [onHeightChange]);

  return (
    <aside
      aria-label="引用上下文"
      className="preview-premium-sidebar min-h-0 min-w-0 overflow-hidden border-l border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-4 max-[1240px]:col-span-2 max-[1240px]:border-l-0 max-[1240px]:border-t"
    >
      <div ref={contentRef} className="grid min-w-0 content-start gap-3.5 max-[1240px]:grid-cols-2 max-[860px]:grid-cols-1">
      <SidePanel>
        <PanelLabel label="WHY THIS CITATION" value={`#${citationIndex}`} />
        <div className="mt-3.5 min-w-0 rounded-[8px] border border-amber-500/35 bg-amber-400/10 p-3.5 text-[13px] leading-[1.7] text-[var(--premium-ink-soft)] [overflow-wrap:anywhere]">
          <b className="text-[var(--premium-ink)] [overflow-wrap:anywhere]">
            {reason}
          </b>
          <p className="mt-2 [overflow-wrap:anywhere]">
            {context?.question
              ? `来自你的问题：“${context.question}”`
              : from === "search"
                ? "来自搜索回答引用。"
                : from === "library"
                  ? "来自最近引用记录。"
                  : "来自对话回答引用。"}
          </p>
        </div>
      </SidePanel>

      <SidePanel>
        <PanelLabel label="SOURCE INFO" value={getPreviewType(item) || "TEXT"} />
        <div className="mt-3.5 grid gap-2.5">
          <InfoRow label="文件名称" value={item.fileName ?? "-"} />
          <InfoRow label="知识库" value={item.kbName ?? item.kbId ?? "-"} />
          <InfoRow label="页码" value={item.anchor?.pageNo ? `第 ${item.anchor.pageNo} 页` : "-"} />
          <InfoRow label="章节" value={item.title ?? "-"} />
          <InfoRow label="引用位置" value={formatCitationPosition(citationIndex, item)} />
        </div>
        <div className="mt-3.5 flex flex-wrap gap-2" aria-label="本回答中的引用">
          {displayedCitations.map((citation, index) => {
            const number = citation.citationIndex ?? index + 1;
            const isCurrent = citation.segmentId === item.segmentId && number === citationIndex;
            const canSwitch = from !== "library" && Boolean(citation.segmentId) && !isCurrent;
            return (
              <button
                type="button"
                key={`${citation.segmentId ?? index}-${index}`}
                onClick={() => onCitationSelect(citation, index + 1)}
                disabled={!canSwitch}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={`查看引用 ${number}${citation.fileName ? `：${citation.fileName}` : ""}`}
                title={citation.segmentId ? citation.fileName : "该引用缺少片段信息，暂时无法预览"}
                className={[
                  "grid size-8 place-items-center rounded-[8px] border text-sm font-black transition",
                  isCurrent
                    ? "border-amber-500/80 bg-amber-400/20 text-amber-800 dark:text-amber-200"
                    : canSwitch
                      ? "border-[var(--premium-line)] bg-[var(--premium-blue-soft)] text-[var(--premium-blue)] hover:-translate-y-0.5 hover:border-[var(--premium-blue)] hover:bg-[var(--premium-blue)] hover:text-white"
                      : "cursor-not-allowed border-[var(--premium-line)] bg-[var(--premium-panel-muted)] text-[var(--premium-muted)] opacity-55",
                ].join(" ")}
              >
                {number}
              </button>
            );
          })}
        </div>
      </SidePanel>

      <SidePanel>
        <PanelLabel label="SURROUNDING CHUNKS" value={String(item.surroundingChunks?.length ?? 0)} />
        <div className="mt-3.5 grid gap-2.5">
          {(item.surroundingChunks ?? []).map((chunk, index) => {
            const isCurrent = chunk.relation === "current" || chunk.segmentId === item.segmentId;
            const isActive = chunk.segmentId === activeChunkSegmentId;
            const hasBbox = Boolean(chunk.bbox?.some((record) => record.bbox));
            const targetPage = chunk.pageNo
              ?? chunk.bbox?.find((record) => record.pageNo)?.pageNo
              ?? (isCurrent ? item.anchor?.pageNo : undefined);
            const canJump = previewType === "PDF"
              ? Boolean(targetPage)
              : previewType === "IMAGE"
                ? hasBbox
                : true;
            return (
              <button
                key={`${chunk.segmentId}-${chunk.relation ?? index}-${index}`}
                type="button"
                disabled={!canJump}
                onClick={() => onChunkSelect(chunk)}
                aria-current={isActive ? "location" : undefined}
                className={[
                  "w-full min-w-0 rounded-[8px] border p-3 text-left transition focus-visible:ring-2 focus-visible:ring-[var(--premium-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--premium-panel-muted)]",
                  canJump ? "hover:-translate-x-[3px]" : "cursor-not-allowed opacity-55",
                  isActive && !isCurrent
                    ? "border-[var(--premium-blue)] bg-[var(--premium-blue-soft)]"
                    : isCurrent
                    ? "border-amber-500/30 bg-amber-400/10"
                    : "border-[var(--premium-line)] bg-[var(--premium-panel-muted)] hover:bg-amber-400/10",
                ].join(" ")}
              >
                <span className="mb-1.5 flex min-w-0 items-center justify-between gap-3">
                  <strong className="min-w-0 text-[13px] text-[var(--premium-ink)] [overflow-wrap:anywhere]">
                    {relationLabel(chunk.relation)}
                  </strong>
                  <span className="shrink-0 text-[10px] font-black text-[var(--premium-muted)]">
                    {targetPage ? `第 ${targetPage} 页` : canJump ? "跳转" : "无法定位"}
                  </span>
                </span>
                <p className="m-0 line-clamp-3 min-w-0 text-xs leading-[1.6] text-[var(--premium-muted)] [overflow-wrap:anywhere]">
                  {stripEmTags(chunk.content ?? chunk.snippet ?? "")}
                </p>
              </button>
            );
          })}
        </div>
        <div className="mt-3.5 grid gap-2">
          {item.previewUrl ? (
            <a
              href={item.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-[13px] font-black text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white"
            >
              打开原始文件
              <ExternalLink size={16} />
            </a>
          ) : null}
          {from !== "library" && item.assetId ? (
            <button
              type="button"
              onClick={() => onContinueWithAsset(item)}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full border-0 bg-[var(--premium-ink)] px-4 text-[13px] font-black text-[var(--premium-bg)] shadow-[0_16px_38px_rgba(16,18,20,0.2)]"
            >
              <MessageCircle size={16} />
              {from === "search" ? "在此资料中继续搜索" : "向此资料继续提问"}
            </button>
          ) : null}
        </div>
      </SidePanel>

      <section className={`${styles.reveal} rounded-[8px] border border-white/10 bg-[#101214]/95 p-4 text-white shadow-[var(--premium-tight-shadow)]`}>
        <PanelLabel label="TRACE QUALITY" value="SYNCED" dark />
        <div className="mt-3.5 flex items-end justify-between gap-4">
          <strong className="text-[clamp(38px,5vw,68px)] font-black leading-[0.88]">91%</strong>
          <span className="text-xs leading-[1.6] text-white/65">
            bbox、页码、片段上下文和返回状态综合评分。
          </span>
        </div>
        <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-white/10">
          <i className={`${styles.meterFill} block h-full rounded-[inherit] bg-gradient-to-r from-amber-400 to-lime-300`} />
        </div>
      </section>
      </div>
    </aside>
  );
}

function SidePanel({ children }: { children: ReactNode }) {
  return (
    <section className={`${styles.reveal} preview-premium-side-panel min-w-0 overflow-hidden rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] p-4 shadow-[var(--premium-tight-shadow)] backdrop-blur-xl`}>
      {children}
    </section>
  );
}

function PanelLabel({ label, value, dark = false }: { label: string; value: string; dark?: boolean }) {
  return (
    <p className={[
      "m-0 flex min-w-0 items-center justify-between gap-3 text-xs font-black",
      dark ? "text-white/65" : "text-[var(--premium-muted)]",
    ].join(" ")}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0">{value}</span>
    </p>
  );
}

function PreviewState({ label }: { label: string }) {
  return (
    <div className="grid min-h-[calc(100vh-112px)] place-items-center p-6 lg:min-h-[calc(100vh-160px)]">
      <div className="premium-surface grid min-h-40 w-full max-w-[420px] place-items-center rounded-[8px] p-6 text-center">
        <Loader2 className="animate-spin text-[var(--premium-blue)]" size={26} />
        <p className="mt-3 text-sm font-black text-[var(--premium-ink-soft)]">{label}</p>
      </div>
    </div>
  );
}

function PreviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[calc(100vh-112px)] place-items-center p-6 lg:min-h-[calc(100vh-160px)]">
      <div className="premium-surface w-full max-w-[460px] rounded-[8px] p-6 text-center">
        <h2 className="text-lg font-black text-[var(--premium-ink)]">预览加载失败</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--premium-ink)] px-4 text-sm font-black text-[var(--premium-bg)]"
        >
          重试
        </button>
      </div>
    </div>
  );
}

function getPreviewFrameSize(scroller: HTMLElement) {
  const computedStyles = window.getComputedStyle(scroller);
  const horizontalPadding = parseFloat(computedStyles.paddingLeft) + parseFloat(computedStyles.paddingRight);
  const verticalPadding = parseFloat(computedStyles.paddingTop) + parseFloat(computedStyles.paddingBottom);
  return {
    width: Math.max(0, scroller.clientWidth - horizontalPadding),
    height: Math.max(0, scroller.clientHeight - verticalPadding),
  };
}

function PdfPreview({
  item,
  pageNo,
  scale,
  citationIndex,
  contextHighlight,
  onPageCountChange,
  onPageNoChange,
  onPageSizeChange,
  onDocumentChange,
}: {
  item: PreviewSegment;
  pageNo: number;
  scale: number;
  citationIndex: number;
  contextHighlight: TransientBBoxHighlight | null;
  onPageCountChange: (count: number) => void;
  onPageNoChange: (pageNo: number) => void;
  onPageSizeChange: (size: PdfPageSize | null) => void;
  onDocumentChange: (doc: PdfDocumentProxy | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [pageSize, setPageSize] = useState<PdfPageSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    if (!item.previewUrl) {
      return;
    }

    let cancelled = false;
    const resetFrame = window.requestAnimationFrame(() => {
      if (!cancelled) {
        setError(null);
        setPdfDoc(null);
        setPageSize(null);
        onPageSizeChange(null);
      }
    });
    const loadingTask = pdfjsLib.getDocument({ url: item.previewUrl });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          void (doc as { destroy?: () => void | Promise<void> }).destroy?.();
          return;
        }
        setPdfDoc(doc);
        onDocumentChange(doc);
        onPageCountChange(doc.numPages);
        const targetPageNo = item.anchor?.pageNo ?? 1;
        if (targetPageNo < 1 || targetPageNo > doc.numPages) {
          onPageNoChange(Math.min(Math.max(targetPageNo, 1), doc.numPages));
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "PDF 加载失败");
        }
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(resetFrame);
      onDocumentChange(null);
      loadingTask.destroy();
    };
  }, [item.anchor?.pageNo, item.previewUrl, onDocumentChange, onPageCountChange, onPageNoChange, onPageSizeChange]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;
    setIsRendering(true);

    pdfDoc.getPage(pageNo)
      .then((page) => {
        if (cancelled) {
          return null;
        }
        const renderTarget = renderPdfPage(page, canvasRef.current, scale);
        renderTask = renderTarget.renderTask;
        return renderTarget.promise;
      })
      .then((size) => {
        if (!cancelled && size) {
          setPageSize(size);
          onPageSizeChange(size);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled && !isPdfRenderingCancelled(nextError)) {
          setError(nextError instanceof Error ? nextError.message : "PDF 渲染失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRendering(false);
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [onPageSizeChange, pageNo, pdfDoc, scale]);

  if (error) {
    return <ErrorBlock message={error} />;
  }

  return (
    <div className={`${styles.reveal} mx-auto w-fit`}>
      <div className="relative overflow-hidden rounded-[8px] border border-black/10 bg-white shadow-[0_28px_90px_rgba(16,18,20,0.18)]">
        <canvas ref={canvasRef} className="block bg-white" />
        {pageSize ? (
          <BBoxOverlay
            key={contextHighlight ? `context-${contextHighlight.id}` : "citation"}
            records={contextHighlight?.records ?? item.anchor?.bbox ?? []}
            pageNo={pageNo}
            pageWidthPt={pageSize.widthPt}
            pageHeightPt={pageSize.heightPt}
            renderedWidth={pageSize.width}
            renderedHeight={pageSize.height}
            citationIndex={citationIndex}
            variant={contextHighlight ? "context" : "citation"}
          />
        ) : null}
        {isRendering ? (
          <div className="absolute inset-0 grid place-items-center bg-white/55 text-slate-500">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PdfThumbnail({ pdfDoc, pageNo, isActive }: { pdfDoc: PdfDocumentProxy | null; pageNo: number; isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ block: "nearest" });
      setShouldRender(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isActive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || shouldRender) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px 0px" },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [shouldRender]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !shouldRender) {
      return;
    }

    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;
    setHasError(false);
    setIsRendering(true);

    pdfDoc.getPage(pageNo)
      .then((page) => {
        if (cancelled) {
          return null;
        }

        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(80 / viewport.width, 116 / viewport.height);
        const renderTarget = renderPdfPage(page, canvasRef.current, scale);
        renderTask = renderTarget.renderTask;
        return renderTarget.promise;
      })
      .catch((nextError: unknown) => {
        if (!cancelled && !isPdfRenderingCancelled(nextError)) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRendering(false);
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageNo, shouldRender]);

  return (
    <div ref={containerRef} className="relative grid h-full w-full place-items-center">
      {!pdfDoc || hasError || !shouldRender ? <FileText size={18} /> : null}
      <canvas
        ref={canvasRef}
        className={["bg-white", !pdfDoc || hasError || !shouldRender ? "hidden" : "block"].join(" ")}
      />
      {isRendering && shouldRender ? (
        <div className="absolute inset-0 grid place-items-center bg-white/60">
          <Loader2 className="animate-spin" size={16} />
        </div>
      ) : null}
    </div>
  );
}

function renderPdfPage(page: PdfPageProxy, canvas: HTMLCanvasElement | null, scale: number) {
  if (!canvas) {
    throw new Error("Canvas is unavailable");
  }

  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context is unavailable");
  }

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();

  const renderTask = page.render({ canvas, canvasContext: context, viewport });
  const [x1, y1, x2, y2] = page.view;
  const size = {
    width: viewport.width,
    height: viewport.height,
    widthPt: Math.abs(x2 - x1),
    heightPt: Math.abs(y2 - y1),
  };

  return {
    renderTask,
    promise: renderTask.promise.then(() => size),
  };
}

function ImagePreview({
  item,
  citationIndex,
  contextHighlight,
}: {
  item: PreviewSegment;
  citationIndex: number;
  contextHighlight: TransientBBoxHighlight | null;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<{
    naturalWidth: number;
    naturalHeight: number;
    renderedWidth: number;
    renderedHeight: number;
  } | null>(null);

  const updateSize = () => {
    const image = imageRef.current;
    if (!image) {
      return;
    }

    setImageSize({
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedWidth: image.clientWidth,
      renderedHeight: image.clientHeight,
    });
  };

  return (
    <div className={`${styles.reveal} mx-auto w-fit`}>
      <div className="relative overflow-hidden rounded-[8px] border border-black/10 bg-white shadow-[0_28px_90px_rgba(16,18,20,0.18)]">
        {/* A signed preview URL cannot be routed through the Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={item.previewUrl}
          alt={item.fileName ?? "预览图片"}
          className="block max-h-[calc(100vh-300px)] max-w-full"
          onLoad={updateSize}
        />
        {imageSize ? (
          <BBoxOverlay
            key={contextHighlight ? `context-${contextHighlight.id}` : "citation"}
            records={contextHighlight?.records ?? item.anchor?.bbox ?? []}
            pageNo={item.anchor?.pageNo ?? 1}
            pageWidthPt={item.anchor?.imageWidth ?? imageSize.naturalWidth}
            pageHeightPt={item.anchor?.imageHeight ?? imageSize.naturalHeight}
            renderedWidth={imageSize.renderedWidth}
            renderedHeight={imageSize.renderedHeight}
            citationIndex={citationIndex}
            variant={contextHighlight ? "context" : "citation"}
          />
        ) : null}
      </div>
    </div>
  );
}

function BBoxOverlay({
  records,
  pageNo,
  pageWidthPt,
  pageHeightPt,
  renderedWidth,
  renderedHeight,
  citationIndex,
  variant = "citation",
}: {
  records: PreviewBBoxRecord[];
  pageNo: number;
  pageWidthPt: number;
  pageHeightPt: number;
  renderedWidth: number;
  renderedHeight: number;
  citationIndex: number;
  variant?: "citation" | "context";
}) {
  const scaleX = renderedWidth / pageWidthPt;
  const scaleY = renderedHeight / pageHeightPt;
  const rects = records
    .filter((record) => record.bbox && (!record.pageNo || record.pageNo === pageNo))
    .map((record) => bboxToRect(record.bbox as PreviewBBox, pageHeightPt, scaleX, scaleY));

  return (
    <div className="pointer-events-none absolute inset-0">
      {rects.map((rect, index) => (
        <div
          key={`${rect.left}-${rect.top}-${index}`}
          className={[
            variant === "context" ? styles.contextHighlight : styles.highlight,
            "absolute rounded-[8px] border-2",
            variant === "context"
              ? "border-blue-500 bg-blue-400/15"
              : "border-amber-400 bg-amber-300/15",
          ].join(" ")}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        >
          {variant === "citation" && index === 0 ? (
            <span className="absolute -right-4 -top-4 grid size-[34px] place-items-center rounded-[8px] bg-amber-400 text-sm font-black text-[#1c1400] shadow-[0_14px_32px_rgba(123,76,0,0.28)]">
              {citationIndex}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TextPreview({ item, citationIndex }: { item: PreviewSegment; citationIndex: number }) {
  const chunks = item.surroundingChunks?.length
    ? item.surroundingChunks
    : [{
        segmentId: item.segmentId,
        content: item.snippet || item.ocrSummary || item.title || "当前片段暂无可展示文本。",
        title: item.title,
        relation: "current",
        pageNo: item.anchor?.pageNo,
      }];

  return (
    <article className={`${styles.reveal} mx-auto min-h-[820px] w-full max-w-[760px] overflow-hidden rounded-[8px] border border-black/10 bg-white shadow-[0_28px_90px_rgba(16,18,20,0.18)]`}>
      <header className="grid grid-cols-[1fr_auto] items-start gap-5 border-b border-black/10 px-[52px] pb-6 pt-12 max-[500px]:grid-cols-1 max-[860px]:px-6">
        <h2 className="m-0 text-[clamp(30px,4vw,62px)] font-black leading-[0.95] text-[#101214]">
          {item.title ?? item.fileName ?? "文档片段"}
        </h2>
        <span className="rounded-full bg-blue-600/10 px-2.5 py-2 text-xs font-black text-blue-800">
          {item.anchor?.pageNo ? `PAGE ${item.anchor.pageNo}` : item.previewType ?? item.assetType ?? "TEXT"}
        </span>
      </header>
      <div className="grid gap-[22px] px-[52px] pb-[58px] pt-[34px] text-[15px] leading-[1.9] text-[#3a424b] max-[860px]:px-6">
        {chunks.map((chunk, index) => {
          const isCurrent = chunk.relation === "current" || chunk.segmentId === item.segmentId;
          return isCurrent ? (
            <div
              key={`${chunk.segmentId}-${chunk.relation ?? index}-${index}`}
              data-preview-segment-id={chunk.segmentId}
              className={`${styles.highlight} relative rounded-[8px] border-2 border-amber-400 bg-amber-300/10 p-[18px] text-[#101214]`}
            >
              <span className="absolute -right-4 -top-4 grid size-[34px] place-items-center rounded-[8px] bg-amber-400 font-black text-[#1c1400]">
                {citationIndex}
              </span>
              {renderEmText(chunk.content ?? chunk.snippet ?? "")}
            </div>
          ) : (
            <p
              key={`${chunk.segmentId}-${chunk.relation ?? index}-${index}`}
              data-preview-segment-id={chunk.segmentId}
              className="m-0"
            >
              {renderEmText(chunk.content ?? chunk.snippet ?? "")}
            </p>
          );
        })}
      </div>
    </article>
  );
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-[38px] min-h-[38px] place-items-center rounded-full border border-transparent bg-transparent text-[var(--premium-muted)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-2.5 text-[13px] text-[var(--premium-muted)] max-[500px]:grid-cols-1">
      <span>{label}</span>
      <strong className="truncate text-[var(--premium-ink)]">{value}</strong>
    </div>
  );
}

function bboxToRect(bbox: PreviewBBox, pageHeightPt: number, scaleX: number, scaleY: number) {
  const origin = String(bbox.coordOrigin ?? bbox.coord_origin ?? "BOTTOMLEFT").replace(/[_-]/g, "").toUpperCase();
  const x1 = bbox.l;
  const x2 = bbox.r;
  const y1 = origin === "TOPLEFT" ? bbox.t : pageHeightPt - bbox.t;
  const y2 = origin === "TOPLEFT" ? bbox.b : pageHeightPt - bbox.b;
  const left = Math.min(x1, x2) * scaleX;
  const right = Math.max(x1, x2) * scaleX;
  const top = Math.min(y1, y2) * scaleY;
  const bottom = Math.max(y1, y2) * scaleY;

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function renderEmText(text: string) {
  const parts = text.split(/(<em>.*?<\/em>)/gi);

  return parts.map((part, index) => {
    const match = part.match(/^<em>(.*?)<\/em>$/i);
    if (!match) {
      return <span key={index}>{part}</span>;
    }

    return (
      <mark key={index} className="rounded-[4px] bg-amber-200 px-1 text-[#101214]">
        {match[1]}
      </mark>
    );
  });
}

function stripEmTags(text: string) {
  return text.replace(/<\/?em>/gi, "");
}

function relationLabel(relation?: string) {
  if (relation === "previous") return "上文";
  if (relation === "next") return "下文";
  if (relation === "current") return "当前片段";
  return "上下文";
}

function formatCitationPosition(citationIndex: number, item?: PreviewSegment) {
  const title = item?.title ? `（${item.title}）` : "";
  return `段落 ${citationIndex}${title}`;
}

function clampScale(scale: number, minScale = MIN_PDF_SCALE) {
  return Math.min(MAX_PDF_SCALE, Math.max(minScale, Number(scale.toFixed(2))));
}

function isPdfRenderingCancelled(error: unknown) {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function getPreviewType(item: PreviewSegment) {
  const rawType = `${item.previewType ?? item.assetType ?? ""}`.trim().toUpperCase();
  const fileName = item.fileName?.toLowerCase() ?? "";

  if (rawType === "PDF" || rawType === "APPLICATION/PDF" || fileName.endsWith(".pdf")) {
    return "PDF";
  }

  if (
    rawType === "IMAGE"
    || rawType.startsWith("IMAGE/")
    || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(fileName)
  ) {
    return "IMAGE";
  }

  return rawType || "TEXT";
}
