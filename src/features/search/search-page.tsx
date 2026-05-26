"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Filter, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { KbSelect } from "@/components/ui/kb-select";
import { ErrorBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [kbId, setKbId] = useState("");

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const searchMutation = useMutation({
    mutationFn: () =>
      apiClient.searchKnowledgeBase({
        query: query.trim(),
        kbIds: kbId ? [kbId] : (kbsQuery.data?.items ?? []).slice(0, 5).map((item) => item.id),
        limit: 10,
        withAnswer: true,
      }),
  });

  const results = searchMutation.data?.items ?? [];

  return (
    <div className="grid grid-cols-[1fr_320px] gap-6 px-8 py-8">
      <section>
        <div className="mb-6">
          <h1 className="text-[30px] font-semibold tracking-normal text-slate-950">检索</h1>
          <p className="mt-1 text-sm text-slate-500">在指定知识库范围内查找证据，并生成带引用的摘要。</p>
        </div>

        <div className="panel p-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="field h-12 pl-12 text-base"
                placeholder="搜索关键词、问题或文件内容"
              />
            </div>
            <div className="w-[260px]">
              <KbSelect items={kbsQuery.data?.items ?? []} value={kbId} onChange={setKbId} />
            </div>
            <button
              type="button"
              onClick={() => searchMutation.mutate()}
              disabled={!query.trim() || searchMutation.isPending}
              className="h-12 rounded-[8px] bg-blue-600 px-6 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {searchMutation.isPending ? "搜索中" : "搜索"}
            </button>
          </div>
        </div>

        {searchMutation.error ? <div className="mt-5"><ErrorBlock message={(searchMutation.error as Error).message} /></div> : null}

        {searchMutation.data?.answer ? (
          <div className="panel mt-5 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-600">
              <Sparkles size={18} />
              综合答案
            </div>
            <div className="whitespace-pre-wrap text-[16px] leading-8 text-slate-900">{searchMutation.data.answer.answer}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(searchMutation.data.answer.citations ?? []).map((item) => (
                <Link
                  key={`${item.citationIndex}-${item.segmentId}`}
                  href={`/preview/${item.segmentId}`}
                  className="rounded-[8px] bg-blue-50 px-3 py-2 text-sm text-blue-700"
                >
                  [{item.citationIndex}] {item.fileName ?? "来源"} {item.pageNo ? `P${item.pageNo}` : ""}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          {results.map((item, index) => (
            <Link
              key={item.segmentId ?? `${item.assetId}-${index}`}
              href={item.segmentId ? `/preview/${item.segmentId}` : "/search"}
              className="panel block p-5 transition hover:border-blue-200"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-950">{item.sourceRef ?? item.assetId ?? "检索结果"}</div>
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{item.snippet || item.content || item.ocrSummary || "无摘要"}</p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  {item.score === undefined ? "-" : item.score.toFixed(3)}
                </div>
              </div>
              <div className="mt-4 flex gap-2 text-xs text-slate-500">
                <span>{item.assetType ?? "TEXT"}</span>
                {item.pageNo ? <span>第 {item.pageNo} 页</span> : null}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <aside className="panel h-fit p-5">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
          <Filter size={18} />
          过滤条件
        </div>
        <div className="mt-5 space-y-5">
          <div>
            <label className="text-sm font-medium text-slate-700">知识库范围</label>
            <div className="mt-2">
              <KbSelect items={kbsQuery.data?.items ?? []} value={kbId} onChange={setKbId} compact />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">来源类型</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {["PDF", "DOCX", "HTML", "IMAGE"].map((item) => (
                <button key={item} className="rounded-[8px] border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">时间范围</label>
            <select className="field mt-2 h-10 text-sm">
              <option>全部时间</option>
              <option>最近 7 天</option>
              <option>最近 30 天</option>
            </select>
          </div>
        </div>
      </aside>
    </div>
  );
}
