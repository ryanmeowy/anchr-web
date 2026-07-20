"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  Grid3X3,
  Link2,
  List,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type UIEvent,
  type WheelEvent,
} from "react";
import { PremiumConfigurationShell } from "@/components/app/premium-configuration-gate";
import { PremiumHeaderUtilities } from "@/components/app/premium-header-utilities";
import { ActionErrorNotice } from "@/components/shared/action-error-notice";
import { FileTypeIcon, fileTypeColor } from "@/components/shared/file-type-icon";
import { apiClient, isAccessDeniedError } from "@/lib/api-client";
import { saveAskAssetScope, saveAssetScopeHandoff, type AssetScope } from "@/lib/asset-scope";
import { formatDateTime, formatFileSize, formatNumber, statusText } from "@/lib/format";
import { PREMIUM_THEME, type PremiumThemeMode } from "@/lib/premium-theme";
import { saveRecentCitationPreviewNavigation } from "@/lib/preview-context";
import type { KnowledgeBase, KnowledgeBaseDocument, KnowledgeBaseHealth, KnowledgeBaseStats, RecentCitation, RecentQuestion } from "@/lib/types";

type ViewMode = "grid" | "list";
type FilterMode = "all" | "answerable" | "archived";
type ThemeMode = PremiumThemeMode;

const KB_GRID_PAGE_SIZE = 6;
const KB_LIST_PAGE_SIZE = 7;
const RECENT_LIMIT = 3;

const filterOptions: Array<{ value: FilterMode; label: string }> = [
  { value: "answerable", label: "可问答" },
  { value: "archived", label: "已归档" },
  { value: "all", label: "全部" },
];

type ArchiveErrorNotice = {
  title: string;
  message: string;
};

