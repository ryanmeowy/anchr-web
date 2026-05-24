"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, FileText, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import { formatDateTime, formatNumber, statusText } from "@/lib/format";
import type { KnowledgeBase } from "@/lib/types";

export function LibraryPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const createMutation = useMutation({
    mutationFn: apiClient.createKnowledgeBase,
    onSuccess: () => {
      setName("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
  });

  const items = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    const list = kbsQuery.data?.items ?? [];

    if (!value) {
      return list;
    }

    return list.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(value));
  }, [kbsQuery.data?.items, keyword]);

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 px-8 py-8">
      <section>
        <div className="mb-7 flex items-center justify-between gap-5">
          <div>
            <h1 className="text-[30px] font-semibold tracking-normal text-slate-950">知识库</h1>
            <p className="mt-1 text-sm text-slate-500">管理资料集合、文档状态和最近引用。</p>
          </div>
          <div className="relative w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className="field pl-10"
              placeholder="搜索知识库"
            />
          </div>
        </div>

        {kbsQuery.isLoading ? <LoadingBlock label="正在加载知识库" /> : null}
        {kbsQuery.isError ? (
          <ErrorBlock message={(kbsQuery.error as Error).message} onRetry={() => kbsQuery.refetch()} />
        ) : null}

        {!kbsQuery.isLoading && !kbsQuery.isError ? (
          <div className="grid grid-cols-2 gap-4">
            <CreateKbCard
              name={name}
              description={description}
              pending={createMutation.isPending}
              error={createMutation.error as Error | null}
              onNameChange={setName}
              onDescriptionChange={setDescription}
              onCreate={() => {
                if (name.trim()) {
                  createMutation.mutate({ name: name.trim(), description: description.trim() });
                }
              }}
            />
            {items.map((item) => (
              <KbCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </section>

      <aside className="space-y-4">
        <div className="panel p-5">
          <h2 className="text-base font-semibold text-slate-950">工作区概览</h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Metric label="知识库" value={formatNumber(kbsQuery.data?.total)} />
            <Metric
              label="文档"
              value={formatNumber((kbsQuery.data?.items ?? []).reduce((sum, item) => sum + item.documentCount, 0))}
            />
            <Metric
              label="片段"
              value={formatNumber((kbsQuery.data?.items ?? []).reduce((sum, item) => sum + item.segmentCount, 0))}
            />
            <Metric label="可用" value={formatNumber((kbsQuery.data?.items ?? []).filter((item) => item.status === "ACTIVE").length)} />
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="text-base font-semibold text-slate-950">最近更新</h2>
          <div className="mt-4 space-y-3">
            {(kbsQuery.data?.items ?? []).slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-[8px] border border-slate-100 p-3">
                <Database size={18} className="mt-0.5 text-blue-600" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{item.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.updatedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CreateKbCard({
  name,
  description,
  pending,
  error,
  onNameChange,
  onDescriptionChange,
  onCreate,
}: {
  name: string;
  description: string;
  pending: boolean;
  error: Error | null;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="panel min-h-[210px] border-blue-200 p-5">
      <div className="flex items-center gap-3 text-blue-600">
        <div className="grid size-10 place-items-center rounded-[8px] bg-blue-50">
          <Plus size={20} />
        </div>
        <div className="font-semibold">创建知识库</div>
      </div>
      <div className="mt-4 space-y-3">
        <input className="field" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="知识库名称" />
        <input
          className="field"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="描述，可选"
        />
        {error ? <div className="text-xs text-rose-600">{error.message}</div> : null}
        <button
          type="button"
          onClick={onCreate}
          disabled={pending || !name.trim()}
          className="h-10 rounded-[8px] bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
        >
          {pending ? "创建中" : "创建"}
        </button>
      </div>
    </div>
  );
}

function KbCard({ item }: { item: KnowledgeBase }) {
  return (
    <div className="panel min-h-[210px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-blue-50 text-blue-600">
          <FileText size={22} />
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{statusText(item.status)}</span>
      </div>
      <div className="mt-5 text-lg font-semibold text-slate-950">{item.name}</div>
      <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-500">{item.description || "暂无描述"}</p>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        <Metric label="文档" value={formatNumber(item.documentCount)} />
        <Metric label="片段" value={formatNumber(item.segmentCount)} />
        <Metric label="更新" value={formatDateTime(item.updatedAt)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}
