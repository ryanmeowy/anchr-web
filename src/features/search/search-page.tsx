"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  ExternalLink,
  FileImage,
  FileText,
  FileType,
  Folder,
  Hash,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import type { KnowledgeBase, RecentQuestion, SearchAssetType, SearchPage as SearchPageData, SearchResult } from "@/lib/types";

const SEARCH_LIMIT = 10;
const SEARCH_TOP_K = 50;
const ASSET_TYPES: SearchAssetType[] = ["PDF", "IMAGE", "TXT", "MARKDOWN"];

const ASSET_TYPE_META: Record<SearchAssetType, { icon: React.ComponentType<{ size?: number; className?: string }>; badgeClass: string }> = {
  PDF: {
    icon: FileText,
    badgeClass: "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20",
  },
  IMAGE: {
    icon: FileImage,
    badgeClass: "bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/20",
  },
  TXT: {
    icon: FileType,
    badgeClass: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/20",
  },
  MARKDOWN: {
    icon: Hash,
    badgeClass: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20",
  },
};

type SearchTab = "answer" | "results";
type SearchMutationVariables = {
  query: string;
  cursor?: string | null;
  append?: boolean;
  startedAt: number;
};

type ResultGroup = {
  kbId: string;
  title: string;
  items: SearchResult[];
};

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedKbId, setSelectedKbId] = useState("");
  const [isKbMenuOpen, setIsKbMenuOpen] = useState(false);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<SearchAssetType[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("answer");
  const [searchData, setSearchData] = useState<SearchPageData | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
    refetchOnWindowFocus: false,
  });

  const recentQuestionsQuery = useQuery({
    queryKey: ["activity", "recent-questions", 5],
    queryFn: () => apiClient.recentQuestions(5),
  });

  const capabilitiesQuery = useQuery({
    queryKey: ["ingestion-capabilities"],
    queryFn: apiClient.ingestionCapabilities,
  });

  const kbItems = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
  const kbById = useMemo(() => new Map(kbItems.map((item) => [item.id, item])), [kbItems]);
  const selectedKb = useMemo(
    () => kbItems.find((item) => item.id === selectedKbId),
    [kbItems, selectedKbId],
  );
  const selectedKbLabel = selectedKb?.name ?? "全部知识库";
  const selectedKbKey = selectedKbId;
  const selectedAssetTypeKey = selectedAssetTypes.join(",");
  const supportedAssetTypes = useMemo(
    () =>
      (capabilitiesQuery.data?.supportedFormats ?? [])
        .filter((item) => item.enabled && isSearchAssetType(item.fileType))
        .map((item) => item.fileType as SearchAssetType),
    [capabilitiesQuery.data?.supportedFormats],
  );

  const buildDateRange = useCallback(() => {
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : undefined;

    if (from === undefined && to === undefined) {
      return undefined;
    }

    return { from, to };
  }, [dateFrom, dateTo]);

  const searchMutation = useMutation<SearchPageData, Error, SearchMutationVariables>({
    mutationFn: (variables) =>
      apiClient.searchKnowledgeBase({
        query: variables.query,
        topK: SEARCH_TOP_K,
        limit: SEARCH_LIMIT,
        strategy: "KB_RRF_RERANK",
        kbIds: selectedKbId ? [selectedKbId] : [],
        assetTypes: selectedAssetTypes.length > 0 ? selectedAssetTypes : undefined,
        dateRange: buildDateRange(),
        cursor: variables.cursor ?? undefined,
        sort: "score",
        withAnswer: true,
        answerMode: "STRICT",
      }),
    onSuccess: (data, variables) => {
      setElapsedMs(Math.max(1, Math.round(performance.now() - variables.startedAt)));
      setSearchData((previous) => {
        if (!variables.append || !previous) {
          return data;
        }

        return {
          ...data,
          items: [...previous.items, ...(data.items ?? [])],
          answer: previous.answer ?? data.answer,
          facets: data.facets ?? previous.facets,
        };
      });
    },
  });

  const executeSearch = useCallback((searchText: string, cursor?: string | null, append = false) => {
    const trimmed = searchText.trim();
    if (!trimmed) {
      return;
    }

    searchMutation.mutate({
      query: trimmed,
      cursor,
      append,
      startedAt: performance.now(),
    });
  }, [searchMutation]);

  useEffect(() => {
    if (!submittedQuery) {
      return;
    }

    executeSearch(submittedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKbKey, selectedAssetTypeKey, dateFrom, dateTo]);

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed || searchMutation.isPending) {
      return;
    }

    setActiveTab("answer");
    setSubmittedQuery(trimmed);
    executeSearch(trimmed);
  };

  const handleLoadMore = () => {
    if (!submittedQuery || !searchData?.nextCursor || searchMutation.isPending) {
      return;
    }

    executeSearch(submittedQuery, searchData.nextCursor, true);
  };

  const resultGroups = useMemo(() => groupResults(searchData?.items ?? [], kbById), [kbById, searchData?.items]);
  const isAppending = Boolean(searchMutation.isPending && searchMutation.variables?.append);
  const isSearching = Boolean(searchMutation.isPending && !searchMutation.variables?.append);
  const hasSearched = Boolean(submittedQuery);

  return (
    <div className="min-h-[calc(100vh-68px)] px-4 pb-8 sm:px-6 lg:min-h-[calc(100vh-82px)] lg:px-10 lg:pb-10">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-7 lg:mb-9">
          <h1 className="text-[26px] font-semibold tracking-normal text-slate-950 dark:text-slate-200 lg:text-[30px]">搜索知识库</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">在知识库中检索证据，并生成带引用的回答。</p>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
        <main className="min-w-0">
          <div className="mb-7 lg:mb-9">
            <div className="flex items-center gap-3">
              <div className="flex h-[46px] min-w-0 flex-1 items-center gap-3 rounded-[11px] border border-blue-200 bg-[var(--surface)] py-0 pl-4 pr-[3px] shadow-[0_18px_40px_rgba(37,99,235,0.10)] ring-1 ring-blue-500/10 dark:border-blue-500/35 dark:bg-[var(--surface)] dark:ring-blue-400/10 sm:h-[52px] sm:gap-4 sm:pl-5 sm:pr-1">
                <Search size={23} className="shrink-0 text-slate-500 dark:text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSubmit();
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[17px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder="搜索关键词、问题或文件内容"
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!query.trim() || searchMutation.isPending}
                  className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-blue-600 text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] transition hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none dark:disabled:bg-slate-700 sm:size-11"
                  aria-label="搜索"
                >
                  {isSearching ? <Loader2 size={21} className="animate-spin" /> : <ArrowRight size={22} />}
                </button>
              </div>
              <SearchTabs activeTab={activeTab} onChange={setActiveTab} />
            </div>
          </div>

          {searchMutation.error ? (
            <div className="mt-5">
              <ErrorBlock message={searchMutation.error.message} />
            </div>
          ) : null}

          {!hasSearched ? <EmptySearchState /> : null}

          {hasSearched && isSearching ? (
            <div className="mt-5">
              <LoadingBlock label="正在搜索知识库" />
            </div>
          ) : null}

          {hasSearched && !isSearching && activeTab === "answer" ? (
            <AnswerPanel data={searchData} query={submittedQuery} onRegenerate={() => executeSearch(submittedQuery)} />
          ) : null}

          {hasSearched && !isSearching && activeTab === "results" ? (
            <ResultsPanel
              groups={resultGroups}
              total={searchData?.total ?? 0}
              elapsedMs={elapsedMs}
              hasMore={Boolean(searchData?.nextCursor)}
              isAppending={isAppending}
              onLoadMore={handleLoadMore}
            />
          ) : null}
        </main>

        <aside className="space-y-5 pt-0">
          <SearchFilters
            kbs={kbItems}
            kbsLoading={kbsQuery.isLoading}
            selectedKbId={selectedKbId}
            selectedKbLabel={selectedKbLabel}
            isKbMenuOpen={isKbMenuOpen}
            onKbMenuToggle={() => setIsKbMenuOpen((open) => !open)}
            onKbMenuClose={() => setIsKbMenuOpen(false)}
            onSelectedKbIdChange={setSelectedKbId}
            sourceTypes={supportedAssetTypes}
            sourceTypesLoading={capabilitiesQuery.isLoading}
            sourceTypesError={capabilitiesQuery.isError}
            selectedAssetTypes={selectedAssetTypes}
            onSelectedAssetTypesChange={setSelectedAssetTypes}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
          <RecentQuestionsPanel items={recentQuestionsQuery.data?.items ?? []} isLoading={recentQuestionsQuery.isLoading} isError={recentQuestionsQuery.isError} />
        </aside>
      </div>
    </div>
  );
}