export function LibraryPremiumPage({ openedKnowledgeBaseId }: { openedKnowledgeBaseId: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const theme: ThemeMode = PREMIUM_THEME;
  const [keyword, setKeyword] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("answerable");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [page, setPage] = useState(1);
  const [selectedKbIdValue, setSelectedKbIdValue] = useState<string | null>(null);
  const [hoveredKbId, setHoveredKbId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [archiveConfirmKbId, setArchiveConfirmKbId] = useState<string | null>(null);
  const [savingKbId, setSavingKbId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("create") !== "1" || openedKnowledgeBaseId) return;
    const frame = window.requestAnimationFrame(() => {
      setEditingKbId(null);
      setArchiveConfirmKbId(null);
      setFilterMode("answerable");
      setShowCreateForm(true);
      router.replace("/library", { scroll: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openedKnowledgeBaseId, router, searchParams]);
  const [archivingKbId, setArchivingKbId] = useState<string | null>(null);
  const deferredKeyword = useDeferredValue(keyword);
  const trimmedKeyword = deferredKeyword.trim();
  const pageSize = viewMode === "list" ? KB_LIST_PAGE_SIZE : KB_GRID_PAGE_SIZE;

  const queryBody = useMemo(() => {
    const body: {
      keyword?: string;
      status?: string;
      page: number;
      size: number;
    } = {
      page,
      size: pageSize,
    };

    if (trimmedKeyword) {
      body.keyword = trimmedKeyword;
    }

    if (filterMode === "answerable") {
      body.status = "0";
    }

    if (filterMode === "archived") {
      body.status = "1";
    }

    return body;
  }, [filterMode, page, pageSize, trimmedKeyword]);

  const kbsQuery = useQuery({
    queryKey: ["kbs", "premium", queryBody],
    queryFn: () => apiClient.queryKnowledgeBases(queryBody),
    refetchOnWindowFocus: false,
  });

  const citationsQuery = useInfiniteQuery({
    queryKey: ["activity", "recent-citations", RECENT_LIMIT],
    queryFn: ({ pageParam }) => apiClient.recentCitations(RECENT_LIMIT, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const questionsQuery = useInfiniteQuery({
    queryKey: ["activity", "recent-questions", 5],
    queryFn: ({ pageParam }) => apiClient.recentQuestions(5, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
  const openedKbFromCurrentPage = useMemo(
    () => items.find((item) => item.id === openedKnowledgeBaseId) ?? null,
    [items, openedKnowledgeBaseId],
  );
  const openedKbQuery = useQuery({
    queryKey: ["kbs", "detail", openedKnowledgeBaseId],
    queryFn: () => apiClient.getKnowledgeBase(openedKnowledgeBaseId ?? ""),
    enabled: Boolean(openedKnowledgeBaseId && !openedKbFromCurrentPage),
    refetchOnWindowFocus: false,
  });
  const openedKb = openedKbFromCurrentPage ?? openedKbQuery.data ?? null;
  const recentCitations = useMemo(
    () => citationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [citationsQuery.data?.pages],
  );
  const recentQuestions = useMemo(
    () => questionsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [questionsQuery.data?.pages],
  );
  const activeStatsKbIds = useMemo(
    () => items.filter(isActiveKnowledgeBase).map((item) => item.id),
    [items],
  );
  const activeStatsKey = activeStatsKbIds.join("|");
  const statsQuery = useQuery({
    queryKey: ["kbs", "stats", activeStatsKey],
    queryFn: () => apiClient.getKnowledgeBaseStats(activeStatsKbIds),
    enabled: activeStatsKbIds.length > 0,
    refetchOnWindowFocus: false,
  });
  const statsByKbId = useMemo(() => {
    const entries = statsQuery.data?.map((stats) => [stats.kbId, stats] as const) ?? [];
    return new Map(entries);
  }, [statsQuery.data]);
  const total = kbsQuery.data?.total ?? 0;
  const isSearching = trimmedKeyword.length > 0;
  const canShowCreateEntry = filterMode !== "archived";
  const totalWithCreateCard = isSearching || !canShowCreateEntry ? total : total + 1;
  const totalPages = Math.max(1, Math.ceil(totalWithCreateCard / pageSize));
  const shouldShowCreateEntry = canShowCreateEntry && !isSearching && !kbsQuery.isLoading && !kbsQuery.isError && items.length < pageSize;
  const gridItems = items.slice(0, shouldShowCreateEntry ? pageSize - 1 : pageSize);
  const gridEntryCount = gridItems.length + (shouldShowCreateEntry ? 1 : 0);
  const canShowResults = !kbsQuery.isLoading && !kbsQuery.isError;
  const showEmptyResults = canShowResults && items.length === 0 && !shouldShowCreateEntry;
  const activeSelectedKbId = useMemo(() => {
    if (items.length === 0) return null;
    if (hoveredKbId && items.some((item) => item.id === hoveredKbId)) {
      return hoveredKbId;
    }
    if (selectedKbIdValue && items.some((item) => item.id === selectedKbIdValue)) {
      return selectedKbIdValue;
    }

    return items[0].id;
  }, [hoveredKbId, items, selectedKbIdValue]);

  const selectedKb = useMemo(
    () => items.find((item) => item.id === activeSelectedKbId) ?? null,
    [activeSelectedKbId, items],
  );

  const healthQuery = useQuery({
    queryKey: ["kbs", "health", activeSelectedKbId],
    queryFn: () => apiClient.getKnowledgeBaseHealth(activeSelectedKbId ?? ""),
    enabled: Boolean(activeSelectedKbId),
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: apiClient.createKnowledgeBase,
    onSuccess: async (created) => {
      setNewName("");
      setNewDescription("");
      setShowCreateForm(false);
      setPage(1);
      setSelectedKbIdValue(created.id);
      await queryClient.invalidateQueries({ queryKey: ["kbs", "premium"] });
      await queryClient.invalidateQueries({ queryKey: ["kbs", "stats"] });
      await queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ kbId, name, description }: { kbId: string; name: string; description?: string }) =>
      apiClient.updateKnowledgeBase(kbId, { name, description }),
    onSuccess: async (updated) => {
      setEditingKbId(null);
      setEditName("");
      setEditDescription("");
      setSelectedKbIdValue(updated.id);
      await queryClient.invalidateQueries({ queryKey: ["kbs", "premium"] });
      await queryClient.invalidateQueries({ queryKey: ["kbs", "stats"] });
      await queryClient.invalidateQueries({ queryKey: ["kbs", "health", updated.id] });
      await queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
    onSettled: () => setSavingKbId(null),
  });

  const archiveMutation = useMutation({
    mutationFn: apiClient.archiveKnowledgeBase,
    onSuccess: async (_, kbId) => {
      setArchiveConfirmKbId(null);
      if (selectedKbIdValue === kbId) {
        setSelectedKbIdValue(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["kbs", "premium"] });
      await queryClient.invalidateQueries({ queryKey: ["kbs", "stats"] });
      await queryClient.invalidateQueries({ queryKey: ["kbs", "health", kbId] });
      await queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
    onError: (error) => {
      if (isAccessDeniedError(error)) setArchiveConfirmKbId(null);
    },
    onSettled: () => setArchivingKbId(null),
  });

  const updateAccessDenied = isAccessDeniedError(updateMutation.error);
  const archiveAccessDenied = isAccessDeniedError(archiveMutation.error);
  const updatePermissionNotice = getUpdatePermissionNotice(updateMutation.error);
  const archiveErrorNotice = getArchiveErrorNotice(archiveMutation.error);
  const actionErrorNotice = updatePermissionNotice ?? archiveErrorNotice;

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
  };

  const handleFilterChange = (nextFilter: FilterMode) => {
    setFilterMode(nextFilter);
    setEditingKbId(null);
    setArchiveConfirmKbId(null);
    setShowCreateForm(false);
    updateMutation.reset();
    archiveMutation.reset();
    setPage(1);
  };

  const handleStartEdit = (item: KnowledgeBase) => {
    if (!isActiveKnowledgeBase(item)) return;

    setShowCreateForm(false);
    setArchiveConfirmKbId(null);
    updateMutation.reset();
    archiveMutation.reset();
    setEditingKbId(item.id);
    setEditName(item.name);
    setEditDescription(item.description ?? "");
  };

  const handleCancelEdit = () => {
    setEditingKbId(null);
    setEditName("");
    setEditDescription("");
    updateMutation.reset();
  };

  const handleSaveEdit = (kbId: string) => {
    const name = editName.trim();
    if (!name || savingKbId || updateMutation.isPending) return;

    setSavingKbId(kbId);
    updateMutation.mutate({
      kbId,
      name,
      description: editDescription.trim(),
    });
  };

  const handleRequestArchive = (item: KnowledgeBase) => {
    if (!isActiveKnowledgeBase(item)) return;

    setEditingKbId(null);
    updateMutation.reset();
    archiveMutation.reset();
    setArchiveConfirmKbId(item.id);
  };

  const handleCancelArchive = () => {
    setArchiveConfirmKbId(null);
    archiveMutation.reset();
  };

  const handleConfirmArchive = (kbId: string) => {
    if (archivingKbId || archiveMutation.isPending) return;

    setArchivingKbId(kbId);
    archiveMutation.mutate(kbId);
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || createMutation.isPending) return;

    createMutation.mutate({
      name,
      description: newDescription.trim(),
    });
  };

  const handleOpenKnowledgeBase = (item: KnowledgeBase) => {
    setSelectedKbIdValue(item.id);
    router.push(`/library?kbId=${encodeURIComponent(item.id)}`);
  };

  const handleCloseKnowledgeBase = () => {
    router.replace("/library");
  };

  return (
    <PremiumConfigurationShell
      theme={theme}
      scrollContent
      ambientGlow={false}
      pageClassName="library-premium-page library-premium-entry-page"
    >
      <div className="library-premium-content grid min-h-full min-w-0 grid-rows-[auto_minmax(0,1fr)]">
        {actionErrorNotice ? (
          <ActionErrorNotice
            title={actionErrorNotice.title}
            message={actionErrorNotice.message}
            onDismiss={() => {
              if (updatePermissionNotice) updateMutation.reset();
              else archiveMutation.reset();
            }}
          />
        ) : null}
            <header className="ask-premium-hero relative grid h-[112px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div aria-hidden="true" className="ask-premium-watermark pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]">
                LIBRARY
              </div>
              <section className="ask-premium-hero-copy relative z-10 flex min-w-0 flex-col justify-center gap-2">
                <div>
                  <p className="ask-premium-kicker ask-premium-mode-kicker mb-1.5 text-[10px] font-black">
                    {openedKnowledgeBaseId ? "LIBRARY / KNOWLEDGE BASE / DOCUMENTS" : "LIBRARY / KNOWLEDGE ASSET COMMAND"}
                  </p>
                  <h1 className="max-w-[720px] text-[clamp(16px,2.4vw,34px)] font-black leading-none">
                    {openedKnowledgeBaseId ? openedKb?.name ?? "正在恢复文档界面" : "让每个知识库都能被看见、被追踪、被提问。"}
                  </h1>
                  {openedKnowledgeBaseId ? (
                    <p className="mt-1.5 max-w-[720px] truncate text-[11px] font-bold text-[var(--premium-ink-soft)]">
                      {openedKb?.description || "知识库文档资产与版本档案"}
                    </p>
                  ) : null}
                </div>
              </section>
              <PremiumHeaderUtilities
                theme={theme}
                onCreateKnowledgeBase={() => {
                  if (openedKnowledgeBaseId) {
                    router.push("/library?create=1");
                    return;
                  }
                  setEditingKbId(null);
                  setArchiveConfirmKbId(null);
                  setFilterMode("answerable");
                  setShowCreateForm(true);
                }}
              />
            </header>

            {openedKnowledgeBaseId ? openedKb ? (
              <KnowledgeBaseDocumentView
                knowledgeBase={openedKb}
                onBack={handleCloseKnowledgeBase}
              />
            ) : (
              <main className="ask-premium-main library-no-ambient-glow grid min-h-0 place-items-center bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4))] p-6">
                <InlineState
                  label={openedKbQuery.isError
                    ? `知识库暂不可用：${openedKbQuery.error instanceof Error ? openedKbQuery.error.message : "请稍后重试"}`
                    : "正在恢复文档界面"}
                  fill
                />
              </main>
            ) : (
            <main className="ask-premium-main library-no-ambient-glow grid min-h-0 min-w-0 content-start items-start gap-3 overflow-visible bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4))] px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,330px)] lg:items-stretch lg:px-5">
              <section className="flex min-h-0 min-w-0 flex-col" aria-label="我的知识库">
                <div className="mb-7 grid shrink-0 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <form
              className="library-kb-search premium-focusable flex min-h-11 min-w-0 items-center gap-3 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] pr-1 pl-4 shadow-[0_12px_32px_rgba(17,19,21,0.07)] backdrop-blur-xl transition"
                    role="search"
                    onSubmit={handleSearchSubmit}
                  >
                    <Search size={21} className="premium-search-leading-icon shrink-0" />
                    <input
                      value={keyword}
                      onChange={(event) => {
                        setKeyword(event.target.value);
                        setPage(1);
                      }}
                      className="premium-search-input min-w-0 flex-1 border-0 bg-transparent text-[var(--premium-ink)] outline-none"
                      aria-label="搜索知识库"
                      placeholder="搜索知识库"
                    />
                    <button
                      type="submit"
                className="library-kb-search-submit grid size-9 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-[var(--premium-muted)] shadow-none transition-colors duration-200 hover:text-[var(--premium-ink)]"
                      aria-label="搜索"
                    >
                  <svg
                    aria-hidden="true"
                    width="24"
                    height="22"
                    viewBox="0 0 24 22"
                    fill="none"
                  >
                    <path
                      d="M3 11H20"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M14 5L20 11L14 17"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                    </button>
                  </form>

                  <div className="inline-flex w-fit gap-1 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] p-1">
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      className={viewButtonClass(viewMode === "grid")}
                      aria-label="网格视图"
                      aria-pressed={viewMode === "grid"}
                    >
                      <Grid3X3 size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      className={viewButtonClass(viewMode === "list")}
                      aria-label="列表视图"
                      aria-pressed={viewMode === "list"}
                    >
                      <List size={18} />
                    </button>
                  </div>
                </div>

                <div className="library-results-shell flex min-h-0 flex-1 flex-col">
                  <div className="mb-[18px] flex shrink-0 flex-col items-start justify-between gap-2 sm:flex-row sm:items-end">
                    <div>
                      <h2 className="text-[clamp(18px,2vw,24px)] font-black leading-none">我的知识库</h2>
                      <p className="mt-1 text-[11px] text-[var(--premium-muted)]">按可问答状态、文档数量和最近活动组织。</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {filterOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleFilterChange(option.value)}
                          className={[
                            "inline-flex h-7 w-[68px] items-center justify-center rounded-full border px-1 transition hover:-translate-y-0.5",
                            filterMode === option.value
                              ? "border-[var(--premium-ink)] bg-[var(--premium-ink)] text-[var(--premium-bg)]"
                              : "border-[var(--premium-line)] bg-[var(--premium-panel-strong)] text-[var(--premium-ink-soft)] hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)]",
                          ].join(" ")}
                          aria-pressed={filterMode === option.value}
                        >
                          <span className="block max-w-full truncate text-center text-[11px] font-bold leading-none">{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
                    {kbsQuery.isLoading ? <InlineState label="加载知识库" fill /> : null}
                    {kbsQuery.isError ? (
                      <InlineState label={`知识库暂不可用：${kbsQuery.error instanceof Error ? kbsQuery.error.message : "请稍后重试"}`} fill />
                    ) : null}
                    {showEmptyResults ? (
                      <InlineState label={trimmedKeyword ? "没有找到匹配的知识库" : "暂无知识库"} fill />
                    ) : null}

                    {canShowResults && !showEmptyResults && viewMode === "grid" ? (
                      <div
                        className={[
                          "library-card-grid grid grid-cols-1 gap-3 xl:grid-cols-3",
                          gridEntryCount > 3 ? "xl:h-full xl:auto-rows-fr" : "",
                        ].join(" ")}
                      >
                        {gridItems.map((item, index) => (
                          <KnowledgeBaseCard
                            key={item.id}
                            item={item}
                            index={index}
                            stats={statsByKbId.get(item.id)}
                            selected={item.id === activeSelectedKbId}
                            editing={item.id === editingKbId}
                            editName={editName}
                            editDescription={editDescription}
                            saving={savingKbId === item.id}
                            archiveConfirming={archiveConfirmKbId === item.id}
                            archiving={archivingKbId === item.id}
                            updateError={item.id === editingKbId && !updateAccessDenied && updateMutation.error instanceof Error ? updateMutation.error.message : null}
                            archiveError={item.id === archiveConfirmKbId && !archiveAccessDenied ? archiveErrorNotice?.message ?? null : null}
                            onSelect={() => handleOpenKnowledgeBase(item)}
                            onHover={() => {
                              setHoveredKbId(item.id);
                              setSelectedKbIdValue(item.id);
                            }}
                            onHoverEnd={() => setHoveredKbId(null)}
                            onStartEdit={() => handleStartEdit(item)}
                            onCancelEdit={handleCancelEdit}
                            onEditNameChange={setEditName}
                            onEditDescriptionChange={setEditDescription}
                            onSaveEdit={() => handleSaveEdit(item.id)}
                            onRequestArchive={() => handleRequestArchive(item)}
                            onCancelArchive={handleCancelArchive}
                            onConfirmArchive={() => handleConfirmArchive(item.id)}
                          />
                        ))}
                        {shouldShowCreateEntry ? <CreateKnowledgeBaseCard
                          expanded={showCreateForm}
                          name={newName}
                          description={newDescription}
                          pending={createMutation.isPending}
                          error={createMutation.error instanceof Error ? createMutation.error.message : null}
                          onExpand={() => {
                            setEditingKbId(null);
                            setArchiveConfirmKbId(null);
                            setShowCreateForm(true);
                          }}
                          onCancel={() => {
                            setShowCreateForm(false);
                            setNewName("");
                            setNewDescription("");
                          }}
                          onNameChange={setNewName}
                          onDescriptionChange={setNewDescription}
                          onCreate={handleCreate}
                        /> : null}
                      </div>
                    ) : null}

                    {canShowResults && !showEmptyResults && viewMode === "list" ? (
                      <div className="flex min-h-0 flex-col overflow-x-auto rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] shadow-[var(--premium-tight-shadow)]">
                        <div className="grid min-w-[860px] grid-cols-[minmax(0,1fr)_92px_112px_136px_184px] items-center gap-4 border-b border-[var(--premium-line)] px-5 py-3 text-xs font-black text-[var(--premium-muted)]">
                          <span>知识库</span>
                          <span className="text-center">文档</span>
                          <span className="text-center">片段</span>
                          <span className="text-center">更新时间</span>
                          <span className="text-center">操作</span>
                        </div>
                        <div className="grid min-h-0 min-w-[860px] auto-rows-[92px] divide-y divide-[var(--premium-line)]">
                          {items.map((item, index) => (
                            <KnowledgeBaseListRow
                              key={item.id}
                              item={item}
                              index={index}
                              selected={item.id === activeSelectedKbId}
                              editing={item.id === editingKbId}
                              editName={editName}
                              editDescription={editDescription}
                              saving={savingKbId === item.id}
                              archiveConfirming={archiveConfirmKbId === item.id}
                              archiving={archivingKbId === item.id}
                              updateError={item.id === editingKbId && !updateAccessDenied && updateMutation.error instanceof Error ? updateMutation.error.message : null}
                              archiveError={item.id === archiveConfirmKbId && !archiveAccessDenied ? archiveErrorNotice?.message ?? null : null}
                              onSelect={() => handleOpenKnowledgeBase(item)}
                              onHover={() => {
                                setHoveredKbId(item.id);
                                setSelectedKbIdValue(item.id);
                              }}
                              onHoverEnd={() => setHoveredKbId(null)}
                              onStartEdit={() => handleStartEdit(item)}
                              onCancelEdit={handleCancelEdit}
                              onEditNameChange={setEditName}
                              onEditDescriptionChange={setEditDescription}
                              onSaveEdit={() => handleSaveEdit(item.id)}
                              onRequestArchive={() => handleRequestArchive(item)}
                              onCancelArchive={handleCancelArchive}
                              onConfirmArchive={() => handleConfirmArchive(item.id)}
                            />
                          ))}
                          {shouldShowCreateEntry ? <CreateKnowledgeBaseListRow
                            expanded={showCreateForm}
                            name={newName}
                            description={newDescription}
                            pending={createMutation.isPending}
                            error={createMutation.error instanceof Error ? createMutation.error.message : null}
                            onExpand={() => {
                              setEditingKbId(null);
                              setArchiveConfirmKbId(null);
                              setShowCreateForm(true);
                            }}
                            onCancel={() => {
                              setShowCreateForm(false);
                              setNewName("");
                              setNewDescription("");
                            }}
                            onNameChange={setNewName}
                            onDescriptionChange={setNewDescription}
                            onCreate={handleCreate}
                          /> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 pt-3">
                    <KnowledgeBasePagination
                      page={page}
                      total={total}
                      visibleCount={items.length}
                      pageSize={pageSize}
                      totalPages={totalPages}
                      isFetching={kbsQuery.isFetching}
                      onPageChange={setPage}
                    />
                  </div>
                </div>
              </section>

              <aside className="grid content-start gap-3 overflow-visible lg:min-h-0 lg:min-w-0 lg:grid-rows-[288px_288px_288px]" aria-label="活动洞察">
                <div className="min-h-[184px]">
                  <HealthPanel
                    selectedKb={selectedKb}
                    health={healthQuery.data}
                    isLoading={healthQuery.isLoading}
                    isRefreshing={healthQuery.isFetching && !healthQuery.isLoading}
                    isError={healthQuery.isError}
                  />
                </div>
                <RecentQuestionPanel
                  items={recentQuestions}
                  isLoading={questionsQuery.isLoading}
                  isError={questionsQuery.isError}
                  hasNextPage={Boolean(questionsQuery.hasNextPage)}
                  isFetchingNextPage={questionsQuery.isFetchingNextPage}
                  onLoadMore={() => void questionsQuery.fetchNextPage()}
                />
                <RecentCitationPanel
                  items={recentCitations}
                  isLoading={citationsQuery.isLoading}
                  isError={citationsQuery.isError}
                  hasNextPage={Boolean(citationsQuery.hasNextPage)}
                  isFetchingNextPage={citationsQuery.isFetchingNextPage}
                  onLoadMore={() => void citationsQuery.fetchNextPage()}
                />
              </aside>
            </main>
            )}
          </div>
    </PremiumConfigurationShell>
  );
}

type LibraryDocumentType = "PDF" | "MD" | "IMAGE" | "TXT";

type LibraryDocumentItem = {
  id: string;
  name: string;
  type: LibraryDocumentType;
  version: number;
  importedAt?: string;
  size: string;
  segments: number;
  previewAvailable: boolean;
  parseStatus: string;
  indexStatus: string;
};
const DOCUMENT_GRID_PAGE_SIZES = [24, 48, 72] as const;
const DOCUMENT_LIST_PAGE_SIZES = [25, 50, 100] as const;

function KnowledgeBaseDocumentView({
  knowledgeBase,
  onBack,
}: {
  knowledgeBase: KnowledgeBase;
  onBack: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const documentListRef = useRef<HTMLElement | null>(null);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | LibraryDocumentType>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [documentPage, setDocumentPage] = useState(1);
  const [documentPageSize, setDocumentPageSize] = useState<number>(DOCUMENT_GRID_PAGE_SIZES[0]);
  const [deleteTarget, setDeleteTarget] = useState<LibraryDocumentItem | null>(null);
  const [askingDocumentId, setAskingDocumentId] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const deferredDocumentKeyword = useDeferredValue(keyword.trim());
  const documentsQuery = useQuery({
    queryKey: [
      "kbs",
      knowledgeBase.id,
      "documents",
      documentPage,
      documentPageSize,
      deferredDocumentKeyword,
      typeFilter,
    ],
    queryFn: () => apiClient.listKnowledgeBaseDocuments(knowledgeBase.id, {
      page: documentPage,
      size: documentPageSize,
      ...(deferredDocumentKeyword ? { keyword: deferredDocumentKeyword } : {}),
      ...(typeFilter !== "ALL" ? { fileType: typeFilter } : {}),
    }),
    refetchOnWindowFocus: false,
  });
  const documents = useMemo(
    () => (documentsQuery.data?.items ?? []).map(toLibraryDocumentItem),
    [documentsQuery.data?.items],
  );
  const documentTotal = documentsQuery.data?.total ?? 0;
  const documentSegmentTotal = documentsQuery.data?.segmentTotal ?? 0;
  const documentTotalPages = Math.max(1, Math.ceil(documentTotal / documentPageSize));
  const activeDocumentPage = Math.min(documentPage, documentTotalPages);
  const deleteMutation = useMutation({
    mutationFn: (assetId: string) => apiClient.deleteKnowledgeBaseDocument(knowledgeBase.id, assetId),
    onSuccess: async () => {
      setDeleteTarget(null);
      if (documents.length === 1 && documentPage > 1) {
        setDocumentPage((page) => Math.max(1, page - 1));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["kbs", knowledgeBase.id, "documents"] }),
        queryClient.invalidateQueries({ queryKey: ["kbs", "stats"] }),
        queryClient.invalidateQueries({ queryKey: ["kbs", "health", knowledgeBase.id] }),
        queryClient.invalidateQueries({ queryKey: ["kbs", "premium"] }),
        queryClient.invalidateQueries({ queryKey: ["activity", "recent-citations"] }),
      ]);
    },
  });

  const handleDocumentViewModeChange = (nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    setDocumentPageSize(nextViewMode === "grid" ? DOCUMENT_GRID_PAGE_SIZES[0] : DOCUMENT_LIST_PAGE_SIZES[1]);
    setDocumentPage(1);
  };

  const handleDocumentPageChange = (nextPage: number) => {
    setDocumentPage(nextPage);
    window.requestAnimationFrame(() => {
      documentListRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  const handlePreview = (document: LibraryDocumentItem) => {
    if (!document.previewAvailable) return;
    const params = new URLSearchParams({ kbId: knowledgeBase.id });
    router.push(`/preview/asset/${encodeURIComponent(document.id)}?${params.toString()}`);
  };

  const handleAskDocument = async (document: LibraryDocumentItem) => {
    if (askingDocumentId) return;
    setAskingDocumentId(document.id);
    setDocumentActionError(null);
    try {
      const session = await apiClient.createConversation({
        title: null,
        kbIds: [knowledgeBase.id],
        assetIdList: [document.id],
      });
      const scope: AssetScope = {
        assetId: document.id,
        fileName: document.name,
        kbId: knowledgeBase.id,
      };
      saveAskAssetScope(session.sessionId, scope);
      saveAssetScopeHandoff({ destination: "ask", scope, sessionId: session.sessionId });
      router.push(`/ask?session=${encodeURIComponent(session.sessionId)}`);
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : "创建文档问答会话失败");
      setAskingDocumentId(null);
    }
  };

  const handleRequestDelete = (document: LibraryDocumentItem) => {
    deleteMutation.reset();
    setDeleteTarget(document);
  };

  const handleCancelDelete = () => {
    if (deleteMutation.isPending) return;
    deleteMutation.reset();
    setDeleteTarget(null);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget || deleteMutation.isPending) return;
    deleteMutation.mutate(deleteTarget.id);
  };

  return (
    <>
    <main className="ask-premium-main library-no-ambient-glow library-document-view min-h-0 min-w-0 overflow-auto bg-[linear-gradient(100deg,rgba(255,255,255,0.88),rgba(255,255,255,0.4))] px-4 py-4 sm:px-5 lg:px-5" aria-label={`${knowledgeBase.name} 文档`}>
      <div className="mx-auto grid w-full max-w-[1500px] gap-4">
        <section className="library-document-command relative overflow-hidden rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-rail)] p-4 text-white shadow-[var(--premium-tight-shadow)] sm:p-5">
          <div aria-hidden="true" className="library-document-orbit absolute -right-12 -top-20 size-64 rounded-full border border-white/10" />
          <div aria-hidden="true" className="library-document-orbit library-document-orbit-secondary absolute -right-3 -top-8 size-40 rounded-full border border-[rgba(187,255,102,0.28)]" />
          <div className="relative z-10 grid items-end gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="group mb-6 inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 text-[11px] font-black text-white/75 transition duration-300 hover:-translate-x-1 hover:border-white/30 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-accent)]"
              >
                <ArrowLeft size={15} className="transition group-hover:-translate-x-0.5" />
                返回知识库
              </button>
              <p className="mb-2 text-[10px] font-black text-[#87CEEB]">
                DOCUMENT LEDGER / LIVE ARCHIVE
              </p>
              <h2 className="max-w-[820px] text-[clamp(25px,4vw,54px)] font-black leading-[0.94]">
                <span className="block">文档不只是文件</span>
                <span className="mt-1 block text-[#89C777]">而是可追溯的知识版本</span>
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
              <DocumentMetric value={formatNumber(documentTotal)} label="DOCUMENTS" />
              <DocumentMetric value={formatNumber(documentSegmentTotal)} label="SEGMENTS" />
              <DocumentMetric value="READY" label="INDEX" accent />
            </div>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]" aria-label="文档筛选">
          <label className="library-document-search premium-focusable flex min-h-11 min-w-0 items-center gap-3 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-4 shadow-[0_12px_32px_rgba(17,19,21,0.07)] transition focus-within:!border-[#87CEEB]">
            <Search size={19} className="shrink-0 text-[var(--premium-muted)]" />
            <span className="sr-only">搜索文档</span>
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setDocumentPage(1);
              }}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--premium-ink)] outline-none placeholder:text-[var(--premium-muted)]"
              placeholder="搜索文档名称…"
            />
            <span className="hidden text-[10px] font-black text-[var(--premium-muted)] sm:inline">
              {documentsQuery.isFetching ? "LOADING" : `${documentTotal} RESULTS`}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] p-1" aria-label="文档类型">
              <SlidersHorizontal size={14} className="ml-2 text-[var(--premium-muted)]" />
              {(["ALL", "PDF", "MD", "IMAGE", "TXT"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setTypeFilter(type);
                    setDocumentPage(1);
                  }}
                  aria-pressed={typeFilter === type}
                  className={[
                    "h-8 rounded-full px-3 text-[10px] font-black transition duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-blue)]",
                    typeFilter === type
                      ? "bg-[var(--premium-ink)] text-[var(--premium-bg)] shadow-[0_8px_18px_rgba(17,19,21,0.14)]"
                      : "text-[var(--premium-muted)] hover:bg-[var(--premium-panel-muted)] hover:text-[var(--premium-ink)]",
                  ].join(" ")}
                >
                  {type === "ALL" ? "全部" : type}
                </button>
              ))}
            </div>
            <div className="inline-flex gap-1 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] p-1">
              <button type="button" onClick={() => handleDocumentViewModeChange("grid")} className={viewButtonClass(viewMode === "grid")} aria-label="文档卡片视图" aria-pressed={viewMode === "grid"}><Grid3X3 size={16} /></button>
              <button type="button" onClick={() => handleDocumentViewModeChange("list")} className={viewButtonClass(viewMode === "list")} aria-label="文档列表视图" aria-pressed={viewMode === "list"}><List size={16} /></button>
            </div>
          </div>
        </section>

        <section ref={documentListRef} aria-labelledby="document-list-title">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h3 id="document-list-title" className="text-[clamp(19px,2.2vw,28px)] font-black leading-none">库内文档</h3>
            </div>
            <p className="hidden text-right text-[11px] leading-5 text-[var(--premium-muted)] sm:block">
              点击文档进入预览<br />版本与入库时间永久留痕
            </p>
          </div>

          {documentActionError ? (
            <div className="mb-3 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
              {documentActionError}
            </div>
          ) : null}

          {documentsQuery.isLoading ? (
            <InlineState label="正在加载文档" />
          ) : documentsQuery.isError ? (
            <InlineState label={`文档暂不可用：${documentsQuery.error instanceof Error ? documentsQuery.error.message : "请稍后重试"}`} />
          ) : documents.length === 0 ? (
            <InlineState label="没有找到匹配的文档" />
          ) : viewMode === "grid" ? (
            <div className="library-document-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {documents.map((document, index) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  index={index}
                  onPreview={() => handlePreview(document)}
                  onAsk={() => void handleAskDocument(document)}
                  asking={askingDocumentId === document.id}
                  onDelete={() => handleRequestDelete(document)}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] shadow-[var(--premium-tight-shadow)]">
              <div className="grid min-w-[880px] grid-cols-[minmax(0,1fr)_100px_100px_168px_210px] gap-4 border-b border-[var(--premium-line)] px-4 py-3 text-[10px] font-black text-[var(--premium-muted)]">
                <span>文档名称</span><span>类型</span><span>版本</span><span>入库时间</span><span className="flex items-center justify-center">操作</span>
              </div>
              <div className="divide-y divide-[var(--premium-line)]">
                {documents.map((document, index) => (
                  <DocumentListItem
                    key={document.id}
                    document={document}
                    index={index}
                    onPreview={() => handlePreview(document)}
                    onAsk={() => void handleAskDocument(document)}
                    asking={askingDocumentId === document.id}
                    onDelete={() => handleRequestDelete(document)}
                  />
                ))}
              </div>
            </div>
          )}
          {!documentsQuery.isLoading && !documentsQuery.isError && documentTotal > 0 ? (
            <DocumentPagination
              page={activeDocumentPage}
              total={documentTotal}
              pageSize={documentPageSize}
              pageSizeOptions={viewMode === "grid" ? DOCUMENT_GRID_PAGE_SIZES : DOCUMENT_LIST_PAGE_SIZES}
              totalPages={documentTotalPages}
              onPageChange={handleDocumentPageChange}
              onPageSizeChange={(nextPageSize) => {
                setDocumentPageSize(nextPageSize);
                handleDocumentPageChange(1);
              }}
            />
          ) : null}
        </section>
      </div>
    </main>
    {deleteTarget ? (
      <DocumentDeleteDialog
        document={deleteTarget}
        pending={deleteMutation.isPending}
        error={deleteMutation.error instanceof Error ? deleteMutation.error.message : null}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    ) : null}
    </>
  );
}

