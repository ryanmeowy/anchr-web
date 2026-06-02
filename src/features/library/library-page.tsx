"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookMarked,
  Box,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  FileText,
  Grid3X3,
  List,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import { formatDateTime, formatNumber, statusText } from "@/lib/format";
import type { KnowledgeBase, RecentCitation, RecentQuestion } from "@/lib/types";

const coverStyles = [
  "from-blue-500 to-blue-700 text-white",
  "from-teal-500 to-emerald-700 text-white",
  "from-violet-500 to-indigo-600 text-white",
  "from-amber-400 to-orange-500 text-white",
];

const coverIcons = [ShieldCheck, Code2, Box, Star];
const KB_PAGE_SIZE = 6;
type ViewMode = "grid" | "list";

export function LibraryPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAllCitations, setShowAllCitations] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [kbPage, setKbPage] = useState(1);

  const kbsQuery = useQuery({
    queryKey: ["kbs", kbPage, KB_PAGE_SIZE],
    queryFn: () => apiClient.listKnowledgeBases(kbPage, KB_PAGE_SIZE),
  });

  const citationsQuery = useQuery({
    queryKey: ["activity", "recent-citations", showAllCitations ? 50 : 3],
    queryFn: () => apiClient.recentCitations(showAllCitations ? 50 : 3),
  });

  const questionsQuery = useQuery({
    queryKey: ["activity", "recent-questions", showAllQuestions ? 50 : 5],
    queryFn: () => apiClient.recentQuestions(showAllQuestions ? 50 : 5),
  });

  const createMutation = useMutation({
    mutationFn: apiClient.createKnowledgeBase,
    onSuccess: () => {
      setName("");
      setDescription("");
      setShowCreateForm(false);
      setKbPage(1);
      queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
  });

  const totalKbs = kbsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalKbs / KB_PAGE_SIZE));

  const items = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    const list = kbsQuery.data?.items ?? [];

    if (!value) {
      return list;
    }

    return list.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(value));
  }, [kbsQuery.data?.items, keyword]);

  return (
    <div className="min-h-[calc(100vh-68px)] px-4 pb-8 sm:px-6 lg:min-h-[calc(100vh-82px)] lg:px-10 lg:pb-10">
      <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
        <main className="min-w-0">
          <div className="mb-7 lg:mb-9">
            <div className="mb-5 flex items-center gap-3 lg:mb-8">
              <h1 className="text-[26px] font-semibold tracking-normal text-slate-950 dark:text-slate-200 lg:text-[30px]">知识库</h1>
              <BookMarked size={22} className="text-slate-500 dark:text-slate-400" />
            </div>

            <div className="flex h-[64px] items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 shadow-[0_18px_40px_rgba(15,23,42,0.06)] dark:border-[#475569] dark:bg-[#2a3648] sm:h-[72px] sm:gap-4 sm:px-5">
              <Search size={23} className="shrink-0 text-slate-500 dark:text-slate-400" />
              <input
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setKbPage(1);
                }}
                className="min-w-0 flex-1 bg-transparent text-[17px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                placeholder="询问或搜索所有知识库..."
              />
              <span className="hidden h-8 items-center rounded-[8px] border border-[var(--line)] bg-[var(--background)] px-3 text-sm font-medium text-slate-500 dark:border-[#475569] dark:bg-[#1f2937] dark:text-slate-400 md:inline-flex">
                ⌘K
              </span>
              <button
                type="button"
                className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-blue-600 text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 sm:size-11"
                aria-label="搜索"
              >
                <ArrowRight size={22} />
              </button>
            </div>
          </div>

          <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-5">
            <div>
              <h2 className="text-[22px] font-semibold text-slate-950 dark:text-slate-200">我的知识库</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">从多个知识库中检索并获得可靠的答案</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1 dark:border-[#475569] dark:bg-[#2a3648]">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={[
                    "grid size-8 place-items-center rounded-[8px] transition",
                    viewMode === "grid"
                      ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
                      : "text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400 dark:hover:bg-[#334155]",
                  ].join(" ")}
                  aria-label="网格视图"
                  aria-pressed={viewMode === "grid"}
                >
                  <Grid3X3 size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={[
                    "grid size-8 place-items-center rounded-[8px] transition",
                    viewMode === "list"
                      ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
                      : "text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400 dark:hover:bg-[#334155]",
                  ].join(" ")}
                  aria-label="列表视图"
                  aria-pressed={viewMode === "list"}
                >
                  <List size={18} />
                </button>
              </div>
            </div>
          </div>

          {kbsQuery.isLoading ? <LoadingBlock label="正在加载知识库" /> : null}
          {kbsQuery.isError ? (
            <ErrorBlock message={(kbsQuery.error as Error).message} onRetry={() => kbsQuery.refetch()} />
          ) : null}

          {!kbsQuery.isLoading && !kbsQuery.isError && viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {items.map((item, index) => (
                <KnowledgeBaseCard key={item.id} item={item} index={index} />
              ))}
              <CreateKnowledgeBaseCard
                expanded={showCreateForm}
                name={name}
                description={description}
                pending={createMutation.isPending}
                error={createMutation.error as Error | null}
                onExpand={() => setShowCreateForm(true)}
                onCancel={() => {
                  setShowCreateForm(false);
                  setName("");
                  setDescription("");
                }}
                onNameChange={setName}
                onDescriptionChange={setDescription}
                onCreate={() => {
                  if (name.trim()) {
                    createMutation.mutate({ name: name.trim(), description: description.trim() });
                  }
                }}
              />
            </div>
          ) : null}

          {!kbsQuery.isLoading && !kbsQuery.isError && viewMode === "list" ? (
            <div className="overflow-x-auto rounded-[14px] border border-[var(--line)] bg-[var(--surface)] shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
              <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_92px_112px_136px_112px] gap-4 border-b border-[var(--line)] px-5 py-3 text-xs font-medium text-slate-500 dark:border-[#475569] dark:text-slate-400">
                <span>知识库</span>
                <span>文档</span>
                <span>片段</span>
                <span>更新时间</span>
                <span className="text-right">操作</span>
              </div>
              <div className="min-w-[760px] divide-y divide-[var(--line)] dark:divide-[#475569]">
                {items.map((item, index) => (
                  <KnowledgeBaseListRow key={item.id} item={item} index={index} />
                ))}
                <CreateKnowledgeBaseListRow
                  expanded={showCreateForm}
                  name={name}
                  description={description}
                  pending={createMutation.isPending}
                  error={createMutation.error as Error | null}
                  onExpand={() => setShowCreateForm(true)}
                  onCancel={() => {
                    setShowCreateForm(false);
                    setName("");
                    setDescription("");
                  }}
                  onNameChange={setName}
                  onDescriptionChange={setDescription}
                  onCreate={() => {
                    if (name.trim()) {
                      createMutation.mutate({ name: name.trim(), description: description.trim() });
                    }
                  }}
                />
              </div>
            </div>
          ) : null}

          {!kbsQuery.isLoading && !kbsQuery.isError ? (
            <KnowledgeBasePagination
              page={kbPage}
              total={totalKbs}
              pageSize={KB_PAGE_SIZE}
              totalPages={totalPages}
              isFetching={kbsQuery.isFetching}
              onPageChange={setKbPage}
            />
          ) : null}
        </main>

        <aside className="space-y-5 pt-0 xl:pt-[78px]">
          <RecentCitationPanel
            items={citationsQuery.data?.items ?? []}
            isLoading={citationsQuery.isLoading}
            isError={citationsQuery.isError}
            expanded={showAllCitations}
            onToggle={() => setShowAllCitations((value) => !value)}
          />
          <RecentQuestionPanel
            items={questionsQuery.data?.items ?? []}
            isLoading={questionsQuery.isLoading}
            isError={questionsQuery.isError}
            expanded={showAllQuestions}
            onToggle={() => setShowAllQuestions((value) => !value)}
          />
        </aside>
      </div>
    </div>
  );
}

