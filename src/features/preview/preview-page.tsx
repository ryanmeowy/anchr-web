"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Star } from "lucide-react";
import Link from "next/link";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";

export function PreviewPage({ segmentId }: { segmentId: string }) {
  const previewQuery = useQuery({
    queryKey: ["preview", segmentId],
    queryFn: () => apiClient.previewSegment(segmentId),
  });

  const item = previewQuery.data;
  const chunks = item?.surroundingChunks ?? [];

  return (
    <div className="grid grid-cols-[1fr_420px] gap-5 px-8 py-8">
      <section className="panel overflow-hidden">
        <div className="flex h-[76px] items-center justify-between border-b border-slate-200 px-5">
          <div className="flex items-center gap-4">
            <Link href="/ask" className="rounded-[8px] border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              返回回答
            </Link>
            <div>
              <div className="text-lg font-semibold text-slate-950">{item?.fileName ?? "引用预览"}</div>
              <div className="mt-1 text-xs text-slate-500">{segmentId}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <button className="grid size-9 place-items-center rounded-[8px] hover:bg-slate-50" aria-label="收藏">
              <Star size={18} />
            </button>
            <button className="grid size-9 place-items-center rounded-[8px] hover:bg-slate-50" aria-label="全屏">
              <Maximize2 size={18} />
            </button>
          </div>
        </div>

        {previewQuery.isLoading ? <div className="p-5"><LoadingBlock label="正在加载预览" /></div> : null}
        {previewQuery.isError ? (
          <div className="p-5"><ErrorBlock message={(previewQuery.error as Error).message} onRetry={() => previewQuery.refetch()} /></div>
        ) : null}

        {item ? (
          <div className="flex h-[calc(100vh-214px)] bg-slate-50">
            <div className="w-[138px] shrink-0 border-r border-slate-200 bg-white p-4">
              {[10, 11, item.anchor?.pageNo ?? 12, 13, 14].map((page) => (
                <div key={page} className="mb-4">
                  <div className={["mx-auto h-[118px] w-[82px] rounded-[6px] border bg-white", page === item.anchor?.pageNo ? "border-blue-500 shadow" : "border-slate-200"].join(" ")} />
                  <div className={["mt-2 text-center text-xs", page === item.anchor?.pageNo ? "font-semibold text-blue-600" : "text-slate-500"].join(" ")}>
                    {page}
                  </div>
                </div>
              ))}
            </div>

            <div className="muted-scrollbar flex-1 overflow-auto p-8">
              <div className="mx-auto min-h-full max-w-[760px] bg-white px-14 py-10 shadow-sm">
                <div className="mb-8 flex items-center justify-between border-b border-slate-300 pb-3 text-sm font-medium text-slate-700">
                  <span>{item.title ?? item.fileName ?? "文档"}</span>
                  <span>第 {item.anchor?.pageNo ?? "-"} 页</span>
                </div>
                <div className="space-y-6 text-[16px] leading-9 text-slate-900">
                  <h2 className="text-xl font-semibold">{item.title ?? "命中片段"}</h2>
                  <div className="rounded-[8px] border border-amber-300 bg-amber-50 px-5 py-4">
                    {item.snippet || item.ocrSummary || "当前片段暂无可展示文本。"}
                  </div>
                  {chunks.map((chunk) => (
                    <p key={chunk.segmentId} className="text-slate-600">{chunk.content ?? chunk.snippet}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="panel h-fit overflow-hidden">
        <div className="border-b border-slate-200 p-5">
          <div className="text-base font-semibold text-slate-950">为什么引用这段</div>
          <div className="mt-3 rounded-[8px] border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-slate-700">
            {item?.citationContext?.citationReason ?? "该片段与问题中的关键实体和条件匹配，可作为回答证据。"}
          </div>
        </div>

        <div className="border-b border-slate-200 p-5">
          <div className="text-base font-semibold text-slate-950">来源信息</div>
          <div className="mt-4 space-y-3 text-sm">
            <Row label="文件名称" value={item?.fileName ?? "-"} />
            <Row label="知识库" value={item?.kbId ?? "-"} />
            <Row label="页码" value={item?.anchor?.pageNo ? `第 ${item.anchor.pageNo} 页` : "-"} />
            <Row label="片段类型" value={item?.segmentType ?? "-"} />
          </div>
        </div>

        <div className="p-5">
          <div className="text-base font-semibold text-slate-950">上下文片段</div>
          <div className="mt-4 space-y-3">
            {chunks.slice(0, 3).map((chunk, index) => (
              <div key={chunk.segmentId} className="rounded-[8px] border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="grid size-6 place-items-center rounded-[6px] bg-blue-50 text-xs font-semibold text-blue-600">{index + 1}</span>
                  <span className="text-xs text-slate-500">{chunk.pageNo ? `P${chunk.pageNo}` : ""}</span>
                </div>
                <p className="line-clamp-2 text-sm leading-6 text-slate-600">{chunk.content ?? chunk.snippet}</p>
              </div>
            ))}
          </div>
          {item?.previewUrl ? (
            <a
              href={item.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-blue-600 text-sm font-medium text-blue-600 hover:bg-blue-50"
            >
              打开原始预览
              <ExternalLink size={16} />
            </a>
          ) : null}
        </div>

        <div className="flex border-t border-slate-200">
          <button className="flex h-14 flex-1 items-center justify-center gap-2 text-sm font-medium text-blue-600 hover:bg-blue-50">
            <ChevronLeft size={17} />
            上一处
          </button>
          <button className="flex h-14 flex-1 items-center justify-center gap-2 border-l border-slate-200 text-sm font-medium text-blue-600 hover:bg-blue-50">
            下一处
            <ChevronRight size={17} />
          </button>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-900">{value}</span>
    </div>
  );
}