function DocumentPagination({
  page,
  total,
  pageSize,
  pageSizeOptions,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const visiblePages = getVisiblePages(page, totalPages);

  return (
    <nav className="library-document-pagination mt-4 grid gap-3 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] p-3 shadow-[var(--premium-tight-shadow)] backdrop-blur-xl lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" aria-label="文档分页">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-bold text-[var(--premium-muted)]">
        <span>
          共 <b className="text-[var(--premium-ink)]">{formatNumber(total)}</b> 份文档
          <span className="ml-1.5">· 当前 {formatNumber(start)}–{formatNumber(end)}</span>
        </span>
        <label className="inline-flex items-center gap-2">
          每页
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-[11px] font-black text-[var(--premium-ink)] outline-none transition focus:border-[var(--premium-focus-line)] focus:shadow-[0_0_0_3px_var(--premium-focus-ring)]"
            aria-label="每页文档数量"
          >
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          条
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        <span className="mr-1 text-[10px] font-black text-[var(--premium-muted)]">第 {page} / {totalPages} 页</span>
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onPageChange(1)}
          className="hidden h-8 items-center rounded-full border border-[var(--premium-line)] px-3 text-[10px] font-black text-[var(--premium-ink-soft)] transition hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)] disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
        >
          首页
        </button>
        <button type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)} className={paginationIconButtonClass()} aria-label="文档上一页">
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1">
          {visiblePages.map((visiblePage) => (
            <button
              key={visiblePage}
              type="button"
              disabled={visiblePage === page}
              onClick={() => onPageChange(visiblePage)}
              className={[
                "grid size-8 place-items-center rounded-full text-[11px] font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-blue)]",
                visiblePage === page
                  ? "bg-[var(--premium-ink)] text-[var(--premium-bg)] shadow-[0_8px_20px_rgba(17,19,21,0.16)]"
                  : "text-[var(--premium-muted)] hover:bg-[var(--premium-panel-muted)] hover:text-[var(--premium-ink)]",
              ].join(" ")}
              aria-label={`转到第 ${visiblePage} 页`}
              aria-current={visiblePage === page ? "page" : undefined}
            >
              {visiblePage}
            </button>
          ))}
        </div>
        <button type="button" disabled={page === totalPages} onClick={() => onPageChange(page + 1)} className={paginationIconButtonClass()} aria-label="文档下一页">
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          disabled={page === totalPages}
          onClick={() => onPageChange(totalPages)}
          className="hidden h-8 items-center rounded-full border border-[var(--premium-line)] px-3 text-[10px] font-black text-[var(--premium-ink-soft)] transition hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)] disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
        >
          末页
        </button>
      </div>
    </nav>
  );
}