function KnowledgeBasePagination({
  page,
  total,
  pageSize,
  totalPages,
  isFetching,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  totalPages: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
}) {
  const currentPage = Math.min(page, totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  const pages = getVisiblePages(currentPage, totalPages);

  return (
    <div className="mt-5 flex flex-col items-stretch justify-between gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-300 sm:flex-row sm:items-center">
      <div>
        共 <span className="font-medium text-slate-900 dark:text-slate-100">{formatNumber(total)}</span> 个知识库
        {total > 0 ? (
          <span className="ml-2 text-slate-500 dark:text-slate-400">
            当前 {formatNumber(start)}-{formatNumber(end)}
          </span>
        ) : null}
        {isFetching ? <span className="ml-2 text-blue-600 dark:text-blue-300">加载中</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1 || isFetching}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          className="grid size-9 place-items-center rounded-[9px] border border-[var(--line)] bg-[var(--surface)] text-slate-600 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-300 dark:hover:bg-[#334155]"
          aria-label="上一页"
        >
          <ChevronLeft size={18} />
        </button>

        {pages.map((item) => (
          <button
            key={item}
            type="button"
            disabled={item === currentPage || isFetching}
            onClick={() => onPageChange(item)}
            className={[
              "grid size-9 place-items-center rounded-[9px] text-sm font-medium transition disabled:cursor-not-allowed",
              item === currentPage
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-[var(--surface-hover)] disabled:opacity-45 dark:text-slate-300 dark:hover:bg-[#334155]",
            ].join(" ")}
            aria-current={item === currentPage ? "page" : undefined}
          >
            {item}
          </button>
        ))}

        <button
          type="button"
          disabled={currentPage >= totalPages || isFetching}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          className="grid size-9 place-items-center rounded-[9px] border border-[var(--line)] bg-[var(--surface)] text-slate-600 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-300 dark:hover:bg-[#334155]"
          aria-label="下一页"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function getVisiblePages(page: number, totalPages: number) {
  const maxVisible = 5;
  const start = Math.max(1, Math.min(page - 2, totalPages - maxVisible + 1));
  const end = Math.min(totalPages, start + maxVisible - 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function askHrefForKb(item: KnowledgeBase) {
  const params = new URLSearchParams({ kbId: item.id, kbName: item.name });

  return `/ask?${params.toString()}`;
}

function KnowledgeBaseCard({ item, index }: { item: KnowledgeBase; index: number }) {
  const CoverIcon = coverIcons[index % coverIcons.length];
  const lastUpdated = item.updatedAt ?? item.lastIngestedAt ?? item.createdAt;

  return (
    <article className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[86px_minmax(0,1fr)] sm:gap-5">
        <div className={`relative h-30 rounded-[7px] bg-gradient-to-br ${coverStyles[index % coverStyles.length]} shadow-[0_12px_24px_rgba(15,23,42,0.16)] sm:h-[122px]`}>
          <div className="absolute inset-x-0 top-8 grid place-items-center">
            <CoverIcon size={36} strokeWidth={2.2} />
          </div>
          <div className="absolute bottom-7 left-6 h-1 w-9 rounded-full bg-white/18" />
          <div className="absolute bottom-4 left-6 h-1 w-13 rounded-full bg-white/14" />
        </div>

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="truncate text-[17px] font-semibold text-slate-950 dark:text-slate-100">{item.name}</h3>
            <span className="shrink-0 rounded-[7px] bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {item.status === "ACTIVE" ? "可问答" : statusText(item.status)}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600 dark:text-slate-300">
            {item.description || "暂无描述"}
          </p>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <FileText size={14} />
              文档 {formatNumber(item.documentCount)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Database size={14} />
              片段 {formatNumber(item.segmentCount)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--line)] pt-3 dark:border-[#475569] sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">更新于 {formatDateTime(lastUpdated)}</span>
        <Link
          href={askHrefForKb(item)}
          className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-slate-800 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-200 dark:hover:bg-[#334155]"
        >
          进入提问
          <ArrowRight size={15} />
        </Link>
      </div>
    </article>
  );
}

function KnowledgeBaseListRow({ item, index }: { item: KnowledgeBase; index: number }) {
  const CoverIcon = coverIcons[index % coverIcons.length];
  const lastUpdated = item.updatedAt ?? item.lastIngestedAt ?? item.createdAt;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_92px_112px_136px_112px] items-center gap-4 px-5 py-4 hover:bg-[var(--surface-hover)] dark:hover:bg-[#334155]">
      <div className="flex min-w-0 items-center gap-4">
        <div className={`grid size-14 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br ${coverStyles[index % coverStyles.length]} text-white shadow-[0_10px_22px_rgba(15,23,42,0.16)]`}>
          <CoverIcon size={25} strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-[15px] font-semibold text-slate-950 dark:text-slate-100">{item.name}</h3>
            <span className="shrink-0 rounded-[7px] bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {item.status === "ACTIVE" ? "可问答" : statusText(item.status)}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">{item.description || "暂无描述"}</p>
        </div>
      </div>
      <span className="text-sm text-slate-600 dark:text-slate-300">{formatNumber(item.documentCount)}</span>
      <span className="text-sm text-slate-600 dark:text-slate-300">{formatNumber(item.segmentCount)}</span>
      <span className="text-sm text-slate-500 dark:text-slate-400">{formatDateTime(lastUpdated)}</span>
      <div className="flex justify-end">
        <Link
          href={askHrefForKb(item)}
          className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-slate-800 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-200 dark:hover:bg-[#334155]"
        >
          提问
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function CreateKnowledgeBaseCard({
  expanded,
  name,
  description,
  pending,
  error,
  onExpand,
  onCancel,
  onNameChange,
  onDescriptionChange,
  onCreate,
}: {
  expanded: boolean;
  name: string;
  description: string;
  pending: boolean;
  error: Error | null;
  onExpand: () => void;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCreate: () => void;
}) {
  if (expanded) {
    return (
      <div className="rounded-[14px] border border-dashed border-blue-300 bg-[var(--surface)] p-5 dark:border-blue-400/40 dark:bg-[#2a3648]">
        <div className="mb-4 flex items-center gap-3 text-blue-600 dark:text-blue-300">
          <Plus size={20} />
          <span className="font-semibold">新建知识库</span>
        </div>
        <div className="space-y-3">
          <input className="field" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="知识库名称" />
          <input
            className="field"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="描述，可选"
          />
          {error ? <div className="text-xs text-rose-600">{error.message}</div> : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCreate}
              disabled={pending || !name.trim()}
              className="h-10 rounded-[8px] bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {pending ? "创建中" : "创建"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-10 rounded-[8px] border border-[var(--line)] px-4 text-sm font-medium text-slate-600 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:text-slate-300 dark:hover:bg-[#334155]"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex min-h-[108px] items-center justify-center gap-4 rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--surface)] text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-300 dark:hover:bg-[#334155] lg:col-span-2"
    >
      <Plus size={22} />
      <span>
        <span className="block text-[17px] font-semibold">新建知识库</span>
        <span className="mt-2 block text-sm text-slate-500 dark:text-slate-400">上传文件或连接数据源，扩展你的知识边界</span>
      </span>
    </button>
  );
}

function CreateKnowledgeBaseListRow({
  expanded,
  name,
  description,
  pending,
  error,
  onExpand,
  onCancel,
  onNameChange,
  onDescriptionChange,
  onCreate,
}: {
  expanded: boolean;
  name: string;
  description: string;
  pending: boolean;
  error: Error | null;
  onExpand: () => void;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCreate: () => void;
}) {
  if (expanded) {
    return (
      <div className="px-5 py-5">
        <div className="rounded-[12px] border border-dashed border-blue-300 bg-[var(--background)] p-4 dark:border-blue-400/40 dark:bg-[#1f2937]">
          <div className="mb-4 flex items-center gap-3 text-blue-600 dark:text-blue-300">
            <Plus size={20} />
            <span className="font-semibold">新建知识库</span>
          </div>
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto]">
            <input className="field" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="知识库名称" />
            <input
              className="field"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="描述，可选"
            />
            <button
              type="button"
              onClick={onCreate}
              disabled={pending || !name.trim()}
              className="h-11 rounded-[8px] bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {pending ? "创建中" : "创建"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-11 rounded-[8px] border border-[var(--line)] px-4 text-sm font-medium text-slate-600 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:text-slate-300 dark:hover:bg-[#334155]"
            >
              取消
            </button>
          </div>
          {error ? <div className="mt-2 text-xs text-rose-600">{error.message}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full flex-wrap items-center justify-center gap-3 px-5 py-5 text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300 dark:hover:bg-[#334155]"
    >
      <Plus size={20} />
      <span className="font-semibold">新建知识库</span>
      <span className="text-sm text-slate-500 dark:text-slate-400">上传文件或连接数据源，扩展你的知识边界</span>
    </button>
  );
}

function RecentCitationPanel({
  items,
  isLoading,
  isError,
  expanded,
  onToggle,
}: {
  items: RecentCitation[];
  isLoading: boolean;
  isError: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
      <PanelHeader title="最近引用" expanded={expanded} onToggle={onToggle} />
      <div className="mt-4 border-t border-[var(--line)] pt-3 dark:border-[#475569]">
        {isLoading ? <LoadingBlock label="加载最近引用" /> : null}
        {isError ? <div className="py-6 text-sm text-slate-500 dark:text-slate-400">最近引用暂不可用。</div> : null}
        {!isLoading && !isError ? (
          <div className="divide-y divide-[var(--line)] dark:divide-[#475569]">
            {items.length > 0 ? items.map((item, index) => <CitationRow key={item.segmentId} item={item} index={index} />) : (
              <div className="py-6 text-sm text-slate-500 dark:text-slate-400">暂无最近引用。</div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CitationRow({ item, index }: { item: RecentCitation; index: number }) {
  return (
    <Link href={`/preview/${item.segmentId}`} className="block py-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1 rounded-[5px] px-1.5 py-1 text-[11px] font-bold text-white ${citationBadgeColor(index)}`}>
          {fileExtension(item.fileName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-[14px] font-semibold text-slate-950 dark:text-slate-100">
              {item.title || item.fileName || "引用片段"}
            </div>
            <span className="rounded-[6px] bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {index + 1}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {item.snippet || item.citationReason || "暂无引用摘要。"}
          </p>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {formatDateTime(item.openedAt)}
          </div>
        </div>
      </div>
    </Link>
  );
}

function RecentQuestionPanel({
  items,
  isLoading,
  isError,
  expanded,
  onToggle,
}: {
  items: RecentQuestion[];
  isLoading: boolean;
  isError: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
      <PanelHeader title="最近问过" expanded={expanded} onToggle={onToggle} />
      <div className="mt-4 divide-y divide-[var(--line)] dark:divide-[#475569]">
        {isLoading ? <LoadingBlock label="加载最近提问" /> : null}
        {isError ? <div className="py-6 text-sm text-slate-500 dark:text-slate-400">最近提问暂不可用。</div> : null}
        {!isLoading && !isError ? (
          items.length > 0 ? items.map((item) => <QuestionRow key={item.turnId} item={item} />) : (
            <div className="py-6 text-sm text-slate-500 dark:text-slate-400">暂无最近提问。</div>
          )
        ) : null}
      </div>
    </section>
  );
}

function QuestionRow({ item }: { item: RecentQuestion }) {
  return (
    <Link href="/ask" className="grid grid-cols-[1fr_auto] gap-3 py-3">
      <div className="flex min-w-0 gap-3">
        <MessageCircle size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-950 dark:text-slate-100">{item.question || "未命名问题"}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(item.kbScope ?? []).slice(0, 2).map((scope, index) => (
              <span key={`${scope}-${index}`} className="rounded-[6px] bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {scope}
              </span>
            ))}
          </div>
        </div>
      </div>
      <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{formatRelativeTime(item.createdAt)}</span>
    </Link>
  );
}

function PanelHeader({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[17px] font-semibold text-slate-950 dark:text-slate-100">{title}</h2>
      <button type="button" onClick={onToggle} className="text-sm font-medium text-blue-600 dark:text-blue-300">
        {expanded ? "收起" : "查看全部"}
      </button>
    </div>
  );
}

function fileExtension(fileName?: string | null) {
  const extension = fileName?.split(".").pop()?.slice(0, 4).toUpperCase();
  return extension || "DOC";
}

function citationBadgeColor(index: number) {
  const colors = ["bg-red-500", "bg-blue-600", "bg-emerald-500"];
  return colors[index % colors.length];
}

function formatRelativeTime(value?: string) {
  if (!value) {
    return "-";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "-";
  }

  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "刚刚";
  }

  if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  }

  if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  }

  return `${Math.floor(diff / day)} 天前`;
}
