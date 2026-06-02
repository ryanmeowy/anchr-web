"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  FileText,
  Folder,
  Globe2,
  MessageCircle,
  Paperclip,
  Plus,
  Scale,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import type { HomeSummary, RecentCitation, RecentQuestion } from "@/lib/types";

type AnswerCitation = {
  segmentId?: string;
  snippet?: string;
  fileName?: string;
  pageNo?: number;
};

const modeOptions = [
  { label: "严格问答", icon: ShieldCheck },
  { label: "总结", icon: FileText },
  { label: "对比", icon: Scale },
  { label: "仅检索", icon: Search },
];

const kbIconStyles = [
  { icon: Building2, tile: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
  { icon: Code2, tile: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" },
  { icon: Folder, tile: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" },
  { icon: Database, tile: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300" },
];

export function AskPage() {
  const searchParams = useSearchParams();
  const initialKbId = searchParams.get("kbId") ?? "";
  const initialKbName = searchParams.get("kbName") ?? "";
  const [query, setQuery] = useState("");
  const [kbId, setKbId] = useState(initialKbId);
  const [sessionId, setSessionId] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<AnswerCitation[]>([]);
  const [activeMode, setActiveMode] = useState("严格问答");
  const [isKbMenuOpen, setIsKbMenuOpen] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [showAllCitations, setShowAllCitations] = useState(false);

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const homeQuery = useQuery({
    queryKey: ["home-summary"],
    queryFn: apiClient.homeSummary,
  });

  const activityQuestionsQuery = useQuery({
    queryKey: ["activity", "recent-questions", 50],
    queryFn: () => apiClient.recentQuestions(50),
    enabled: showAllQuestions,
  });

  const activityCitationsQuery = useQuery({
    queryKey: ["activity", "recent-citations", 50],
    queryFn: () => apiClient.recentCitations(50),
    enabled: showAllCitations,
  });

  const home = homeQuery.data;
  const kbs = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
  const favoriteKbs = useMemo(() => home?.favoriteKbs ?? [], [home?.favoriteKbs]);
  const recentQuestions = useMemo(() => home?.recentQuestions ?? [], [home?.recentQuestions]);
  const recentCitations = useMemo(() => home?.recentCitations ?? [], [home?.recentCitations]);
  const kbOptions = useMemo(() => {
    const options = kbs.map((item) => ({ id: item.id, name: item.name }));
    const existingIds = new Set(options.map((item) => item.id));

    if (initialKbId && initialKbName && !existingIds.has(initialKbId)) {
      options.push({ id: initialKbId, name: initialKbName });
      existingIds.add(initialKbId);
    }

    favoriteKbs.forEach((item) => {
      if (!existingIds.has(item.kbId)) {
        options.push({ id: item.kbId, name: item.name });
      }
    });

    return options;
  }, [favoriteKbs, initialKbId, initialKbName, kbs]);

  const selectedKbIds = useMemo(() => {
    if (kbId) {
      return [kbId];
    }

    if (kbs.length > 0) {
      return kbs.slice(0, 3).map((item) => item.id);
    }

    return favoriteKbs.slice(0, 3).map((item) => item.kbId);
  }, [favoriteKbs, kbId, kbs]);

  const selectedKbLabel = useMemo(() => {
    if (!kbId) {
      return "全部知识库";
    }

    return kbOptions.find((item) => item.id === kbId)?.name ?? "已选知识库";
  }, [kbId, kbOptions]);

  const askMutation = useMutation({
    mutationFn: async () => {
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        const session = await apiClient.createConversation({
          title: query.trim().slice(0, 40) || "新的问答",
          kbIds: selectedKbIds,
        });
        currentSessionId = session.sessionId;
        setSessionId(currentSessionId);
      }

      return apiClient.sendMessage(currentSessionId, {
        query: query.trim(),
        kbIds: selectedKbIds,
        answerMode: "grounded",
      });
    },
    onSuccess: (data) => {
      setAnswer(data.answer ?? "未生成回答。");
      setCitations(data.citations ?? []);
    },
  });

  return (
    <div className="min-h-[calc(100vh-68px)] px-4 py-6 sm:px-6 lg:min-h-[calc(100vh-82px)] lg:px-10 lg:py-8">
      <div className="mx-auto grid max-w-[1340px] grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-14">
        <section className="min-w-0 pt-3 lg:pt-10">
          <div className="mx-auto max-w-[820px]">
            <div className="text-center">
              <h1 className="relative inline-flex items-start text-[34px] font-semibold leading-tight tracking-normal text-slate-950 dark:text-slate-200 sm:text-[40px] lg:text-[46px]">
                向知识库提问
                <Sparkles className="ml-2 mt-1 text-blue-500 sm:ml-3" size={30} fill="currentColor" strokeWidth={1.8} />
              </h1>
              <p className="mt-4 text-[17px] text-slate-500 dark:text-slate-400">从你的知识库中获取可靠答案，并附上来源</p>
            </div>

            <div className="mt-8 rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_22px_60px_rgba(15,23,42,0.08)] dark:border-[#475569] dark:bg-[#2a3648] dark:shadow-[0_22px_60px_rgba(0,0,0,0.26)] sm:mt-10 sm:p-5">
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="询问公司制度库、技术文档库..."
                className="min-h-[86px] w-full resize-none border-0 bg-transparent px-1 text-[18px] leading-8 text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
              />

              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <button
                    className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-[var(--line)] text-slate-500 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:text-slate-400 dark:hover:bg-[#334155]"
                    aria-label="添加附件"
                    type="button"
                  >
                    <Paperclip size={20} />
                  </button>

                  <div
                    className="relative min-w-0 flex-1 sm:flex-none"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setIsKbMenuOpen(false);
                      }
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setIsKbMenuOpen((open) => !open)}
                      className={[
                        "inline-flex h-11 w-full min-w-0 items-center gap-2 rounded-[12px] border bg-[var(--surface)] px-4 text-sm font-medium text-slate-700 transition sm:min-w-[168px] sm:max-w-[230px]",
                        isKbMenuOpen
                          ? "border-blue-300 ring-4 ring-blue-50 dark:border-blue-400/60 dark:bg-[#2a3648] dark:text-slate-200 dark:ring-blue-500/15"
                          : "border-[var(--line)] hover:border-slate-300 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-[#334155]",
                      ].join(" ")}
                      aria-expanded={isKbMenuOpen}
                      aria-haspopup="listbox"
                    >
                      <Database className="shrink-0 text-slate-500 dark:text-slate-400" size={18} />
                      <span className="min-w-0 flex-1 truncate text-left">{selectedKbLabel}</span>
                      <ChevronDown
                        className={[
                          "shrink-0 text-slate-500 transition-transform dark:text-slate-400",
                          isKbMenuOpen ? "rotate-180" : "",
                        ].join(" ")}
                        size={16}
                      />
                    </button>

                    {isKbMenuOpen ? (
                      <div
                        className="absolute left-0 top-[calc(100%+8px)] z-20 w-[min(260px,calc(100vw-48px))] overflow-hidden rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.12)] dark:border-[#475569] dark:bg-[#2a3648] dark:shadow-[0_18px_45px_rgba(0,0,0,0.36)]"
                        role="listbox"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setKbId("");
                            setIsKbMenuOpen(false);
                          }}
                          className={[
                            "flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-sm transition",
                            !kbId ? "bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300 dark:hover:bg-[#334155]",
                          ].join(" ")}
                          role="option"
                          aria-selected={!kbId}
                        >
                          <Database size={17} />
                          <span className="min-w-0 flex-1 truncate">全部知识库</span>
                        </button>

                        {kbOptions.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setKbId(item.id);
                              setIsKbMenuOpen(false);
                            }}
                            className={[
                              "flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-sm transition",
                              kbId === item.id ? "bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300 dark:hover:bg-[#334155]",
                            ].join(" ")}
                            role="option"
                            aria-selected={kbId === item.id}
                          >
                            <Folder size={17} />
                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                          </button>
                        ))}

                        {kbOptions.length === 0 ? (
                          <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">暂无可选知识库</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-3">
                  <button
                    type="button"
                    className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-200 dark:hover:bg-[#334155]"
                  >
                    <Globe2 size={18} />
                    联网搜索
                    <span className="ml-1 h-6 w-10 rounded-full bg-slate-200 p-0.5 dark:bg-[#475569]">
                      <span className="block size-5 rounded-full bg-[var(--surface)] shadow-sm dark:bg-slate-300" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => askMutation.mutate()}
                    disabled={!query.trim() || askMutation.isPending || selectedKbIds.length === 0}
                    className="grid size-12 place-items-center rounded-full bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.32)] transition hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none"
                    aria-label={askMutation.isPending ? "生成中" : "发送"}
                  >
                    <Send size={21} fill="currentColor" />
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-9 flex flex-wrap justify-center gap-5">
              {modeOptions.map((item) => {
                const Icon = item.icon;
                const active = activeMode === item.label;

                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setActiveMode(item.label)}
                    className={[
                      "inline-flex h-12 min-w-[128px] items-center justify-center gap-3 rounded-full border px-5 text-[15px] font-medium transition",
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-600 dark:border-blue-400/70 dark:bg-blue-500/15 dark:text-blue-300"
                        : "border-[var(--line)] bg-[var(--surface)] text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-300 dark:hover:bg-[#334155]",
                    ].join(" ")}
                  >
                    <Icon size={20} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            {askMutation.error ? (
              <div className="mt-6">
                <ErrorBlock message={(askMutation.error as Error).message} />
              </div>
            ) : null}

            {answer ? (
              <div className="mt-8 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
                  <Sparkles size={18} />
                  回答
                </div>
                <div className="mt-4 whitespace-pre-wrap text-[16px] leading-8 text-slate-900 dark:text-slate-200">{answer}</div>
                {citations.length > 0 ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {citations.map((citation, index) => (
                      <Link
                        key={`${citation.segmentId ?? index}`}
                        href={citation.segmentId ? `/preview/${citation.segmentId}` : "/ask"}
                        className="rounded-[8px] border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/15 dark:text-blue-300"
                      >
                        [{index + 1}] {citation.fileName ?? "引用来源"} {citation.pageNo ? `第 ${citation.pageNo} 页` : ""}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-[8px] bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">未找到可引用证据。</div>
                )}
              </div>
            ) : null}

            <RecentQuestions
              questions={showAllQuestions ? (activityQuestionsQuery.data?.items ?? []) : recentQuestions}
              summary={home}
              isLoading={showAllQuestions ? activityQuestionsQuery.isLoading : homeQuery.isLoading}
              isError={showAllQuestions ? activityQuestionsQuery.isError : false}
              isExpanded={showAllQuestions}
              onToggleAll={() => setShowAllQuestions((value) => !value)}
            />
          </div>
        </section>

        <aside className="space-y-5 pt-0 xl:pt-4">
          <FavoriteKnowledgeBases
            items={favoriteKbs}
            isLoading={homeQuery.isLoading}
            onSelectKb={setKbId}
          />
          <RecentCitations
            items={showAllCitations ? (activityCitationsQuery.data?.items ?? []) : recentCitations}
            isLoading={showAllCitations ? activityCitationsQuery.isLoading : homeQuery.isLoading}
            isError={showAllCitations ? activityCitationsQuery.isError : false}
            isExpanded={showAllCitations}
            onToggleAll={() => setShowAllCitations((value) => !value)}
          />
        </aside>
      </div>
    </div>
  );
}

function RecentQuestions({
  questions,
  summary,
  isLoading,
  isError,
  isExpanded,
  onToggleAll,
}: {
  questions: RecentQuestion[];
  summary?: HomeSummary;
  isLoading: boolean;
  isError: boolean;
  isExpanded: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="mt-12 lg:mt-20">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-slate-950 dark:text-slate-200">最近提问</h2>
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-300"
        >
          {isExpanded ? "收起" : "查看全部"}
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[var(--line)] bg-[var(--surface)] dark:border-[#475569] dark:bg-[#2a3648]">
        {isLoading ? (
          <div className="p-5">
            <LoadingBlock label="加载最近提问" />
          </div>
        ) : isError ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            最近提问暂不可用。
          </div>
        ) : questions.length > 0 ? (
          questions.slice(0, isExpanded ? 50 : 3).map((item) => (
            <Link
              key={item.turnId}
              href="/ask"
              className="grid grid-cols-1 gap-3 border-b border-[var(--line)] px-5 py-4 last:border-b-0 hover:bg-[var(--surface-hover)] dark:border-[#475569] dark:hover:bg-[#334155] sm:grid-cols-[1fr_auto] sm:items-center lg:grid-cols-[1fr_auto_auto] lg:gap-4"
            >
              <div className="flex min-w-0 items-center gap-4">
                <MessageCircle className="shrink-0 text-slate-500 dark:text-slate-400" size={19} />
                <span className="truncate text-[15px] font-medium text-slate-900 dark:text-slate-200">{item.question ?? "未命名问题"}</span>
              </div>
              <KbScopeLabels scope={item.kbScope ?? []} />
              <div className="flex items-center justify-between gap-4 text-sm text-slate-500 dark:text-slate-400 sm:justify-end">
                <span>{formatRelativeTime(item.createdAt)}</span>
                <ChevronRight size={17} />
              </div>
            </Link>
          ))
        ) : (
          <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {summary?.state?.error ? "最近提问暂不可用。" : "暂无最近提问。"}
          </div>
        )}
      </div>
    </div>
  );
}

function KbScopeLabels({ scope }: { scope: string[] }) {
  if (scope.length === 0) {
    return null;
  }

  return (
    <div className="hidden max-w-[270px] flex-wrap justify-end gap-2 md:flex">
      {scope.slice(0, 2).map((item, index) => (
        <span
          key={`${item}-${index}`}
          className={[
            "max-w-[120px] truncate rounded-[7px] px-2.5 py-1 text-xs font-medium",
            index % 2 === 0
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
          ].join(" ")}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function FavoriteKnowledgeBases({
  items,
  isLoading,
  onSelectKb,
}: {
  items: NonNullable<HomeSummary["favoriteKbs"]>;
  isLoading: boolean;
  onSelectKb: (kbId: string) => void;
}) {
  return (
    <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-4 dark:border-[#475569]">
        <h2 className="text-[17px] font-semibold text-slate-950 dark:text-slate-200">常用知识库</h2>
        <Link href="/library" className="text-sm font-medium text-blue-600 dark:text-blue-300">管理</Link>
      </div>

      {isLoading ? (
        <div className="py-5">
          <LoadingBlock label="加载知识库" />
        </div>
      ) : items.length > 0 ? (
        <div className="divide-y divide-[var(--line)] dark:divide-[#475569]">
          {items.slice(0, 3).map((item, index) => {
            const style = kbIconStyles[index % kbIconStyles.length];
            const Icon = style.icon;

            return (
              <button
                key={item.kbId}
                type="button"
                onClick={() => onSelectKb(item.kbId)}
                className="flex w-full items-center gap-4 py-4 text-left"
              >
                <span className={`grid size-12 shrink-0 place-items-center rounded-[10px] ${style.tile}`}>
                  <Icon size={23} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-slate-950 dark:text-slate-200">{item.name}</span>
                  <span className="mt-1 block truncate text-sm text-slate-500 dark:text-slate-400">
                    文档 {formatNumber(item.documentCount)} <span className="px-1.5">·</span> 片段 {formatNumber(item.segmentCount)}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-300 sm:inline-flex">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  可用
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">暂无常用知识库。</div>
      )}

      <Link
        href="/library"
        className="mt-1 flex h-11 items-center justify-center gap-2 border-t border-[var(--line)] pt-4 text-sm font-medium text-slate-500 hover:text-blue-600 dark:border-[#475569] dark:text-slate-400 dark:hover:text-blue-300"
      >
        <Plus size={18} />
        添加知识库
      </Link>
    </div>
  );
}

function RecentCitations({
  items,
  isLoading,
  isError,
  isExpanded,
  onToggleAll,
}: {
  items: RecentCitation[];
  isLoading: boolean;
  isError: boolean;
  isExpanded: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-slate-950 dark:text-slate-200">最近引用</h2>
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-300"
        >
          {isExpanded ? "收起" : "查看全部"}
          <ChevronRight size={16} />
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock label="加载最近引用" />
      ) : isError ? (
        <div className="rounded-[8px] border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-slate-500 dark:border-[#475569] dark:text-slate-400">
          最近引用暂不可用。
        </div>
      ) : items.length > 0 ? (
        <div className="space-y-3">
          {items.slice(0, isExpanded ? 50 : 3).map((item, index) => (
            <Link
              key={item.segmentId}
              href={`/preview/${item.segmentId}`}
              className="block rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-3 hover:border-blue-200 hover:bg-blue-50/40 dark:border-[#475569] dark:bg-[#2a3648] dark:hover:border-blue-400/40 dark:hover:bg-blue-500/10"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-[5px] px-1.5 py-1 text-[11px] font-bold text-white ${citationBadgeColor(index)}`}>
                  {fileExtension(item.fileName)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-950 dark:text-slate-200">
                  {item.title || item.fileName || "引用片段"}
                </span>
              </div>
              <div className="line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {item.snippet || item.citationReason || "暂无引用摘要。"}
              </div>
              <div className="mt-2 text-right text-xs font-medium text-blue-600">[{index + 1}]</div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[8px] border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-slate-500 dark:border-[#475569] dark:text-slate-400">
          暂无最近引用。
        </div>
      )}

    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
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

function fileExtension(fileName?: string | null) {
  const extension = fileName?.split(".").pop()?.slice(0, 4).toUpperCase();
  return extension || "DOC";
}

function citationBadgeColor(index: number) {
  const colors = ["bg-red-500", "bg-blue-600", "bg-emerald-500"];
  return colors[index % colors.length];
}
