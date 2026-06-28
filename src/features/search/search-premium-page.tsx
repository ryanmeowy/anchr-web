"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  FileImage,
  FileText,
  FileType,
  Folder,
  Hash,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { PremiumRail } from "@/components/app/premium-rail";
import { FileTypeIcon } from "@/components/shared/file-type-icon";
import { apiClient } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import {
  clearPreviewRestoreState,
  normalizeSearchCitations,
  readPreviewRestoreState,
  savePreviewNavigation,
  type PreviewCitation,
} from "@/lib/preview-context";
import type {
  KnowledgeBase,
  RecentSearch,
  SearchAnswer,
  SearchAssetType,
  SearchHitType,
  SearchPage as SearchPageData,
  SearchResult,
} from "@/lib/types";

const DEFAULT_SEARCH_LIMIT = 10;
const MIN_SEARCH_LIMIT = 1;
const MAX_SEARCH_LIMIT = 200;
const SEARCH_TOP_K = 50;
const RECENT_SEARCH_PAGE_SIZE = 8;

const SOURCE_TYPE_LABEL: Record<string, string> = {
  PDF: "PDF",
  IMAGE: "IMAGE",
  TXT: "TXT",
  MD: "MD",
  MARKDOWN: "MD",
};

const HIT_TYPE_OPTIONS: Array<{ value: SearchHitType; label: string }> = [
  { value: "TEXT_CHUNK", label: "文本片段" },
  { value: "IMAGE_OCR_BLOCK", label: "OCR片段" },
];

type SearchTab = "answer" | "results";
type ThemeMode = PremiumThemeMode;

type SearchFiltersValue = {
  kbIds: string[];
  assetTypes: SearchAssetType[];
  hitType: SearchHitType[];
  limit: number;
  dateFrom: string;
  dateTo: string;
  withAnswer: boolean;
};

type SearchMutationVariables = {
  query: string;
  filters: SearchFiltersValue;
  cursor?: string | null;
  append?: boolean;
  startedAt: number;
};

type SearchPremiumReturnState = {
  query: string;
  submittedQuery: string;
  submittedFilters: SearchFiltersValue | null;
  selectedKbIds: string[];
  selectedAssetTypes: SearchAssetType[];
  selectedHitTypes: SearchHitType[];
  recallLimit: number;
  dateFrom: string;
  dateTo: string;
  activeTab: SearchTab;
  searchData: SearchPageData | null;
  elapsedMs: number | null;
  windowScrollY: number;
  answerScrollTop: number;
  resultsScrollTop: number;
};

type ResultGroup = {
  kbId: string;
  title: string;
  items: SearchResult[];
};