function DocumentMetric({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-[8px] border border-white/10 bg-white/[0.07] p-3 backdrop-blur-md">
      <strong className={[
        "block truncate text-[clamp(16px,2vw,24px)] font-black leading-none",
        accent ? "text-[#89C777]" : "text-white",
      ].join(" ")}>{value}</strong>
      <span className="mt-2 block truncate text-[9px] font-black text-white/55">{label}</span>
    </div>
  );
}

function DocumentCard({
  document,
  index,
  onPreview,
  onAsk,
  asking,
  onDelete,
}: {
  document: LibraryDocumentItem;
  index: number;
  onPreview: () => void;
  onAsk: () => void;
  asking: boolean;
  onDelete: () => void;
}) {
  const typeColor = fileTypeColor(document.type) ?? "#aab2ac";

  return (
    <article
      style={{ animationDelay: `${Math.min(index, 6) * 58}ms` }}
      className={index === 0 ? "relative min-h-[230px] sm:col-span-2 xl:col-span-1" : "relative min-h-[230px]"}
    >
      <button
        type="button"
        onClick={onPreview}
        disabled={!document.previewAvailable}
        title={document.previewAvailable ? `预览 ${document.name}` : documentPreviewUnavailableLabel(document)}
        className="library-document-card group relative grid h-full min-h-[230px] w-full overflow-hidden rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] p-4 text-left shadow-[var(--premium-tight-shadow)] transition duration-500 enabled:hover:-translate-y-1 enabled:hover:border-[var(--premium-line-strong)] enabled:hover:shadow-[0_24px_56px_rgba(17,19,21,0.14)] disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-blue)]"
        aria-label={`预览 ${document.name}`}
      >
        <span aria-hidden="true" className="absolute -right-14 -top-14 size-36 rounded-full border border-[var(--premium-line)] transition duration-500 group-hover:scale-125 group-hover:border-[rgba(49,88,255,0.28)]" />
        <span className="relative z-10 flex items-start pr-[112px]">
          <FileTypeIcon fileName={document.name} sourceType={document.type} palette="document" className="shadow-[0_10px_28px_rgba(17,19,21,0.1)]" />
        </span>
        <span className="relative z-10 mt-7 min-w-0">
          <span className="mb-2 flex items-center gap-2">
            <span
              className="rounded-full px-2 py-1 text-[9px] font-black"
              style={{ color: typeColor, backgroundColor: `color-mix(in srgb, ${typeColor} 14%, transparent)` }}
            >
              {document.type}
            </span>
            <span className="text-[10px] font-bold text-[var(--premium-muted)]">{document.size} · {document.segments} 片段</span>
          </span>
          <strong className="line-clamp-2 break-words text-[17px] font-black leading-[1.18] text-[var(--premium-ink)]">{document.name}</strong>
        </span>
        <span className="relative z-10 mt-auto flex items-end justify-between gap-3 border-t border-[var(--premium-line)] pt-3">
          <span className="min-w-0 text-[10px] text-[var(--premium-muted)]">
            <span className="mb-1 flex items-center gap-1.5 font-bold"><Clock3 size={12} /> 入库时间</span>
            <time className="block truncate font-black text-[var(--premium-ink-soft)]" dateTime={document.importedAt}>{formatDateTime(document.importedAt)}</time>
          </span>
          <span className={[
            "grid shrink-0 place-items-center transition duration-500",
            document.previewAvailable
              ? "size-9 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] text-[var(--premium-ink-soft)] hover:-translate-y-0.5 hover:border-[#99C39E] hover:bg-[rgba(153,195,158,0.12)] hover:text-[#99C39E]"
              : "min-h-9 rounded-full bg-[var(--premium-ink)] px-3 text-[10px] font-black text-[var(--premium-bg)] group-enabled:group-hover:bg-[var(--premium-blue)] group-enabled:group-hover:text-white",
          ].join(" ")}>
            {document.previewAvailable ? <Eye size={15} /> : statusText(document.parseStatus)}
          </span>
        </span>
      </button>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] text-[10px] font-black text-[var(--premium-ink-soft)] shadow-sm">
          V{document.version}
        </span>
        <button
          type="button"
          onClick={onAsk}
          disabled={asking}
          className="grid size-8 place-items-center rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] text-[var(--premium-ink-soft)] shadow-sm transition enabled:hover:-translate-y-0.5 enabled:hover:border-[#4B8DE6] enabled:hover:bg-[rgba(75,141,230,0.12)] enabled:hover:text-[#4B8DE6] disabled:cursor-wait disabled:opacity-65"
          aria-label={`使用 ${document.name} 新建问答`}
          title={`仅使用 ${document.name} 新建问答`}
        >
          {asking ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="grid size-8 place-items-center rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] text-[var(--premium-ink-soft)] shadow-sm transition hover:-translate-y-0.5 hover:border-[#DF836D] hover:bg-[rgba(223,131,109,0.12)] hover:text-[#DF836D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-focus-line)]"
          aria-label={`删除 ${document.name}`}
          title={`删除 ${document.name}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function DocumentListItem({
  document,
  index,
  onPreview,
  onAsk,
  asking,
  onDelete,
}: {
  document: LibraryDocumentItem;
  index: number;
  onPreview: () => void;
  onAsk: () => void;
  asking: boolean;
  onDelete: () => void;
}) {
  const typeColor = fileTypeColor(document.type) ?? "#aab2ac";

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 6) * 48}ms` }}
      className="library-document-card group grid min-h-16 w-full min-w-[880px] grid-cols-[minmax(0,1fr)_100px_100px_168px_210px] items-center gap-4 px-4 py-2 text-left transition duration-300 hover:bg-[var(--premium-panel-strong)]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <FileTypeIcon fileName={document.name} sourceType={document.type} palette="document" compact />
        <span className="min-w-0">
          <strong className="block truncate text-xs font-black text-[var(--premium-ink)]">{document.name}</strong>
          <span className="mt-1 block text-[10px] text-[var(--premium-muted)]">{document.size} · {document.segments} 片段</span>
        </span>
      </span>
      <span className="text-[11px] font-black" style={{ color: typeColor }}>{document.type}</span>
      <span className="grid size-8 place-items-center rounded-full border border-[var(--premium-line)] bg-transparent text-[10px] font-black text-[var(--premium-ink-soft)]">V{document.version}</span>
      <time className="truncate text-[11px] font-bold text-[var(--premium-muted)]" dateTime={document.importedAt}>{formatDateTime(document.importedAt)}</time>
      <span className="flex w-full items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={onAsk}
          disabled={asking}
          aria-label={`使用 ${document.name} 新建问答`}
          title={`仅使用 ${document.name} 新建问答`}
          className="grid size-8 place-items-center rounded-full border border-[var(--premium-line)] bg-transparent text-[var(--premium-ink-soft)] transition enabled:hover:-translate-y-0.5 enabled:hover:border-[#4B8DE6] enabled:hover:bg-[rgba(75,141,230,0.12)] enabled:hover:text-[#4B8DE6] disabled:cursor-wait disabled:opacity-60"
        >
          {asking ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
        </button>
        <button
          type="button"
          onClick={onPreview}
          disabled={!document.previewAvailable}
          aria-label={document.previewAvailable ? `预览 ${document.name}` : documentPreviewUnavailableLabel(document)}
          title={document.previewAvailable ? `预览 ${document.name}` : documentPreviewUnavailableLabel(document)}
          className="grid size-8 place-items-center rounded-full border border-[var(--premium-line)] bg-transparent text-[var(--premium-ink-soft)] transition enabled:hover:-translate-y-0.5 enabled:hover:border-[#99C39E] enabled:hover:bg-[rgba(153,195,158,0.12)] enabled:hover:text-[#99C39E] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Eye size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="grid size-8 place-items-center rounded-full border border-[var(--premium-line)] bg-transparent text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5 hover:border-[#DF836D] hover:bg-[rgba(223,131,109,0.12)] hover:text-[#DF836D]"
          aria-label={`删除 ${document.name}`}
          title={`删除 ${document.name}`}
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

function DocumentDeleteDialog({
  document,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  document: LibraryDocumentItem;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-delete-title"
    >
      <div className="w-full max-w-[400px] rounded-[8px] border border-[var(--premium-line)] bg-[rgba(255,253,245,0.96)] p-4 shadow-[var(--premium-menu-shadow)] backdrop-blur-xl dark:bg-[var(--premium-elevated)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-rose-600 text-white shadow-[0_14px_32px_rgba(225,29,72,0.2)]">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <h2 id="document-delete-title" className="text-[18px] font-black leading-none text-[var(--premium-ink)]">删除文档</h2>
              <p className="mt-2 text-xs font-bold leading-[1.6] text-[var(--premium-muted)]">
                确认删除“<strong className="break-all text-[var(--premium-ink)]">{document.name}</strong>”？文档将从知识库和检索范围中移除。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="grid size-8 shrink-0 place-items-center rounded-[8px] text-[var(--premium-muted)] hover:bg-white/70 disabled:opacity-50 dark:hover:bg-[var(--premium-panel-muted)]"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        {error ? (
          <p className="mt-3 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
            删除失败：{error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-4 text-sm font-black text-[var(--premium-ink)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[8px] bg-rose-600 px-4 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={15} />}
            {pending ? "删除中" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toLibraryDocumentItem(asset: KnowledgeBaseDocument): LibraryDocumentItem {
  return {
    id: asset.id,
    name: asset.fileName || asset.title || asset.id,
    type: libraryDocumentType(asset),
    version: asset.versionNo ?? 1,
    importedAt: asset.createdAt,
    size: formatFileSize(asset.sizeBytes ?? undefined),
    segments: asset.segmentCount,
    previewAvailable: asset.previewAvailable,
    parseStatus: asset.parseStatus,
    indexStatus: asset.indexStatus,
  };
}

function libraryDocumentType(asset: KnowledgeBaseDocument): LibraryDocumentType {
  const rawType = asset.fileType?.trim().toUpperCase();
  const fileName = asset.fileName?.toLowerCase() ?? "";

  if (rawType === "PDF" || fileName.endsWith(".pdf")) return "PDF";
  if (rawType === "MD" || rawType === "MARKDOWN" || /\.mdx?$/i.test(fileName)) return "MD";
  if (rawType === "IMAGE" || rawType?.startsWith("IMAGE/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(fileName)) return "IMAGE";
  return "TXT";
}

function documentPreviewUnavailableLabel(document: LibraryDocumentItem) {
  return `暂不可预览：解析${statusText(document.parseStatus)}，索引${statusText(document.indexStatus)}`;
}

function viewButtonClass(active: boolean) {
  return [
    "grid h-8 w-9 place-items-center rounded-full transition hover:-translate-y-0.5",
    active ? "bg-[var(--premium-ink)] text-[var(--premium-bg)]" : "text-[var(--premium-muted)] hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)]",
  ].join(" ");
}

function premiumFieldClass() {
  return "h-10 w-full rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-sm text-[var(--premium-ink)] outline-none transition placeholder:text-[var(--premium-muted)] focus:border-[var(--premium-focus-line)] focus:shadow-[0_0_0_3px_var(--premium-focus-ring)]";
}

function paginationIconButtonClass() {
  return "grid size-8 place-items-center rounded-full border border-[var(--premium-line)] text-[var(--premium-muted)] transition hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)] disabled:cursor-not-allowed disabled:opacity-45";
}

function compactFieldClass() {
  return "h-8 w-full rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-2.5 text-xs font-semibold text-[var(--premium-ink)] outline-none transition placeholder:text-[var(--premium-muted)] focus:border-[var(--premium-focus-line)] focus:shadow-[0_0_0_3px_var(--premium-focus-ring)]";
}

function isActiveKnowledgeBase(item: KnowledgeBase) {
  return item.status === "ACTIVE" || item.status === "0";
}

function getArchiveErrorNotice(error: unknown): ArchiveErrorNotice | null {
  if (!error) return null;

  const message = error instanceof Error ? error.message : "请稍后重试";
  if (isAccessDeniedError(error)) {
    return {
      title: "权限不足，无法归档",
      message: "当前角色没有归档知识库的权限，请切换为管理员角色后重试。",
    };
  }

  return {
    title: "知识库归档失败",
    message,
  };
}

function getUpdatePermissionNotice(error: unknown): ArchiveErrorNotice | null {
  if (!isAccessDeniedError(error)) return null;

  return {
    title: "权限不足，无法编辑",
    message: "当前角色没有编辑知识库的权限，请切换为管理员角色后重试。",
  };
}

function ingestionStatusLabel(status?: string | null) {
  if (!status) return "暂无导入";
  return status;
}

function ingestionBadgeClass(status?: string | null) {
  const normalized = status?.toUpperCase();
  if (normalized === "FAILED") {
    return "bg-[rgba(255,117,95,0.16)] text-[#9c2b1d] dark:text-[#ffb4a8]";
  }
  if (normalized === "RUNNING" || normalized === "PENDING") {
    return "bg-[rgba(39,93,255,0.14)] text-[var(--premium-blue)]";
  }
  if (normalized === "SUCCESS") {
    return "bg-[var(--library-status-success-bg)] text-[var(--library-status-success-text)]";
  }
  return "bg-black/5 text-[var(--premium-muted)] dark:bg-white/10";
}

function ingestionFlex(value: number, total: number) {
  if (total <= 0 || value <= 0) return "0 0 0%";
  return `${value} ${value} 0`;
}

type KnowledgeBaseRowActions = {
  editing: boolean;
  editName: string;
  editDescription: string;
  saving: boolean;
  archiveConfirming: boolean;
  archiving: boolean;
  updateError: string | null;
  archiveError: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onSaveEdit: () => void;
  onRequestArchive: () => void;
  onCancelArchive: () => void;
  onConfirmArchive: () => void;
};

function KnowledgeBaseCard({
  item,
  index,
  stats,
  selected,
  editing,
  editName,
  editDescription,
  saving,
  archiveConfirming,
  archiving,
  updateError,
  archiveError,
  onSelect,
  onHover,
  onHoverEnd,
  onStartEdit,
  onCancelEdit,
  onEditNameChange,
  onEditDescriptionChange,
  onSaveEdit,
  onRequestArchive,
  onCancelArchive,
  onConfirmArchive,
}: {
  item: KnowledgeBase;
  index: number;
  stats?: KnowledgeBaseStats;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
} & KnowledgeBaseRowActions) {
  const lastUpdated = item.updatedAt ?? item.lastIngestedAt ?? item.createdAt;
  const active = isActiveKnowledgeBase(item);
  const documentCount = stats?.documentCount ?? item.documentCount;
  const segmentCount = stats?.segmentCount ?? item.segmentCount;

  return (
    <article
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      onFocusCapture={onHover}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHoverEnd();
      }}
      className={[
        "library-kb-card group relative grid h-full min-h-[254px] grid-rows-[auto_minmax(0,1fr)_auto] gap-1.5 overflow-hidden rounded-[8px] border p-2.5 shadow-[var(--premium-tight-shadow)] backdrop-blur-xl transition hover:shadow-[0_20px_48px_rgba(17,19,21,0.13)]",
        selected ? "border-[var(--premium-line-strong)] bg-[var(--premium-panel-strong)] ring-1 ring-black/5 dark:ring-white/10" : "border-[var(--premium-line)] bg-[var(--premium-panel)]",
      ].join(" ")}
    >
      {!editing && !archiveConfirming ? (
        <button
          type="button"
          onClick={onSelect}
          className="absolute inset-0 z-[5] cursor-pointer rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--premium-blue)]"
          aria-label={`打开 ${item.name} 的文档`}
        />
      ) : null}
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
        <KnowledgeGlyph index={index} />
        <StatusBadge status={item.status} />
      </div>

      {editing ? (
        <div className="pointer-events-auto relative z-10 grid min-w-0 self-start content-start gap-1.5">
          <input className={compactFieldClass()} value={editName} onChange={(event) => onEditNameChange(event.target.value)} placeholder="知识库名称" />
          <input className={compactFieldClass()} value={editDescription} onChange={(event) => onEditDescriptionChange(event.target.value)} placeholder="描述，可选" />
          {updateError ? <p className="line-clamp-1 text-[11px] text-rose-600 dark:text-rose-300">{updateError}</p> : null}
        </div>
      ) : (
        <div className="pointer-events-none relative z-10 min-w-0 self-start">
          <h3 className="library-kb-title line-clamp-1 break-words text-[16px] font-black leading-[1.08]">{item.name}</h3>
          <p className="mt-1 line-clamp-1 min-h-4 text-[11px] leading-4 text-[var(--premium-ink-soft)]">{item.description || "暂无描述"}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <StatBox value={formatNumber(documentCount)} label="文档" />
            <StatBox value={formatNumber(segmentCount)} label="片段" />
          </div>
          <RecentIngestionCard stats={stats} active={active} />
        </div>
      )}

      <div className="library-kb-footer pointer-events-none relative z-10 flex min-h-12 shrink-0 flex-col gap-1.5 border-t border-[var(--premium-line)] pt-2 sm:flex-row sm:items-center sm:justify-between">
        <small className="library-kb-updated inline-flex h-8 items-center text-xs text-[var(--premium-muted)]">更新于 {formatDateTime(lastUpdated)}</small>
        {editing ? (
          <EditConfirmActions saving={saving} canSave={Boolean(editName.trim())} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : archiveConfirming ? (
          <ArchiveConfirmActions item={item} archiving={archiving} error={archiveError} onConfirm={onConfirmArchive} onCancel={onCancelArchive} />
        ) : (
          <KnowledgeBaseActions item={item} active={active} onStartEdit={onStartEdit} onRequestArchive={onRequestArchive} />
        )}
      </div>
    </article>
  );
}

function KnowledgeBaseListRow({
  item,
  index,
  selected,
  editing,
  editName,
  editDescription,
  saving,
  archiveConfirming,
  archiving,
  updateError,
  archiveError,
  onSelect,
  onHover,
  onHoverEnd,
  onStartEdit,
  onCancelEdit,
  onEditNameChange,
  onEditDescriptionChange,
  onSaveEdit,
  onRequestArchive,
  onCancelArchive,
  onConfirmArchive,
}: {
  item: KnowledgeBase;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
} & KnowledgeBaseRowActions) {
  const lastUpdated = item.updatedAt ?? item.lastIngestedAt ?? item.createdAt;
  const active = isActiveKnowledgeBase(item);

  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      onFocusCapture={onHover}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHoverEnd();
      }}
      className={[
      "library-kb-list-row relative grid h-full min-h-0 max-h-full overflow-hidden grid-cols-[minmax(0,1fr)_92px_112px_136px_184px] items-center gap-4 px-5 py-2 transition",
      selected ? "bg-[var(--premium-panel-strong)]" : "hover:bg-[var(--premium-panel-muted)]",
    ].join(" ")}
    >
      {!editing && !archiveConfirming ? (
        <button
          type="button"
          onClick={onSelect}
          className="absolute inset-0 z-[5] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--premium-blue)]"
          aria-label={`打开 ${item.name} 的文档`}
        />
      ) : null}
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-4 text-left">
        <KnowledgeGlyph index={index} compact />
        {editing ? (
          <div className="pointer-events-auto grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2">
            <input className={compactFieldClass()} value={editName} onChange={(event) => onEditNameChange(event.target.value)} placeholder="知识库名称" />
            <input className={compactFieldClass()} value={editDescription} onChange={(event) => onEditDescriptionChange(event.target.value)} placeholder="描述，可选" />
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <h3 className="truncate text-sm font-black">{item.name}</h3>
              <StatusBadge status={item.status} compact />
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs text-[var(--premium-muted)]">{item.description || "暂无描述"}</p>
          </div>
        )}
      </div>
      <span className="pointer-events-none relative z-10 text-center text-sm text-[var(--premium-ink-soft)]">{formatNumber(item.documentCount)}</span>
      <span className="pointer-events-none relative z-10 text-center text-sm text-[var(--premium-ink-soft)]">{formatNumber(item.segmentCount)}</span>
      <span className="pointer-events-none relative z-10 truncate text-center text-sm text-[var(--premium-muted)]">
        {editing && updateError ? updateError : archiveConfirming && archiveError ? archiveError : formatDateTime(lastUpdated)}
      </span>
      <div className="pointer-events-auto relative z-10 flex justify-center">
        {editing ? (
          <EditConfirmActions saving={saving} canSave={Boolean(editName.trim())} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : archiveConfirming ? (
          <ArchiveConfirmActions item={item} archiving={archiving} error={null} onConfirm={onConfirmArchive} onCancel={onCancelArchive} compact />
        ) : (
          <KnowledgeBaseActions item={item} active={active} onStartEdit={onStartEdit} onRequestArchive={onRequestArchive} compact />
        )}
      </div>
    </div>
  );
}

function KnowledgeBaseActions({
  item,
  active,
  compact = false,
  onStartEdit,
  onRequestArchive,
}: {
  item: KnowledgeBase;
  active: boolean;
  compact?: boolean;
  onStartEdit: () => void;
  onRequestArchive: () => void;
}) {
  if (!active) {
    return <span className="inline-flex h-8 items-center text-xs font-black text-[var(--premium-muted)]">已归档</span>;
  }

  return (
    <div className={["pointer-events-auto flex h-8 items-center", compact ? "gap-1" : "gap-1.5"].join(" ")}>
      <AskKbLink item={item} label="进入提问" />
      <IconActionButton label="编辑知识库" onClick={onStartEdit}>
        <Edit3 size={14} />
      </IconActionButton>
      <IconActionButton label="归档知识库" onClick={onRequestArchive}>
        <Archive size={14} />
      </IconActionButton>
    </div>
  );
}

function EditConfirmActions({
  saving,
  canSave,
  onSave,
  onCancel,
}: {
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-1.5">
      <IconActionButton label="保存知识库" disabled={saving || !canSave} onClick={onSave}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </IconActionButton>
      <IconActionButton label="取消编辑" onClick={onCancel}>
        <X size={14} />
      </IconActionButton>
    </div>
  );
}

function ArchiveConfirmActions({
  item,
  archiving,
  error,
  compact = false,
  onConfirm,
  onCancel,
}: {
  item: KnowledgeBase;
  archiving: boolean;
  error: string | null;
  compact?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
      {!compact ? (
        <span className="max-w-[130px] truncate text-[11px] font-black text-[var(--premium-muted)]" title={error ?? `归档 ${item.name}`}>
          {error ?? `归档「${item.name}」?`}
        </span>
      ) : null}
      <IconActionButton label="确认归档" disabled={archiving} onClick={onConfirm}>
        {archiving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </IconActionButton>
      <IconActionButton label="取消归档" onClick={onCancel}>
        <X size={14} />
      </IconActionButton>
    </div>
  );
}

function IconActionButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="library-icon-action grid size-8 shrink-0 place-items-center rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] text-[var(--premium-ink-soft)] transition hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function AskKbLink({ item, label }: { item: KnowledgeBase; label: string }) {
  return (
    <Link
      href={askHrefForKb(item)}
      onClick={(event) => event.stopPropagation()}
      className="library-kb-action inline-flex min-h-8 items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-xs font-black text-[var(--premium-ink-soft)] transition hover:translate-x-1 hover:border-[rgba(187,255,102,0.72)] hover:bg-[rgba(187,255,102,0.26)] hover:text-[var(--premium-ink)] dark:hover:border-[rgba(187,255,102,0.72)] dark:hover:bg-[rgba(187,255,102,0.26)] dark:hover:text-[var(--premium-ink)] dark:hover:shadow-[0_0_0_3px_rgba(187,255,102,0.08)]"
    >
      {label} <ArrowRight size={14} />
    </Link>
  );
}

function KnowledgeGlyph({ index, large = false, compact = false }: { index: number; large?: boolean; compact?: boolean }) {
  const accents = [
    "fill-[var(--library-semantic-green)]",
    "fill-[var(--premium-blue)]",
    "fill-[#ff755f]",
  ];
  const accent = accents[index % accents.length];

  return (
    <span
      className={[
        "relative grid shrink-0 place-items-center overflow-hidden rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)]",
        compact ? "size-10" : large ? "size-14" : "size-12",
      ].join(" ")}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 40 40"
        className={compact ? "size-[30px]" : large ? "size-[38px]" : "size-[34px]"}
        fill="none"
      >
        <circle cx="20" cy="20" r="15" className="fill-[var(--premium-ink-soft)]/[0.06]" />
        <circle cx="20" cy="20" r="9" className="stroke-[var(--premium-ink-soft)]/20" strokeWidth="1.4" strokeDasharray="4 3" />
        <circle cx="20" cy="20" r="5.5" className={accent} />
        <circle cx="30" cy="13" r="2.8" className="fill-[var(--premium-ink-soft)]/15" />
        <circle cx="10" cy="27" r="2.2" className="fill-[var(--premium-ink-soft)]/25" />
        <circle cx="28" cy="28" r="1.8" className="fill-[var(--premium-ink-soft)]/12" />
      </svg>
    </span>
  );
}

function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const isActive = status === "ACTIVE" || status === "0";
  const isArchived = status === "ARCHIVED" || status === "1";

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-black",
        isActive
          ? "bg-[var(--library-status-success-bg)] text-[var(--library-status-success-text)]"
          : isArchived
            ? "bg-black/5 text-[var(--premium-muted)] dark:bg-white/8"
            : "bg-[var(--premium-panel-muted)] text-[var(--premium-muted)]",
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1.5 text-xs",
      ].join(" ")}
      data-library-status={isActive ? "answerable" : isArchived ? "archived" : "other"}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {isActive ? "可问答" : isArchived ? "已归档" : statusText(status)}
    </span>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <span className="library-stat-box min-h-9 rounded-[8px] border border-[var(--premium-line)] bg-white/45 p-1.5 text-[10px] text-[var(--premium-muted)] dark:bg-white/5">
      <b className="mb-0.5 block truncate text-sm text-[var(--premium-ink)]">{value}</b>
      {label}
    </span>
  );
}

function ingestionPanelClass() {
  return "library-ingestion-panel mt-1.5 grid gap-1.5 rounded-[8px] border border-[var(--premium-line)] bg-[linear-gradient(135deg,var(--premium-panel-strong),rgba(255,255,255,0.34)),repeating-linear-gradient(135deg,rgba(17,19,21,0.025)_0_1px,transparent_1px_12px)] p-1.5 text-[11px] text-[var(--premium-muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.42)] dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(10,12,14,0.58),rgba(10,12,14,0.42)),repeating-linear-gradient(135deg,rgba(255,255,255,0.035)_0_1px,transparent_1px_12px)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";
}

function RecentIngestionCard({
  stats,
  active,
}: {
  stats?: KnowledgeBaseStats;
  active: boolean;
}) {
  if (!active) {
    return (
      <div className={ingestionPanelClass()}>
        <div className="library-ingestion-head flex items-center justify-between gap-2">
          <span className="min-w-0 text-[11px] font-black text-[var(--premium-muted)]">
            <b className="block truncate text-[11px] text-[var(--premium-ink)]">知识库已归档</b>
            最近导入
          </span>
          <span className="rounded-full bg-black/5 px-2 py-1 text-[10px] font-black dark:bg-black/30 dark:text-white/65">归档只读</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-black/10 dark:bg-black/35" aria-hidden="true" />
        <div className="invisible grid grid-cols-4 gap-1" aria-hidden="true">
          <IngestionCount value={0} label="总条目" />
          <IngestionCount value={0} label="成功" />
          <IngestionCount value={0} label="失败" />
          <IngestionCount value={0} label="运行中" />
        </div>
      </div>
    );
  }

  const total = stats?.lastIngestionTotalCount ?? 0;
  const success = stats?.lastIngestionSuccessCount ?? 0;
  const failure = stats?.lastIngestionFailureCount ?? 0;
  const running = stats?.lastIngestionRunningCount ?? 0;
  const status = stats?.lastIngestionStatus ?? null;
  const ingestedAt = stats?.lastIngestedAt;

  return (
    <div className={ingestionPanelClass()}>
      <div className="library-ingestion-head flex items-center justify-between gap-2">
        <span className="min-w-0 text-[11px] font-black text-[var(--premium-muted)]">
          <b className="block truncate text-[11px] text-[var(--premium-ink)]">{ingestedAt ? formatDateTime(ingestedAt) : "暂无导入"}</b>
          最近导入
        </span>
        <span
          className={["shrink-0 rounded-full px-2 py-1 text-[10px] font-black", ingestionBadgeClass(status)].join(" ")}
          data-library-ingestion-status={status?.toUpperCase() ?? "NONE"}
        >
          {ingestionStatusLabel(status)}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-black/10 dark:bg-black/35" aria-label={`最近导入成功 ${success}，失败 ${failure}，运行中 ${running}`}>
        <span className="h-full bg-[var(--library-progress-accent)]" style={{ flex: ingestionFlex(success, total) }} />
        <span className="h-full bg-[#ff755f]" style={{ flex: ingestionFlex(failure, total) }} />
        <span className="h-full bg-[var(--premium-blue)]" style={{ flex: ingestionFlex(running, total) }} />
      </div>
      <div className="grid grid-cols-4 gap-1">
        <IngestionCount value={total} label="总条目" />
        <IngestionCount value={success} label="成功" />
        <IngestionCount value={failure} label="失败" />
        <IngestionCount value={running} label="运行中" />
      </div>
    </div>
  );
}

function IngestionCount({ value, label }: { value: number; label: string }) {
  return (
    <span className="library-ingestion-count min-w-0 rounded-[8px] bg-white/50 p-1 text-[9px] leading-tight text-[var(--premium-muted)] dark:border dark:border-white/8 dark:bg-black/18">
      <b className="mb-0.5 block truncate text-[11px] text-[var(--premium-ink)]">{formatNumber(value)}</b>
      {label}
    </span>
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
}: CreateKnowledgeBaseProps) {
  if (expanded) {
    return (
      <div className="library-create-kb-card grid h-full min-h-[254px] gap-2 rounded-[8px] border border-dashed border-[var(--premium-line-strong)] bg-white p-2.5 text-[var(--premium-ink)] shadow-[var(--premium-tight-shadow)] dark:border-white/30 dark:bg-[#101214] dark:text-white">
        <div className="library-create-kb-title flex items-center gap-2 font-black text-[var(--premium-blue)] dark:text-[var(--premium-accent)]">
          <Plus size={20} />
          新建知识库
        </div>
        <input className={premiumFieldClass()} value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="知识库名称" />
        <input className={premiumFieldClass()} value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="描述，可选" />
        {error ? <div className="text-xs text-rose-600 dark:text-rose-300">{error}</div> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCreate} disabled={pending || !name.trim()} className="inline-flex h-9 items-center gap-2 rounded-full bg-[#101214] px-3.5 text-xs font-black text-white disabled:opacity-45 dark:bg-white dark:text-[#101214]">
            {pending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {pending ? "创建中" : "创建"}
          </button>
          <button type="button" onClick={onCancel} className="h-9 rounded-full border border-[var(--premium-line)] px-3.5 text-xs font-black text-[var(--premium-ink-soft)] hover:bg-[var(--premium-panel-muted)] dark:border-white/20 dark:text-white/75 dark:hover:bg-white/10 dark:hover:text-white">
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onExpand}
      className="library-create-kb-card grid h-full min-h-[254px] place-items-center rounded-[8px] border border-dashed border-[var(--premium-line-strong)] bg-white p-3 text-center text-[var(--premium-ink)] shadow-[var(--premium-tight-shadow)] transition hover:-translate-y-1 hover:border-[var(--premium-blue)] hover:bg-[#f9faf7] dark:border-white/30 dark:bg-[#101214] dark:text-white dark:hover:border-[var(--premium-accent)] dark:hover:bg-[#171a1c]"
    >
      <span>
        <span className="mx-auto mb-2 grid size-12 place-items-center rounded-full bg-[#101214] text-white shadow-[0_14px_30px_rgba(17,19,21,0.18)] dark:bg-white dark:text-[#101214] dark:shadow-[0_14px_30px_rgba(0,0,0,0.3)]">
          <Plus size={24} />
        </span>
        <strong className="library-create-kb-title block text-base font-black">新建知识库</strong>
        <span className="mx-auto mt-1.5 block max-w-[330px] text-xs leading-5 text-[var(--premium-muted)] dark:text-white/55">上传文件，让新的业务上下文进入可检索、可引用、可问答的资产流。</span>
      </span>
    </button>
  );
}

function CreateKnowledgeBaseListRow(props: CreateKnowledgeBaseProps) {
  if (props.expanded) {
    return (
      <div className="grid h-full min-h-0 max-h-full overflow-hidden items-center px-5 py-2">
        <div className="grid items-center gap-3 rounded-[8px] border border-dashed border-[var(--premium-line-strong)] bg-[var(--premium-panel-muted)] p-1 sm:grid-cols-[1fr_1.3fr_auto_auto]">
          <input className={premiumFieldClass()} value={props.name} onChange={(event) => props.onNameChange(event.target.value)} placeholder="知识库名称" />
          <input className={premiumFieldClass()} value={props.description} onChange={(event) => props.onDescriptionChange(event.target.value)} placeholder="描述，可选" />
          <button type="button" onClick={props.onCreate} disabled={props.pending || !props.name.trim()} className="h-9 rounded-full bg-[var(--premium-ink)] px-4 text-xs font-black text-[var(--premium-bg)] disabled:opacity-45">
            {props.pending ? "创建中" : "创建"}
          </button>
          <button type="button" onClick={props.onCancel} className="h-9 rounded-full border border-[var(--premium-line)] px-4 text-xs font-black text-[var(--premium-ink-soft)]">
            取消
          </button>
          {props.error ? <div className="text-xs text-rose-600 sm:col-span-4">{props.error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={props.onExpand} className="flex h-full min-h-0 max-h-full w-full flex-wrap items-center justify-center gap-3 overflow-hidden px-5 py-2 text-[var(--premium-ink-soft)] transition hover:bg-[var(--premium-panel-muted)]">
      <Plus size={20} />
      <span className="library-create-kb-title font-black">新建知识库</span>
      <span className="text-sm text-[var(--premium-muted)]">上传文件或连接数据源，扩展你的知识边界</span>
    </button>
  );
}

type CreateKnowledgeBaseProps = {
  expanded: boolean;
  name: string;
  description: string;
  pending: boolean;
  error: string | null;
  onExpand: () => void;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCreate: () => void;
};

function KnowledgeBasePagination({
  page,
  total,
  pageSize,
  totalPages,
  visibleCount,
  isFetching,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  totalPages: number;
  visibleCount: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
}) {
  const currentPage = Math.min(page, totalPages);
  const start = total === 0 || visibleCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = visibleCount === 0 ? 0 : Math.min(start + visibleCount - 1, total);
  const pages = getVisiblePages(currentPage, totalPages);

  return (
    <nav className="flex flex-col items-stretch justify-between gap-2 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] p-2 text-xs text-[var(--premium-muted)] sm:flex-row sm:items-center" aria-label="知识库分页">
      <span>
        共 <b className="text-[var(--premium-ink)]">{formatNumber(total)}</b> 个知识库
        {visibleCount > 0 ? <span>，当前 {formatNumber(start)}-{formatNumber(end)}</span> : null}
        {visibleCount === 0 && total > 0 ? <span>，当前为新建入口</span> : null}
        {isFetching ? <span className="ml-2 text-[var(--premium-blue)]">更新中</span> : null}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={currentPage <= 1 || isFetching} onClick={() => onPageChange(Math.max(1, currentPage - 1))} className={paginationIconButtonClass()} aria-label="上一页">
          <ChevronLeft size={17} />
        </button>
        {pages.map((item) => (
          <button
            key={item}
            type="button"
            disabled={item === currentPage || isFetching}
            onClick={() => onPageChange(item)}
            className={[
              "grid size-8 place-items-center rounded-full text-xs font-black transition disabled:cursor-not-allowed",
              item === currentPage ? "bg-[var(--premium-ink)] text-[var(--premium-bg)]" : "text-[var(--premium-muted)] hover:bg-[var(--premium-ink)] hover:text-[var(--premium-bg)] disabled:opacity-50",
            ].join(" ")}
            aria-current={item === currentPage ? "page" : undefined}
          >
            {item}
          </button>
        ))}
        <button type="button" disabled={currentPage >= totalPages || isFetching} onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} className={paginationIconButtonClass()} aria-label="下一页">
          <ChevronRight size={17} />
        </button>
      </div>
    </nav>
  );
}

function RecentCitationPanel({
  items,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  items: RecentCitation[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 28) onLoadMore();
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage || event.deltaY <= 0) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 28) onLoadMore();
  };

  return (
    <section className="library-activity-panel flex h-[288px] min-h-0 flex-col overflow-hidden rounded-[8px] border border-white/10 px-4 pb-4 text-white" data-activity-kind="citations" aria-label="最近引用">
      <ActivityPanelHeader
        label="RECENT CITATIONS"
        icon={<Link2 size={15} strokeWidth={2.2} />}
      />
      <div
        className="library-activity-scroll relative z-10 mt-3 grid min-h-0 flex-1 content-start gap-2 overflow-x-hidden overflow-y-auto overscroll-contain pb-0.5 pr-1 pt-1 [scrollbar-color:rgba(255,255,255,0.22)_transparent] [scrollbar-width:thin]"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        {isLoading ? <DarkState label="加载最近引用" /> : null}
        {isError ? <DarkState label="最近引用暂不可用" /> : null}
        {!isLoading && !isError && items.length === 0 ? <DarkState label="暂无最近引用" /> : null}
        {items.map((item, index) => <CitationItem key={`${item.segmentId}-${item.openedAt ?? index}-${index}`} item={item} index={index} />)}
        {isFetchingNextPage ? <DarkState label="加载更多" /> : null}
      </div>
    </section>
  );
}

function CitationItem({ item, index }: { item: RecentCitation; index: number }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(saveRecentCitationPreviewNavigation(item, index))}
      className="library-activity-item library-citation-item group grid w-full items-center rounded-[8px] border border-white/10 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-accent)]"
    >
      <span className="library-activity-index library-citation-index grid place-items-center rounded-[8px] text-[11px] font-black" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="library-citation-content grid min-w-0">
        <strong className="library-citation-title truncate" title={item.fileName || "未命名文件"}>
          {item.fileName || "未命名文件"}
        </strong>
        <span className="library-citation-context min-w-0 text-white/55">
          <span className="library-citation-context-part" title={item.kbName || "未知知识库"}>
            <Database size={11} strokeWidth={2} aria-hidden="true" />
            <span>{item.kbName || "未知知识库"}</span>
          </span>
          <span className="library-citation-context-part is-question" title={item.question || "未记录问题"}>
            <MessageCircle size={11} strokeWidth={2} aria-hidden="true" />
            <span>{item.question || "未记录问题"}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

function RecentQuestionPanel({
  items,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  items: RecentQuestion[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 28) onLoadMore();
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!hasNextPage || isFetchingNextPage || event.deltaY <= 0) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 28) onLoadMore();
  };

  return (
    <section className="library-activity-panel flex h-[288px] min-h-0 flex-col overflow-hidden rounded-[8px] border border-white/10 px-4 pb-4 text-white" data-activity-kind="questions" aria-label="最近问过">
      <ActivityPanelHeader
        label="RECENT QUESTIONS"
        icon={<MessageCircle size={15} strokeWidth={2.4} />}
      />
      <div
        className="library-activity-scroll relative z-10 mt-3 grid min-h-0 flex-1 content-start gap-2 overflow-x-hidden overflow-y-auto overscroll-contain pb-0.5 pr-1 pt-1 [scrollbar-color:rgba(255,255,255,0.22)_transparent] [scrollbar-width:thin]"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        {isLoading ? <DarkState label="加载最近提问" /> : null}
        {isError ? <DarkState label="最近提问暂不可用" /> : null}
        {!isLoading && !isError && items.length === 0 ? <DarkState label="暂无最近提问" /> : null}
        {items.map((item, index) => <QuestionItem key={`${item.turnId}-${index}`} item={item} index={index} />)}
        {isFetchingNextPage ? <DarkState label="加载更多" /> : null}
      </div>
    </section>
  );
}

function QuestionItem({ item, index }: { item: RecentQuestion; index: number }) {
  const params = new URLSearchParams();
  if (item.sessionId) params.set("session", item.sessionId);
  if (item.turnId) params.set("turn", item.turnId);
  const query = params.toString();
  const href = query ? `/ask?${query}` : "/ask";
  const knowledgeBases = (item.knowledgeBaseNames ?? item.kbScope ?? []).slice(0, 2).join(" / ") || "全部知识库";

  return (
    <Link
      href={href}
      className="library-activity-item library-question-item group grid min-h-[60px] grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 rounded-[8px] border border-white/10 px-2.5 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-blue)]"
    >
      <span className="library-activity-index grid size-8 shrink-0 place-items-center rounded-full text-[10px] font-black" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="grid min-w-0 overflow-hidden">
        <strong className="block truncate text-xs leading-5" title={item.question || "未命名问题"}>{item.question || "未命名问题"}</strong>
        <span className="library-question-context block truncate text-[10px] leading-5 text-white/55" title={knowledgeBases}>{knowledgeBases}</span>
      </span>
    </Link>
  );
}

function ActivityPanelHeader({
  label,
  icon,
  trailing,
}: {
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header className="relative z-10 flex h-[52px] min-h-[52px] min-w-0 items-center justify-between gap-3 border-b border-white/10">
      <span className="flex min-w-0 items-center gap-2">
        {icon ? (
          <span
            className="library-activity-header-icon grid size-6 shrink-0 place-items-center"
            style={{ background: "transparent", border: 0, boxShadow: "none" }}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
        <h2 className="truncate text-xs font-black leading-none">{label}</h2>
      </span>
      {trailing}
    </header>
  );
}

function HealthPanel({
  selectedKb,
  health,
  isLoading,
  isRefreshing,
  isError,
}: {
  selectedKb: KnowledgeBase | null;
  health?: KnowledgeBaseHealth;
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
}) {
  const sourceTypes = health?.sourceTypes ?? [];
  const segmentTotal = health?.segments.total ?? 0;
  const segmentIndexed = health?.segments.indexed ?? 0;
  const coverage = segmentTotal > 0
    ? Math.min(100, Math.max(0, (segmentIndexed / segmentTotal) * 100))
    : 0;

  return (
    <section className="library-health-panel relative isolate h-[288px] min-h-[288px] overflow-hidden rounded-[8px] border border-white/10 text-[#f4f7ec] shadow-[0_28px_70px_rgba(17,19,21,0.24)]" aria-live="polite" aria-busy={isLoading || isRefreshing} aria-label="知识库健康度">
      <div className="relative z-10 grid h-full content-start gap-2 overflow-y-auto px-3 pb-2.5">
        <ActivityPanelHeader
          label="KB OVERVIEW"
          icon={<Activity size={15} strokeWidth={2.4} />}
          trailing={isLoading || isRefreshing ? <Loader2 size={13} className="shrink-0 animate-spin text-[var(--premium-muted)]" aria-hidden="true" /> : null}
        />

        {!selectedKb ? <DarkState label="选择知识库查看健康度" /> : null}
        {selectedKb && isLoading ? <DarkState label="正在加载健康状态" /> : null}
        {selectedKb && isError ? <DarkState label="健康状态暂不可用" /> : null}
        {selectedKb && !isLoading && !isError && health ? (
          <div key={health.kbId} className="library-health-snapshot grid min-w-0 gap-2">
            <div className="flex min-w-0 items-end gap-3">
              <h2 className="min-w-0 truncate text-xl font-black leading-none" title={health.kbName || selectedKb.name}>
                {health.kbName || selectedKb.name}
              </h2>
            </div>

            <div className="grid grid-cols-3 gap-2" aria-label="知识库总量">
              <HealthMetric value={formatNumber(health.documents.total)} label="DOCUMENTS" />
              <HealthMetric value={formatNumber(segmentTotal)} label="SEGMENTS" />
              <HealthMetric value={formatNumber(segmentIndexed)} label="INDEXED" accent />
            </div>

            <section className="grid gap-1.5 border-t border-white/10 pt-1.5" aria-label="Segment 索引完成率">
              <div className="flex items-center justify-between gap-3 text-[10px] font-black">
                <strong>SEGMENT INDEX COVERAGE</strong>
                <span className="library-health-muted text-[9px] text-white/55">{coverage.toFixed(1)}%</span>
              </div>
              <div className="library-health-track flex h-1.5 overflow-hidden rounded-full bg-white/[0.09]">
                <span
                  className="block rounded-full bg-[linear-gradient(90deg,var(--premium-blue),var(--premium-accent))] transition-[width] duration-700 ease-out"
                  style={{ width: `${coverage}%` }}
                />
              </div>
            </section>

            <section className="grid gap-1.5 border-t border-white/10 pt-1.5" aria-label="文件类型占比">
              <div className="flex items-center justify-between gap-3 text-[10px] font-black">
                <strong>FILE TYPE MIX</strong>
                <span className="library-health-muted text-[9px] text-white/55">{sourceTypes.length} TYPES</span>
              </div>
              <div className="library-health-track flex h-1.5 overflow-hidden rounded-full bg-white/[0.09]" aria-hidden="true">
                {sourceTypes.map((source) => (
                  <span
                    key={source.type}
                    className="library-health-type-slice h-full min-w-0"
                    style={{ backgroundColor: healthSourceColor(source.type), flexGrow: Math.max(0, source.count), flexBasis: 0 }}
                  />
                ))}
              </div>
              {sourceTypes.length ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {sourceTypes.map((source) => {
                    const label = healthSourceLabel(source.type, source.label);

                    return (
                      <span key={source.type} className="library-health-muted grid min-w-0 grid-cols-[7px_minmax(0,1fr)_auto] items-center gap-2 text-[10px] text-white/55">
                        <i className="size-[7px] rounded-full" style={{ backgroundColor: healthSourceColor(source.type) }} aria-hidden="true" />
                        <span className="truncate" title={label}>{label}</span>
                        <strong className="library-health-source-value text-white">{Math.max(0, source.percentage)}%</strong>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="library-health-muted m-0 text-[10px] text-white/55">暂无文件类型数据</p>
              )}
            </section>
          </div>
        ) : null}
        {selectedKb && !isLoading && !isError && !health ? (
          <DarkState label="暂无健康状态数据" />
        ) : null}
      </div>
    </section>
  );
}

const HEALTH_FALLBACK_COLORS = ["#ffb366", "#8ec5ff", "#d7a9ff", "#ff8f9c"];

function healthSourceColor(type: string) {
  const normalizedType = type.toUpperCase();
  const knownColor = fileTypeColor(normalizedType);
  if (knownColor) return knownColor;

  const colorIndex = Array.from(normalizedType).reduce((total, character) => total + character.charCodeAt(0), 0);
  return HEALTH_FALLBACK_COLORS[colorIndex % HEALTH_FALLBACK_COLORS.length];
}

function healthSourceLabel(type: string, label: string) {
  const value = (label || type || "OTHER").toUpperCase();
  return value === "MARKDOWN" ? "MD" : value;
}

function HealthMetric({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <article className="library-health-metric min-w-0 rounded-[8px] border border-white/10 bg-white/[0.055] px-2.5 py-2.5">
      <strong
        className={[
          "library-health-metric-value mb-1.5 block overflow-hidden text-ellipsis text-[clamp(18px,1.55vw,22px)] font-black leading-[0.9]",
          accent ? "text-[var(--premium-accent)]" : "text-white",
        ].join(" ")}
        data-accent={accent}
        title={value}
      >
        {value}
      </strong>
      <span className="library-health-metric-label text-[9px] font-black text-white/55">{label}</span>
    </article>
  );
}

function InlineState({ label, compact = false, fill = false }: { label: string; compact?: boolean; fill?: boolean }) {
  return (
    <div className={[
      "grid place-items-center rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] px-4 text-center text-sm text-[var(--premium-muted)]",
      fill ? "h-full min-h-0" : compact ? "min-h-16" : "min-h-28",
    ].join(" ")}>
      {label}
    </div>
  );
}

function DarkState({ label }: { label: string }) {
  return <div className="library-panel-state grid h-full place-items-center rounded-[8px] bg-white/10 p-2.5 text-xs text-white/60">{label}</div>;
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
