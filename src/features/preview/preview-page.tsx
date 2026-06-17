"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileImage,
  FileText,
  Loader2,
  Maximize2,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Sparkles,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import { readPreviewNavigation, type PreviewNavigationContext } from "@/lib/preview-context";
import type { PreviewBBox, PreviewBBoxRecord, PreviewSegment } from "@/lib/types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy["getPage"]>>;
type PdfPageSize = { width: number; height: number; widthPt: number; heightPt: number };
type PdfRenderTask = ReturnType<PdfPageProxy["render"]>;
type PdfFitMode = "frame" | "manual";

const DEFAULT_PDF_SCALE = 1.15;
const MIN_PDF_SCALE = 0.55;
const MAX_PDF_SCALE = 2.2;

export function PreviewPage({ segmentId }: { segmentId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const decodedSegmentId = useMemo(() => decodeURIComponent(segmentId), [segmentId]);
  const from = searchParams.get("from") === "search" ? "search" : "ask";
  const contextKey = searchParams.get("contextKey");
  const citationIndexFromUrl = Number(searchParams.get("citationIndex") ?? "");
  const context = useMemo(() => readPreviewNavigation(contextKey), [contextKey]);

  const previewQuery = useQuery({
    queryKey: ["preview", decodedSegmentId],
    queryFn: () => apiClient.previewSegment(decodedSegmentId),
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiClient.refreshSegmentPreview(decodedSegmentId),
    onSuccess: (data) => {
      previewQuery.refetch();
      return data;
    },
  });

  const item = refreshMutation.data ?? previewQuery.data;
  const citationIndex = citationIndexFromUrl || item?.citationContext?.citationIndex || 1;
  const returnLabel = from === "search" ? "返回搜索结果" : "返回回答";

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push(from === "search" ? "/search" : "/ask");
  };

  return (
    <div className="min-h-[calc(100vh-68px)] px-4 pb-8 sm:px-6 lg:min-h-[calc(100vh-82px)] lg:px-10 lg:pb-10">
      <div className="mx-auto flex h-full max-w-[1440px] flex-col">
        <nav className="mb-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Link href={from === "search" ? "/search" : "/ask"} className="hover:text-slate-900 dark:hover:text-slate-100">
            {from === "search" ? "Search" : "Ask"}
          </Link>
          <span>/</span>
          <span>引用来源</span>
          <span>/</span>
          <span className="text-slate-900 dark:text-slate-100">预览</span>
        </nav>

        <div className="grid min-h-[720px] flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="panel preview-panel flex min-h-[720px] min-w-0 flex-col overflow-hidden">
            <div className="grid min-h-[76px] shrink-0 grid-cols-1 border-b border-[var(--line)] bg-[var(--surface)] dark:border-[var(--line)] lg:grid-cols-[174px_minmax(0,1fr)]">
              <div className="flex items-center border-b border-[var(--line)] px-5 dark:border-[var(--line)] lg:border-b-0 lg:border-r">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
                >
                  <ChevronLeft size={17} />
                  {returnLabel}
                </button>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-4 px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <AssetIcon type={item?.previewType ?? item?.assetType} />
                  <div className="min-w-0">
                    <h1 className="truncate text-[17px] font-semibold text-slate-950 dark:text-slate-100">
                      {item?.fileName ?? "引用预览"}
                    </h1>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{item?.title ?? decodedSegmentId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <IconButton label="收藏">
                    <Star size={18} />
                  </IconButton>
                  <IconButton label="更多">
                    <MoreHorizontal size={19} />
                  </IconButton>
                </div>
              </div>
            </div>

            {previewQuery.isLoading ? (
              <div className="p-5">
                <LoadingBlock label="正在加载预览" />
              </div>
            ) : null}
            {previewQuery.isError ? (
              <div className="p-5">
                <ErrorBlock message={(previewQuery.error as Error).message} onRetry={() => previewQuery.refetch()} />
              </div>
            ) : null}

            {item ? (
              <PreviewWorkspace
                item={item}
                citationIndex={citationIndex}
                onRefresh={() => refreshMutation.mutate()}
                isRefreshing={refreshMutation.isPending}
              />
            ) : null}
          </section>

          <CitationPanel
            item={item}
            context={context}
            citationIndex={citationIndex}
            from={from}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewWorkspace({
  item,
  citationIndex,
  onRefresh,
  isRefreshing,
}: {
  item: PreviewSegment;
  citationIndex: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const previewType = getPreviewType(item);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const [pdfPage, setPdfPage] = useState(item.anchor?.pageNo ?? 1);
  const [pdfScale, setPdfScale] = useState(DEFAULT_PDF_SCALE);
  const [pdfFitMode, setPdfFitMode] = useState<PdfFitMode>("frame");
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [previewFrameSize, setPreviewFrameSize] = useState({ width: 0, height: 0 });

  const pageNumbers = useMemo(() => {
    const total = pdfPageCount ?? Math.max(pdfPage, item.anchor?.pageNo ?? 1);
    return Array.from({ length: total }, (_, index) => index + 1);
  }, [item.anchor?.pageNo, pdfPage, pdfPageCount]);

  const getPdfFrameScale = useCallback(() => {
    if (!pdfPageSize || !previewFrameSize.width || !previewFrameSize.height) {
      return DEFAULT_PDF_SCALE;
    }

    return clampScale(Math.max(previewFrameSize.width / pdfPageSize.widthPt, previewFrameSize.height / pdfPageSize.heightPt));
  }, [pdfPageSize, previewFrameSize.height, previewFrameSize.width]);

  useEffect(() => {
    const scroller = previewScrollerRef.current;
    if (!scroller) {
      return;
    }

    const updateFrameSize = () => {
      const nextSize = getPreviewFrameSize(scroller);
      setPreviewFrameSize((size) => (
        Math.abs(size.width - nextSize.width) < 1 && Math.abs(size.height - nextSize.height) < 1 ? size : nextSize
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

  const fitPdfToFrame = useCallback(() => {
    setPdfFitMode("frame");
    setPdfScale(getPdfFrameScale());
  }, [getPdfFrameScale]);

  useEffect(() => {
    if (previewType !== "PDF" || pdfFitMode !== "frame") {
      return;
    }

    const nextScale = getPdfFrameScale();
    setPdfScale((scale) => (Math.abs(scale - nextScale) < 0.01 ? scale : nextScale));
  }, [getPdfFrameScale, pdfFitMode, previewType]);

  const toggleFullscreen = useCallback(() => {
    const shell = previewShellRef.current;
    if (!shell) {
      return;
    }

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }

    shell.requestFullscreen().catch(() => undefined);
  }, []);

  return (
    <div
      ref={previewShellRef}
      className="preview-workspace grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-slate-50 dark:bg-[#0d1117] lg:grid-cols-[154px_minmax(0,1fr)]"
    >
      <aside className="hidden min-h-0 border-r border-[var(--line)] bg-[var(--surface)] p-4 dark:border-[var(--line)] dark:bg-[var(--surface)] lg:block">
        <div className="muted-scrollbar h-full overflow-y-auto pr-1">
          {pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => setPdfPage(page)}
              className="mb-4 block w-full"
              disabled={previewType !== "PDF"}
            >
              <div className={[
                "mx-auto grid h-[116px] w-[82px] place-items-center overflow-hidden rounded-[7px] border bg-white text-xs text-slate-400 shadow-sm",
                page === pdfPage ? "border-blue-500 ring-2 ring-blue-100 dark:ring-blue-500/20" : "border-slate-200 dark:border-slate-700",
              ].join(" ")}
              >
                {previewType === "PDF" ? <PdfThumbnail pdfDoc={pdfDoc} pageNo={page} isActive={page === pdfPage} /> : <FileText size={18} />}
              </div>
              <div className={[
                "mx-auto mt-2 grid h-6 min-w-6 place-items-center rounded-[6px] px-1 text-xs",
                page === pdfPage ? "bg-blue-600 font-semibold text-white" : "text-slate-500 dark:text-slate-400",
              ].join(" ")}
              >
                {page}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex min-h-[64px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-5 dark:border-[var(--line)] dark:bg-[var(--surface)]">
          <div className="flex items-center gap-2">
            <IconButton label="上一页" disabled={previewType !== "PDF" || pdfPage <= 1} onClick={() => setPdfPage((page) => Math.max(1, page - 1))}>
              <ChevronLeft size={17} />
            </IconButton>
            <div className="inline-flex h-9 items-center rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-slate-700 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200">
              {previewType === "PDF" ? `${pdfPage} / ${pdfPageCount ?? "-"}` : item.anchor?.pageNo ? `第 ${item.anchor.pageNo} 页` : "预览"}
            </div>
            <IconButton label="下一页" disabled={previewType !== "PDF" || (pdfPageCount !== null && pdfPage >= pdfPageCount)} onClick={() => setPdfPage((page) => Math.min(pdfPageCount ?? page + 1, page + 1))}>
              <ChevronRight size={17} />
            </IconButton>
          </div>

          <div className="flex items-center gap-2">
            <IconButton
              label="缩小"
              disabled={previewType !== "PDF"}
              onClick={() => {
                setPdfFitMode("manual");
                setPdfScale((scale) => clampScale(scale - 0.1));
              }}
            >
              <Minus size={16} />
            </IconButton>
            <span className="w-14 text-center text-sm font-medium text-slate-700 dark:text-slate-200">{Math.round(pdfScale * 100)}%</span>
            <IconButton
              label="放大"
              disabled={previewType !== "PDF"}
              onClick={() => {
                setPdfFitMode("manual");
                setPdfScale((scale) => clampScale(scale + 0.1));
              }}
            >
              <Plus size={16} />
            </IconButton>
            <button
              type="button"
              disabled={previewType !== "PDF"}
              onClick={fitPdfToFrame}
              className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-slate-700 hover:bg-[var(--surface-hover)] disabled:opacity-50 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
            >
              铺满
              <ChevronDown size={15} />
            </button>
            <IconButton label="刷新预览地址" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
            </IconButton>
            <IconButton label="全屏" onClick={toggleFullscreen}>
              <Maximize2 size={17} />
            </IconButton>
          </div>
        </div>

        <div ref={previewScrollerRef} className="muted-scrollbar min-h-0 flex-1 overflow-auto bg-slate-50 p-5 dark:bg-[#0d1117] lg:p-8">
          {previewType === "PDF" && item.previewUrl ? (
            <PdfPreview
              item={item}
              pageNo={pdfPage}
              scale={pdfScale}
              citationIndex={citationIndex}
              onPageCountChange={setPdfPageCount}
              onPageNoChange={setPdfPage}
              onPageSizeChange={setPdfPageSize}
              onDocumentChange={setPdfDoc}
            />
          ) : previewType === "IMAGE" && item.previewUrl ? (
            <ImagePreview item={item} citationIndex={citationIndex} />
          ) : (
            <TextPreview item={item} citationIndex={citationIndex} />
          )}
        </div>
      </main>
    </div>
  );
}

function getPreviewFrameSize(scroller: HTMLElement) {
    const styles = window.getComputedStyle(scroller);
    const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
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
  onPageCountChange,
  onPageNoChange,
  onPageSizeChange,
  onDocumentChange,
}: {
  item: PreviewSegment;
  pageNo: number;
  scale: number;
  citationIndex: number;
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
    window.requestAnimationFrame(() => {
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
          (doc as { destroy?: () => void | Promise<void> }).destroy?.();
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
  }, [onPageSizeChange, pdfDoc, pageNo, scale]);

  if (error) {
    return <ErrorBlock message={error} />;
  }

  return (
    <div className="mx-auto w-fit">
      <div className="relative bg-white shadow-[0_18px_48px_rgba(15,23,42,0.12)]">
        <canvas ref={canvasRef} className="block bg-white" />
        {pageSize ? (
          <BBoxOverlay
            records={item.anchor?.bbox ?? []}
            pageNo={pageNo}
            pageWidthPt={pageSize.widthPt}
            pageHeightPt={pageSize.heightPt}
            renderedWidth={pageSize.width}
            renderedHeight={pageSize.height}
            citationIndex={citationIndex}
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
    if (isActive) {
      containerRef.current?.scrollIntoView({ block: "nearest" });
      setShouldRender(true);
    }
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
        const scale = Math.min(74 / viewport.width, 106 / viewport.height);
        const renderTarget = renderPdfPage(page, canvasRef.current, scale);
        renderTask = renderTarget.renderTask;
        return renderTarget.promise;
      })
      .catch((error: unknown) => {
        if (!cancelled && !isPdfRenderingCancelled(error)) {
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
      <canvas ref={canvasRef} className={["bg-white", !pdfDoc || hasError || !shouldRender ? "hidden" : "block"].join(" ")} />
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

function ImagePreview({ item, citationIndex }: { item: PreviewSegment; citationIndex: number }) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<{ naturalWidth: number; naturalHeight: number; renderedWidth: number; renderedHeight: number } | null>(null);

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
    <div className="mx-auto w-fit">
      <div className="relative overflow-hidden bg-white shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:bg-slate-950">
        <img
          ref={imageRef}
          src={item.previewUrl}
          alt={item.fileName ?? "预览图片"}
          className="block max-h-[calc(100vh-340px)] max-w-full"
          onLoad={updateSize}
        />
        {imageSize ? (
          <BBoxOverlay
            records={item.anchor?.bbox ?? []}
            pageNo={item.anchor?.pageNo ?? 1}
            pageWidthPt={item.anchor?.imageWidth ?? imageSize.naturalWidth}
            pageHeightPt={item.anchor?.imageHeight ?? imageSize.naturalHeight}
            renderedWidth={imageSize.renderedWidth}
            renderedHeight={imageSize.renderedHeight}
            citationIndex={citationIndex}
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
}: {
  records: PreviewBBoxRecord[];
  pageNo: number;
  pageWidthPt: number;
  pageHeightPt: number;
  renderedWidth: number;
  renderedHeight: number;
  citationIndex: number;
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
          className="absolute rounded-[6px] border-2 border-amber-400 bg-amber-200/20 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        >
          {index === 0 ? (
            <span className="absolute -right-7 -top-3 grid size-6 place-items-center rounded-[6px] bg-amber-500 text-xs font-bold text-white shadow">
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
    <article className="mx-auto min-h-full max-w-[760px] bg-white px-6 py-7 shadow-[0_18px_48px_rgba(15,23,42,0.08)] dark:bg-slate-950 sm:px-12 sm:py-10">
      <header className="mb-8 flex items-center justify-between border-b border-slate-300 pb-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
        <span className="truncate">{item.title ?? item.fileName ?? "文档片段"}</span>
        <span>{item.anchor?.pageNo ? `第 ${item.anchor.pageNo} 页` : item.previewType ?? item.assetType ?? "文本"}</span>
      </header>
      <div className="space-y-6 text-[15px] leading-8 text-slate-800 dark:text-slate-200">
        {chunks.map((chunk, index) => {
          const isCurrent = chunk.relation === "current" || chunk.segmentId === item.segmentId;

          return (
            <section
              key={`${chunk.segmentId}-${chunk.relation ?? "chunk"}-${chunk.chunkOrder ?? index}-${index}`}
              className={isCurrent ? "relative rounded-[8px] border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-500/45 dark:bg-amber-500/10" : ""}
            >
              {isCurrent ? (
                <span className="absolute -right-3 -top-3 grid size-6 place-items-center rounded-[6px] bg-amber-500 text-xs font-bold text-white">
                  {citationIndex}
                </span>
              ) : null}
              {chunk.title ? <h2 className="mb-2 text-base font-semibold text-slate-950 dark:text-slate-100">{chunk.title}</h2> : null}
              <p>{renderEmText(chunk.content ?? chunk.snippet ?? "")}</p>
            </section>
          );
        })}
      </div>
    </article>
  );
}

function CitationPanel({
  item,
  context,
  citationIndex,
  from,
}: {
  item?: PreviewSegment;
  context: PreviewNavigationContext | null;
  citationIndex: number;
  from: "ask" | "search";
}) {
  const citations = context?.citations ?? [];
  const currentCitation = citations.find((citation) => citation.citationIndex === citationIndex || citation.segmentId === item?.segmentId);
  const reason = item?.citationContext?.citationReason ?? "该片段命中当前检索或问答引用，可作为原文证据查看。";

  return (
    <aside className="panel h-fit overflow-hidden">
      <div className="border-b border-[var(--line)] p-5 dark:border-[var(--line)]">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-slate-100">
          <Sparkles size={18} className="text-blue-600 dark:text-blue-300" />
          为什么引用这段
        </div>
        <div className="mt-4 rounded-[8px] border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-slate-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-slate-200">
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {currentCitation?.snippet || item?.snippet || item?.ocrSummary || reason}
          </p>
          {context?.question ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">来自你的问题：{context.question}</p>
          ) : (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{from === "search" ? "来自搜索回答" : "来自对话回答"}</p>
          )}
        </div>
      </div>

      <div className="border-b border-[var(--line)] p-5 dark:border-[var(--line)]">
        <div className="text-base font-semibold text-slate-950 dark:text-slate-100">来源信息</div>
        <div className="mt-4 space-y-3 text-sm">
          <InfoRow label="文件名称" value={item?.fileName ?? "-"} />
          <InfoRow label="所属知识库" value={item?.kbName ?? item?.kbId ?? "-"} />
          <InfoRow label="页码" value={item?.anchor?.pageNo ? `第 ${item.anchor.pageNo} 页` : "-"} />
          <InfoRow label="章节" value={item?.title ?? "-"} />
          <InfoRow label="引用位置" value={formatCitationPosition(citationIndex, item)} />
        </div>
      </div>

      {citations.length ? (
        <div className="border-b border-[var(--line)] p-5 dark:border-[var(--line)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-base font-semibold text-slate-950 dark:text-slate-100">本回答中的引用</div>
            <div className="flex gap-2">
              {citations.map((citation, index) => (
                <span
                  key={`${citation.segmentId ?? index}-${index}`}
                  className={[
                    "grid size-7 place-items-center rounded-[6px] text-sm font-semibold",
                    (citation.citationIndex ?? index + 1) === citationIndex
                      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30"
                      : "bg-blue-50 text-blue-600 ring-1 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/25",
                  ].join(" ")}
                >
                  {citation.citationIndex ?? index + 1}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="p-5">
        <div className="text-base font-semibold text-slate-950 dark:text-slate-100">上下文片段</div>
        <div className="mt-4 space-y-3">
          {(item?.surroundingChunks ?? []).map((chunk, index) => {
            const isCurrent = chunk.relation === "current" || chunk.segmentId === item?.segmentId;

            return (
              <div
                key={`${chunk.segmentId}-${chunk.relation ?? "chunk"}-${chunk.chunkOrder ?? index}-${index}`}
                className={[
                  "rounded-[8px] border p-3",
                  isCurrent
                    ? "border-amber-300 bg-amber-50 dark:border-amber-500/35 dark:bg-amber-500/10"
                    : "border-[var(--line)] bg-[var(--surface)] dark:border-[var(--line)] dark:bg-[var(--surface)]",
                ].join(" ")}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className={[
                    "grid size-6 place-items-center rounded-[6px] text-xs font-semibold",
                    isCurrent ? "bg-amber-500 text-white" : "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-200",
                  ].join(" ")}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {chunk.title || relationLabel(chunk.relation)}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {stripEmTags(chunk.content ?? chunk.snippet ?? "")}
                </p>
              </div>
            );
          })}
        </div>

        {item?.previewUrl ? (
          <a
            href={item.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-blue-600 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-200 dark:hover:bg-blue-500/10"
          >
            打开原始文件
            <ExternalLink size={16} />
          </a>
        ) : null}

        <button className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-blue-600 bg-blue-600 text-sm font-medium text-white hover:bg-blue-700">
          <MessageCircle size={16} />
          向此资料继续提问
          <ChevronDown size={16} />
        </button>
      </div>
    </aside>
  );
}

function AssetIcon({ type }: { type?: string }) {
  const normalized = (type ?? "").toUpperCase();

  if (normalized === "IMAGE") {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-200">
        <FileImage size={21} />
      </span>
    );
  }

  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-200">
      <FileText size={21} />
    </span>
  );
}

function IconButton({
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
      className="grid size-9 place-items-center rounded-[8px] text-slate-500 hover:bg-[var(--surface-hover)] disabled:opacity-45 dark:text-slate-300 dark:hover:bg-[var(--surface-hover)]"
    >
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100">{value}</span>
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
      <mark key={index} className="rounded-[4px] bg-yellow-100 px-1 text-slate-950 dark:bg-yellow-500/25 dark:text-yellow-100">
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

function clampScale(scale: number) {
  return Math.min(MAX_PDF_SCALE, Math.max(MIN_PDF_SCALE, Number(scale.toFixed(2))));
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
    rawType === "IMAGE" ||
    rawType.startsWith("IMAGE/") ||
    /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(fileName)
  ) {
    return "IMAGE";
  }

  return rawType;
}
