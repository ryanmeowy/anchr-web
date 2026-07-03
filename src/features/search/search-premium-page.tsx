"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Database,
  Folder,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
  X,
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
import {
  PremiumConfigurationGate,
  PremiumConfigurationLoading,
  PremiumConfigurationShell,
  usePremiumModelConfiguration,
} from "@/components/app/premium-configuration-gate";
import { PremiumRail } from "@/components/app/premium-rail";
import { AssetScopeChip } from "@/components/shared/asset-scope-chip";
import { TransientNotice } from "@/components/shared/transient-notice";
import { apiClient } from "@/lib/api-client";
import {
  consumeAssetScopeHandoff,
  readSearchAssetScope,
  rememberAssetScopes,
  saveSearchAssetScope,
  type AssetScope,
} from "@/lib/asset-scope";
import { formatFileSize, formatNumber } from "@/lib/format";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import {
  clearPreviewRestoreState,
  normalizeSearchCitations,
  readPreviewRestoreState,
  savePreviewNavigation,
  type PreviewCitation,
} from "@/lib/preview-context";
import type {
  ElasticsearchHealth,
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

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

type SearchTab = "answer" | "results";
type ThemeMode = PremiumThemeMode;

type SearchFiltersValue = {
  kbIds: string[];
  assetScope: AssetScope | null;
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
  activeAssetScope: AssetScope | null;
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
  const [activeAssetScope, setActiveAssetScope] = useState<AssetScope | null>(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);

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
  const modelConfiguration = usePremiumModelConfiguration();

  const elasticsearchHealthQuery = useQuery({
    queryKey: ["health", "elasticsearch"],
    queryFn: apiClient.getElasticsearchHealth,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
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
    const handoff = consumeAssetScopeHandoff("search");
    if (handoff) {
      const frame = window.requestAnimationFrame(() => {
        setQuery("");
        setSubmittedQuery("");
        setSubmittedFilters(null);
        setSearchData(null);
        setElapsedMs(null);
        setActiveTab("answer");
        setActiveAssetScope(handoff.scope);
        clearPreviewRestoreState("search");
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const restored = readPreviewRestoreState<SearchPremiumReturnState>("search");
    if (!restored?.context.returnState) {
      const frame = window.requestAnimationFrame(() => {
        setActiveAssetScope(readSearchAssetScope());
      });
      return () => window.cancelAnimationFrame(frame);
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
      setActiveAssetScope(state.activeAssetScope ?? readSearchAssetScope());
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
        limit: variables.filters.limit,
        kbIds: variables.filters.assetScope?.kbId
          ? [variables.filters.assetScope.kbId]
          : variables.filters.kbIds,
        assetIdList: variables.filters.assetScope ? [variables.filters.assetScope.assetId] : undefined,
        assetTypes: variables.filters.assetTypes.length ? variables.filters.assetTypes : undefined,
        hitTypes: variables.filters.hitType.length ? variables.filters.hitType : undefined,
        dateRange: buildDateRange(variables.filters),
        cursor: variables.cursor ?? undefined,
        withAnswer: variables.filters.withAnswer,
      }),
    onSuccess: (data, variables) => {
      rememberAssetScopes((data.answer?.citations ?? []).map((citation) => ({
        assetId: citation.assetId,
        fileName: citation.fileName,
      })));
      setElapsedMs(Math.max(1, Math.round(performance.now() - variables.startedAt)));
      setSearchData((previous) => {
        if (!variables.append || !previous) return data;
        return {
          ...data,
          items: [...previous.items, ...(data.items ?? [])],
          answer: previous.answer ?? data.answer,
          suggestedQuestions: previous.suggestedQuestions ?? data.suggestedQuestions,
          rewrittenKeywords: previous.rewrittenKeywords ?? data.rewrittenKeywords,
          facets: data.facets ?? previous.facets,
        };
      });
    },
  });

  const buildFilters = useCallback(
    (withAnswer: boolean): SearchFiltersValue => ({
      kbIds: selectedKbIds,
      assetScope: activeAssetScope,
      assetTypes: selectedAssetTypes,
      hitType: selectedHitTypes,
      limit: clampSearchLimit(recallLimit),
      dateFrom,
      dateTo,
      withAnswer,
    }),
    [activeAssetScope, dateFrom, dateTo, recallLimit, selectedAssetTypes, selectedHitTypes, selectedKbIds],
  );

  const executeSearch = useCallback(
    (searchText: string, filters: SearchFiltersValue, cursor?: string | null, append = false) => {
      const trimmed = searchText.trim();
      if (!trimmed) return;
      if (!append) setElapsedMs(null);
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

  const handleSuggestedQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || searchMutation.isPending) return;
    const filters = buildFilters(true);
    setQuery(trimmed);
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
    let scopeForSearch = activeAssetScope;
    const changesKbScope = JSON.stringify([...(item.kbIds ?? [])].sort())
      !== JSON.stringify([...selectedKbIds].sort());
    if (activeAssetScope && changesKbScope) {
      saveSearchAssetScope(null);
      setActiveAssetScope(null);
      setScopeNotice("已关闭“仅此资料”范围，并切换知识库");
      scopeForSearch = null;
    }

    const filters: SearchFiltersValue = {
      kbIds: item.kbIds ?? [],
      assetScope: scopeForSearch,
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
      activeAssetScope,
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
      activeAssetScope,
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
  const closeSearchAssetScope = () => {
    saveSearchAssetScope(null);
    setActiveAssetScope(null);
  };
  const handleSelectedKbIdsChange = (ids: string[]) => {
    if (activeAssetScope) {
      closeSearchAssetScope();
      setScopeNotice("已关闭“仅此资料”范围，并切换知识库");
    }
    setSelectedKbIds(ids);
  };

  if (modelConfiguration.isLoading) {
    return (
      <PremiumConfigurationShell theme={theme} onThemeChange={setTheme}>
        <PremiumConfigurationLoading
          theme={theme}
          title="正在检查模型配置"
          description="稍等片刻，系统正在确认向量模型与生成模型状态。"
        />
      </PremiumConfigurationShell>
    );
  }

  if (modelConfiguration.missing.embedding || modelConfiguration.missing.generation) {
    return (
      <PremiumConfigurationShell theme={theme} onThemeChange={setTheme}>
        <PremiumConfigurationGate
          theme={theme}
          description="使用搜索功能需要配置 Embedding 模型和 Generation 模型。"
          statuses={[
            { label: "Embedding 模型", missing: modelConfiguration.missing.embedding },
            { label: "Generation 模型", missing: modelConfiguration.missing.generation },
          ]}
        />
      </PremiumConfigurationShell>
    );
  }

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

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr]">
            <header className="ask-premium-hero relative grid h-[112px] gap-2 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div
                className="pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]"
                aria-hidden="true"
              >
                SEARCH
              </div>
              <section className="relative z-10 flex min-w-0 flex-col justify-center gap-2">
                <div>
                  <p className="ask-premium-kicker mb-1.5 flex items-center gap-2 text-[10px] font-black text-blue-700">
                    <span className="size-1.5 rounded-full bg-[var(--premium-accent)] shadow-[0_0_0_5px_rgba(187,255,102,0.2)]" />
                    SEARCH / EVIDENCE RADAR
                  </p>
                  <h1 className="max-w-[720px] text-[clamp(16px,2.4vw,34px)] font-black leading-none">
                    从一条问题，抵达可验证的证据链。
                  </h1>
                </div>
              </section>
            </header>

            <main className="search-premium-content grid min-h-0 min-w-0 gap-3 px-4 py-3 sm:px-5">
              <section className="search-premium-main-column grid min-h-0 min-w-0 gap-2.5" aria-label="搜索结果">
                <form
                  className="search-premium-command premium-focusable"
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSubmit();
                  }}
                >
                  <label>
                    <Search size={22} aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="search-premium-command-input"
                      placeholder="搜索关键词、问题或文件内容"
                      aria-label="搜索关键词"
                    />
                  </label>
                  <SearchTabs activeTab={activeTab} onChange={handleTabChange} />
                  <button
                    type="submit"
                    disabled={!query.trim() || searchMutation.isPending}
                    className="search-premium-submit"
                  >
                    搜索
                    {isSearching ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} strokeWidth={2.2} />}
                  </button>
                </form>

                <article className="search-premium-answer-card premium-surface">
                  <div className="search-premium-answer-inner">
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
                      scopeContent={activeAssetScope || submittedFilters?.assetScope || scopeNotice ? (
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                          {activeAssetScope ? (
                            <AssetScopeChip
                              scope={activeAssetScope}
                              label="当前范围"
                              onClear={closeSearchAssetScope}
                            />
                          ) : null}
                          {submittedFilters?.assetScope
                            && submittedFilters.assetScope.assetId !== activeAssetScope?.assetId ? (
                              <AssetScopeChip
                                scope={submittedFilters.assetScope}
                                label="当前结果"
                              />
                            ) : null}
                          {scopeNotice ? (
                            <TransientNotice
                              message={scopeNotice}
                              onDismiss={() => setScopeNotice(null)}
                              placement="card"
                            />
                          ) : null}
                        </div>
                      ) : null}
                    />

                    {searchMutation.error ? (
                      <SearchErrorState message={searchMutation.error.message || "请稍后重新搜索。"} />
                    ) : isSearching ? (
                      <SearchLoadingState />
                    ) : !hasSearched ? null : activeTab === "answer" ? (
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

                    {activeTab === "answer" ? (
                      <ContinueExploring
                        questions={searchData?.suggestedQuestions ?? []}
                        onSelect={handleSuggestedQuestion}
                      />
                    ) : <span />}
                  </div>
                </article>

                <RetrievalInsight
                  hasSearched={hasSearched}
                  rewriteResolved={searchData !== null && !searchMutation.isPending}
                  query={submittedQuery}
                  rewrittenKeywords={searchData?.rewrittenKeywords ?? []}
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
                  onSelectedKbIdsChange={handleSelectedKbIdsChange}
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
                <SearchHealthPanel
                  health={elasticsearchHealthQuery.data}
                  error={elasticsearchHealthQuery.error}
                  isLoading={elasticsearchHealthQuery.isLoading}
                  isFetching={elasticsearchHealthQuery.isFetching}
                  onRetry={() => {
                    void elasticsearchHealthQuery.refetch();
                  }}
                />
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
    <div className="search-premium-tabs" aria-label="结果模式">
      {[
        { value: "answer" as const, label: "回答" },
        { value: "results" as const, label: "来源" },
      ].map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={[
            "search-premium-tab",
            activeTab === item.value ? "is-active" : "",
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
  scopeContent,
}: {
  activeTab: SearchTab;
  evidenceCount: number;
  resultCount: number;
  answer?: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
  scopeContent?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!answer) return;
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="search-premium-section-head">
      <div className="min-w-0">
        <h2 className="search-premium-answer-title truncate">
          {activeTab === "answer"
            ? evidenceCount > 0
              ? `基于 ${formatNumber(evidenceCount)} 条证据生成`
              : "回答结果"
            : `证据来源 · ${formatNumber(resultCount)} 条`}
        </h2>
        <p className="search-premium-answer-description truncate">
          {activeTab === "answer" ? "严格回答模式，保留可点击引用来源。" : "按知识库与相关性组织检索结果。"}
        </p>
        {scopeContent}
      </div>
      {activeTab === "answer" && answer?.trim() ? (
        <div className="search-premium-answer-actions">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!answer}
            className="search-premium-answer-action is-copy"
            title="复制回答"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制回答"}
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={!canRegenerate}
            className="search-premium-answer-action is-regenerate"
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
    <div ref={ref} className="search-premium-answer-scroll">
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
        <div className="search-premium-citations" aria-label="引用来源">
          {visibleCitations.map((citation, index) => (
            <button
              type="button"
              key={`${citation.segmentId}-${citation.citationIndex ?? "citation"}-${index}`}
              onClick={() => onPreview(citation, index)}
              disabled={!citation.segmentId}
              className="search-premium-citation"
              title={`[${citation.citationIndex ?? index + 1}] ${citation.fileName ?? "引用来源"}`}
            >
              <span>
                [{citation.citationIndex ?? index + 1}] {citation.fileName ?? "引用来源"}
                {citation.pageNo ? ` P${citation.pageNo}` : ""}
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
  hasMore,
  isAppending,
  onLoadMore,
  onPreview,
  ref,
}: {
  groups: ResultGroup[];
  hasMore: boolean;
  isAppending: boolean;
  onLoadMore: () => void;
  onPreview: (item: SearchResult) => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  const results = groups.flatMap((group) =>
    group.items.map((item) => ({ item, knowledgeBaseName: group.title })),
  );

  return (
    <div ref={ref} className="search-premium-results-scroll">
      {results.length ? (
        <div className="search-premium-result-groups">
          <div className="search-premium-result-group">
            <div className="search-premium-result-list">
              {results.map(({ item, knowledgeBaseName }, index) => (
                <ResultRow
                  key={`${item.segmentId ?? item.assetId}-${index}`}
                  item={item}
                  knowledgeBaseName={knowledgeBaseName}
                  onPreview={() => onPreview(item)}
                />
              ))}
            </div>
          </div>
          {hasMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isAppending}
              className="search-premium-load-more"
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

function ResultRow({
  item,
  knowledgeBaseName,
  onPreview,
}: {
  item: SearchResult;
  knowledgeBaseName: string;
  onPreview: () => void;
}) {
  const type = getEvidenceSourceLabel(item);
  const position = formatResultPosition(item);

  return (
    <button
      type="button"
      onClick={onPreview}
      disabled={!item.segmentId}
      className="search-premium-result"
    >
      <span className="min-w-0">
        <span className="search-premium-result-title">
          <SourceBadge label={type} />
          <strong>
            {displaySourceName(item.sourceRef, item.assetId)}
          </strong>
        </span>
        <span className="search-premium-result-snippet">
          {renderHighlightedText(item.snippet || item.content || item.ocrSummary || "无摘要")}
        </span>
        <span className="search-premium-result-meta">
          <span>{knowledgeBaseName}</span>
          {position ? <span>{position}</span> : null}
          {item.explain?.hitSources?.length ? <span>{item.explain.hitSources.join(" / ")}</span> : null}
        </span>
      </span>
      <span className="search-premium-result-score">
        {item.score === undefined ? "--" : item.score.toFixed(2)}
      </span>
    </button>
  );
}

function ContinueExploring({
  questions,
  onSelect,
}: {
  questions: string[];
  onSelect: (question: string) => void;
}) {
  const visibleQuestions = Array.from(
    new Set(questions.map((question) => question.trim()).filter(Boolean)),
  ).slice(0, 3);

  if (!visibleQuestions.length) {
    return null;
  }

  return (
    <div className="search-premium-explore">
      <span className="search-premium-explore-label">继续探索</span>
      <div className="search-premium-explore-grid">
        {visibleQuestions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onSelect(question)}
            className="search-premium-explore-chip"
            title={question}
          >
            <span className="search-premium-explore-icon">
              <Search size={13} />
            </span>
            <span className="search-premium-explore-text">{question}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type InsightData = {
  kbCount: number | null;
  fileCount: number | null;
  pipeline: {
    keywordCandidates: number | null;
    vectorCandidates: number | null;
    fusedRetained: number | null;
    rerankAdopted: number | null;
  };
  semanticHitCount: number | null;
  keywordHitCount: number | null;
  queryIntent: {
    intent: string;
    category: string;
    fallback: boolean;
  } | null;
  lowRelevanceCount: number | null;
  relevanceDistribution: {
    high: number;
    medium: number;
    low: number;
  } | null;
  sourceCounts: Array<{ label: string; count: number }>;
  scopeNames: string[];
};

function RetrievalInsight({
  hasSearched,
  rewriteResolved,
  query,
  rewrittenKeywords,
  elapsedMs,
  evidenceCount,
  insight,
}: {
  hasSearched: boolean;
  rewriteResolved: boolean;
  query: string;
  rewrittenKeywords: string[];
  elapsedMs: number | null;
  evidenceCount: number;
  insight: InsightData;
}) {
  const coverage = insight.kbCount !== null && insight.fileCount !== null
    ? `${insight.kbCount} 库 · ${insight.fileCount} 文件`
    : "--";
  let hitSourceValue = "--";
  let hitSourceNote = "--";
  if (insight.semanticHitCount !== null && insight.keywordHitCount !== null) {
    hitSourceValue = `语义 ${insight.semanticHitCount} · 关键词 ${insight.keywordHitCount}`;
    if (insight.semanticHitCount === 0 && insight.keywordHitCount === 0) {
      hitSourceNote = "暂无命中信号";
    } else if (insight.semanticHitCount > insight.keywordHitCount) {
      hitSourceNote = "向量为主混合召回";
    } else if (insight.keywordHitCount > insight.semanticHitCount) {
      hitSourceNote = "关键词为主混合召回";
    } else {
      hitSourceNote = "语义与关键词混合召回";
    }
  }
  const intentValue = insight.queryIntent?.intent || "--";
  const intentNote = insight.queryIntent
    ? [
        insight.queryIntent.category || "OTHER",
        insight.queryIntent.fallback ? "FALLBACK" : "",
      ].filter(Boolean).join(" · ")
    : "--";
  const riskValue = insight.lowRelevanceCount === null
    ? "--"
    : insight.lowRelevanceCount === 0
      ? "低风险"
      : `${insight.lowRelevanceCount} 条需复核`;
  const riskNote = insight.lowRelevanceCount === null
    ? "--"
    : insight.lowRelevanceCount === 0
      ? "无低相关证据"
      : `含 ${insight.lowRelevanceCount} 条低相关证据`;
  const queryTerms = Array.from(
    new Set(rewrittenKeywords.map((keyword) => keyword.trim()).filter(Boolean)),
  );
  const rewriteFallback = rewriteResolved && !queryTerms.length && Boolean(query.trim());
  if (rewriteFallback) {
    queryTerms.push(query.trim());
  }

  const latencyColor = hasSearched && elapsedMs !== null
    ? elapsedMs < 2000 ? "is-fast" : elapsedMs < 5000 ? "is-mid" : "is-slow"
    : "";

  return (
    <section className="search-premium-insight premium-surface min-h-0 overflow-hidden rounded-[8px] p-2.5" aria-label="检索洞察">
      <div className="search-premium-insight-header">
        <PanelLabel label="RETRIEVAL INSIGHT" />
        <span className={`search-premium-insight-latency ${latencyColor}`}>
          <span className="search-premium-insight-latency-bar" />
          <span className="search-premium-insight-latency-value">
            <b>{hasSearched && elapsedMs !== null ? formatNumber(elapsedMs) : "--"}</b> MS
          </span>
        </span>
      </div>

      <div className="search-premium-insight-body">
        <div className="search-premium-insight-query">
          <div className="search-premium-query-row is-original">
            <span className="search-premium-query-tag is-original">原始问题</span>
            <span className="search-premium-query-text">
              {hasSearched ? query : ""}
            </span>
          </div>
          <div className="search-premium-query-arrow" aria-hidden="true">
            <span>→</span>
            <small>语义改写</small>
          </div>
          <div className="search-premium-query-row is-rewritten">
            <div className="search-premium-query-tag-row">
              <span className="search-premium-query-tag is-rewritten">检索词组</span>
              {rewriteFallback ? (
                <span className="search-premium-query-fallback">改写失败 · 已降级</span>
              ) : null}
            </div>
            <div className="search-premium-query-terms">
              {hasSearched
                ? queryTerms.map((term) => (
                    <span key={term} className="search-premium-query-term">
                      {term}
                    </span>
                  ))
                : null}
            </div>
          </div>
        </div>

        <div className="search-premium-pipeline" aria-label="检索链路">
          {[
            {
              index: 1,
              name: "关键词召回",
              detail: "BM25 精确命中",
              value: insight.pipeline.keywordCandidates,
              unit: "条候选",
              tone: "blue",
            },
            {
              index: 2,
              name: "语义召回",
              detail: "向量相似度匹配",
              value: insight.pipeline.vectorCandidates,
              unit: "条候选",
              tone: "violet",
            },
            {
              index: 3,
              name: "融合去重",
              detail: "RRF 合并排序",
              value: insight.pipeline.fusedRetained,
              unit: "条保留",
              tone: "coral",
            },
            {
              index: 4,
              name: "重排采纳",
              detail: "Cross-encoder 精排",
              value: insight.pipeline.rerankAdopted ?? (hasSearched ? evidenceCount : null),
              unit: "条证据",
              tone: "lime",
            },
          ].map((item) => (
            <div key={item.index} className={`search-premium-pipe-item is-${item.tone}`}>
              <span className="search-premium-pipe-number">{item.index}</span>
              <span className="search-premium-pipe-body">
                <strong className="search-premium-pipe-name">{item.name}</strong>
                <small className="search-premium-pipe-detail">{item.detail}</small>
              </span>
              <span className="search-premium-pipe-value">
                <b>{hasSearched && item.value !== null ? formatNumber(item.value) : "--"}</b>
                <small>{item.unit}</small>
              </span>
            </div>
          ))}
        </div>

        <div className="search-premium-quality" aria-label="查询理解与答案质量">
          <QualityItem label="查询意图" value={hasSearched ? intentValue : "--"} note={hasSearched ? intentNote : "--"} intent />
          <QualityItem label="证据覆盖" value={hasSearched ? coverage : "--"} note={hasSearched ? `采用 ${evidenceCount} 个片段` : "--"} />
          <QualityItem
            label="命中来源"
            value={hasSearched ? hitSourceValue : "--"}
            note={hasSearched ? hitSourceNote : "--"}
            hitSource
          />
          <QualityItem label="证据风险" value={hasSearched ? riskValue : "--"} note={hasSearched ? riskNote : "--"} />
        </div>

        <div className="search-premium-distributions">
          <DistributionRow
            label="证据构成"
            items={
              hasSearched && insight.sourceCounts.length
                ? insight.sourceCounts.map((item) => `${item.label} ${item.count} 条`)
                : ["--"]
            }
            tone="coral"
          />
          <DistributionRow
            label="检索范围"
            items={hasSearched && insight.scopeNames.length ? insight.scopeNames : ["全部知识库"]}
            tone="blue"
          />
          <DistributionRow
            label="证据相关性"
            items={
              hasSearched && insight.relevanceDistribution
                ? [
                    `高相关 ${insight.relevanceDistribution.high}`,
                    `中相关 ${insight.relevanceDistribution.medium}`,
                    `低相关 ${insight.relevanceDistribution.low}`,
                  ]
                : ["--"]
            }
            tone="lime"
          />
        </div>
      </div>
    </section>
  );
}

function QualityItem({
  label,
  value,
  note,
  hitSource = false,
  intent = false,
}: {
  label: string;
  value: string;
  note: string;
  hitSource?: boolean;
  intent?: boolean;
}) {
  return (
    <div className={["search-premium-quality-item", hitSource ? "is-hit-source" : "", intent ? "is-intent" : ""].filter(Boolean).join(" ")}>
      <span className="search-premium-quality-label">{label}</span>
      <strong className="search-premium-quality-value">{value}</strong>
      <small className="search-premium-quality-note">{note}</small>
    </div>
  );
}

function DistributionRow({ label, items, tone }: { label: string; items: string[]; tone: "blue" | "coral" | "lime" }) {
  const tagTones = tone === "coral" ? ["pdf", "md", "ocr"] : tone === "blue" ? ["kb"] : ["hi", "mid", "lo"];

  return (
    <div className={`search-premium-dist-row is-${tone}`}>
      <span className="search-premium-dist-label">{label}</span>
      <div className="search-premium-dist-tags">
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className={`search-premium-dist-tag is-${tagTones[index % tagTones.length]}`}>{item}</span>
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
    <section className="search-premium-filter premium-surface min-h-0 rounded-[8px] p-2.5" aria-label="筛选范围">
      <PanelLabel label="FILTER SCOPE" />
      <div className="search-premium-filter-stack">
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
            <div className="search-premium-filter-tags">
              {sourceTypes.map((assetType) => (
                <button
                  key={assetType}
                  type="button"
                  onClick={() => onSelectedAssetTypesChange(toggleSelection(selectedAssetTypes, assetType))}
                  className="search-premium-filter-chip"
                  aria-pressed={selectedAssetTypes.includes(assetType)}
                >
                  {SOURCE_TYPE_LABEL[assetType] ?? assetType}
                </button>
              ))}
              {!sourceTypes.length ? <span className="text-[10px] text-[var(--premium-muted)]">暂无可用来源类型</span> : null}
            </div>
          )}
        </FilterBlock>

        <FilterBlock title="筛选类型">
          <div className="search-premium-filter-tags">
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
                  className="search-premium-filter-chip"
                  aria-pressed={selected}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </FilterBlock>

        <FilterBlock title="召回数量">
          <div className="search-premium-filter-row search-premium-number-row">
            <input
              type="number"
              min={MIN_SEARCH_LIMIT}
              max={MAX_SEARCH_LIMIT}
              value={recallLimit}
              onChange={(event) => onRecallLimitChange(clampSearchLimit(event.target.valueAsNumber))}
              className="min-w-0 flex-1 bg-transparent outline-none"
              style={{ colorScheme: "dark" }}
              aria-label="召回数量"
            />
            <span>有效值 1-200</span>
          </div>
        </FilterBlock>

        <FilterBlock title="时间范围">
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={onDateFromChange}
            onDateToChange={onDateToChange}
          />
        </FilterBlock>
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
  const handleChange = (ids: string[]) => {
    onChange(ids);
    onClose();
  };

  return (
    <div
      className="search-premium-kb-picker relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="search-premium-filter-row search-premium-select-row w-full"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown size={15} className="search-premium-kb-chevron" />
      </button>
      {isOpen ? (
        <div
          className="search-premium-kb-menu premium-elevated absolute inset-x-0 top-[calc(100%+6px)] z-[100] max-h-56 overflow-auto rounded-[8px] p-1.5"
          role="listbox"
          aria-multiselectable="true"
        >
          {isLoading ? (
            <MiniLoading label="加载知识库" />
          ) : (
            <>
              <PickerOption
                label="全部知识库"
                selected={selectedKbIds.length === 0}
                icon={<Database size={13} />}
                onClick={() => handleChange([])}
              />
              {items.map((item) => (
                <PickerOption
                  key={item.id}
                  label={item.name}
                  selected={selectedKbIds.includes(item.id)}
                  icon={<Folder size={13} />}
                  onClick={() => handleChange(toggleSelection(selectedKbIds, item.id))}
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
        "search-premium-kb-option",
        selected ? "is-selected" : "",
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

function DateRangePicker({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfCalendarMonth(parseDateKey(dateFrom) ?? new Date()));

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const openPicker = () => {
    if (!isOpen) {
      setVisibleMonth(startOfCalendarMonth(parseDateKey(dateFrom) ?? new Date()));
    }
    setIsOpen((open) => !open);
  };

  const handleDateSelect = (date: Date) => {
    const selectedKey = formatDateKey(date);
    if (!dateFrom || dateTo) {
      onDateFromChange(selectedKey);
      onDateToChange("");
      return;
    }

    if (selectedKey < dateFrom) {
      onDateFromChange(selectedKey);
      onDateToChange(dateFrom);
    } else {
      onDateToChange(selectedKey);
    }
    setIsOpen(false);
  };

  const rightMonth = addCalendarMonths(visibleMonth, 1);
  const hasSelectedRange = Boolean(dateFrom || dateTo);
  const triggerLabel = dateFrom && dateTo
    ? `${dateFrom} 至 ${dateTo}`
    : dateFrom
      ? `${dateFrom} 至 结束日期`
      : "选择时间范围";

  return (
    <div ref={rootRef} className="search-premium-date-range">
      <div className="search-premium-filter-row search-premium-date-range-control">
        <button
          type="button"
          className="search-premium-date-range-trigger"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onClick={openPicker}
        >
          <span className={dateFrom ? "" : "is-placeholder"}>{triggerLabel}</span>
        </button>
        {hasSelectedRange ? (
          <button
            type="button"
            className="search-premium-date-clear"
            aria-label="清除时间范围"
            title="清除时间范围"
            onClick={() => {
              onDateFromChange("");
              onDateToChange("");
              setIsOpen(false);
            }}
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {isOpen ? (
        <div
          ref={popoverRef}
          className="search-premium-date-popover"
          role="dialog"
          aria-label="选择日期范围"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
              rootRef.current?.querySelector("button")?.focus();
            }
          }}
        >
          <div className="search-premium-date-nav">
            <div className="search-premium-date-nav-actions">
              <CalendarNavButton label="上一年" onClick={() => setVisibleMonth((month) => addCalendarMonths(month, -12))}>
                <ChevronsLeft size={18} />
              </CalendarNavButton>
              <CalendarNavButton label="上个月" onClick={() => setVisibleMonth((month) => addCalendarMonths(month, -1))}>
                <ChevronLeft size={18} />
              </CalendarNavButton>
            </div>
            <strong>{formatCalendarMonth(visibleMonth)}</strong>
            <strong className="search-premium-date-second-title">{formatCalendarMonth(rightMonth)}</strong>
            <div className="search-premium-date-nav-actions">
              <CalendarNavButton label="下个月" onClick={() => setVisibleMonth((month) => addCalendarMonths(month, 1))}>
                <ChevronRight size={18} />
              </CalendarNavButton>
              <CalendarNavButton label="下一年" onClick={() => setVisibleMonth((month) => addCalendarMonths(month, 12))}>
                <ChevronsRight size={18} />
              </CalendarNavButton>
            </div>
          </div>

          <div className="search-premium-date-calendars">
            <CalendarMonth
              month={visibleMonth}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onSelect={handleDateSelect}
            />
            <CalendarMonth
              month={rightMonth}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onSelect={handleDateSelect}
              secondary
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CalendarNavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function CalendarMonth({
  month,
  dateFrom,
  dateTo,
  onSelect,
  secondary = false,
}: {
  month: Date;
  dateFrom: string;
  dateTo: string;
  onSelect: (date: Date) => void;
  secondary?: boolean;
}) {
  const days = getCalendarDays(month);
  const todayKey = formatDateKey(new Date());

  return (
    <section className={secondary ? "search-premium-calendar-month is-secondary" : "search-premium-calendar-month"}>
      <div className="search-premium-calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="search-premium-calendar-grid">
        {days.map(({ date, key, currentMonth }) => {
          const isStart = key === dateFrom;
          const isEnd = key === dateTo;
          const isInRange = Boolean(dateFrom && dateTo && key >= dateFrom && key <= dateTo);
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(date)}
              className={[
                "search-premium-calendar-day",
                currentMonth ? "" : "is-outside",
                isInRange ? "is-in-range" : "",
                isStart ? "is-range-start" : "",
                isEnd ? "is-range-end" : "",
                isToday ? "is-today" : "",
              ].filter(Boolean).join(" ")}
              aria-label={formatCalendarDateLabel(date)}
              aria-pressed={isStart || isEnd}
            >
              <span>{date.getDate()}</span>
            </button>
          );
        })}
      </div>
    </section>
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
  const keyedItems = useMemo(() => {
    const occurrences = new Map<string, number>();

    return items.map((item) => {
      const fingerprint = getRecentSearchFingerprint(item);
      const occurrence = occurrences.get(fingerprint) ?? 0;
      occurrences.set(fingerprint, occurrence + 1);
      return { item, key: `${fingerprint}#${occurrence}` };
    });
  }, [items]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 28) onLoadMore();
  };

  return (
    <section className="search-premium-recent premium-surface flex min-h-0 flex-col rounded-[8px] p-2.5" aria-label="最近搜索">
      <PanelLabel label="RECENT SEARCHES" value={items.length ? String(items.length) : undefined} />
      <div className="search-premium-recent-list min-h-0 flex-1" onScroll={handleScroll}>
        {isLoading ? <MiniLoading label="加载最近搜索" /> : null}
        {isError ? <span className="text-[10px] text-[var(--premium-muted)]">最近搜索暂不可用</span> : null}
        {!isLoading && !isError && !items.length ? (
          <span className="text-[10px] text-[var(--premium-muted)]">暂无最近搜索</span>
        ) : null}
        {keyedItems.map(({ item, key }, index) => (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(item)}
            className="search-premium-recent-item"
          >
            <span className="search-premium-recent-num">{index + 1}</span>
            <span className="search-premium-recent-body">
              <strong>{item.query || "未命名搜索"}</strong>
              <span>
                {item.knowledgeBaseNames?.length ? item.knowledgeBaseNames.slice(0, 2).join(" / ") : "全部知识库"}
                {" · "}
                {formatRelativeTime(item.searchedAt)}
              </span>
            </span>
            <span className="search-premium-recent-hit">{formatNumber(item.total)}</span>
          </button>
        ))}
        {isFetchingNextPage ? <MiniLoading label="加载更多" /> : null}
      </div>
    </section>
  );
}

type SearchHealthState = "loading" | "error" | "offline" | "green" | "yellow" | "red" | "unknown";

type SearchHealthView = {
  state: SearchHealthState;
  title: string;
  grade: string;
  summary: string;
  connectionLabel: string;
};

function SearchHealthPanel({
  health,
  error,
  isLoading,
  isFetching,
  onRetry,
}: {
  health?: ElasticsearchHealth;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  onRetry: () => void;
}) {
  const view = getSearchHealthView(health, error, isLoading);
  const connectionState = health?.connected
    ? "online"
    : health
      ? "offline"
      : isLoading
        ? "checking"
        : error
          ? "error"
          : "unknown";
  const hasMetrics = Boolean(health?.connected);
  const nodeCount = hasMetrics ? health?.nodeCount : undefined;
  const dataNodeCount = hasMetrics ? health?.dataNodeCount : undefined;
  const activeShards = hasMetrics ? health?.activeShards : undefined;
  const unassignedShards = hasMetrics ? health?.unassignedShards : undefined;
  const docsCount = hasMetrics ? health?.indices?.docsCount : undefined;
  const storeSizeBytes = hasMetrics ? health?.indices?.storeSizeBytes : undefined;

  return (
    <section
      className="search-premium-health premium-surface rounded-[8px] p-2.5"
      aria-label="ES 服务健康信息"
      aria-busy={isLoading || isFetching}
      data-health-state={view.state}
      data-connection-state={connectionState}
    >
      <div className="search-premium-health-content">
        <div className="search-premium-health-header">
          <p>ES SERVICE HEALTH</p>
          <button
            type="button"
            className="search-premium-health-connection"
            onClick={onRetry}
            disabled={isFetching}
            aria-label={isFetching ? "正在刷新 ES 健康状态" : "刷新 ES 健康状态"}
            title="刷新 ES 健康状态"
          >
            <span>{view.connectionLabel}</span>
          </button>
        </div>
        <div className="search-premium-health-main">
          <span className="search-premium-health-orb" aria-hidden="true">
            {view.state === "loading" ? (
              <Loader2 size={24} className="search-premium-health-spinner" />
            ) : view.state === "error" || view.state === "offline" ? (
              <AlertCircle size={25} />
            ) : (
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M8 9.5 14 6l6 3.5v7L14 20l-6-3.5v-7Z" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="m8.5 9.8 5.5 3.1 5.5-3.1M14 13v6.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="9.5" r="2" fill="currentColor" />
                <circle cx="20" cy="9.5" r="2" fill="currentColor" />
                <circle cx="14" cy="20" r="2" fill="currentColor" />
              </svg>
            )}
          </span>
          <div className="search-premium-health-readout">
            <span className="search-premium-health-kicker">CLUSTER STATUS</span>
            <div className="search-premium-health-status-row">
              <strong>{view.title}</strong>
              <span className="search-premium-health-grade">{view.grade}</span>
            </div>
            <p className="search-premium-health-summary" title={view.summary}>{view.summary}</p>
          </div>
        </div>
        <div className="search-premium-health-stats">
          <HealthMetric
            value={formatHealthCount(nodeCount)}
            label="节点"
            detail={dataNodeCount === undefined ? "等待状态数据" : `${formatNumber(dataNodeCount)} 个数据节点`}
            title={
              nodeCount === undefined
                ? undefined
                : `节点总数 ${formatNumber(nodeCount)}，数据节点 ${dataNodeCount === undefined ? "—" : formatNumber(dataNodeCount)}`
            }
          />
          <HealthMetric
            value={formatHealthCount(activeShards)}
            label="活跃分片"
            detail={unassignedShards === undefined ? "等待状态数据" : `${formatNumber(unassignedShards)} 个未分配`}
            title={
              activeShards === undefined
                ? undefined
                : `活跃分片 ${formatNumber(activeShards)}，未分配分片 ${unassignedShards === undefined ? "—" : formatNumber(unassignedShards)}`
            }
            alert={Boolean(unassignedShards)}
          />
          <HealthMetric
            value={formatCompactHealthCount(docsCount)}
            label="文档"
            detail={storeSizeBytes === undefined ? "等待状态数据" : `占用 ${formatFileSize(storeSizeBytes)}`}
            title={
              docsCount === undefined
                ? undefined
                : `文档 ${formatNumber(docsCount)} 条，占用 ${storeSizeBytes === undefined ? "—" : formatFileSize(storeSizeBytes)}`
            }
          />
        </div>
      </div>
    </section>
  );
}

function HealthMetric({
  value,
  label,
  detail,
  title,
  alert = false,
}: {
  value: string;
  label: string;
  detail: string;
  title?: string;
  alert?: boolean;
}) {
  return (
    <div className={alert ? "search-premium-health-stat is-alert" : "search-premium-health-stat"} title={title}>
      <span className="search-premium-health-stat-primary">
        <b>{value}</b>
        <em>{label}</em>
      </span>
      <small>{detail}</small>
    </div>
  );
}

function getSearchHealthView(
  health: ElasticsearchHealth | undefined,
  error: Error | null,
  isLoading: boolean,
): SearchHealthView {
  if (isLoading && !health) {
    return {
      state: "loading",
      title: "正在检测",
      grade: "CHECKING",
      summary: "正在连接 Elasticsearch…",
      connectionLabel: "CHECKING",
    };
  }

  if (error && !health) {
    return {
      state: "error",
      title: "状态未知",
      grade: "ERROR",
      summary: error.message || "ES 健康接口暂不可用",
      connectionLabel: "UNAVAILABLE",
    };
  }

  if (!health) {
    return {
      state: "unknown",
      title: "状态未知",
      grade: "UNKNOWN",
      summary: "暂未获取 Elasticsearch 状态",
      connectionLabel: "UNKNOWN",
    };
  }

  if (!health.connected) {
    return {
      state: "offline",
      title: "连接中断",
      grade: "OFFLINE",
      summary: health.error || "Elasticsearch 当前无法连接",
      connectionLabel: "OFFLINE",
    };
  }

  const status = health.status?.toLowerCase();
  if (status === "green") {
    return {
      state: "green",
      title: "运行正常",
      grade: "GREEN",
      summary: "Elasticsearch 已连接 · 搜索可用",
      connectionLabel: "ONLINE",
    };
  }

  if (status === "yellow") {
    return {
      state: "yellow",
      title: "需要关注",
      grade: "YELLOW",
      summary: "部分副本分片尚未分配",
      connectionLabel: "ONLINE",
    };
  }

  if (status === "red") {
    return {
      state: "red",
      title: "服务异常",
      grade: "RED",
      summary: "主分片异常，搜索结果可能不完整",
      connectionLabel: "ONLINE",
    };
  }

  return {
    state: "unknown",
    title: "状态未知",
    grade: status?.toUpperCase() || "UNKNOWN",
    summary: "Elasticsearch 已连接，集群状态未知",
    connectionLabel: "ONLINE",
  };
}

function formatHealthCount(value?: number) {
  return value === undefined ? "—" : formatNumber(value);
}

function formatCompactHealthCount(value?: number) {
  if (value === undefined) return "—";
  if (Math.abs(value) < 1_000) return formatNumber(value);

  const divisor = Math.abs(value) >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? "M" : "K";
  const compact = value / divisor;
  return `${compact >= 100 || Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}${suffix}`;
}

function PanelLabel({ label, value }: { label: string; value?: string }) {
  return (
    <p className="flex items-center justify-between gap-3 text-xs font-[900] leading-[normal] text-[var(--search-premium-label)]">
      <span>{label}</span>
      {value ? <span className="inline-flex items-center gap-[5px] text-[10px]">{value}</span> : null}
    </p>
  );
}

function FilterBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="search-premium-filter-block min-w-0">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function SearchLoadingState() {
  return (
    <div className="grid min-h-0 place-items-center" role="status" aria-label="正在检索证据">
      <Loader2 size={22} className="animate-spin text-[var(--premium-blue)]" />
    </div>
  );
}

function SearchErrorState({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-0 items-center justify-center gap-2 px-4 text-center text-xs font-bold text-rose-700 dark:text-rose-200"
      role="alert"
    >
      <AlertCircle size={16} className="shrink-0" />
      <span>搜索暂时失败：{message}</span>
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

function SourceBadge({ label }: { label: string }) {
  return (
    <span className={`search-premium-source-badge is-${label.toLowerCase()}`}>
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
    return {
      kbCount: null,
      fileCount: null,
      pipeline: {
        keywordCandidates: null,
        vectorCandidates: null,
        fusedRetained: null,
        rerankAdopted: null,
      },
      semanticHitCount: null,
      keywordHitCount: null,
      queryIntent: null,
      lowRelevanceCount: null,
      relevanceDistribution: null,
      sourceCounts: [],
      scopeNames: [],
    };
  }

  const itemBySegment = new Map(
    data.items.filter((item) => item.segmentId).map((item) => [item.segmentId as string, item]),
  );
  const itemByAsset = new Map(
    data.items.filter((item) => item.assetId).map((item) => [item.assetId as string, item]),
  );
  const kbIds = new Set(citations.map((item) => item.kbId).filter(Boolean));
  const fileIds = new Set(
    citations.map((item) => item.assetId || item.fileName).filter(Boolean),
  );
  const sourceCountMap = new Map<string, number>();

  citations.forEach((citation) => {
    const item = (citation.segmentId ? itemBySegment.get(citation.segmentId) : undefined)
      ?? (citation.assetId ? itemByAsset.get(citation.assetId) : undefined);
    const label = item
      ? getEvidenceSourceLabel(item)
      : getSourceLabelFromFileName(citation.fileName);
    if (label) {
      sourceCountMap.set(label, (sourceCountMap.get(label) ?? 0) + 1);
    }
  });

  const apiHitSources = data.insight?.hitSourceDistribution;
  let fallbackSemanticCount = 0;
  let fallbackKeywordCount = 0;
  let hasFallbackHitSourceData = false;

  data.items.forEach((item) => {
    const hitSources = (item.explain?.hitSources ?? []).map((source) => source.toLowerCase());
    const isSemanticHit = Boolean(item.explain?.segments?.vector)
      || Boolean(item.explain?.matchedBy?.vector)
      || Boolean(item.explain?.textSignals?.semantic)
      || Boolean(item.explain?.imageSignals?.vector)
      || hitSources.some((source) => source.includes("vector") || source.includes("semantic"));
    const isKeywordHit = Boolean(item.explain?.segments?.keyword)
      || Boolean(item.explain?.matchedBy?.content)
      || Boolean(item.explain?.textSignals?.keyword)
      || hitSources.some((source) =>
        source.includes("content") || source.includes("keyword") || source.includes("bm25"),
      );

    if (isSemanticHit || isKeywordHit || hitSources.length) {
      hasFallbackHitSourceData = true;
    }
    if (isSemanticHit) fallbackSemanticCount += 1;
    if (isKeywordHit) fallbackKeywordCount += 1;
  });

  const scopeNames = (filters?.kbIds ?? [])
    .map((id) => kbById.get(id)?.name)
    .filter((name): name is string => Boolean(name));

  return {
    kbCount: kbIds.size || null,
    fileCount: fileIds.size || null,
    pipeline: {
      keywordCandidates: nullableCount(data.insight?.pipeline?.keywordCandidates),
      vectorCandidates: nullableCount(data.insight?.pipeline?.vectorCandidates),
      fusedRetained: nullableCount(data.insight?.pipeline?.fusedRetained),
      rerankAdopted: nullableCount(data.insight?.pipeline?.rerankAdopted),
    },
    semanticHitCount:
      nullableCount(apiHitSources?.vectorCount)
      ?? (hasFallbackHitSourceData ? fallbackSemanticCount : null),
    keywordHitCount:
      nullableCount(apiHitSources?.contentCount)
      ?? (hasFallbackHitSourceData ? fallbackKeywordCount : null),
    queryIntent: data.insight?.queryIntent
      ? {
          intent: data.insight.queryIntent.intent?.trim() ?? "",
          category: data.insight.queryIntent.category?.trim() ?? "OTHER",
          fallback: Boolean(data.insight.queryIntent.fallback),
        }
      : null,
    lowRelevanceCount: nullableCount(data.insight?.risk?.lowRelevanceCount),
    relevanceDistribution: data.insight?.relevanceDistribution
      ? {
          high: nullableCount(data.insight.relevanceDistribution.high) ?? 0,
          medium: nullableCount(data.insight.relevanceDistribution.medium) ?? 0,
          low: nullableCount(data.insight.relevanceDistribution.low) ?? 0,
        }
      : null,
    sourceCounts: Array.from(sourceCountMap, ([label, count]) => ({ label, count })),
    scopeNames,
  };
}

function nullableCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

function getEvidenceSourceLabel(item: SearchResult) {
  if (item.segmentType === "IMAGE_OCR_BLOCK") {
    return "OCR";
  }
  return SOURCE_TYPE_LABEL[item.assetType] ?? item.assetType;
}

function getSourceLabelFromFileName(fileName?: string) {
  const extension = fileName?.split(".").pop()?.trim().toUpperCase();
  if (!extension) return "";
  if (extension === "MARKDOWN") return "MD";
  if (["PNG", "JPG", "JPEG", "WEBP", "GIF", "BMP"].includes(extension)) return "IMAGE";
  return SOURCE_TYPE_LABEL[extension] ?? extension;
}

function renderAnswerText(
  text: string,
  citations: NonNullable<SearchAnswer["citations"]>,
  onPreview: (citation: NonNullable<SearchAnswer["citations"]>[number], index: number) => void,
) {
  const parts = text.split(/(<em>.*?<\/em>|\[\d+\])/g);
  return parts.map((part, index) => {
    const emMatch = part.match(/^<em>(.*?)<\/em>$/);
    if (emMatch) {
      return <span key={`em-${index}`}>{emMatch[1]}</span>;
    }
    const citationMatch = part.match(/^\[(\d+)]$/);
    if (!citationMatch) return <span key={`${part.slice(0, 16)}-${index}`}>{part}</span>;
    const citationNumber = Number(citationMatch[1]);
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
  const hitSources = item.explain?.hitSources;

  return {
    citationIndex: 1,
    segmentId: item.segmentId,
    assetId: item.assetId,
    kbId: item.kbId,
    fileName: displaySourceName(item.sourceRef, item.assetId),
    pageNo: item.pageNo ?? item.anchor?.pageNo ?? undefined,
    snippet: item.snippet || item.content || item.ocrSummary,
    ...(item.score !== undefined || hitSources?.length
      ? {
          why: {
            ...(item.score !== undefined ? { score: item.score } : {}),
            ...(hitSources?.length ? { hitSources } : {}),
          },
        }
      : {}),
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
  return formatDateKey(date);
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfCalendarMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addCalendarMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function formatCalendarMonth(date: Date) {
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

function formatCalendarDateLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getCalendarDays(month: Date) {
  const monthStart = startOfCalendarMonth(month);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    return {
      date,
      key: formatDateKey(date),
      currentMonth: date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear(),
    };
  });
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

function getRecentSearchFingerprint(item: RecentSearch) {
  return JSON.stringify({
    query: item.query,
    searchedAt: item.searchedAt ?? null,
    kbIds: [...(item.kbIds ?? [])].sort(),
    knowledgeBaseNames: [...(item.knowledgeBaseNames ?? [])].sort(),
    total: item.total,
    assetTypes: [...(item.assetTypes ?? [])].sort(),
    dateFrom: item.dateRange?.from ?? null,
    dateTo: item.dateRange?.to ?? null,
    withAnswer: item.withAnswer ?? null,
    answerMode: item.answerMode ?? null,
  });
}