function SearchTabs({ activeTab, onChange }: { activeTab: SearchTab; onChange: (tab: SearchTab) => void }) {
  return (
    <div className="inline-flex h-[46px] shrink-0 rounded-[11px] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)] sm:h-[52px]">
      {[
        { value: "answer" as const, label: "回答" },
        { value: "results" as const, label: "结果" },
      ].map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={[
            "h-[36px] rounded-[9px] px-4 text-sm font-medium transition sm:h-[42px]",
            activeTab === item.value
              ? "bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/20"
              : "text-slate-600 hover:bg-[var(--surface-hover)] dark:text-slate-300 dark:hover:bg-[var(--surface-hover)]",
          ].join(" ")}
          aria-pressed={activeTab === item.value}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function EmptySearchState() {
  return (
    <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-14 text-center shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)]">
      <div className="mx-auto grid size-12 place-items-center rounded-[14px] bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
        <Sparkles size={24} />
      </div>
      <h2 className="mt-5 text-xl font-semibold text-slate-950 dark:text-slate-100">输入问题开始搜索</h2>
      <p className="mx-auto mt-2 max-w-[480px] text-sm leading-6 text-slate-500 dark:text-slate-400">
        搜索会同时返回可引用的回答和相关片段。
      </p>
    </div>
  );
}

function AnswerPanel({ data, query, onRegenerate }: { data: SearchPageData | null; query: string; onRegenerate: () => void }) {
  const answer = data?.answer?.answer?.trim();
  const citations = data?.answer?.citations ?? [];

  if (!answer) {
    return (
      <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-slate-500 shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-400">
        暂无可生成的回答。
      </div>
    );
  }

  return (
    <section className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)]">
      <div className="mb-4 flex flex-col gap-3 border-b border-[var(--line)] pb-4 dark:border-[var(--line)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-[10px] bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
            <Sparkles size={19} />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold text-slate-950 dark:text-slate-100">基于证据生成</h2>
            <p className="mt-1 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">{query}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRegenerate}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
        >
          <RefreshCcw size={15} />
          重新生成
        </button>
      </div>

      <div className="whitespace-pre-wrap text-[15px] leading-8 text-slate-900 dark:text-slate-100">{answer}</div>

      {citations.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {citations.map((item) => (
            <Link
              key={`${item.citationIndex}-${item.segmentId}`}
              href={`/preview/${item.segmentId}`}
              className="inline-flex max-w-full items-center gap-2 rounded-[8px] border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/15 dark:text-blue-200 dark:hover:bg-blue-500/20"
            >
              <span>[{item.citationIndex}]</span>
              <span className="truncate">{item.fileName ?? "引用来源"}</span>
              {item.pageNo ? <span className="shrink-0">P{item.pageNo}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ResultsPanel({
  groups,
  total,
  elapsedMs,
  hasMore,
  isAppending,
  onLoadMore,
}: {
  groups: ResultGroup[];
  total: number;
  elapsedMs: number | null;
  hasMore: boolean;
  isAppending: boolean;
  onLoadMore: () => void;
}) {
  return (
    <section>
      <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="text-[19px] font-semibold text-slate-950 dark:text-slate-100">相关结果</h2>
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {formatNumber(total)} 条结果
          {elapsedMs ? <span className="ml-2">{(elapsedMs / 1000).toFixed(2)}s</span> : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-6 text-sm text-slate-500 shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-400">
          没有找到相关结果。
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <ResultGroupCard key={group.kbId} group={group} />
          ))}
        </div>
      )}

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isAppending}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] disabled:opacity-60 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
        >
          {isAppending ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={17} />}
          加载更多
        </button>
      ) : null}
    </section>
  );
}

