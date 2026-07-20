"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  FileText,
  Loader2,
  Maximize2,
  MessageCircle,
  Minus,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PremiumRail } from "@/components/app/premium-rail";
import { PremiumHeaderUtilities } from "@/components/app/premium-header-utilities";
import { ErrorBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import {
  saveAskAssetScope,
  saveAssetScopeHandoff,
  saveSearchAssetScope,
  type AssetScope,
} from "@/lib/asset-scope";
import { PREMIUM_THEME, type PremiumThemeMode } from "@/lib/premium-theme";
import { formatDateTime, formatFileSize, statusText } from "@/lib/format";
import { normalizeCitationLabel, parseAssetCitationIndex } from "@/lib/citation-reference";
import {
  buildChunkNavigation,
  buildPreviewRequest,
  clearPreviewRestoreState,
  readPreviewNavigation,
  type PreviewCitation,
  type PreviewNavigationContext,
  type PreviewSource,
} from "@/lib/preview-context";
import type { AssetPreview, CitationChunk, PreviewBBox, PreviewBBoxRecord, PreviewSegment } from "@/lib/types";
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
type PreviewOverflow = { horizontal: boolean; vertical: boolean };

const DEFAULT_PDF_SCALE = 1.23;
const MIN_AUTO_PDF_SCALE = 0.25;
const MIN_PDF_SCALE = 0.55;
const MAX_PDF_SCALE = 2.2;
const PREVIEW_OVERFLOW_TOLERANCE = 2;

function mergePreviewChunk(item: PreviewSegment | undefined, chunk: CitationChunk | undefined) {
  if (!item || !chunk) {
    return item;
  }
  const pageNo = chunk.pageNo ?? chunk.anchor?.pageNo ?? undefined;
  const chunkOrder = chunk.chunkOrder ?? chunk.anchor?.chunkOrder ?? undefined;
  const isInitiallyLoadedSegment = chunk.segmentId === item.segmentId;
  const citationReason = chunk.why?.reason ?? chunk.why?.matchSummary;
  return {
    ...item,
    segmentId: chunk.segmentId,
    title: chunk.title ?? (isInitiallyLoadedSegment ? item.title : undefined),
    content: chunk.content ?? chunk.snippet ?? "",
    anchor: {
      ...item.anchor,
      pageNo,
      chunkOrder,
      bbox: chunk.anchor?.bbox ?? [],
      ...(chunk.anchor?.imageWidth != null ? { imageWidth: chunk.anchor.imageWidth } : {}),
      ...(chunk.anchor?.imageHeight != null ? { imageHeight: chunk.anchor.imageHeight } : {}),
    },
    citationContext: {
      ...item.citationContext,
      citationReason: citationReason
        ?? (isInitiallyLoadedSegment ? item.citationContext?.citationReason : undefined),
    },
  } satisfies PreviewSegment;
}

export function PreviewPremiumPage({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const theme: PremiumThemeMode = PREMIUM_THEME;
  const decodedSegmentId = useMemo(() => decodeURIComponent(segmentId), [segmentId]);
  const fromParam = searchParams.get("from");
  const from: PreviewSource = fromParam === "search"
    ? "search"
    : fromParam === "library"
      ? "library"
      : "ask";
  const contextKey = searchParams.get("contextKey");
  const citationLabelFromUrl = normalizeCitationLabel(searchParams.get("citationIndex"));
  const assetCitationIndexFromUrl = parseAssetCitationIndex(citationLabelFromUrl);
  const context = useMemo(() => readPreviewNavigation(contextKey), [contextKey]);
  const [activeSelection, setActiveSelection] = useState({
    routeSegmentId: decodedSegmentId,
    segmentId: decodedSegmentId,
  });
  const activeSegmentId = activeSelection.routeSegmentId === decodedSegmentId
    ? activeSelection.segmentId
    : decodedSegmentId;
  const previewRequest = useMemo(
    () => buildPreviewRequest({
      source: from,
      segmentId: decodedSegmentId,
      citationIndex: citationLabelFromUrl,
      context,
    }),
    [citationLabelFromUrl, context, decodedSegmentId, from],
  );

  const previewQueryKey = ["preview", decodedSegmentId, from, contextKey, citationLabelFromUrl] as const;
  const previewQuery = useQuery({
    queryKey: previewQueryKey,
    queryFn: () => apiClient.previewSegment(decodedSegmentId, previewRequest),
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiClient.refreshSegmentPreview(decodedSegmentId, previewRequest),
    onSuccess: (refreshedPreview) => {
      queryClient.setQueryData(previewQueryKey, refreshedPreview);
    },
  });

  const item = previewQuery.data;
  const activeCitation = useMemo(() => {
    const citations = context?.citations ?? [];
    return citations.find((citation) => citation.chunks.some((chunk) => chunk.segmentId === activeSegmentId))
      ?? citations.find((citation) => citation.chunks.some((chunk) => chunk.segmentId === decodedSegmentId))
      ?? citations.find((citation) => citation.citationIndex === assetCitationIndexFromUrl);
  }, [activeSegmentId, assetCitationIndexFromUrl, context?.citations, decodedSegmentId]);
  const activeChunk = activeCitation?.chunks.find((chunk) => chunk.segmentId === activeSegmentId);
  const activeItem = useMemo(() => mergePreviewChunk(item, activeChunk), [activeChunk, item]);
  const citationIndex = normalizeCitationLabel(
    activeChunk?.citationLabel
      ?? (activeSegmentId === decodedSegmentId ? citationLabelFromUrl : undefined)
      ?? item?.citationContext?.citationIndex
      ?? String(activeCitation?.citationIndex ?? assetCitationIndexFromUrl),
  );

  const handleCitationSelect = useCallback((chunk: CitationChunk) => {
    if (!chunk.segmentId || chunk.segmentId === activeSegmentId) {
      return;
    }
    setActiveSelection({ routeSegmentId: decodedSegmentId, segmentId: chunk.segmentId });
  }, [activeSegmentId, decodedSegmentId]);

  const handleAssetCitationSelect = useCallback((citation: PreviewCitation) => {
    const targetChunk = citation.chunks[0];
    if (!targetChunk?.segmentId || citation.citationIndex === activeCitation?.citationIndex) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", from);
    params.set("citationIndex", String(citation.citationIndex ?? 1));
    router.push(`/preview/${encodeURIComponent(targetChunk.segmentId)}?${params.toString()}`);
  }, [activeCitation?.citationIndex, from, router, searchParams]);

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
    if (from === "ask") {
      const sessionId = context?.sessionId?.trim();
      router.replace(sessionId ? `/ask?session=${encodeURIComponent(sessionId)}` : "/ask");
      return;
    }
    if (from === "library") clearPreviewRestoreState("library");
    router.replace(from === "search" ? "/search" : "/library");
  };

  return (
    <div
      className="premium-theme ask-premium-page preview-premium-page premium-no-ambient-glow min-h-screen overflow-x-hidden bg-[#f7f7f2] text-[#111315]"
      data-theme={theme}
      data-premium-theme={theme}
    >
      <div
        aria-hidden="true"
        className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(var(--premium-bg-grid)_1px,transparent_1px),linear-gradient(90deg,var(--premium-bg-grid)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]"
      />
      <div className="relative h-screen overflow-hidden p-0">
        <div className="ask-premium-shell grid h-screen min-h-0 overflow-hidden border-0 bg-white/70 shadow-none backdrop-blur-2xl lg:grid-cols-[60px_minmax(0,1fr)]">
          <PremiumRail />

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
            <header className="ask-premium-hero relative grid h-[112px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div
                aria-hidden="true"
                className="ask-premium-watermark pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]"
              >
                PREVIEW
              </div>
              <div className="premium-page-header-content relative z-10 flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="preview-control-action inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3.5 text-xs font-black text-[var(--premium-ink)] shadow-[0_10px_26px_rgba(17,19,21,0.08)] transition hover:-translate-y-0.5"
                >
                  <ChevronLeft size={16} />
                  返回
                </button>
                <section className="min-w-0">
                  <p className="ask-premium-kicker ask-premium-mode-kicker mb-1.5 text-[10px] font-black">
                    PREVIEW / CITATION SOURCE
                  </p>
                  <h1 className="max-w-[900px] truncate text-[clamp(18px,2.6vw,36px)] font-black leading-none text-[var(--premium-ink)]">
                    {activeItem?.fileName ?? "引用预览"}
                  </h1>
                  <p className="mt-1.5 truncate text-[11px] font-bold text-[var(--premium-muted)]">
                    {activeItem?.kbName ?? activeItem?.kbId ?? "知识库"} · 来自{from === "search" ? " Search" : from === "library" ? " Library Recent Citations" : " Ask"} 引用
                  </p>
                </section>
              </div>
              <PremiumHeaderUtilities theme={theme} />
            </header>

            <main className="preview-premium-main min-h-0 min-w-0 overflow-auto bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4))] dark:bg-[#080b09]">
              {previewQuery.isLoading ? (
                <PreviewState label="正在加载预览" />
              ) : previewQuery.isError ? (
                <PreviewError
                  message={(previewQuery.error as Error).message}
                  onRetry={() => void previewQuery.refetch()}
                />
              ) : activeItem ? (
                <PreviewContent
                  item={activeItem}
                  context={context}
                  citationIndex={citationIndex}
                  from={from}
                  onCitationSelect={handleCitationSelect}
                  onAssetCitationSelect={handleAssetCitationSelect}
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

export function AssetPreviewContent({
  asset,
  onRefresh,
  isRefreshing,
}: {
  asset: AssetPreview;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const item = useMemo<PreviewSegment>(() => ({
    segmentId: `asset:${asset.assetId}`,
    assetId: asset.assetId,
    kbId: asset.kbId,
    kbName: asset.kbName ?? undefined,
    assetType: asset.fileType,
    fileName: asset.fileName,
    title: asset.title ?? undefined,
    previewType: asset.previewType || asset.fileType,
    previewUrl: asset.previewUrl ?? undefined,
    thumbnail: asset.thumbnailUrl ?? undefined,
    expiresAt: asset.expiresAt ?? undefined,
  }), [asset]);

  return (
    <PreviewContent
      key={`${asset.assetId}-${asset.previewUrl ?? "no-preview"}`}
      item={item}
      context={null}
      citationIndex="1"
      from="library"
      onCitationSelect={() => undefined}
      onAssetCitationSelect={() => undefined}
      onContinueWithAsset={() => undefined}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      assetDetails={asset}
    />
  );
}

function PreviewContent({
  item,
  context,
  citationIndex,
  from,
  onCitationSelect,
  onAssetCitationSelect,
  onContinueWithAsset,
  onRefresh,
  isRefreshing,
  assetDetails,
}: {
  item: PreviewSegment;
  context: PreviewNavigationContext | null;
  citationIndex: string;
  from: PreviewSource;
  onCitationSelect: (chunk: CitationChunk) => void;
  onAssetCitationSelect: (citation: PreviewCitation) => void;
  onContinueWithAsset: (item: PreviewSegment) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  assetDetails?: AssetPreview;
}) {
  const previewType = getPreviewType(item);
  const visibleCitationIndex = from === "library" ? undefined : citationIndex;
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const [pdfPage, setPdfPage] = useState(item.anchor?.pageNo ?? 1);
  const [pdfScale, setPdfScale] = useState(DEFAULT_PDF_SCALE);
  const [pdfFitMode, setPdfFitMode] = useState<PdfFitMode>("auto");
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [pdfNavigationToken, setPdfNavigationToken] = useState(0);
  const pdfNavigationPageRef = useRef(item.anchor?.pageNo ?? 1);
  const pdfVisiblePageRef = useRef(item.anchor?.pageNo ?? 1);
  const pendingPdfZoomAnchorRef = useRef<{ page: number; x: number; y: number } | null>(null);
  const [previewFrameSize, setPreviewFrameSize] = useState({ width: 0, height: 0 });
  const [previewOverflow, setPreviewOverflow] = useState<PreviewOverflow>({
    horizontal: false,
    vertical: false,
  });

  useLayoutEffect(() => {
    const targetPage = item.anchor?.pageNo ?? 1;
    pdfNavigationPageRef.current = targetPage;
    pdfVisiblePageRef.current = targetPage;
  }, [item.anchor?.pageNo, item.segmentId]);

  const handleChunkSelect = useCallback((chunk: CitationChunk) => {
    const nextPage = chunk.pageNo ?? chunk.anchor?.pageNo;
    if (nextPage) {
      pdfNavigationPageRef.current = nextPage;
      pdfVisiblePageRef.current = nextPage;
      setPdfPage(nextPage);
      setPdfNavigationToken((token) => token + 1);
    }
    onCitationSelect(chunk);
  }, [onCitationSelect]);

  const navigateToPdfPage = useCallback((page: number) => {
    const nextPage = Math.max(1, Math.min(pdfPageCount ?? page, page));
    pdfNavigationPageRef.current = nextPage;
    pdfVisiblePageRef.current = nextPage;
    setPdfPage(nextPage);
    setPdfNavigationToken((token) => token + 1);
  }, [pdfPageCount]);

  const scrollPdfElementIntoView = useCallback((element: HTMLElement, behavior: ScrollBehavior, center = false) => {
    const scroller = previewScrollerRef.current;
    if (!scroller) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const centeredOffset = center ? (scroller.clientHeight - elementRect.height) / 2 : 24;
    scroller.scrollTo({
      top: scroller.scrollTop + elementRect.top - scrollerRect.top - centeredOffset,
      behavior,
    });
  }, []);

  const scrollPdfPageIntoView = useCallback((pageNo: number, behavior: ScrollBehavior) => {
    const page = previewScrollerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${pageNo}"]`);
    if (page) scrollPdfElementIntoView(page, behavior);
  }, [scrollPdfElementIntoView]);

  const capturePdfZoomAnchor = useCallback(() => {
    const scroller = previewScrollerRef.current;
    const page = scroller?.querySelector<HTMLElement>(`[data-pdf-page="${pdfVisiblePageRef.current}"]`);
    if (!scroller || !page) return;

    const rootRect = scroller.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    pendingPdfZoomAnchorRef.current = {
      page: pdfVisiblePageRef.current,
      x: Math.min(1, Math.max(0, (rootRect.left + scroller.clientWidth / 2 - pageRect.left) / pageRect.width)),
      y: Math.min(1, Math.max(0, (rootRect.top + scroller.clientHeight / 2 - pageRect.top) / pageRect.height)),
    };
  }, []);

  const handleVisiblePdfPageChange = useCallback((page: number) => {
    pdfVisiblePageRef.current = page;
    setPdfPage(page);
  }, []);

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

  useEffect(() => {
    if (previewType !== "PDF" || !pdfPageCount) {
      return;
    }

    let bboxObserver: MutationObserver | null = null;
    let observerTimeout: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = pdfNavigationToken === 0 || reduceMotion ? "auto" : "smooth";
      const targetPageNo = pdfNavigationPageRef.current;
      scrollPdfPageIntoView(
        targetPageNo,
        item.anchor?.pageNo === targetPageNo && item.anchor.bbox?.length ? "auto" : behavior,
      );

      if (item.anchor?.pageNo !== targetPageNo || !item.anchor.bbox?.length) return;
      const page = previewScrollerRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${targetPageNo}"]`);
      if (!page) return;

      const focusBBox = () => {
        const bbox = page.querySelector<HTMLElement>("[data-citation-bbox]");
        if (!bbox) return false;
        scrollPdfElementIntoView(bbox, behavior, true);
        return true;
      };
      if (focusBBox()) return;

      bboxObserver = new MutationObserver(() => {
        if (focusBBox()) bboxObserver?.disconnect();
      });
      bboxObserver.observe(page, { childList: true, subtree: true });
      observerTimeout = window.setTimeout(() => bboxObserver?.disconnect(), 4000);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      bboxObserver?.disconnect();
      if (observerTimeout !== null) window.clearTimeout(observerTimeout);
    };
  }, [item.anchor?.bbox, item.anchor?.pageNo, item.segmentId, pdfNavigationToken, pdfPageCount, previewType, scrollPdfElementIntoView, scrollPdfPageIntoView]);

  useEffect(() => {
    if (previewType !== "PDF" || !pendingPdfZoomAnchorRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = pendingPdfZoomAnchorRef.current;
      const scroller = previewScrollerRef.current;
      const page = anchor && scroller?.querySelector<HTMLElement>(`[data-pdf-page="${anchor.page}"]`);
      if (!anchor || !scroller || !page) return;

      const rootRect = scroller.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      scroller.scrollTo({
        top: scroller.scrollTop + pageRect.top + pageRect.height * anchor.y - rootRect.top - scroller.clientHeight / 2,
        left: scroller.scrollLeft + pageRect.left + pageRect.width * anchor.x - rootRect.left - scroller.clientWidth / 2,
        behavior: "auto",
      });
      pendingPdfZoomAnchorRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pdfScale, previewType]);

  useEffect(() => {
    if (previewType !== "PDF" || pdfFitMode === "manual") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const nextScale = pdfFitMode === "width" ? getPdfWidthScale() : getPdfAutoScale();
      if (Math.abs(pdfScale - nextScale) < 0.01) return;
      capturePdfZoomAnchor();
      setPdfScale(nextScale);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [capturePdfZoomAnchor, getPdfAutoScale, getPdfWidthScale, pdfFitMode, pdfScale, previewType]);

  const fitPdfToWidth = useCallback(() => {
    capturePdfZoomAnchor();
    setPdfFitMode("width");
    setPdfScale(getPdfWidthScale());
  }, [capturePdfZoomAnchor, getPdfWidthScale]);

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

  return (
    <div
      ref={previewShellRef}
      className="preview-premium-viewer-shell grid h-full min-h-0 min-w-0 grid-cols-[132px_minmax(0,1fr)_minmax(320px,390px)] overflow-hidden max-[1240px]:h-auto max-[1240px]:min-h-[760px] max-[1240px]:grid-cols-[116px_minmax(0,1fr)] max-[860px]:block max-[860px]:overflow-visible"
    >
      <aside
        aria-label="页面缩略图"
        className="preview-premium-thumbnails grid min-h-0 content-start gap-3.5 overflow-auto border-r border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-4 max-[860px]:grid-flow-col max-[860px]:grid-cols-none max-[860px]:auto-cols-[88px] max-[860px]:overflow-x-auto max-[860px]:border-r-0 max-[860px]:border-b"
      >
        {pageNumbers.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => navigateToPdfPage(page)}
            disabled={previewType !== "PDF"}
            className="grid gap-2 border-0 bg-transparent text-center text-[var(--premium-muted)]"
          >
            <span className={[
              "preview-pdf-thumbnail-frame grid h-[124px] w-[88px] place-items-center overflow-hidden rounded-[8px] border bg-white shadow-[0_12px_28px_rgba(16,18,20,0.10)] transition",
              page === pdfPage
                ? "border-[#5B8CE0] -translate-y-[3px]"
                : "border-[var(--premium-line)] hover:-translate-y-[3px] hover:border-[#5B8CE0]",
            ].join(" ")}
            data-active={page === pdfPage}
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
        className="preview-premium-workspace grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-[rgba(16,18,20,0.04)] dark:bg-[#0a0f0c] max-[860px]:min-h-[760px]"
      >
        <div
          aria-label="预览工具栏"
          className="preview-premium-toolbar flex min-h-16 items-center justify-between gap-3 border-b border-[var(--premium-line)] bg-[var(--premium-panel)] px-4 py-2.5 backdrop-blur-xl max-[860px]:items-start max-[860px]:flex-col"
        >
          <div className="flex flex-wrap items-center gap-2 max-[500px]:w-full max-[500px]:items-stretch max-[500px]:flex-col">
            <ToolButton
              label="上一页"
              disabled={previewType !== "PDF" || pdfPage <= 1}
              onClick={() => navigateToPdfPage(pdfPage - 1)}
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
              onClick={() => navigateToPdfPage(pdfPage + 1)}
            >
              <ChevronRight size={17} />
            </ToolButton>
          </div>

          <div className="flex flex-wrap items-center gap-2 max-[500px]:w-full max-[500px]:items-stretch max-[500px]:flex-col">
            <ToolButton
              label="缩小"
              disabled={previewType !== "PDF"}
              onClick={() => {
                capturePdfZoomAnchor();
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
                capturePdfZoomAnchor();
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
              className="preview-control-action inline-flex min-h-[38px] items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-[13px] font-black text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              铺满
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
              scale={pdfScale}
              scrollRootRef={previewScrollerRef}
              onVisiblePageChange={handleVisiblePdfPageChange}
              onPageCountChange={setPdfPageCount}
              onPageSizeChange={setPdfPageSize}
              onDocumentChange={setPdfDoc}
            />
          ) : previewType === "IMAGE" && item.previewUrl ? (
            <ImagePreview item={item} />
          ) : assetDetails && item.previewUrl ? (
            <AssetTextPreview item={item} />
          ) : (
            <TextPreview item={item} citationIndex={visibleCitationIndex} />
          )}
        </div>
      </section>

      {assetDetails ? (
        <DocumentInfoSidebar asset={assetDetails} />
      ) : (
        <CitationSidebar
          item={item}
          context={context}
          citationIndex={citationIndex}
          from={from}
          onCitationSelect={handleChunkSelect}
          onAssetCitationSelect={onAssetCitationSelect}
          onContinueWithAsset={onContinueWithAsset}
        />
      )}
    </div>
  );
}

function DocumentInfoSidebar({ asset }: { asset: AssetPreview }) {
  return (
    <aside
      aria-label="文档信息"
      className="preview-premium-sidebar min-h-0 min-w-0 overflow-auto border-l border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-4 max-[1240px]:col-span-2 max-[1240px]:overflow-visible max-[1240px]:border-l-0 max-[1240px]:border-t"
    >
      <div className="grid min-w-0 content-start gap-3.5 max-[1240px]:grid-cols-2 max-[860px]:grid-cols-1">
        <SidePanel>
          <PanelLabel label="DOCUMENT INFO" value={asset.fileType || asset.previewType || "FILE"} />
          <div className="mt-3.5 grid gap-2.5">
            <InfoRow label="文件名称" value={asset.fileName} />
            <InfoRow label="文档标题" value={asset.title ?? "-"} />
            <InfoRow label="知识库" value={asset.kbName ?? asset.kbId} />
            <InfoRow label="文件类型" value={asset.fileType || "-"} />
            <InfoRow label="文件大小" value={formatFileSize(asset.sizeBytes ?? undefined)} />
            <InfoRow label="入库时间" value={formatDateTime(asset.createdAt)} />
          </div>
        </SidePanel>

        <SidePanel>
          <PanelLabel label="PROCESSING" value={statusText(asset.indexStatus)} />
          <div className="mt-3.5 grid gap-2.5">
            <InfoRow label="解析状态" value={statusText(asset.parseStatus)} />
            <InfoRow label="索引状态" value={statusText(asset.indexStatus)} />
            <InfoRow label="片段数量" value={String(asset.segmentCount)} />
            <InfoRow label="预览方式" value={asset.previewType || "-"} />
            <InfoRow label="链接到期" value={formatPreviewExpiry(asset.expiresAt)} />
          </div>
          {asset.previewUrl ? (
            <a
              href={asset.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="preview-source-action preview-open-original-action mt-4 inline-flex min-h-[42px] w-full items-center justify-center rounded-full border px-3 text-[13px] font-black transition"
            >
              打开原始文件
            </a>
          ) : null}
        </SidePanel>

      </div>
    </aside>
  );
}

function CitationSidebar({
  item,
  context,
  citationIndex,
  from,
  onCitationSelect,
  onAssetCitationSelect,
  onContinueWithAsset,
}: {
  item: PreviewSegment;
  context: PreviewNavigationContext | null;
  citationIndex: string;
  from: PreviewSource;
  onCitationSelect: (chunk: CitationChunk) => void;
  onAssetCitationSelect: (citation: PreviewCitation) => void;
  onContinueWithAsset: (item: PreviewSegment) => void;
}) {
  const citation = context?.citations?.find((itemCitation) => (
    itemCitation.chunks.some((chunk) => chunk.segmentId === item.segmentId)
  )) ?? context?.citations?.find(
    (itemCitation) => itemCitation.citationIndex === parseAssetCitationIndex(citationIndex),
  );
  const citationNavigation = buildChunkNavigation(citation, item.segmentId);
  const documentChunks = citationNavigation.chunks;
  const currentCitationPosition = citationNavigation.currentPosition;
  const canNavigateCitations = context?.navigationMode === "CITATION"
    && documentChunks.length > 1
    && currentCitationPosition >= 0;
  const previousCitation = canNavigateCitations ? citationNavigation.previous : undefined;
  const nextCitation = canNavigateCitations ? citationNavigation.next : undefined;
  const reason = item.citationContext?.citationReason
    ?? "该片段命中当前检索或问答引用，可作为原文证据查看。";

  return (
    <aside
      aria-label="引用上下文"
      className="preview-premium-sidebar min-h-0 min-w-0 overflow-auto border-l border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-4 max-[1240px]:col-span-2 max-[1240px]:overflow-visible max-[1240px]:border-l-0 max-[1240px]:border-t"
    >
      <div className="grid min-w-0 content-start gap-3.5 max-[1240px]:grid-cols-2 max-[860px]:grid-cols-1">
      <SidePanel>
        <PanelLabel label="WHY THIS CITATION" value={from === "library" ? undefined : `#${citationIndex}`} />
        <div className="mt-3.5 min-w-0 rounded-[8px] p-3.5 text-[13px] leading-[1.7] text-[var(--premium-ink-soft)] [overflow-wrap:anywhere]">
          <b className="text-[var(--premium-ink)] [overflow-wrap:anywhere]">
            {reason}
          </b>
          <p className="mt-2 [overflow-wrap:anywhere]">
            {context?.question
              ? `来自你的问题：“${context.question}”`
              : from === "search"
                ? context?.navigationMode === "CITATION" ? "来自搜索回答引用。" : "来自搜索结果。"
                : from === "library"
                  ? "来自最近引用记录。"
                  : "来自对话回答引用。"}
          </p>
        </div>
      </SidePanel>

      <EvidenceExcerptPanel key={item.segmentId} item={item} />

      <SidePanel>
        <PanelLabel label="SOURCE INFO" value={getPreviewType(item) || "TEXT"} />
        <div className="mt-3.5 grid gap-2.5">
          <InfoRow label="文件名称" value={item.fileName ?? "-"} />
          <InfoRow label="知识库" value={item.kbName ?? item.kbId ?? "-"} />
          <InfoRow label="页码" value={item.anchor?.pageNo ? `第 ${item.anchor.pageNo} 页` : "-"} />
          <InfoRow label="章节" value={item.title ?? "-"} />
          {from !== "library" ? (
            <AssetCitationIndexRow
              citations={context?.citations ?? []}
              currentCitationIndex={parseAssetCitationIndex(citationIndex)}
              onSelect={onAssetCitationSelect}
            />
          ) : null}
        </div>
      </SidePanel>

      {canNavigateCitations ? (
        <SidePanel>
          <PanelLabel
            label="ADJACENT CITATIONS"
            value={`${currentCitationPosition + 1} / ${documentChunks.length}`}
          />
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <CitationNavigationButton
              direction="previous"
              chunk={previousCitation}
              onSelect={onCitationSelect}
            />
            <CitationNavigationButton
              direction="next"
              chunk={nextCitation}
              onSelect={onCitationSelect}
            />
          </div>
        </SidePanel>
      ) : null}

      <SidePanel>
        <PanelLabel label="SOURCE ACTIONS" />
        <div className="mt-3.5 grid gap-2">
          {item.previewUrl ? (
            <a
              href={item.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="preview-source-action preview-open-original-action inline-flex min-h-[42px] items-center justify-center rounded-full border px-3 text-[13px] font-black transition"
            >
              打开原始文件
            </a>
          ) : null}
          {from !== "library" && item.assetId ? (
            <button
              type="button"
              onClick={() => onContinueWithAsset(item)}
              className="preview-source-action preview-source-action-lift-only inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full border px-4 text-[13px] font-black transition"
            >
              {from === "search" ? "在此资料中继续搜索" : "向此资料继续提问"}
              <MessageCircle size={16} />
            </button>
          ) : null}
        </div>
      </SidePanel>

      </div>
    </aside>
  );
}

function EvidenceExcerptPanel({ item }: { item: PreviewSegment }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const evidenceText = (item.content || item.ocrSummary || item.title || "").trim();
  const plainEvidenceText = stripEmTags(evidenceText);
  const pageNo = item.anchor?.pageNo;
  const chunkOrder = item.anchor?.chunkOrder;
  const location = [
    pageNo ? `第 ${pageNo} 页` : null,
    chunkOrder != null ? `Chunk ${chunkOrder}` : null,
  ].filter(Boolean).join(" · ") || "片段证据";
  const canExpand = plainEvidenceText.length > 180;

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plainEvidenceText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <SidePanel>
      <PanelLabel label="EVIDENCE EXCERPT" value={location} />
      {evidenceText ? (
        <>
          <div className={[
            "mt-3.5 text-[13px] leading-[1.75] text-[var(--premium-ink)] [overflow-wrap:anywhere]",
            expanded ? "max-h-80 overflow-auto pr-1" : "line-clamp-5",
          ].join(" ")}
          >
            {renderEmText(evidenceText)}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {canExpand ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-3 text-[11px] font-black text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5"
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {expanded ? "收起原文" : "展开原文"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-3 text-[11px] font-black text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "已复制" : "复制原文"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-3.5 text-[13px] leading-6 text-[var(--premium-ink-soft)]">
          当前片段暂无可展示的文本，仍可通过页码与框选位置核验原文。
        </p>
      )}
    </SidePanel>
  );
}

function CitationNavigationButton({
  direction,
  chunk,
  onSelect,
}: {
  direction: "previous" | "next";
  chunk?: CitationChunk;
  onSelect: (chunk: CitationChunk) => void;
}) {
  const isPrevious = direction === "previous";
  const label = isPrevious ? "上一处引用" : "下一处引用";
  const pageNo = chunk?.pageNo ?? chunk?.anchor?.pageNo;

  return (
    <button
      type="button"
      disabled={!chunk?.segmentId}
      onClick={() => chunk && onSelect(chunk)}
      aria-label={chunk ? label : `没有${label}`}
      className="grid min-h-[112px] min-w-0 content-between gap-2 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-3 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-black text-[#5B8CE0]">
        {isPrevious ? <ChevronLeft size={14} /> : null}
        {label}
        {!isPrevious ? <ChevronRight size={14} /> : null}
      </span>
      {chunk ? (
        <span className="grid min-w-0 gap-1">
          <strong className="truncate text-xs text-[var(--premium-ink)]">
            {stripEmTags(chunk.snippet ?? chunk.content ?? "引用位置")}
          </strong>
          <span className="text-[10px] font-bold text-[var(--premium-muted)]">
            {pageNo ? `第 ${pageNo} 页` : "页码未知"}
          </span>
        </span>
      ) : (
        <span className="text-xs font-bold text-[var(--premium-muted)]">已经到达边界</span>
      )}
    </button>
  );
}

function SidePanel({ children }: { children: ReactNode }) {
  return (
    <section className={`${styles.reveal} preview-premium-side-panel min-w-0 overflow-hidden rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] p-4 shadow-[var(--premium-tight-shadow)] backdrop-blur-xl`}>
      {children}
    </section>
  );
}

function PanelLabel({ label, value }: { label: string; value?: string }) {
  return (
    <p className="m-0 flex min-w-0 items-center justify-between gap-3 text-xs font-black text-[var(--premium-muted)]">
      <span className="min-w-0 truncate">{label}</span>
      {value ? <span className="shrink-0">{value}</span> : null}
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
  scale,
  scrollRootRef,
  onVisiblePageChange,
  onPageCountChange,
  onPageSizeChange,
  onDocumentChange,
}: {
  item: PreviewSegment;
  scale: number;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onVisiblePageChange: (page: number) => void;
  onPageCountChange: (count: number) => void;
  onPageSizeChange: (size: PdfPageSize | null) => void;
  onDocumentChange: (doc: PdfDocumentProxy | null) => void;
}) {
  const pagesRootRef = useRef<HTMLDivElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [basePageSize, setBasePageSize] = useState<{ widthPt: number; heightPt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item.previewUrl) {
      return;
    }

    let cancelled = false;
    const resetFrame = window.requestAnimationFrame(() => {
      if (!cancelled) {
        setError(null);
        setPdfDoc(null);
        setBasePageSize(null);
        onPageSizeChange(null);
      }
    });
    const loadingTask = pdfjsLib.getDocument({ url: item.previewUrl });

    loadingTask.promise
      .then(async (doc) => {
        if (cancelled) {
          void (doc as { destroy?: () => void | Promise<void> }).destroy?.();
          return;
        }
        const firstPage = await doc.getPage(1);
        if (cancelled) return;
        const [x1, y1, x2, y2] = firstPage.view;
        setBasePageSize({ widthPt: Math.abs(x2 - x1), heightPt: Math.abs(y2 - y1) });
        setPdfDoc(doc);
        onDocumentChange(doc);
        onPageCountChange(doc.numPages);
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
  }, [item.previewUrl, onDocumentChange, onPageCountChange, onPageSizeChange]);

  useEffect(() => {
    if (!basePageSize) {
      return;
    }
    onPageSizeChange({
      width: basePageSize.widthPt * scale,
      height: basePageSize.heightPt * scale,
      widthPt: basePageSize.widthPt,
      heightPt: basePageSize.heightPt,
    });
  }, [basePageSize, onPageSizeChange, scale]);

  useEffect(() => {
    const pagesRoot = pagesRootRef.current;
    const scrollRoot = scrollRootRef.current;
    if (!pdfDoc || !pagesRoot || !scrollRoot) return;

    const visibility = new Map<number, { height: number; centerDistance: number }>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const page = Number((entry.target as HTMLElement).dataset.pdfPage);
          if (Number.isFinite(page)) {
            const rootCenter = entry.rootBounds
              ? entry.rootBounds.top + entry.rootBounds.height / 2
              : 0;
            const visibleCenter = entry.intersectionRect.top + entry.intersectionRect.height / 2;
            visibility.set(page, {
              height: entry.isIntersecting ? entry.intersectionRect.height : 0,
              centerDistance: entry.isIntersecting ? Math.abs(visibleCenter - rootCenter) : Number.POSITIVE_INFINITY,
            });
          }
        });

        let visiblePage = 0;
        let bestHeight = 0;
        let bestCenterDistance = Number.POSITIVE_INFINITY;
        visibility.forEach(({ height, centerDistance }, page) => {
          if (height > bestHeight || (height === bestHeight && centerDistance < bestCenterDistance)) {
            bestHeight = height;
            bestCenterDistance = centerDistance;
            visiblePage = page;
          }
        });
        if (visiblePage > 0) onVisiblePageChange(visiblePage);
      },
      { root: scrollRoot, threshold: [0, 0.15, 0.3, 0.5, 0.7, 0.9] },
    );

    pagesRoot.querySelectorAll<HTMLElement>("[data-pdf-page]").forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [onVisiblePageChange, pdfDoc, scrollRootRef]);

  if (error) {
    return <ErrorBlock message={error} />;
  }

  if (!pdfDoc || !basePageSize) {
    return (
      <div className="grid min-h-48 place-items-center text-[var(--premium-muted)]" role="status" aria-label="正在加载 PDF">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const citationPage = item.anchor?.pageNo ?? 1;
  const pages = Array.from({ length: pdfDoc.numPages }, (_, index) => index + 1);

  return (
    <div ref={pagesRootRef} className={`${styles.reveal} grid w-fit min-w-full justify-items-center gap-7 pb-8`}>
      {pages.map((page) => (
        <PdfContinuousPage
          key={page}
          pdfDoc={pdfDoc}
          pageNo={page}
          scale={scale}
          basePageSize={basePageSize}
          scrollRootRef={scrollRootRef}
          segmentId={item.segmentId}
          bboxRecords={(item.anchor?.bbox ?? []).filter((record) => (
            record.pageNo ? record.pageNo === page : page === citationPage
          ))}
        />
      ))}
    </div>
  );
}

function PdfContinuousPage({
  pdfDoc,
  pageNo,
  scale,
  basePageSize,
  scrollRootRef,
  segmentId,
  bboxRecords,
}: {
  pdfDoc: PdfDocumentProxy;
  pageNo: number;
  scale: number;
  basePageSize: { widthPt: number; heightPt: number };
  scrollRootRef: RefObject<HTMLDivElement | null>;
  segmentId: string;
  bboxRecords: PreviewBBoxRecord[];
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [pageSize, setPageSize] = useState<(PdfPageSize & { renderScale: number }) | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [animatedBBoxSegment, setAnimatedBBoxSegment] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => setShouldRender(entry.isIntersecting),
      { root: scrollRootRef.current, rootMargin: "900px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollRootRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shouldRender) {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    if (!canvas) return;

    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;
    setHasError(false);
    setIsRendering(true);

    pdfDoc.getPage(pageNo)
      .then((page) => {
        if (cancelled) return null;
        const renderTarget = renderPdfPage(page, canvas, scale);
        renderTask = renderTarget.renderTask;
        return renderTarget.promise;
      })
      .then((size) => {
        if (!cancelled && size) setPageSize({ ...size, renderScale: scale });
      })
      .catch((nextError: unknown) => {
        if (!cancelled && !isPdfRenderingCancelled(nextError)) setHasError(true);
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNo, pdfDoc, scale, shouldRender]);

  const placeholderWidth = Math.max(1, Math.floor(basePageSize.widthPt * scale));
  const placeholderHeight = Math.max(1, Math.floor(basePageSize.heightPt * scale));
  const shouldAnimateBBox = animatedBBoxSegment !== segmentId;
  const isPageReady = Boolean(
    shouldRender
    && !isRendering
    && pageSize
    && Math.abs(pageSize.renderScale - scale) < 0.001,
  );

  useEffect(() => {
    if (!isPageReady || !bboxRecords.length || !shouldAnimateBBox) return;
    const timeout = window.setTimeout(() => {
      setAnimatedBBoxSegment(segmentId);
    }, 1150);
    return () => window.clearTimeout(timeout);
  }, [bboxRecords.length, isPageReady, segmentId, shouldAnimateBBox]);

  return (
    <section
      ref={containerRef}
      data-pdf-page={pageNo}
      aria-label={`PDF 第 ${pageNo} 页`}
      className="relative scroll-mt-6 overflow-hidden rounded-[8px] border border-black/10 bg-white shadow-[0_28px_90px_rgba(16,18,20,0.16)]"
      style={{
        width: pageSize ? pageSize.widthPt * scale : placeholderWidth,
        minHeight: pageSize ? pageSize.heightPt * scale : placeholderHeight,
      }}
    >
      <canvas ref={canvasRef} className={shouldRender && !hasError ? "preview-pdf-canvas block bg-white" : "hidden"} />
      {isPageReady && pageSize && bboxRecords.length ? (
        <BBoxOverlay
          key={`${segmentId}:${pageNo}`}
          records={bboxRecords}
          pageNo={pageNo}
          pageWidthPt={pageSize.widthPt}
          pageHeightPt={pageSize.heightPt}
          renderedWidth={pageSize.width}
          renderedHeight={pageSize.height}
          animateLock={shouldAnimateBBox}
        />
      ) : null}
      {!shouldRender || isRendering ? (
        <div className="preview-pdf-loading absolute inset-0 grid place-items-center bg-white/70 text-slate-400" aria-hidden="true">
          {shouldRender ? <Loader2 className="animate-spin" size={22} /> : <span className="text-[10px] font-black">PAGE {pageNo}</span>}
        </div>
      ) : null}
      {hasError ? (
        <div className="absolute inset-0 grid place-items-center bg-white text-xs font-bold text-red-600">第 {pageNo} 页渲染失败</div>
      ) : null}
    </section>
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
        className={["preview-pdf-canvas bg-white", !pdfDoc || hasError || !shouldRender ? "hidden" : "block"].join(" ")}
      />
      {isRendering && shouldRender ? (
        <div className="preview-pdf-loading absolute inset-0 grid place-items-center bg-white/60">
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
  const outputScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context is unavailable");
  }

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();

  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  });
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

function ImagePreview({ item }: { item: PreviewSegment }) {
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
            key={`${item.segmentId}:${item.anchor?.pageNo ?? 1}`}
            records={item.anchor?.bbox ?? []}
            pageNo={item.anchor?.pageNo ?? 1}
            pageWidthPt={item.anchor?.imageWidth ?? imageSize.naturalWidth}
            pageHeightPt={item.anchor?.imageHeight ?? imageSize.naturalHeight}
            renderedWidth={imageSize.renderedWidth}
            renderedHeight={imageSize.renderedHeight}
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
  animateLock = true,
}: {
  records: PreviewBBoxRecord[];
  pageNo: number;
  pageWidthPt: number;
  pageHeightPt: number;
  renderedWidth: number;
  renderedHeight: number;
  animateLock?: boolean;
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
          key={index}
          data-citation-bbox={index === 0 ? "" : undefined}
          className={`${animateLock ? styles.bboxLock : styles.bboxStable} absolute rounded-[8px] border-2 border-[#5B8CE0] bg-[rgba(91,140,224,0.1)]`}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
  );
}

function TextPreview({ item, citationIndex }: { item: PreviewSegment; citationIndex?: string }) {
  const content = item.content || item.ocrSummary || item.title || "当前片段暂无可展示文本。";

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
        <div
          data-preview-segment-id={item.segmentId}
          className={`${styles.highlight} relative rounded-[8px] border-2 border-amber-400 bg-amber-300/10 p-[18px] text-[#101214]`}
        >
          {citationIndex != null ? (
            <span className="absolute -right-4 -top-4 grid size-[34px] place-items-center rounded-[8px] bg-amber-400 font-black text-[#1c1400]">
              {citationIndex}
            </span>
          ) : null}
          {renderEmText(content)}
        </div>
      </div>
    </article>
  );
}

function AssetTextPreview({ item }: { item: PreviewSegment }) {
  const textQuery = useQuery({
    queryKey: ["asset-preview", "text", item.assetId, item.previewUrl],
    queryFn: async () => {
      if (!item.previewUrl) return "";
      const response = await fetch(item.previewUrl);
      if (!response.ok) {
        throw new Error(`文件内容加载失败（${response.status}）`);
      }
      return response.text();
    },
    enabled: Boolean(item.previewUrl),
    refetchOnWindowFocus: false,
  });

  if (textQuery.isLoading) {
    return (
      <div className="mx-auto grid min-h-[520px] w-full max-w-[860px] place-items-center rounded-[8px] border border-black/10 bg-white shadow-[0_28px_90px_rgba(16,18,20,0.18)]">
        <Loader2 className="animate-spin text-blue-600" size={26} />
      </div>
    );
  }

  if (textQuery.isError) {
    return <ErrorBlock message={textQuery.error instanceof Error ? textQuery.error.message : "文件内容加载失败"} />;
  }

  return (
    <article className={`${styles.reveal} mx-auto min-h-[820px] w-full max-w-[860px] overflow-hidden rounded-[8px] border border-black/10 bg-white shadow-[0_28px_90px_rgba(16,18,20,0.18)]`}>
      <header className="grid grid-cols-[1fr_auto] items-start gap-5 border-b border-black/10 px-[52px] pb-6 pt-12 max-[500px]:grid-cols-1 max-[860px]:px-6">
        <h2 className="m-0 break-words text-[clamp(30px,4vw,62px)] font-black leading-[0.95] text-[#101214]">
          {item.title ?? item.fileName ?? "文档"}
        </h2>
        <span className="rounded-full bg-blue-600/10 px-3 py-2 text-xs font-black text-blue-800">
          {getPreviewType(item)}
        </span>
      </header>
      <pre className="m-0 whitespace-pre-wrap break-words px-[52px] pb-[58px] pt-[34px] font-mono text-[14px] leading-[1.85] text-[#303841] max-[860px]:px-6">
        {textQuery.data || "当前文档为空。"}
      </pre>
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
      className="preview-control-action grid size-[38px] min-h-[38px] place-items-center rounded-full border border-transparent bg-transparent text-[var(--premium-muted)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
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

function AssetCitationIndexRow({
  citations,
  currentCitationIndex,
  onSelect,
}: {
  citations: PreviewCitation[];
  currentCitationIndex: number;
  onSelect: (citation: PreviewCitation) => void;
}) {
  if (!citations.length) {
    return null;
  }

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap gap-2" aria-label="文档引用导航">
      {citations.map((citation, index) => {
        const value = citation.citationIndex ?? index + 1;
        const isCurrent = value === currentCitationIndex;
        return (
          <button
            key={`${citation.assetId ?? citation.fileName ?? value}-${value}`}
            type="button"
            disabled={isCurrent || !citation.chunks.length}
            onClick={() => onSelect(citation)}
            title={isCurrent ? `当前引用 [${value}]` : `跳转到引用 [${value}] ${citation.fileName ?? ""}`}
            aria-label={isCurrent ? `当前引用 ${value}` : `跳转到引用 ${value}`}
            className={[
              "inline-flex size-[38px] shrink-0 items-center justify-center rounded-[9px] border text-[14px] font-black transition",
              isCurrent
                ? "border-[#5B8CE0] bg-[rgba(91,140,224,0.2)] text-[#5B8CE0] shadow-[inset_0_0_0_1px_rgba(91,140,224,0.14)]"
                : "border-[rgba(91,140,224,0.55)] bg-transparent text-[#5B8CE0] hover:-translate-y-0.5 hover:border-[#5B8CE0] hover:bg-[rgba(91,140,224,0.1)]",
              !citation.chunks.length ? "cursor-not-allowed opacity-45" : "",
            ].join(" ")}
          >
            {value}
          </button>
        );
      })}
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
  return text.replace(/<\/?em\b[^>]*>/gi, "");
}

function formatPreviewExpiry(expiresAt?: number | null) {
  if (!expiresAt) return "-";
  const milliseconds = expiresAt < 10_000_000_000 ? expiresAt * 1000 : expiresAt;
  return formatDateTime(new Date(milliseconds).toISOString());
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