export function SearchPremiumPage() {
  const router = useRouter();
  const answerScrollRef = useRef<HTMLDivElement>(null);
  const resultsScrollRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [submittedFilters, setSubmittedFilters] = useState<SearchFiltersValue | null>(null);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<SearchAssetType[]>([]);
  const [selectedHitTypes, setSelectedHitTypes] = useState<SearchHitType[]>([]);
  const [recallLimit, setRecallLimit] = useState(DEFAULT_SEARCH_LIMIT);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("answer");
  const [searchData, setSearchData] = useState<SearchPageData | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [isKbMenuOpen, setIsKbMenuOpen] = useState(false);

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

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
    refetchOnWindowFocus: false,
  });

  const capabilitiesQuery = useQuery({
    queryKey: ["ingestion-capabilities"],
    queryFn: apiClient.ingestionCapabilities,
    refetchOnWindowFocus: false,
  });

  const recentSearchQuery = useInfiniteQuery({
    queryKey: ["activity", "recent-search", "premium", RECENT_SEARCH_PAGE_SIZE],
    queryFn: ({ pageParam }) => apiClient.recentSearch(RECENT_SEARCH_PAGE_SIZE, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const kbItems = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
  const kbById = useMemo(() => new Map(kbItems.map((item) => [item.id, item])), [kbItems]);
  const supportedAssetTypes = useMemo(
    () =>
      (capabilitiesQuery.data?.supportedFormats ?? [])
        .filter((item) => item.enabled)
        .map((item) => item.fileType as SearchAssetType),
    [capabilitiesQuery.data?.supportedFormats],
  );
  const recentSearchItems = useMemo(
    () => recentSearchQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [recentSearchQuery.data?.pages],
  );

  useEffect(() => {
    const restored = readPreviewRestoreState<SearchPremiumReturnState>("search");
    if (!restored?.context.returnState) {
      return;
    }

    const state = restored.context.returnState;
    let scrollFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      setQuery(state.query);
      setSubmittedQuery(state.submittedQuery);
      setSubmittedFilters(state.submittedFilters);
      setSelectedKbIds(state.selectedKbIds);
      setSelectedAssetTypes(state.selectedAssetTypes);
      setSelectedHitTypes(state.selectedHitTypes ?? []);
      setRecallLimit(clampSearchLimit(state.recallLimit));
      setDateFrom(state.dateFrom);
      setDateTo(state.dateTo);
      setActiveTab(state.activeTab);
      setSearchData(state.searchData);
      setElapsedMs(state.elapsedMs);
      clearPreviewRestoreState("search");
      scrollFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: state.windowScrollY });
        if (answerScrollRef.current) answerScrollRef.current.scrollTop = state.answerScrollTop;
        if (resultsScrollRef.current) resultsScrollRef.current.scrollTop = state.resultsScrollTop;
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, []);

  const buildDateRange = useCallback((filters: SearchFiltersValue) => {
    const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : undefined;
    const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`).getTime() : undefined;
    return from === undefined && to === undefined ? undefined : { from, to };
  }, []);

  const searchMutation = useMutation<SearchPageData, Error, SearchMutationVariables>({
    mutationFn: (variables) =>
      apiClient.searchKnowledgeBase({
        query: variables.query,
        topK: SEARCH_TOP_K,
        limit: variables.filters.limit,
        kbIds: variables.filters.kbIds,
        assetTypes: variables.filters.assetTypes.length ? variables.filters.assetTypes : undefined,
        hitType: variables.filters.hitType.length ? variables.filters.hitType : undefined,
        dateRange: buildDateRange(variables.filters),
        cursor: variables.cursor ?? undefined,
        withAnswer: variables.filters.withAnswer,
      }),
    onSuccess: (data, variables) => {
      setElapsedMs(Math.max(1, Math.round(performance.now() - variables.startedAt)));
      setSearchData((previous) => {
        if (!variables.append || !previous) return data;
        return {
          ...data,
          items: [...previous.items, ...(data.items ?? [])],
          answer: previous.answer ?? data.answer,
          facets: data.facets ?? previous.facets,
        };
      });
    },
  });

  const buildFilters = useCallback(
    (withAnswer: boolean): SearchFiltersValue => ({
      kbIds: selectedKbIds,
      assetTypes: selectedAssetTypes,
      hitType: selectedHitTypes,
      limit: clampSearchLimit(recallLimit),
      dateFrom,
      dateTo,
      withAnswer,
    }),
    [dateFrom, dateTo, recallLimit, selectedAssetTypes, selectedHitTypes, selectedKbIds],
  );

  const executeSearch = useCallback(
    (searchText: string, filters: SearchFiltersValue, cursor?: string | null, append = false) => {
      const trimmed = searchText.trim();
      if (!trimmed) return;
      searchMutation.mutate({
        query: trimmed,
        filters,
        cursor,
        append,
        startedAt: performance.now(),
      });
    },
    [searchMutation],
  );

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed || searchMutation.isPending) return;
    const filters = buildFilters(true);
    setSubmittedQuery(trimmed);
    setSubmittedFilters(filters);
    setActiveTab("answer");
    setSearchData(null);
    executeSearch(trimmed, filters);
  };

  const handleTabChange = (tab: SearchTab) => {
    if (tab === "answer" && submittedQuery && submittedFilters?.withAnswer === false && !searchMutation.isPending) {
      const filters = { ...submittedFilters, withAnswer: true };
      setSubmittedFilters(filters);
      setActiveTab("answer");
      executeSearch(submittedQuery, filters);
      return;
    }
    setActiveTab(tab);
  };

  const handleLoadMore = () => {
    if (!submittedQuery || !submittedFilters || !searchData?.nextCursor || searchMutation.isPending) return;
    executeSearch(submittedQuery, submittedFilters, searchData.nextCursor, true);
  };

  const handleRecentSearchSelect = (item: RecentSearch) => {
    const filters: SearchFiltersValue = {
      kbIds: item.kbIds ?? [],
      assetTypes: (item.assetTypes ?? []) as SearchAssetType[],
      hitType: [],
      limit: DEFAULT_SEARCH_LIMIT,
      dateFrom: dateKeyFromTimestamp(item.dateRange?.from),
      dateTo: dateKeyFromTimestamp(item.dateRange?.to),
      withAnswer: item.withAnswer !== false,
    };
    setQuery(item.query);
    setSelectedKbIds(filters.kbIds);
    setSelectedAssetTypes(filters.assetTypes);
    setSelectedHitTypes([]);
    setRecallLimit(DEFAULT_SEARCH_LIMIT);
    setDateFrom(filters.dateFrom);
    setDateTo(filters.dateTo);
    setSubmittedQuery(item.query);
    setSubmittedFilters(filters);
    setActiveTab(filters.withAnswer ? "answer" : "results");
    executeSearch(item.query, filters);
  };

  const buildReturnState = useCallback(
    (): SearchPremiumReturnState => ({
      query,
      submittedQuery,
      submittedFilters,
      selectedKbIds,
      selectedAssetTypes,
      selectedHitTypes,
      recallLimit: clampSearchLimit(recallLimit),
      dateFrom,
      dateTo,
      activeTab,
      searchData,
      elapsedMs,
      windowScrollY: window.scrollY,
      answerScrollTop: answerScrollRef.current?.scrollTop ?? 0,
      resultsScrollTop: resultsScrollRef.current?.scrollTop ?? 0,
    }),
    [
      activeTab,
      dateFrom,
      dateTo,
      elapsedMs,
      query,
      recallLimit,
      searchData,
      selectedAssetTypes,
      selectedHitTypes,
      selectedKbIds,
      submittedFilters,
      submittedQuery,
    ],
  );

  const openPreview = useCallback(
    (
      segmentId: string | undefined,
      citationIndex: number,
      citations: PreviewCitation[],
      context?: { question?: string; answer?: string },
    ) => {
      if (!segmentId) return;
      const contextKey = savePreviewNavigation<SearchPremiumReturnState>({
        source: "search",
        question: context?.question,
        answer: context?.answer,
        citations,
        returnState: buildReturnState(),
      });
      const params = new URLSearchParams({
        from: "search",
        contextKey,
        citationIndex: String(citationIndex),
      });
      router.push(`/preview/${encodeURIComponent(segmentId)}?${params.toString()}`);
    },
    [buildReturnState, router],
  );

  const normalizedCitations = useMemo(
    () => normalizeSearchCitations(searchData?.answer?.citations),
    [searchData?.answer?.citations],
  );
  const resultGroups = useMemo(
    () => groupResults(searchData?.items ?? [], kbById),
    [kbById, searchData?.items],
  );
  const insight = useMemo(
    () => buildInsightData(searchData, normalizedCitations, submittedFilters, kbById),
    [kbById, normalizedCitations, searchData, submittedFilters],
  );
  const isSearching = Boolean(searchMutation.isPending && !searchMutation.variables?.append);
  const isAppending = Boolean(searchMutation.isPending && searchMutation.variables?.append);
  const hasSearched = Boolean(submittedQuery);
  const onlyImageSelected = selectedAssetTypes.length === 1 && selectedAssetTypes[0] === "IMAGE";
  const ocrDisabled = selectedAssetTypes.length > 0 && !selectedAssetTypes.includes("IMAGE");

  return (
    <div
      className="premium-theme ask-premium-page search-premium-page min-h-screen overflow-x-hidden bg-[#f7f7f2] text-[#111315]"
      data-theme={theme}
      data-premium-theme={theme}
    >
      <div
        aria-hidden="true"
        className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(var(--premium-bg-grid)_1px,transparent_1px),linear-gradient(90deg,var(--premium-bg-grid)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]"
      />
      <div
        aria-hidden="true"
        className="ask-premium-glow-bg pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_82%_8%,var(--premium-glow-primary),transparent_28rem),radial-gradient(circle_at_14%_90%,var(--premium-glow-secondary),transparent_30rem)]"
      />

      <div className="relative min-h-screen p-0 lg:p-6">
        <div className="search-premium-shell grid min-h-screen overflow-hidden border border-black/15 bg-white/70 shadow-[var(--premium-shadow)] backdrop-blur-2xl lg:h-[calc(100vh-48px)] lg:min-h-0 lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-[8px]">
          <PremiumRail theme={theme} onThemeChange={setTheme} />

          <div className="search-premium-workspace grid min-h-0 min-w-0">
            <header className="search-premium-hero relative overflow-hidden border-b border-[var(--premium-line)] px-4 py-3 sm:px-5">
              <div className="search-premium-watermark pointer-events-none absolute inset-y-0 right-4 flex items-center text-[72px] font-black leading-none text-black/[0.025]" aria-hidden="true">
                SEARCH
              </div>
              <div className="relative flex h-full items-center">
                <div>
                  <p className="mb-1.5 flex items-center gap-2 text-[10px] font-black text-[var(--premium-blue)]">
                    <span className="search-premium-live-dot size-1.5 rounded-full bg-[var(--premium-accent)]" />
                    SEARCH / EVIDENCE RADAR
                  </p>
                  <h1 className="text-[clamp(22px,2.6vw,36px)] font-black leading-none text-[var(--premium-ink)]">
                    从一条问题，抵达可验证的证据链。
                  </h1>
                </div>
              </div>
            </header>

            <main className="search-premium-content grid min-h-0 min-w-0 gap-3 px-4 py-3 sm:px-5">
              <section className="search-premium-main-column grid min-h-0 min-w-0 gap-2.5" aria-label="搜索结果">
                <form
                  className="search-premium-command premium-focusable grid min-w-0 items-center gap-2 rounded-[8px] border border-[var(--premium-line-strong)] bg-[var(--premium-panel-strong)] p-1.5 pl-4 shadow-[var(--premium-tight-shadow)]"
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSubmit();
                  }}
                >
                  <label className="flex min-w-0 items-center gap-3">
                    <Search size={21} className="shrink-0 text-[var(--premium-muted)]" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-[var(--premium-ink)] outline-none placeholder:text-[var(--premium-muted)]"
                      placeholder="搜索关键词、问题或文件内容"
                      aria-label="搜索关键词"
                    />
                  </label>
                  <SearchTabs activeTab={activeTab} onChange={handleTabChange} />
                  <button
                    type="submit"
                    disabled={!query.trim() || searchMutation.isPending}
                    className="search-premium-submit inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--premium-ink)] px-4 text-xs font-black text-[var(--premium-bg)] transition disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isSearching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                    搜索
                  </button>
                </form>

                <article className="search-premium-answer-card premium-surface relative min-h-0 overflow-hidden rounded-[8px] p-3">
                  <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2">
                    <AnswerHeader
                      activeTab={activeTab}
                      evidenceCount={normalizedCitations.length}
                      resultCount={searchData?.total ?? 0}
                      answer={searchData?.answer?.answer}
                      canRegenerate={Boolean(submittedQuery && submittedFilters) && !searchMutation.isPending}
                      onRegenerate={() => {
                        if (!submittedQuery || !submittedFilters) return;
                        const filters = { ...submittedFilters, withAnswer: true };
                        setSubmittedFilters(filters);
                        executeSearch(submittedQuery, filters);
                      }}
                    />

                    {searchMutation.error ? (
                      <InlineState
                        title="搜索暂时失败"
                        description={searchMutation.error.message || "请稍后重新搜索。"}
                        tone="error"
                      />
                    ) : isSearching ? (
                      <InlineState title="正在检索证据" description="正在搜索知识库并生成可引用回答。" loading />
                    ) : !hasSearched ? (
                      <InlineState title="输入问题开始搜索" description="回答、证据来源与检索洞察将在这里展示。" />
                    ) : activeTab === "answer" ? (
                      <AnswerPanel
                        ref={answerScrollRef}
                        answer={searchData?.answer?.answer}
                        citations={searchData?.answer?.citations ?? []}
                        onPreview={(citation, index) =>
                          openPreview(citation.segmentId, citation.citationIndex ?? index + 1, normalizedCitations, {
                            question: submittedQuery,
                            answer: searchData?.answer?.answer,
                          })
                        }
                      />
                    ) : (
                      <ResultsPanel
                        ref={resultsScrollRef}
                        groups={resultGroups}
                        total={searchData?.total ?? 0}
                        elapsedMs={elapsedMs}
                        hasMore={Boolean(searchData?.nextCursor)}
                        isAppending={isAppending}
                        onLoadMore={handleLoadMore}
                        onPreview={(item) => {
                          const matched = normalizedCitations.find((citation) => citation.segmentId === item.segmentId);
                          const citations = normalizedCitations.length ? normalizedCitations : [searchResultToCitation(item)];
                          openPreview(item.segmentId, matched?.citationIndex ?? 1, citations, {
                            question: submittedQuery,
                            answer: searchData?.answer?.answer,
                          });
                        }}
                      />
                    )}

                    {activeTab === "answer" ? <ContinueExploring /> : <span />}
                  </div>
                </article>

                <RetrievalInsight
                  hasSearched={hasSearched}
                  query={submittedQuery}
                  elapsedMs={elapsedMs}
                  evidenceCount={normalizedCitations.length}
                  insight={insight}
                />
              </section>

              <aside className="search-premium-side-column grid min-h-0 min-w-0 gap-2.5" aria-label="筛选与最近搜索">
                <FilterPanel
                  kbs={kbItems}
                  kbsLoading={kbsQuery.isLoading}
                  selectedKbIds={selectedKbIds}
                  isKbMenuOpen={isKbMenuOpen}
                  onKbMenuToggle={() => setIsKbMenuOpen((open) => !open)}
                  onKbMenuClose={() => setIsKbMenuOpen(false)}
                  onSelectedKbIdsChange={setSelectedKbIds}
                  sourceTypes={supportedAssetTypes}
                  sourceTypesLoading={capabilitiesQuery.isLoading}
                  sourceTypesError={capabilitiesQuery.isError}
                  selectedAssetTypes={selectedAssetTypes}
                  onSelectedAssetTypesChange={(types) => {
                    setSelectedAssetTypes(types);
                    const nextOnlyImage = types.length === 1 && types[0] === "IMAGE";
                    const nextOcrDisabled = types.length > 0 && !types.includes("IMAGE");
                    setSelectedHitTypes((current) =>
                      current.filter((item) => {
                        if (item === "TEXT_CHUNK" && nextOnlyImage) return false;
                        if (item === "IMAGE_OCR_BLOCK" && nextOcrDisabled) return false;
                        return true;
                      }),
                    );
                  }}
                  selectedHitTypes={selectedHitTypes}
                  onSelectedHitTypesChange={setSelectedHitTypes}
                  textDisabled={onlyImageSelected}
                  ocrDisabled={ocrDisabled}
                  recallLimit={recallLimit}
                  onRecallLimitChange={setRecallLimit}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateFromChange={setDateFrom}
                  onDateToChange={setDateTo}
                />
                <RecentSearchPanel
                  items={recentSearchItems}
                  isLoading={recentSearchQuery.isLoading}
                  isError={recentSearchQuery.isError}
                  hasNextPage={recentSearchQuery.hasNextPage}
                  isFetchingNextPage={recentSearchQuery.isFetchingNextPage}
                  onLoadMore={() => recentSearchQuery.fetchNextPage()}
                  onSelect={handleRecentSearchSelect}
                />
                <SearchHealthPanel />
              </aside>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchTabs({ activeTab, onChange }: { activeTab: SearchTab; onChange: (tab: SearchTab) => void }) {
  return (
    <div className="grid h-10 grid-cols-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-1" aria-label="结果模式">
      {[
        { value: "answer" as const, label: "回答" },
        { value: "results" as const, label: "来源" },
      ].map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={[
            "min-w-[58px] rounded-full px-3 text-xs font-black transition",
            activeTab === item.value
              ? "bg-[var(--premium-ink)] text-[var(--premium-bg)] shadow-sm"
              : "text-[var(--premium-muted)] hover:text-[var(--premium-ink)]",
          ].join(" ")}
          aria-pressed={activeTab === item.value}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function AnswerHeader({
  activeTab,
  evidenceCount,
  resultCount,
  answer,
  canRegenerate,
  onRegenerate,
}: {
  activeTab: SearchTab;
  evidenceCount: number;
  resultCount: number;
  answer?: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!answer) return;
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-black text-[var(--premium-ink)]">
          {activeTab === "answer"
            ? evidenceCount > 0
              ? `基于 ${formatNumber(evidenceCount)} 条证据生成`
              : "回答结果"
            : `证据来源 · ${formatNumber(resultCount)} 条`}
        </h2>
        <p className="mt-0.5 truncate text-[10px] text-[var(--premium-muted)]">
          {activeTab === "answer" ? "严格回答模式，保留可点击引用来源。" : "按知识库与相关性组织检索结果。"}
        </p>
      </div>
      {activeTab === "answer" ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!answer}
            className="search-premium-answer-action"
            title="复制回答"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制回答"}
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={!canRegenerate}
            className="search-premium-answer-action"
            title="重新生成"
          >
            <RefreshCcw size={14} />
            重新生成
          </button>
        </div>
      ) : null}
    </div>
  );
}

const AnswerPanel = function AnswerPanel({
  answer,
  citations,
  onPreview,
  ref,
}: {
  answer?: string;
  citations: NonNullable<SearchAnswer["citations"]>;
  onPreview: (citation: NonNullable<SearchAnswer["citations"]>[number], index: number) => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  if (!answer?.trim()) {
    return <InlineState title="暂无可生成的回答" description="可以切换到来源模式查看已召回的文档片段。" />;
  }

  const visibleCitations = citations.slice(0, 3);

  return (
    <div ref={ref} className="search-premium-answer-scroll min-h-0 overflow-auto pr-1">
      <div className="search-premium-answer-text">
        {answer
          .trim()
          .split(/\n{2,}/)
          .map((paragraph, index) => (
            <p key={`${paragraph.slice(0, 24)}-${index}`} className={index === 0 ? "search-premium-answer-lead" : ""}>
              {renderAnswerText(paragraph, citations, onPreview)}
            </p>
          ))}
      </div>

      {visibleCitations.length ? (
        <div className="search-premium-citations mt-3 grid grid-cols-3 gap-2" aria-label="引用来源">
          {visibleCitations.map((citation, index) => (
            <button
              type="button"
              key={`${citation.segmentId}-${citation.citationIndex ?? index}`}
              onClick={() => onPreview(citation, index)}
              disabled={!citation.segmentId}
              className="search-premium-citation min-w-0 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-2.5 py-2 text-left transition"
              title={`[${citation.citationIndex ?? index + 1}] ${citation.fileName ?? "引用来源"}`}
            >
              <span className="block truncate text-[11px] font-black text-[var(--premium-ink)]">
                <b className="mr-1 text-[var(--premium-blue)]">[{citation.citationIndex ?? index + 1}]</b>
                {citation.fileName ?? "引用来源"}
              </span>
              <span className="mt-1 block truncate text-[10px] text-[var(--premium-muted)]">
                {citation.pageNo ? `P${citation.pageNo}` : "文档片段"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const ResultsPanel = function ResultsPanel({
  groups,
  total,
  elapsedMs,
  hasMore,
  isAppending,
  onLoadMore,
  onPreview,
  ref,
}: {
  groups: ResultGroup[];
  total: number;
  elapsedMs: number | null;
  hasMore: boolean;
  isAppending: boolean;
  onLoadMore: () => void;
  onPreview: (item: SearchResult) => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className="search-premium-results-scroll min-h-0 overflow-auto pr-1">
      <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-[var(--premium-muted)]">
        <span>{formatNumber(total)} 条结果</span>
        <span>{elapsedMs ? `${elapsedMs} ms` : "-- ms"}</span>
      </div>
      {groups.length ? (
        <div className="grid gap-2">
          {groups.map((group) => (
            <section key={group.kbId} className="overflow-hidden rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)]">
              <div className="flex items-center gap-2 border-b border-[var(--premium-line)] px-3 py-2">
                <Database size={13} className="text-[var(--premium-muted)]" />
                <h3 className="min-w-0 flex-1 truncate text-[11px] font-black text-[var(--premium-ink)]">{group.title}</h3>
                <span className="text-[9px] text-[var(--premium-muted)]">{group.items.length}</span>
              </div>
              <div className="divide-y divide-[var(--premium-line)]">
                {group.items.map((item, index) => (
                  <ResultRow
                    key={`${item.segmentId ?? item.assetId}-${index}`}
                    item={item}
                    onPreview={() => onPreview(item)}
                  />
                ))}
              </div>
            </section>
          ))}
          {hasMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isAppending}
              className="flex h-9 items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] text-[10px] font-black text-[var(--premium-ink-soft)] transition hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)] disabled:opacity-50"
            >
              {isAppending ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} />}
              加载更多
            </button>
          ) : null}
        </div>
      ) : (
        <InlineState title="没有找到相关来源" description="尝试调整关键词或减少筛选条件。" />
      )}
    </div>
  );
};

function ResultRow({ item, onPreview }: { item: SearchResult; onPreview: () => void }) {
  const type = SOURCE_TYPE_LABEL[item.assetType] ?? item.assetType;
  const position = formatResultPosition(item);

  return (
    <button
      type="button"
      onClick={onPreview}
      disabled={!item.segmentId}
      className="search-premium-result grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5 text-left transition"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <SourceBadge assetType={item.assetType} label={type} />
          <strong className="truncate text-[11px] text-[var(--premium-ink)]">
            {displaySourceName(item.sourceRef, item.assetId)}
          </strong>
        </span>
        <span className="mt-1.5 line-clamp-2 text-[10px] leading-[1.5] text-[var(--premium-ink-soft)]">
          {renderHighlightedText(item.snippet || item.content || item.ocrSummary || "无摘要")}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-[var(--premium-muted)]">
          {position ? <span>{position}</span> : null}
          {item.explain?.hitSources?.length ? <span>{item.explain.hitSources.join(" / ")}</span> : null}
          {item.totalHits ? <span>命中 {formatNumber(item.totalHits)}</span> : null}
        </span>
      </span>
      <span className="flex h-full flex-col items-end justify-between gap-2">
        <b className="rounded-full bg-[rgba(187,255,102,0.28)] px-2 py-1 text-[9px] text-[#456b08] dark:text-[var(--premium-accent)]">
          {item.score === undefined ? "--" : item.score.toFixed(2)}
        </b>
        <ExternalLink size={12} className="text-[var(--premium-blue)]" />
      </span>
    </button>
  );
}

function ContinueExploring() {
  return (
    <div className="search-premium-explore grid shrink-0 grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-2">
      <span className="text-[9px] font-black text-[var(--premium-muted)]">CONTINUE EXPLORING</span>
      {[1, 2, 3].map((item) => (
        <button
          key={item}
          type="button"
          disabled
          className="flex h-8 min-w-0 items-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-3 text-left text-[9px] font-bold text-[var(--premium-muted)]"
        >
          <Sparkles size={11} className="shrink-0" />
          <span className="truncate">建议追问待接入</span>
        </button>
      ))}
    </div>
  );
}

type InsightData = {
  kbCount: number | null;
  fileCount: number | null;
  sourceCounts: Array<{ label: string; count: number }>;
  scopeNames: string[];
};

function RetrievalInsight({
  hasSearched,
  query,
  elapsedMs,
  evidenceCount,
  insight,
}: {
  hasSearched: boolean;
  query: string;
  elapsedMs: number | null;
  evidenceCount: number;
  insight: InsightData;
}) {
  const coverage = insight.kbCount !== null && insight.fileCount !== null
    ? `${insight.kbCount} 库 · ${insight.fileCount} 文件`
    : "--";

  return (
    <section className="search-premium-insight premium-surface min-h-0 overflow-hidden rounded-[8px] p-3" aria-label="检索洞察">
      <div className="flex items-center justify-between border-b border-[var(--premium-line)] pb-2">
        <PanelLabel label="RETRIEVAL INSIGHT" />
        <span className="border-l border-[var(--premium-line)] pl-3 text-[10px] font-black text-[var(--premium-muted)]">
          <b className="mr-1 text-base text-[var(--premium-ink)]">{hasSearched && elapsedMs ? elapsedMs : "--"}</b>MS
        </span>
      </div>

      <div className="search-premium-insight-body min-h-0 overflow-auto">
        <div className="search-premium-insight-query grid border-b border-[var(--premium-line)]">
          <div className="min-w-0 px-3 py-2">
            <span className="search-premium-query-tag">原始问题</span>
            <strong className="mt-1.5 block truncate text-[12px] text-[var(--premium-ink)]">
              {hasSearched ? query : "等待搜索"}
            </strong>
          </div>
          <div className="flex items-center justify-center gap-2 border-x border-[var(--premium-line)] text-[var(--premium-blue)]">
            <ArrowRight size={17} />
            <small className="text-[9px] font-black text-[var(--premium-muted)]">语义改写</small>
          </div>
          <div className="min-w-0 bg-[var(--premium-panel-muted)] px-3 py-2">
            <span className="search-premium-query-tag is-blue">检索词组</span>
            <div className="mt-1.5 flex min-w-0 gap-1.5">
              {[1, 2, 3].map((item) => (
                <span key={item} className="truncate rounded-full border border-[var(--premium-line)] px-2 py-1 text-[9px] font-bold text-[var(--premium-muted)]">
                  待接入
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="search-premium-pipeline grid border-b border-[var(--premium-line)]">
          {[
            { index: 1, name: "关键词召回", detail: "BM25 精确命中", value: "--", unit: "条候选", tone: "blue" },
            { index: 2, name: "语义召回", detail: "向量相似度匹配", value: "--", unit: "条候选", tone: "violet" },
            { index: 3, name: "融合去重", detail: "RRF 合并排序", value: "--", unit: "条保留", tone: "coral" },
            {
              index: 4,
              name: "重排采纳",
              detail: "Cross-encoder 精排",
              value: hasSearched ? formatNumber(evidenceCount) : "--",
              unit: "条证据",
              tone: "lime",
            },
          ].map((item) => (
            <div key={item.index} className={`search-premium-pipe-item is-${item.tone} grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2`}>
              <span className="grid size-7 place-items-center rounded-full text-[10px] font-black">{item.index}</span>
              <span className="min-w-0">
                <strong className="block truncate text-[11px] text-[var(--premium-ink)]">{item.name}</strong>
                <small className="block truncate text-[9px] font-bold text-[var(--premium-muted)]">{item.detail}</small>
              </span>
              <span className="whitespace-nowrap text-right">
                <b className="text-xl leading-none text-[var(--premium-ink)]">{item.value}</b>
                <small className="ml-1 text-[8px] font-bold text-[var(--premium-muted)]">{item.unit}</small>
              </span>
            </div>
          ))}
        </div>

        <div className="search-premium-quality grid border-b border-[var(--premium-line)]">
          <QualityItem label="查询意图" value="待接入" note="--" />
          <QualityItem label="证据覆盖" value={hasSearched ? coverage : "--"} note={hasSearched ? `采用 ${evidenceCount} 个片段` : "--"} />
          <QualityItem label="引用覆盖" value="待接入" note="--" accent />
          <QualityItem label="证据风险" value="待接入" note="--" />
        </div>

        <div className="search-premium-distributions grid gap-2 pt-2">
          <DistributionRow
            label="证据构成"
            items={
              hasSearched && insight.sourceCounts.length
                ? insight.sourceCounts.map((item) => `${item.label} ${item.count} 条`)
                : ["待接入"]
            }
            tone="coral"
          />
          <DistributionRow
            label="检索范围"
            items={hasSearched && insight.scopeNames.length ? insight.scopeNames : ["全部知识库"]}
            tone="blue"
          />
          <DistributionRow label="证据相关性" items={["待接入"]} tone="lime" />
        </div>
      </div>
    </section>
  );
}

function QualityItem({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className={["min-w-0 px-3 py-2", accent ? "bg-[rgba(187,255,102,0.12)]" : ""].join(" ")}>
      <span className="block text-[8px] font-black text-[var(--premium-muted)]">{label}</span>
      <strong className="mt-0.5 block truncate text-[12px] text-[var(--premium-ink)]">{value}</strong>
      <small className="block truncate text-[8px] font-bold text-[var(--premium-muted)]">{note}</small>
    </div>
  );
}

function DistributionRow({ label, items, tone }: { label: string; items: string[]; tone: "blue" | "coral" | "lime" }) {
  return (
    <div className={`search-premium-dist-row is-${tone} flex min-w-0 items-center gap-2 border-l-2 bg-[var(--premium-panel-muted)] px-2.5 py-2`}>
      <span className="w-[64px] shrink-0 text-[8px] font-black text-[var(--premium-muted)]">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className="text-[9px] font-black text-[var(--premium-ink-soft)]">{item}</span>
        ))}
      </div>
    </div>
  );
}

function FilterPanel({
  kbs,
  kbsLoading,
  selectedKbIds,
  isKbMenuOpen,
  onKbMenuToggle,
  onKbMenuClose,
  onSelectedKbIdsChange,
  sourceTypes,
  sourceTypesLoading,
  sourceTypesError,
  selectedAssetTypes,
  onSelectedAssetTypesChange,
  selectedHitTypes,
  onSelectedHitTypesChange,
  textDisabled,
  ocrDisabled,
  recallLimit,
  onRecallLimitChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  kbs: KnowledgeBase[];
  kbsLoading: boolean;
  selectedKbIds: string[];
  isKbMenuOpen: boolean;
  onKbMenuToggle: () => void;
  onKbMenuClose: () => void;
  onSelectedKbIdsChange: (ids: string[]) => void;
  sourceTypes: SearchAssetType[];
  sourceTypesLoading: boolean;
  sourceTypesError: boolean;
  selectedAssetTypes: SearchAssetType[];
  onSelectedAssetTypesChange: (types: SearchAssetType[]) => void;
  selectedHitTypes: SearchHitType[];
  onSelectedHitTypesChange: (types: SearchHitType[]) => void;
  textDisabled: boolean;
  ocrDisabled: boolean;
  recallLimit: number;
  onRecallLimitChange: (limit: number) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
}) {
  const kbById = useMemo(() => new Map(kbs.map((item) => [item.id, item])), [kbs]);
  const selectedLabel = formatSelectedKbLabel(selectedKbIds, kbById);

  return (
    <section className="search-premium-filter premium-surface min-h-0 rounded-[8px] p-3" aria-label="筛选范围">
      <PanelLabel label="FILTER SCOPE" />
      <div className="mt-2.5 grid gap-2.5">
        <FilterBlock title="知识库">
          <KnowledgeBasePicker
            items={kbs}
            selectedKbIds={selectedKbIds}
            selectedLabel={selectedLabel}
            isOpen={isKbMenuOpen}
            isLoading={kbsLoading}
            onToggle={onKbMenuToggle}
            onClose={onKbMenuClose}
            onChange={onSelectedKbIdsChange}
          />
        </FilterBlock>

        <FilterBlock title="来源类型">
          {sourceTypesLoading ? (
            <MiniLoading label="加载来源类型" />
          ) : sourceTypesError ? (
            <span className="text-[10px] text-[var(--premium-muted)]">来源类型暂不可用</span>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {sourceTypes.map((assetType) => (
                <button
                  key={assetType}
                  type="button"
                  onClick={() => onSelectedAssetTypesChange(toggleSelection(selectedAssetTypes, assetType))}
                  className={[
                    "search-premium-filter-chip flex h-8 min-w-0 items-center justify-center gap-1 rounded-full border px-2 text-[9px] font-black transition",
                    selectedAssetTypes.includes(assetType)
                      ? "border-[var(--premium-ink)] bg-[var(--premium-ink)] text-[var(--premium-bg)]"
                      : "border-[var(--premium-line)] bg-[var(--premium-panel-muted)] text-[var(--premium-ink-soft)]",
                  ].join(" ")}
                  aria-pressed={selectedAssetTypes.includes(assetType)}
                >
                  <FileTypeIcon fileName={assetType} sourceType={assetType} compact />
                  <span className="truncate">{SOURCE_TYPE_LABEL[assetType] ?? assetType}</span>
                </button>
              ))}
              {!sourceTypes.length ? <span className="col-span-4 text-[10px] text-[var(--premium-muted)]">暂无可用来源类型</span> : null}
            </div>
          )}
        </FilterBlock>

        <FilterBlock title="筛选类型">
          <div className="grid grid-cols-2 gap-1.5">
            {HIT_TYPE_OPTIONS.map((option) => {
              const disabled =
                (option.value === "TEXT_CHUNK" && textDisabled) ||
                (option.value === "IMAGE_OCR_BLOCK" && ocrDisabled);
              const selected = selectedHitTypes.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectedHitTypesChange(toggleSelection(selectedHitTypes, option.value))}
                  className={[
                    "h-8 rounded-full border text-[9px] font-black transition",
                    selected
                      ? "border-[var(--premium-blue)] bg-[var(--premium-blue-soft)] text-[var(--premium-blue)]"
                      : "border-[var(--premium-line)] bg-[var(--premium-panel-muted)] text-[var(--premium-ink-soft)]",
                    disabled ? "cursor-not-allowed opacity-35" : "",
                  ].join(" ")}
                  aria-pressed={selected}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </FilterBlock>

        <div className="grid grid-cols-2 gap-2">
          <FilterBlock title="召回数量">
            <div className="flex h-9 items-center rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-2.5">
              <input
                type="number"
                min={MIN_SEARCH_LIMIT}
                max={MAX_SEARCH_LIMIT}
                value={recallLimit}
                onChange={(event) => onRecallLimitChange(clampSearchLimit(event.target.valueAsNumber))}
                className="min-w-0 flex-1 bg-transparent text-xs font-black text-[var(--premium-ink)] outline-none"
                aria-label="召回数量"
              />
              <span className="text-[8px] text-[var(--premium-muted)]">1-200</span>
            </div>
          </FilterBlock>
          <FilterBlock title="时间范围">
            <div className="grid h-9 grid-cols-[1fr_auto_1fr] items-center gap-1 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-2">
              <DateInput value={dateFrom} onChange={onDateFromChange} label="开始日期" />
              <span className="text-[8px] text-[var(--premium-muted)]">至</span>
              <DateInput value={dateTo} onChange={onDateToChange} label="结束日期" />
            </div>
          </FilterBlock>
        </div>
      </div>
    </section>
  );
}

function KnowledgeBasePicker({
  items,
  selectedKbIds,
  selectedLabel,
  isOpen,
  isLoading,
  onToggle,
  onClose,
  onChange,
}: {
  items: KnowledgeBase[];
  selectedKbIds: string[];
  selectedLabel: string;
  isOpen: boolean;
  isLoading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (ids: string[]) => void;
}) {
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-3 text-[10px] font-black text-[var(--premium-ink-soft)]"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Database size={13} />
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown size={13} />
      </button>
      {isOpen ? (
        <div className="premium-elevated absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-56 overflow-auto rounded-[8px] p-1.5" role="listbox" aria-multiselectable="true">
          {isLoading ? (
            <MiniLoading label="加载知识库" />
          ) : (
            <>
              <PickerOption
                label="全部知识库"
                selected={selectedKbIds.length === 0}
                icon={<Database size={13} />}
                onClick={() => onChange([])}
              />
              {items.map((item) => (
                <PickerOption
                  key={item.id}
                  label={item.name}
                  selected={selectedKbIds.includes(item.id)}
                  icon={<Folder size={13} />}
                  onClick={() => onChange(toggleSelection(selectedKbIds, item.id))}
                />
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PickerOption({
  label,
  selected,
  icon,
  onClick,
}: {
  label: string;
  selected: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[10px] font-bold",
        selected
          ? "bg-[var(--premium-blue-soft)] text-[var(--premium-blue)]"
          : "text-[var(--premium-ink-soft)] hover:bg-[var(--premium-panel-muted)]",
      ].join(" ")}
      role="option"
      aria-selected={selected}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check size={12} /> : null}
    </button>
  );
}

function DateInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="search-premium-date-input w-full min-w-0 bg-transparent text-[8px] font-bold text-[var(--premium-ink-soft)] outline-none"
      />
      {!value ? <Calendar size={11} className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-[var(--premium-muted)]" /> : null}
    </label>
  );
}

function RecentSearchPanel({
  items,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onSelect,
}: {
  items: RecentSearch[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSelect: (item: RecentSearch) => void;
}) {
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 28) onLoadMore();
  };

  return (
    <section className="search-premium-recent premium-surface flex min-h-0 flex-col rounded-[8px] p-3" aria-label="最近搜索">
      <PanelLabel label="RECENT SEARCHES" value={items.length ? String(items.length) : undefined} />
      <div className="mt-2 min-h-0 flex-1 overflow-auto pr-1" onScroll={handleScroll}>
        {isLoading ? <MiniLoading label="加载最近搜索" /> : null}
        {isError ? <span className="text-[10px] text-[var(--premium-muted)]">最近搜索暂不可用</span> : null}
        {!isLoading && !isError && !items.length ? (
          <span className="text-[10px] text-[var(--premium-muted)]">暂无最近搜索</span>
        ) : null}
        <div className="grid gap-1">
          {items.map((item, index) => (
            <button
              key={`${item.query}-${item.searchedAt ?? index}`}
              type="button"
              onClick={() => onSelect(item)}
              className="search-premium-recent-item grid min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] px-2 py-2 text-left transition"
            >
              <span className="grid size-6 place-items-center rounded-full bg-[var(--premium-panel-muted)] text-[9px] font-black text-[var(--premium-muted)]">
                {index + 1}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-[10px] text-[var(--premium-ink)]">{item.query || "未命名搜索"}</strong>
                <small className="mt-0.5 block truncate text-[8px] text-[var(--premium-muted)]">
                  {item.knowledgeBaseNames?.length ? item.knowledgeBaseNames.slice(0, 2).join(" / ") : "全部知识库"}
                  {" · "}
                  {formatRelativeTime(item.searchedAt)}
                </small>
              </span>
              <b className="text-[10px] text-[var(--premium-blue)]">{formatNumber(item.total)}</b>
            </button>
          ))}
        </div>
        {isFetchingNextPage ? <MiniLoading label="加载更多" /> : null}
      </div>
    </section>
  );
}

function SearchHealthPanel() {
  return (
    <section className="search-premium-health premium-surface rounded-[8px] p-3" aria-label="检索健康度">
      <PanelLabel label="SEARCH HEALTH" value="待接入" />
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <strong className="block text-xl font-black leading-none text-[var(--premium-muted)]">--</strong>
          <span className="mt-1 block text-[8px] text-[var(--premium-muted)]">ES 集群状态接口待接入</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <HealthMetric value="--" label="检索节点" />
          <HealthMetric value="--" label="活跃分片" />
          <HealthMetric value="--" label="未分配" />
        </div>
      </div>
    </section>
  );
}

function HealthMetric({ value, label }: { value: string; label: string }) {
  return (
    <span className="rounded-[8px] bg-[var(--premium-panel-muted)] px-2 py-1.5">
      <b className="block text-[10px] text-[var(--premium-ink)]">{value}</b>
      <small className="block whitespace-nowrap text-[7px] text-[var(--premium-muted)]">{label}</small>
    </span>
  );
}

function PanelLabel({ label, value }: { label: string; value?: string }) {
  return (
    <p className="flex items-center justify-between text-[9px] font-black text-[var(--premium-muted)]">
      <span className="flex items-center gap-2">
        <span className="h-4 w-0.5 rounded-full bg-[var(--premium-blue)]" />
        {label}
      </span>
      {value ? <span>{value}</span> : null}
    </p>
  );
}

function FilterBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-[9px] font-black text-[var(--premium-muted)]">{title}</h3>
      {children}
    </div>
  );
}

function InlineState({
  title,
  description,
  loading = false,
  tone = "neutral",
}: {
  title: string;
  description: string;
  loading?: boolean;
  tone?: "neutral" | "error";
}) {
  return (
    <div className="grid min-h-0 place-items-center rounded-[8px] border border-dashed border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-4 text-center">
      <div>
        <span
          className={[
            "mx-auto mb-2 grid size-8 place-items-center rounded-[8px]",
            tone === "error"
              ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"
              : "bg-[var(--premium-blue-soft)] text-[var(--premium-blue)]",
          ].join(" ")}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        </span>
        <strong className="block text-xs text-[var(--premium-ink)]">{title}</strong>
        <span className="mt-1 block text-[9px] text-[var(--premium-muted)]">{description}</span>
      </div>
    </div>
  );
}

function MiniLoading({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 py-2 text-[9px] font-bold text-[var(--premium-muted)]">
      <Loader2 size={12} className="animate-spin" />
      {label}
    </span>
  );
}

function SourceBadge({ assetType, label }: { assetType: SearchAssetType; label: string }) {
  return (
    <span className={`search-premium-source-badge is-${assetType.toLowerCase()} inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[8px] font-black`}>
      {assetType === "PDF" ? <FileText size={10} /> : null}
      {assetType === "IMAGE" ? <FileImage size={10} /> : null}
      {assetType === "MD" || assetType === "MARKDOWN" ? <Hash size={10} /> : null}
      {assetType !== "PDF" && assetType !== "IMAGE" && assetType !== "MD" && assetType !== "MARKDOWN" ? <FileType size={10} /> : null}
      {label}
    </span>
  );
}

function buildInsightData(
  data: SearchPageData | null,
  citations: PreviewCitation[],
  filters: SearchFiltersValue | null,
  kbById: Map<string, KnowledgeBase>,
): InsightData {
  if (!data) {
    return { kbCount: null, fileCount: null, sourceCounts: [], scopeNames: [] };
  }

  const itemBySegment = new Map(
    data.items.filter((item) => item.segmentId).map((item) => [item.segmentId as string, item]),
  );
  const evidenceItems = citations
    .map((citation) => citation.segmentId ? itemBySegment.get(citation.segmentId) : undefined)
    .filter((item): item is SearchResult => Boolean(item));
  const kbIds = new Set(citations.map((item) => item.kbId).filter(Boolean));
  const fileIds = new Set(
    citations.map((item) => item.assetId || item.fileName).filter(Boolean),
  );
  const sourceCountMap = new Map<string, number>();

  evidenceItems.forEach((item) => {
    const label = item.resultType === "IMAGE_OCR_BLOCK"
      ? "OCR"
      : SOURCE_TYPE_LABEL[item.assetType] ?? item.assetType;
    sourceCountMap.set(label, (sourceCountMap.get(label) ?? 0) + 1);
  });

  const scopeNames = (filters?.kbIds ?? [])
    .map((id) => kbById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  return {
    kbCount: kbIds.size || null,
    fileCount: fileIds.size || null,
    sourceCounts: Array.from(sourceCountMap, ([label, count]) => ({ label, count })),
    scopeNames,
  };
}

function renderAnswerText(
  text: string,
  citations: NonNullable<SearchAnswer["citations"]>,
  onPreview: (citation: NonNullable<SearchAnswer["citations"]>[number], index: number) => void,
) {
  return text.split(/(\[\d+\])/g).map((part, index) => {
    const match = part.match(/^\[(\d+)]$/);
    if (!match) return <span key={`${part.slice(0, 16)}-${index}`}>{part}</span>;
    const citationNumber = Number(match[1]);
    const citationIndex = citations.findIndex((item) => item.citationIndex === citationNumber);
    const citation = citations[citationIndex];
    if (!citation) return <span key={`${part}-${index}`}>{part}</span>;
    return (
      <button
        key={`${part}-${index}`}
        type="button"
        onClick={() => onPreview(citation, citationIndex)}
        disabled={!citation.segmentId}
        className="search-premium-inline-citation"
        aria-label={`查看引用 ${citationNumber}`}
      >
        {part}
      </button>
    );
  });
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

function searchResultToCitation(item: SearchResult): PreviewCitation {
  return {
    citationIndex: 1,
    segmentId: item.segmentId,
    assetId: item.assetId,
    kbId: item.kbId,
    fileName: displaySourceName(item.sourceRef, item.assetId),
    pageNo: item.pageNo ?? item.anchor?.pageNo ?? undefined,
    snippet: item.snippet || item.content || item.ocrSummary,
  };
}

function formatSelectedKbLabel(selectedKbIds: string[], kbById: Map<string, KnowledgeBase>) {
  if (!selectedKbIds.length) return "全部知识库";
  if (selectedKbIds.length === 1) return kbById.get(selectedKbIds[0])?.name ?? "1 个知识库";
  return `已选 ${selectedKbIds.length} 个知识库`;
}

function toggleSelection<T>(selected: T[], value: T) {
  return selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
}

function clampSearchLimit(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(MAX_SEARCH_LIMIT, Math.max(MIN_SEARCH_LIMIT, Math.round(value)));
}

function dateKeyFromTimestamp(value?: number | null) {
  if (!value) return "";
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displaySourceName(sourceRef?: string, assetId?: string) {
  if (!sourceRef) return assetId ?? "检索结果";
  const segments = sourceRef.split("/");
  return segments[segments.length - 1] || sourceRef;
}

function formatResultPosition(item: SearchResult) {
  const pageNo = item.anchor?.pageNo ?? item.pageNo;
  const chunkOrder = item.anchor?.chunkOrder;
  if (pageNo && chunkOrder !== undefined && chunkOrder !== null) return `P${pageNo} · #${chunkOrder + 1}`;
  if (pageNo) return `P${pageNo}`;
  if (chunkOrder !== undefined && chunkOrder !== null) return `#${chunkOrder + 1}`;
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
    if (!part) return null;
    return highlighted ? (
      <mark key={`${part}-${index}`} className="rounded-[4px] bg-[#fff0a8] px-0.5 text-inherit dark:bg-amber-400/20">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    );
  });
}

function formatRelativeTime(value?: string) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.round(diff / hour)} 小时前`;
  return `${Math.round(diff / day)} 天前`;
}