function ResultGroupCard({ group }: { group: ResultGroup }) {
  return (
    <article className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)] shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3 dark:border-[var(--line)]">
        <Database size={16} className="text-slate-500 dark:text-slate-400" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{group.title}</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">{group.items.length} 个结果</span>
      </div>
      <div className="divide-y divide-[var(--line)] dark:divide-[var(--line)]">
        {group.items.map((item, index) => (
          <ResultRow key={item.segmentId ?? `${item.assetId}-${index}`} item={item} />
        ))}
      </div>
    </article>
  );
}

function ResultRow({ item }: { item: SearchResult }) {
  const assetType = item.assetType;
  const meta = ASSET_TYPE_META[assetType];
  const Icon = meta.icon;
  const href = item.segmentId ? `/preview/${item.segmentId}` : "/search";
  const position = formatResultPosition(item);

  return (
    <Link href={href} className="block px-4 py-4 transition hover:bg-[var(--surface-hover)] dark:hover:bg-[var(--surface-hover)]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[11px] font-bold ring-1 ${meta.badgeClass}`}>
              <Icon size={13} />
              {assetType}
            </span>
            <h4 className="min-w-0 truncate text-[15px] font-semibold text-slate-950 dark:text-slate-100">
              {displaySourceName(item.sourceRef, item.assetId)}
            </h4>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {renderHighlightedText(item.snippet || item.content || item.ocrSummary || "无摘要")}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            {position ? <span>{position}</span> : null}
            {item.totalHits ? <span>命中 {formatNumber(item.totalHits)}</span> : null}
            {item.explain?.hitSources?.length ? <span>{item.explain.hitSources.join(" / ")}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end justify-between gap-3">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            {item.score === undefined ? "-" : item.score.toFixed(2)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-300">
            预览
            <ExternalLink size={13} />
          </span>
        </div>
      </div>
    </Link>
  );
}

function SearchFilters({
  kbs,
  kbsLoading,
  selectedKbId,
  selectedKbLabel,
  isKbMenuOpen,
  onKbMenuToggle,
  onKbMenuClose,
  onSelectedKbIdChange,
  sourceTypes,
  sourceTypesLoading,
  sourceTypesError,
  selectedAssetTypes,
  onSelectedAssetTypesChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  kbs: KnowledgeBase[];
  kbsLoading: boolean;
  selectedKbId: string;
  selectedKbLabel: string;
  isKbMenuOpen: boolean;
  onKbMenuToggle: () => void;
  onKbMenuClose: () => void;
  onSelectedKbIdChange: (id: string) => void;
  sourceTypes: SearchAssetType[];
  sourceTypesLoading: boolean;
  sourceTypesError: boolean;
  selectedAssetTypes: SearchAssetType[];
  onSelectedAssetTypesChange: (types: SearchAssetType[]) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
}) {
  const [isDateRangeOpen, setIsDateRangeOpen] = useState(false);

  return (
    <section className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)]">
      <div className="mb-5">
        <h2 className="text-[17px] font-semibold text-slate-950 dark:text-slate-100">筛选范围</h2>
      </div>

      <div className="space-y-6">
        <FilterSection title="知识库">
          <SearchKnowledgeBasePicker
            items={kbs}
            selectedKbId={selectedKbId}
            selectedLabel={selectedKbLabel}
            isOpen={isKbMenuOpen}
            isLoading={kbsLoading}
            onToggle={onKbMenuToggle}
            onClose={onKbMenuClose}
            onSelect={onSelectedKbIdChange}
          />
        </FilterSection>

        <FilterSection
          title="来源类型"
          action={sourceTypesLoading || sourceTypesError ? undefined : selectedAssetTypes.length === 0 ? `全部 ${formatNumber(sourceTypes.length)}` : `已选 ${selectedAssetTypes.length}`}
        >
          {sourceTypesLoading ? <LoadingBlock label="加载来源类型" /> : null}
          {sourceTypesError ? <div className="text-sm text-slate-500 dark:text-slate-400">来源类型暂不可用。</div> : null}
          {!sourceTypesLoading && !sourceTypesError && sourceTypes.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">暂无支持的来源类型。</div>
          ) : null}
          {!sourceTypesLoading && !sourceTypesError && sourceTypes.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {sourceTypes.map((assetType) => {
              const Icon = ASSET_TYPE_META[assetType].icon;
              const checked = selectedAssetTypes.length === 0 || selectedAssetTypes.includes(assetType);

              return (
                <button
                  key={assetType}
                  type="button"
                  onClick={() => onSelectedAssetTypesChange(toggleWithinAllSelection(selectedAssetTypes, assetType, sourceTypes))}
                  className={[
                    "flex h-9 items-center justify-center gap-1.5 rounded-[8px] border px-2 text-xs font-semibold transition",
                    checked
                      ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-200"
                      : "border-[var(--line)] bg-[var(--surface)] text-slate-600 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-300 dark:hover:bg-[var(--surface-hover)]",
                  ].join(" ")}
                  aria-pressed={checked}
                >
                  <Icon size={14} />
                  {assetType}
                </button>
              );
              })}
            </div>
          ) : null}
        </FilterSection>

        <FilterSection title="时间范围">
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            isOpen={isDateRangeOpen}
            onToggle={() => setIsDateRangeOpen((open) => !open)}
            onClose={() => setIsDateRangeOpen(false)}
            onFromChange={onDateFromChange}
            onToChange={onDateToChange}
          />
        </FilterSection>
      </div>
    </section>
  );
}

