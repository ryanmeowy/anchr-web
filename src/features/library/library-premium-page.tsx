"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Grid3X3,
  List,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PremiumRail } from "@/components/app/premium-rail";
import { apiClient } from "@/lib/api-client";
import { formatDateTime, formatNumber, statusText } from "@/lib/format";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import type { KnowledgeBase, KnowledgeBaseHealth, KnowledgeBaseStats, RecentCitation, RecentQuestion } from "@/lib/types";

type ViewMode = "grid" | "list";
type FilterMode = "all" | "answerable" | "recent" | "archived";
type ThemeMode = PremiumThemeMode;

const KB_PAGE_SIZE = 6;
const RECENT_LIMIT = 3;
const RECENT_UPDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const filterOptions: Array<{ value: FilterMode; label: string }> = [
  { value: "all", label: "全部" },
  { value: "answerable", label: "可问答" },
  { value: "archived", label: "已归档" },
  { value: "recent", label: "最近更新" },
];

export function LibraryPremiumPage() {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [recentUpdateAfter, setRecentUpdateAfter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [page, setPage] = useState(1);
  const [selectedKbIdValue, setSelectedKbIdValue] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [archiveConfirmKbId, setArchiveConfirmKbId] = useState<string | null>(null);
  const [savingKbId, setSavingKbId] = useState<string | null>(null);
  const [archivingKbId, setArchivingKbId] = useState<string | null>(null);
  const deferredKeyword = useDeferredValue(keyword);
  const trimmedKeyword = deferredKeyword.trim();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTheme(getInitialPremiumTheme());
      setThemeHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!themeHydrated) return;

    applyPremiumTheme(theme);
  }, [theme, themeHydrated]);

  const queryBody = useMemo(() => {
    const body: {
      keyword?: string;
      status?: string;
      updateAfter?: string;
      page: number;
      size: number;
    } = {
      page,
      size: KB_PAGE_SIZE,
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

    if (filterMode === "recent") {
      body.updateAfter = recentUpdateAfter;
    }

    return body;
  }, [filterMode, page, recentUpdateAfter, trimmedKeyword]);

  const kbsQuery = useQuery({
    queryKey: ["kbs", "premium", queryBody],
    queryFn: () => apiClient.queryKnowledgeBases(queryBody),
    refetchOnWindowFocus: false,
  });

  const citationsQuery = useQuery({
    queryKey: ["activity", "recent-citations", RECENT_LIMIT],
    queryFn: () => apiClient.recentCitations(RECENT_LIMIT),
  });

  const questionsQuery = useQuery({
    queryKey: ["activity", "recent-questions", RECENT_LIMIT],
    queryFn: () => apiClient.recentQuestions(RECENT_LIMIT),
  });

  const items = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
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
  const totalPages = Math.max(1, Math.ceil(totalWithCreateCard / KB_PAGE_SIZE));
  const shouldShowCreateEntry = canShowCreateEntry && !isSearching && !kbsQuery.isLoading && !kbsQuery.isError && items.length < KB_PAGE_SIZE;
  const gridItems = items.slice(0, shouldShowCreateEntry ? KB_PAGE_SIZE - 1 : KB_PAGE_SIZE);
  const canShowResults = !kbsQuery.isLoading && !kbsQuery.isError;
  const showEmptyResults = canShowResults && items.length === 0 && !shouldShowCreateEntry;
  const activeSelectedKbId = useMemo(() => {
    if (items.length === 0) return null;
    if (selectedKbIdValue && items.some((item) => item.id === selectedKbIdValue)) {
      return selectedKbIdValue;
    }

    return items[0].id;
  }, [items, selectedKbIdValue]);

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
    onSettled: () => setArchivingKbId(null),
  });

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
  };

  const handleFilterChange = (nextFilter: FilterMode) => {
    setFilterMode(nextFilter);
    setRecentUpdateAfter(nextFilter === "recent" ? recentUpdateAfterValue() : "");
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

  return (
    <div className="premium-theme ask-premium-page library-premium-page min-h-screen overflow-x-hidden bg-[#f7f7f2] text-[#111315]" data-theme={theme} data-premium-theme={theme}>
      <div aria-hidden="true" className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(17,19,21,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(17,19,21,0.055)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div aria-hidden="true" className="ask-premium-glow-bg pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_78%_8%,rgba(187,255,102,0.34),transparent_28rem),radial-gradient(circle_at_14%_92%,rgba(49,88,255,0.15),transparent_30rem)]" />

      <div className="relative min-h-screen overflow-x-hidden p-0 lg:p-6">
        <div className="ask-premium-shell grid min-h-screen overflow-hidden border border-black/15 bg-white/70 shadow-[0_24px_80px_rgba(17,19,21,0.12)] backdrop-blur-2xl lg:min-h-[calc(100vh-48px)] lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-[8px]">
          <PremiumRail theme={theme} onThemeChange={setTheme} />

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr]">
            <header className="ask-premium-hero relative grid h-[112px] gap-2 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div aria-hidden="true" className="pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]">
                LIBRARY
              </div>
              <section className="relative z-10 flex min-w-0 flex-col justify-center gap-2">
                <div>
                  <p className="ask-premium-kicker mb-1.5 flex items-center gap-2 text-[10px] font-black text-blue-700">
                    <span className="size-1.5 rounded-full bg-[var(--premium-accent)] shadow-[0_0_0_5px_rgba(187,255,102,0.2)]" />
                    LIBRARY / KNOWLEDGE ASSET COMMAND
                  </p>
                  <h1 className="max-w-[720px] text-[clamp(16px,2.4vw,34px)] font-black leading-none">
                    让每个知识库都能被看见、被追踪、被提问。
                  </h1>
                </div>
              </section>
            </header>

            <main className="ask-premium-main grid min-h-0 min-w-0 items-start gap-3 overflow-visible bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)] px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,330px)] lg:items-stretch lg:px-5">
              <section className="flex min-h-0 min-w-0 flex-col lg:h-full" aria-label="我的知识库">
                <div className="mb-5 grid shrink-0 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <form
                    className="premium-focusable flex min-h-11 min-w-0 items-center gap-3 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-2 pl-4 shadow-[0_12px_32px_rgba(17,19,21,0.07)] backdrop-blur-xl transition"
                    role="search"
                    onSubmit={handleSearchSubmit}
                  >
                    <Search size={21} className="shrink-0 text-[var(--premium-muted)]" />
                    <input
                      value={keyword}
                      onChange={(event) => {
                        setKeyword(event.target.value);
                        setPage(1);
                      }}
                      className="min-w-0 flex-1 border-0 bg-transparent text-base text-[var(--premium-ink)] outline-none placeholder:text-[var(--premium-muted)]"
                      aria-label="搜索知识库"
                      placeholder="搜索知识库"
                    />
                    <button
                      type="submit"
                      className="inline-flex min-h-9 items-center justify-center rounded-full bg-[var(--premium-ink)] px-3.5 text-[var(--premium-bg)] shadow-[0_12px_28px_rgba(17,19,21,0.16)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white"
                      aria-label="搜索"
                    >
                      <ArrowRight size={17} />
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
                  <div className="mb-2.5 flex shrink-0 flex-col items-start justify-between gap-2 sm:flex-row sm:items-end">
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
                      <div className="library-card-grid grid grid-cols-1 gap-3 lg:h-full lg:min-h-0 xl:grid-cols-3 xl:grid-rows-2">
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
                            updateError={item.id === editingKbId && updateMutation.error instanceof Error ? updateMutation.error.message : null}
                            archiveError={item.id === archiveConfirmKbId && archiveMutation.error instanceof Error ? archiveMutation.error.message : null}
                            onSelect={() => setSelectedKbIdValue(item.id)}
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
                      <div className="flex h-full min-h-0 flex-col overflow-x-auto rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] shadow-[var(--premium-tight-shadow)]">
                        <div className="grid min-w-[860px] grid-cols-[minmax(0,1fr)_92px_112px_136px_184px] items-center gap-4 border-b border-[var(--premium-line)] px-5 py-3 text-xs font-black text-[var(--premium-muted)]">
                          <span>知识库</span>
                          <span className="text-center">文档</span>
                          <span className="text-center">片段</span>
                          <span className="text-center">更新时间</span>
                          <span className="text-center">操作</span>
                        </div>
                        <div className="grid min-h-0 min-w-[860px] flex-1 grid-rows-6 divide-y divide-[var(--premium-line)]">
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
                              updateError={item.id === editingKbId && updateMutation.error instanceof Error ? updateMutation.error.message : null}
                              archiveError={item.id === archiveConfirmKbId && archiveMutation.error instanceof Error ? archiveMutation.error.message : null}
                              onSelect={() => setSelectedKbIdValue(item.id)}
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
                      pageSize={KB_PAGE_SIZE}
                      totalPages={totalPages}
                      isFetching={kbsQuery.isFetching}
                      onPageChange={setPage}
                    />
                  </div>
                </div>
              </section>

              <aside className="grid gap-2 overflow-visible lg:min-w-0" aria-label="活动洞察">
                <RecentCitationPanel
                  items={citationsQuery.data?.items ?? []}
                  isLoading={citationsQuery.isLoading}
                  isError={citationsQuery.isError}
                />
                <RecentQuestionPanel
                  items={questionsQuery.data?.items ?? []}
                  isLoading={questionsQuery.isLoading}
                  isError={questionsQuery.isError}
                />
                <div className="min-h-[184px]">
                  <HealthPanel
                    selectedKb={selectedKb}
                    health={healthQuery.data}
                    isLoading={healthQuery.isLoading || healthQuery.isFetching}
                    isError={healthQuery.isError}
                  />
                </div>
              </aside>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
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
    return "bg-[rgba(187,255,102,0.28)] text-[#496c08] dark:text-[var(--premium-accent)]";
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
} & KnowledgeBaseRowActions) {
  const lastUpdated = item.updatedAt ?? item.lastIngestedAt ?? item.createdAt;
  const active = isActiveKnowledgeBase(item);
  const documentCount = stats?.documentCount ?? item.documentCount;
  const segmentCount = stats?.segmentCount ?? item.segmentCount;

  return (
    <article
      onClick={onSelect}
      className={[
        "library-kb-card group relative grid h-full min-h-[254px] cursor-pointer grid-rows-[auto_minmax(0,1fr)_auto] gap-1.5 overflow-hidden rounded-[8px] border p-2.5 shadow-[var(--premium-tight-shadow)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(17,19,21,0.13)] lg:min-h-0",
        selected ? "border-[var(--premium-line-strong)] bg-[var(--premium-panel-strong)] ring-1 ring-black/5 dark:ring-white/10" : "border-[var(--premium-line)] bg-[var(--premium-panel)]",
      ].join(" ")}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(120deg, rgba(39,93,255,0.12), transparent 36%), radial-gradient(circle at 86% 8%, rgba(187,255,102,0.34), transparent 12rem)",
        }}
      />
      <div className="relative z-10 flex items-start justify-between gap-3">
        <KnowledgeGlyph index={index} />
        <StatusBadge status={item.status} />
      </div>

      {editing ? (
        <div className="relative z-10 grid min-w-0 self-start content-start gap-1.5" onClick={(event) => event.stopPropagation()}>
          <input className={compactFieldClass()} value={editName} onChange={(event) => onEditNameChange(event.target.value)} placeholder="知识库名称" />
          <input className={compactFieldClass()} value={editDescription} onChange={(event) => onEditDescriptionChange(event.target.value)} placeholder="描述，可选" />
          {updateError ? <p className="line-clamp-1 text-[11px] text-rose-600 dark:text-rose-300">{updateError}</p> : null}
        </div>
      ) : (
        <div className="relative z-10 min-w-0 self-start">
          <h3 className="library-kb-title line-clamp-1 break-words text-[16px] font-black leading-[1.08]">{item.name}</h3>
          <p className="mt-1 line-clamp-1 min-h-4 text-[11px] leading-4 text-[var(--premium-ink-soft)]">{item.description || "暂无描述"}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <StatBox value={formatNumber(documentCount)} label="文档" />
            <StatBox value={formatNumber(segmentCount)} label="片段" />
          </div>
          <RecentIngestionCard stats={stats} active={active} />
        </div>
      )}

      <div className="library-kb-footer relative z-10 flex min-h-12 shrink-0 flex-col gap-1.5 border-t border-[var(--premium-line)] pt-2 sm:flex-row sm:items-center sm:justify-between">
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
} & KnowledgeBaseRowActions) {
  const lastUpdated = item.updatedAt ?? item.lastIngestedAt ?? item.createdAt;
  const active = isActiveKnowledgeBase(item);

  return (
    <div
      onClick={onSelect}
      className={[
      "grid h-full min-h-0 max-h-full overflow-hidden cursor-pointer grid-cols-[minmax(0,1fr)_92px_112px_136px_184px] items-center gap-4 px-5 py-2 transition",
      selected ? "bg-[var(--premium-panel-strong)]" : "hover:bg-[var(--premium-panel-muted)]",
    ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-4 text-left">
        <KnowledgeGlyph index={index} compact />
        {editing ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2" onClick={(event) => event.stopPropagation()}>
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
      <span className="text-center text-sm text-[var(--premium-ink-soft)]">{formatNumber(item.documentCount)}</span>
      <span className="text-center text-sm text-[var(--premium-ink-soft)]">{formatNumber(item.segmentCount)}</span>
      <span className="truncate text-center text-sm text-[var(--premium-muted)]">
        {editing && updateError ? updateError : archiveConfirming && archiveError ? archiveError : formatDateTime(lastUpdated)}
      </span>
      <div className="flex justify-center">
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
    <div className={["flex h-8 items-center", compact ? "gap-1" : "gap-1.5"].join(" ")}>
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
    <div className="flex items-center gap-1.5">
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
    <div className="flex min-w-0 items-center gap-1.5">
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
    "fill-[var(--premium-accent)]",
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
    <span className={[
      "inline-flex shrink-0 items-center gap-1.5 rounded-full font-black",
      isActive
        ? "bg-[rgba(187,255,102,0.26)] text-[#496c08] dark:text-[var(--premium-accent)]"
        : isArchived
          ? "bg-black/5 text-[var(--premium-muted)] dark:bg-white/8"
          : "bg-[var(--premium-panel-muted)] text-[var(--premium-muted)]",
      compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1.5 text-xs",
    ].join(" ")}>
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
        <span className={["shrink-0 rounded-full px-2 py-1 text-[10px] font-black", ingestionBadgeClass(status)].join(" ")}>
          {ingestionStatusLabel(status)}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-black/10 dark:bg-black/35" aria-label={`最近导入成功 ${success}，失败 ${failure}，运行中 ${running}`}>
        <span className="h-full bg-[var(--premium-accent)]" style={{ flex: ingestionFlex(success, total) }} />
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
      <div className="library-create-kb-card grid h-full min-h-[254px] gap-2 rounded-[8px] border border-dashed border-[var(--premium-line-strong)] bg-[var(--premium-panel)] p-2.5 shadow-[var(--premium-tight-shadow)] lg:min-h-0">
        <div className="flex items-center gap-2 font-black text-[var(--premium-blue)]">
          <Plus size={20} />
          新建知识库
        </div>
        <input className={premiumFieldClass()} value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="知识库名称" />
        <input className={premiumFieldClass()} value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="描述，可选" />
        {error ? <div className="text-xs text-rose-600 dark:text-rose-300">{error}</div> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCreate} disabled={pending || !name.trim()} className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--premium-ink)] px-3.5 text-xs font-black text-[var(--premium-bg)] disabled:opacity-45">
            {pending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {pending ? "创建中" : "创建"}
          </button>
          <button type="button" onClick={onCancel} className="h-9 rounded-full border border-[var(--premium-line)] px-3.5 text-xs font-black text-[var(--premium-ink-soft)] hover:bg-[var(--premium-panel-muted)]">
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
      className="library-create-kb-card grid h-full min-h-[254px] place-items-center rounded-[8px] border border-dashed border-[var(--premium-line-strong)] bg-[linear-gradient(135deg,var(--premium-panel),rgba(255,255,255,0.28)),repeating-linear-gradient(135deg,rgba(17,19,21,0.035)_0_1px,transparent_1px_12px)] p-3 text-center transition hover:-translate-y-1 hover:border-[var(--premium-ink-soft)] hover:bg-[var(--premium-panel-strong)] lg:min-h-0"
    >
      <span>
        <span className="mx-auto mb-2 grid size-12 place-items-center rounded-full bg-[var(--premium-ink)] text-[var(--premium-bg)] shadow-[0_14px_30px_rgba(17,19,21,0.18)]">
          <Plus size={24} />
        </span>
        <strong className="block text-base font-black">新建知识库</strong>
        <span className="mx-auto mt-1.5 block max-w-[330px] text-xs leading-5 text-[var(--premium-muted)]">上传文件或连接数据源，让新的业务上下文进入可检索、可引用、可问答的资产流。</span>
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
      <span className="font-black">新建知识库</span>
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

function RecentCitationPanel({ items, isLoading, isError }: { items: RecentCitation[]; isLoading: boolean; isError: boolean }) {
  return (
    <section className="rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-rail)] p-3 text-white shadow-[var(--premium-tight-shadow)]" aria-label="最近引用">
      <PanelLabel label="RECENT CITATIONS" value="OPENED" dark />
      <div className="mt-2.5 grid gap-2">
        {isLoading ? <DarkState label="加载最近引用" /> : null}
        {isError ? <DarkState label="最近引用暂不可用" /> : null}
        {!isLoading && !isError && items.length === 0 ? <DarkState label="暂无最近引用" /> : null}
        {!isLoading && !isError ? items.slice(0, RECENT_LIMIT).map((item, index) => <CitationItem key={`${item.segmentId}-${item.openedAt ?? index}`} item={item} index={index} />) : null}
      </div>
    </section>
  );
}

function CitationItem({ item, index }: { item: RecentCitation; index: number }) {
  return (
    <Link href={`/preview/${encodeURIComponent(item.segmentId)}`} className="grid gap-1.5 rounded-[8px] border border-white/10 bg-white/10 p-2.5 transition hover:-translate-x-0.5 hover:bg-white/[0.14]">
      <div className="flex flex-wrap gap-1">
        <span className="rounded-full bg-[rgba(187,255,102,0.16)] px-2 py-0.5 text-[10px] font-black text-[var(--premium-accent)]">{fileExtension(item.fileName)}</span>
        <span className="rounded-full bg-[rgba(187,255,102,0.16)] px-2 py-0.5 text-[10px] font-black text-[var(--premium-accent)]">#{index + 1}</span>
      </div>
      <strong className="break-words text-xs">{item.title || item.fileName || "引用片段"}</strong>
      <p className="line-clamp-1 text-[11px] leading-4 text-white/70">{item.snippet || item.citationReason || "暂无引用摘要。"}</p>
    </Link>
  );
}

function RecentQuestionPanel({ items, isLoading, isError }: { items: RecentQuestion[]; isLoading: boolean; isError: boolean }) {
  return (
    <section className="flex min-h-[152px] flex-col rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-rail)] p-3 text-white shadow-[var(--premium-tight-shadow)]" aria-label="最近问过">
      <PanelLabel label="RECENT QUESTIONS" value={String(items.length)} dark />
      <div className="mt-2.5 grid gap-2">
        {isLoading ? <DarkState label="加载最近提问" /> : null}
        {isError ? <DarkState label="最近提问暂不可用" /> : null}
        {!isLoading && !isError && items.length === 0 ? <DarkState label="暂无最近提问" /> : null}
        {!isLoading && !isError ? items.slice(0, RECENT_LIMIT).map((item) => <QuestionItem key={item.turnId} item={item} />) : null}
      </div>
    </section>
  );
}

function QuestionItem({ item }: { item: RecentQuestion }) {
  const params = new URLSearchParams();
  if (item.sessionId) params.set("session", item.sessionId);
  if (item.turnId) params.set("turn", item.turnId);
  const query = params.toString();
  const href = query ? `/ask?${query}` : "/ask";

  return (
    <Link href={href} className="grid min-h-16 content-center gap-1.5 rounded-[8px] border border-white/10 bg-white/10 p-2.5 transition hover:-translate-x-0.5 hover:bg-white/[0.14]">
      <strong className="line-clamp-2 break-words text-xs leading-5">{item.question || "未命名问题"}</strong>
      <p className="line-clamp-1 text-[11px] leading-4 text-white/70">{(item.knowledgeBaseNames ?? item.kbScope ?? []).slice(0, 2).join(" / ") || "全部知识库"}</p>
    </Link>
  );
}

function HealthPanel({
  selectedKb,
  health,
  isLoading,
  isError,
}: {
  selectedKb: KnowledgeBase | null;
  health?: KnowledgeBaseHealth;
  isLoading: boolean;
  isError: boolean;
}) {
  const score = Math.max(0, Math.min(100, health?.score ?? 0));
  const sourceTypes = health?.sourceTypes ?? [];

  return (
    <section className="flex h-full flex-col rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-rail)] p-3 text-white shadow-[var(--premium-tight-shadow)]" aria-label="知识库健康度">
      <PanelLabel label="LIBRARY HEALTH" value={health?.status ?? selectedKb?.status ?? "READY"} dark />
      <div className="mt-2.5 grid min-h-0 flex-1 gap-2.5">
        {!selectedKb ? <DarkState label="选择知识库查看健康度" /> : null}
        {selectedKb && isLoading ? <DarkState label="加载健康状态" /> : null}
        {selectedKb && isError ? <DarkState label="健康状态暂不可用" /> : null}
        {selectedKb && !isLoading && !isError ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <strong className="text-[clamp(34px,4.6vw,58px)] font-black leading-[0.88]">{score}%</strong>
              <span className="max-w-[140px] text-[11px] leading-4 text-white/70">
                {health?.kbName ?? selectedKb.name} 的索引、片段与导入状态综合评分。
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-label={`健康度 ${score}%`}>
              <span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--premium-blue),var(--premium-accent))] transition-[width] duration-500" style={{ width: `${score}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {sourceTypes.length ? sourceTypes.slice(0, 3).map((source) => (
                <HealthMetric key={source.type} value={`${Math.round(source.percentage)}%`} label={source.label || source.type} />
              )) : (
                <HealthMetric value="0%" label="暂无来源类型" />
              )}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function HealthMetric({ value, label }: { value: string; label: string }) {
  return (
    <span className="min-h-12 rounded-[8px] border border-white/10 bg-white/10 p-2 text-[10px] text-white/60">
      <b className="mb-0.5 block break-words text-sm text-white">{value}</b>
      {label}
    </span>
  );
}

function PanelLabel({ label, value, dark = false }: { label: string; value: string; dark?: boolean }) {
  return (
    <p className={[
      "m-0 flex items-center justify-between gap-3 text-xs font-black leading-5",
      dark ? "text-white/60" : "text-[var(--premium-muted)]",
    ].join(" ")}>
      {label} <span className="truncate">{value}</span>
    </p>
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
  return <div className="grid h-full place-items-center rounded-[8px] bg-white/10 p-2.5 text-xs text-white/60">{label}</div>;
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

function recentUpdateAfterValue() {
  return String(Date.now() - RECENT_UPDATE_WINDOW_MS);
}

function fileExtension(fileName?: string | null) {
  const extension = fileName?.split(".").pop()?.slice(0, 4).toUpperCase();
  return extension || "DOC";
}