function FilterSection({ title, action, children }: { title: string; action?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {action ? <span className="text-xs font-medium text-blue-600 dark:text-blue-300">{action}</span> : null}
      </div>
      {children}
    </div>
  );
}

function SearchKnowledgeBasePicker({
  items,
  selectedKbId,
  selectedLabel,
  isOpen,
  isLoading,
  onToggle,
  onClose,
  onSelect,
}: {
  items: KnowledgeBase[];
  selectedKbId: string;
  selectedLabel: string;
  isOpen: boolean;
  isLoading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (kbId: string) => void;
}) {
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-11 w-full items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Database size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown size={15} className="shrink-0" />
      </button>

      {isOpen ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-[var(--line)] dark:bg-[var(--surface)]"
          role="listbox"
        >
          {isLoading ? (
            <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">加载知识库...</div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  onSelect("");
                  onClose();
                }}
                className={[
                  "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm",
                  selectedKbId === ""
                    ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                    : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300",
                ].join(" ")}
                role="option"
                aria-selected={selectedKbId === ""}
              >
                <Database size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">全部知识库</span>
                {selectedKbId === "" ? <Check size={14} className="shrink-0" /> : null}
              </button>

              {items.length > 0 ? (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelect(item.id);
                      onClose();
                    }}
                    className={[
                      "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm",
                      selectedKbId === item.id
                        ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                        : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300",
                    ].join(" ")}
                    role="option"
                    aria-selected={selectedKbId === item.id}
                  >
                    <Folder size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {selectedKbId === item.id ? <Check size={14} className="shrink-0" /> : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">暂无可选知识库</div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DateRangePicker({
  from,
  to,
  isOpen,
  onToggle,
  onClose,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDateKey(from) ?? new Date()));
  const nextMonth = addMonths(visibleMonth, 1);
  const hasRange = Boolean(from || to);
  const startPlaceholderClass = from ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500";
  const endPlaceholderClass = to ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500";

  const handleSelectDate = (dateKey: string) => {
    if (!from || to || compareDateKeys(dateKey, from) < 0) {
      onFromChange(dateKey);
      onToChange("");
      return;
    }

    if (dateKey === from) {
      onToChange(dateKey);
      return;
    }

    onToChange(dateKey);
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!isOpen && from) {
            setVisibleMonth(startOfMonth(parseDateKey(from) ?? new Date()));
          }
          onToggle();
        }}
        className={[
          "inline-flex h-11 w-full items-center gap-2 rounded-[8px] border px-3 text-sm font-medium transition",
          hasRange
            ? "border-blue-500 bg-[var(--surface)] text-slate-900 shadow-[0_0_0_3px_rgba(37,99,235,0.10)] dark:border-blue-400 dark:bg-[var(--surface)] dark:text-slate-100"
            : "border-[var(--line)] bg-[var(--surface)] text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200",
        ].join(" ")}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <span className={`min-w-0 flex-1 truncate text-left ${startPlaceholderClass}`}>{from || "开始日期"}</span>
        <span className="shrink-0 text-slate-400 dark:text-slate-500">-</span>
        <span className={`min-w-0 flex-1 truncate text-left ${endPlaceholderClass}`}>{to || "结束日期"}</span>
        <Calendar size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
        <ChevronDown size={15} className="shrink-0" />
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-[12px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-[var(--line)] dark:bg-[var(--surface)]">
          <div className="grid grid-cols-2 border-b border-[var(--line)] dark:border-[var(--line)]">
            <MonthHeader
              month={visibleMonth}
              leading
              onPreviousYear={() => setVisibleMonth((month) => addMonths(month, -12))}
              onPreviousMonth={() => setVisibleMonth((month) => addMonths(month, -1))}
            />
            <MonthHeader
              month={nextMonth}
              onNextMonth={() => setVisibleMonth((month) => addMonths(month, 1))}
              onNextYear={() => setVisibleMonth((month) => addMonths(month, 12))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 p-3">
            <MonthCalendar month={visibleMonth} from={from} to={to} onSelect={handleSelectDate} />
            <MonthCalendar month={nextMonth} from={from} to={to} onSelect={handleSelectDate} />
          </div>

          <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2 dark:border-[var(--line)]">
            <div className="min-w-0 text-sm text-slate-500 dark:text-slate-400">
              {formatDateRangeLabel(from, to)}
            </div>
            {from || to ? (
              <button
                type="button"
                onClick={() => {
                  onFromChange("");
                  onToChange("");
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
              >
                清空
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MonthHeader({
  month,
  leading = false,
  onPreviousYear,
  onPreviousMonth,
  onNextMonth,
  onNextYear,
}: {
  month: Date;
  leading?: boolean;
  onPreviousYear?: () => void;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  onNextYear?: () => void;
}) {
  return (
    <div className="grid h-12 grid-cols-[56px_minmax(0,1fr)_56px] items-center px-2.5">
      <div className="flex items-center gap-1">
        {leading ? (
          <>
            <CalendarNavButton label="上一年" onClick={onPreviousYear}><ChevronsLeft size={17} /></CalendarNavButton>
            <CalendarNavButton label="上一月" onClick={onPreviousMonth}><ChevronLeft size={17} /></CalendarNavButton>
          </>
        ) : null}
      </div>
      <div className="text-center text-base font-semibold text-slate-950 dark:text-slate-100">
        {month.getFullYear()}年 {month.getMonth() + 1}月
      </div>
      <div className="flex items-center justify-end gap-1">
        {!leading ? (
          <>
            <CalendarNavButton label="下一月" onClick={onNextMonth}><ChevronRight size={17} /></CalendarNavButton>
            <CalendarNavButton label="下一年" onClick={onNextYear}><ChevronsRight size={17} /></CalendarNavButton>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CalendarNavButton({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-[7px] text-slate-500 hover:bg-[var(--surface-hover)] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[var(--surface-hover)] dark:hover:text-slate-100"
    >
      {children}
    </button>
  );
}

function MonthCalendar({ month, from, to, onSelect }: { month: Date; from: string; to: string; onSelect: (dateKey: string) => void }) {
  const days = getCalendarDays(month);

  return (
    <div>
      <div className="grid grid-cols-7 pb-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span key={day} className="py-1.5">{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((item) => (
          <CalendarDayButton
            key={item.dateKey}
            item={item}
            from={from}
            to={to}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function CalendarDayButton({
  item,
  from,
  to,
  onSelect,
}: {
  item: CalendarDay;
  from: string;
  to: string;
  onSelect: (dateKey: string) => void;
}) {
  const selectedStart = item.dateKey === from;
  const selectedEnd = item.dateKey === to;
  const inRange = Boolean(from && to && compareDateKeys(item.dateKey, from) > 0 && compareDateKeys(item.dateKey, to) < 0);
  const rangeEdgeClass = selectedStart && selectedEnd
    ? "rounded-[8px]"
    : selectedStart
      ? "rounded-l-[8px]"
      : selectedEnd
        ? "rounded-r-[8px]"
        : "";

  return (
    <button
      type="button"
      onClick={() => onSelect(item.dateKey)}
      className={[
        "relative grid h-8 place-items-center text-xs font-medium transition",
        item.inMonth ? "text-slate-900 dark:text-slate-100" : "text-slate-300 dark:text-slate-600",
        inRange || selectedStart || selectedEnd ? `bg-blue-50 dark:bg-blue-500/15 ${rangeEdgeClass}` : "hover:bg-[var(--surface-hover)] dark:hover:bg-[var(--surface-hover)] rounded-[8px]",
      ].join(" ")}
      aria-pressed={selectedStart || selectedEnd}
    >
      <span
        className={[
          "grid size-7 place-items-center rounded-[7px]",
          selectedStart || selectedEnd ? "bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)]" : "",
        ].join(" ")}
      >
        {item.date.getDate()}
      </span>
    </button>
  );
}

function RecentQuestionsPanel({ items, isLoading, isError }: { items: RecentQuestion[]; isLoading: boolean; isError: boolean }) {
  return (
    <section className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-slate-950 dark:text-slate-100">最近相关问题</h2>
        <Link href="/ask" className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200">
          查看全部
        </Link>
      </div>

      {isLoading ? <LoadingBlock label="加载最近问题" /> : null}
      {isError ? <div className="py-5 text-sm text-slate-500 dark:text-slate-400">最近问题暂不可用。</div> : null}
      {!isLoading && !isError ? (
        <div className="divide-y divide-[var(--line)] dark:divide-[var(--line)]">
          {items.length > 0 ? items.map((item) => <RecentQuestionRow key={item.turnId} item={item} />) : (
            <div className="py-5 text-sm text-slate-500 dark:text-slate-400">暂无最近问题。</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function RecentQuestionRow({ item }: { item: RecentQuestion }) {
  return (
    <Link href="/ask" className="grid grid-cols-[1fr_auto] gap-3 py-3">
      <span className="flex min-w-0 items-center gap-3">
        <MessageCircle size={17} className="shrink-0 text-slate-500 dark:text-slate-400" />
        <span className="truncate text-sm text-slate-700 dark:text-slate-300">{item.question || "未命名问题"}</span>
      </span>
      <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{formatRelativeTime(item.createdAt)}</span>
    </Link>
  );
}

function groupResults(results: SearchResult[], kbById: Map<string, KnowledgeBase>): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();

  results.forEach((item) => {
    const kbId = item.kbId ?? "unknown";
    const group = groups.get(kbId) ?? {
      kbId,
      title: kbById.get(kbId)?.name ?? "知识库",
      items: [],
    };

    group.items.push(item);
    groups.set(kbId, group);
  });

  return Array.from(groups.values());
}

function toggleWithinAllSelection<T>(selected: T[], value: T, allValues: T[]) {
  if (selected.length === 0) {
    return allValues.filter((item) => item !== value);
  }

  const next = selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];

  if (next.length === 0 || next.length === allValues.length) {
    return [];
  }

  return next;
}

function isSearchAssetType(value: string): value is SearchAssetType {
  return (ASSET_TYPES as string[]).includes(value);
}

function formatDateRangeLabel(from: string, to: string) {
  if (from && to) {
    return `${from} 至 ${to}`;
  }

  if (from) {
    return `${from} 起`;
  }

  if (to) {
    return `截至 ${to}`;
  }

  return "全部时间";
}

type CalendarDay = {
  date: Date;
  dateKey: string;
  inMonth: boolean;
};

function getCalendarDays(month: Date): CalendarDay[] {
  const firstDay = startOfMonth(month);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const gridStart = addDays(firstDay, -firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);

    return {
      date,
      dateKey: toDateKey(date),
      inMonth: date.getMonth() === month.getMonth(),
    };
  });
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function compareDateKeys(left: string, right: string) {
  return left.localeCompare(right);
}

function displaySourceName(sourceRef?: string, assetId?: string) {
  if (!sourceRef) {
    return assetId ?? "检索结果";
  }

  const segments = sourceRef.split("/");
  return segments[segments.length - 1] || sourceRef;
}

function formatResultPosition(item: SearchResult) {
  const pageNo = item.anchor?.pageNo ?? item.pageNo;
  const chunkOrder = item.anchor?.chunkOrder;

  if (pageNo && chunkOrder !== undefined && chunkOrder !== null) {
    return `P${pageNo} · #${chunkOrder + 1}`;
  }

  if (pageNo) {
    return `P${pageNo}`;
  }

  if (chunkOrder !== undefined && chunkOrder !== null) {
    return `#${chunkOrder + 1}`;
  }

  return "";
}

function renderHighlightedText(value: string) {
  const parts = value.split(/(<em>|<\/em>)/g);
  let highlighted = false;

  return parts.map((part, index) => {
    if (part === "<em>") {
      highlighted = true;
      return null;
    }
    if (part === "</em>") {
      highlighted = false;
      return null;
    }
    if (!part) {
      return null;
    }

    return highlighted ? (
      <mark key={`${part}-${index}`} className="rounded-[4px] bg-amber-100 px-1 text-inherit dark:bg-amber-400/20">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    );
  });
}

function formatRelativeTime(value?: string) {
  if (!value) {
    return "-";
  }

  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) {
    return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
  }

  if (diff < day) {
    return `${Math.round(diff / hour)} 小时前`;
  }

  return `${Math.round(diff / day)} 天前`;
}
