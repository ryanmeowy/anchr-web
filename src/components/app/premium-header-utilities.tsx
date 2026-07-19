"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Clock3,
  Database,
  Download,
  FileSearch,
  History,
  Loader2,
  MessageSquare,
  Plus,
  Quote,
  Search,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { apiClient } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";
import type { PremiumThemeMode } from "@/lib/premium-theme";
import { saveRecentCitationPreviewNavigation } from "@/lib/preview-context";
import type { RecentCitation, RecentQuestion } from "@/lib/types";

type UtilityMenu = "create" | "recent" | "status";
type UtilityIcon = LucideIcon;

type RecentWorkItem =
  | { id: string; kind: "question"; timestamp?: string; item: RecentQuestion }
  | { id: string; kind: "citation"; timestamp?: string; item: RecentCitation };

type PremiumHeaderUtilitiesProps = {
  theme: PremiumThemeMode;
  onCreateKnowledgeBase?: () => void;
  onStartImport?: () => void;
  onStartSearch?: () => void;
};

const MENU_WIDTH = 304;

export function PremiumHeaderUtilities({
  theme,
  onCreateKnowledgeBase,
  onStartImport,
  onStartSearch,
}: PremiumHeaderUtilitiesProps) {
  const router = useRouter();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<UtilityMenu, HTMLButtonElement | null>>({
    create: null,
    recent: null,
    status: null,
  });
  const [mounted, setMounted] = useState(false);
  const [openMenu, setOpenMenu] = useState<UtilityMenu | null>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 60, left: 12 });

  useEffect(() => setMounted(true), []);

  const recentQuestionsQuery = useQuery({
    queryKey: ["header-utilities", "recent-questions"],
    queryFn: () => apiClient.recentQuestions(5),
    enabled: openMenu === "recent",
    staleTime: 30_000,
  });

  const recentCitationsQuery = useQuery({
    queryKey: ["header-utilities", "recent-citations"],
    queryFn: () => apiClient.recentCitations(5),
    enabled: openMenu === "recent",
    staleTime: 30_000,
  });

  const indexStatusQuery = useQuery({
    queryKey: ["index", "status"],
    queryFn: () => apiClient.getIndexStatus(),
    retry: false,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      const status = query.state.data?.status;
      return status === "INITIALIZING" || status === "REBUILDING" ? 3_000 : 30_000;
    },
  });

  const elasticsearchQuery = useQuery({
    queryKey: ["health", "elasticsearch"],
    queryFn: () => apiClient.getElasticsearchHealth(),
    retry: false,
    refetchInterval: 30_000,
  });

  const knowledgeBasesQuery = useQuery({
    queryKey: ["header-utilities", "knowledge-bases"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const knowledgeBaseIds = useMemo(
    () => knowledgeBasesQuery.data?.items.map((item) => item.id) ?? [],
    [knowledgeBasesQuery.data?.items],
  );
  const knowledgeBaseStatsQuery = useQuery({
    queryKey: ["header-utilities", "knowledge-base-stats", knowledgeBaseIds.join("|")],
    queryFn: () => apiClient.getKnowledgeBaseStats(knowledgeBaseIds),
    enabled: knowledgeBaseIds.length > 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const recentWork = useMemo<RecentWorkItem[]>(() => {
    const questions: RecentWorkItem[] = (recentQuestionsQuery.data?.items ?? []).map((item, index) => ({
      id: `question-${item.turnId || index}`,
      kind: "question",
      timestamp: item.createdAt,
      item,
    }));
    const citations: RecentWorkItem[] = (recentCitationsQuery.data?.items ?? []).map((item, index) => ({
      id: `citation-${item.recordId || item.segmentId || index}`,
      kind: "citation",
      timestamp: item.openedAt,
      item,
    }));

    return [...questions.slice(0, 2), ...citations.slice(0, 2)]
      .sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp))
      .slice(0, 4);
  }, [recentCitationsQuery.data?.items, recentQuestionsQuery.data?.items]);

  const ingestionSummary = useMemo(() => {
    const stats = knowledgeBaseStatsQuery.data ?? [];
    return stats.reduce(
      (summary, item) => ({
        running: summary.running + (item.lastIngestionRunningCount ?? 0),
        failures: summary.failures + (item.lastIngestionFailureCount ?? 0),
        documents: summary.documents + (item.documentCount ?? 0),
      }),
      { running: 0, failures: 0, documents: 0 },
    );
  }, [knowledgeBaseStatsQuery.data]);

  const systemState = useMemo(() => {
    const index = indexStatusQuery.data;
    const elasticsearch = elasticsearchQuery.data;
    const pending = indexStatusQuery.isPending || elasticsearchQuery.isPending;
    const failed = indexStatusQuery.isError
      || elasticsearchQuery.isError
      || index?.status === "NOT_READY"
      || (index?.status === "READY" && (!index.readable || !index.writable))
      || elasticsearch?.connected === false
      || elasticsearch?.status === "red";
    const working = index?.status === "INITIALIZING" || index?.status === "REBUILDING" || ingestionSummary.running > 0;
    const warning = Boolean(index?.pendingRebuild) || elasticsearch?.status === "yellow";

    if (pending) return { tone: "loading", label: "检查状态" } as const;
    if (failed) return { tone: "error", label: "系统异常" } as const;
    if (working) {
      return {
        tone: "working",
        label: ingestionSummary.running > 0 ? `${formatNumber(ingestionSummary.running)} 个任务处理中` : "索引处理中",
      } as const;
    }
    if (warning) return { tone: "warning", label: "需要处理" } as const;
    return { tone: "ready", label: "系统就绪" } as const;
  }, [elasticsearchQuery.data, elasticsearchQuery.isError, elasticsearchQuery.isPending, indexStatusQuery.data, indexStatusQuery.isError, indexStatusQuery.isPending, ingestionSummary.running]);

  const updatePopoverPosition = useCallback((menu: UtilityMenu) => {
    const trigger = triggerRefs.current[menu];
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const left = Math.min(
      window.innerWidth - MENU_WIDTH - viewportPadding,
      Math.max(viewportPadding, rect.right - MENU_WIDTH),
    );
    setPopoverPosition({ top: rect.bottom + 8, left });
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    updatePopoverPosition(openMenu);

    const handleViewportChange = () => updatePopoverPosition(openMenu);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenMenu(null);
      triggerRefs.current[openMenu]?.focus();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu, updatePopoverPosition]);

  const toggleMenu = (menu: UtilityMenu) => {
    setOpenMenu((current) => current === menu ? null : menu);
  };

  const runQuickAction = (action: "ask" | "search" | "library" | "imports") => {
    setOpenMenu(null);
    if (action === "ask") {
      router.push("/ask");
      return;
    }
    if (action === "search") {
      if ((pathname === "/search" || pathname.startsWith("/search/")) && onStartSearch) {
        onStartSearch();
      } else {
        router.push("/search");
      }
      return;
    }
    if (action === "library") {
      if ((pathname === "/library" || pathname.startsWith("/library/")) && onCreateKnowledgeBase) {
        onCreateKnowledgeBase();
      } else {
        router.push("/library?create=1");
      }
      return;
    }
    if ((pathname === "/imports" || pathname.startsWith("/imports/")) && onStartImport) {
      onStartImport();
    } else {
      router.push("/imports");
    }
  };

  const openRecentWork = (work: RecentWorkItem, index: number) => {
    setOpenMenu(null);
    if (work.kind === "question") {
      const params = new URLSearchParams();
      if (work.item.sessionId) params.set("session", work.item.sessionId);
      if (work.item.turnId) params.set("turn", work.item.turnId);
      router.push(params.size > 0 ? `/ask?${params.toString()}` : "/ask");
      return;
    }
    router.push(saveRecentCitationPreviewNavigation(work.item, index));
  };

  const popover = openMenu && mounted ? createPortal(
    <div
      ref={popoverRef}
      className="premium-header-utility-popover"
      data-theme={theme}
      id={`premium-header-utility-${openMenu}`}
      role="dialog"
      aria-label={openMenu === "create" ? "新建" : openMenu === "recent" ? "最近工作" : "系统状态"}
      style={{ top: popoverPosition.top, left: popoverPosition.left }}
    >
      {openMenu === "create" ? (
        <>
          <UtilityPopoverHeader eyebrow="QUICK CREATE" title="新建" />
          <div className="premium-header-utility-list">
            <UtilityAction icon={MessageSquare} title="新建对话" detail="从一个空白问题开始" onClick={() => runQuickAction("ask")} />
            <UtilityAction icon={Search} title="发起检索" detail="跨知识库查找证据" onClick={() => runQuickAction("search")} />
            <UtilityAction icon={Database} title="创建知识库" detail="建立新的资料空间" onClick={() => runQuickAction("library")} />
            <UtilityAction icon={Download} title="导入文件" detail="PDF、Markdown、图片或文本" onClick={() => runQuickAction("imports")} />
          </div>
        </>
      ) : null}

      {openMenu === "recent" ? (
        <>
          <UtilityPopoverHeader eyebrow="CONTINUE WORKING" title="最近工作" />
          <div className="premium-header-utility-list">
            {recentQuestionsQuery.isPending || recentCitationsQuery.isPending ? (
              <UtilityState icon={Loader2} label="正在整理最近工作" spinning />
            ) : recentQuestionsQuery.isError && recentCitationsQuery.isError ? (
              <UtilityState icon={AlertTriangle} label="最近工作暂时无法加载" />
            ) : recentWork.length === 0 ? (
              <UtilityState icon={History} label="还没有最近工作" />
            ) : recentWork.map((work, index) => (
              work.kind === "question" ? (
                <UtilityAction
                  key={work.id}
                  icon={MessageSquare}
                  title={work.item.question?.trim() || "未命名问题"}
                  detail={`${work.item.knowledgeBaseNames?.join(" / ") || "Ask"} · ${formatRelativeTime(work.timestamp)}`}
                  meta="继续"
                  onClick={() => openRecentWork(work, index)}
                />
              ) : (
                <UtilityAction
                  key={work.id}
                  icon={Quote}
                  title={work.item.fileName?.trim() || work.item.title?.trim() || "引用来源"}
                  detail={`${work.item.kbName || "Preview"} · ${formatRelativeTime(work.timestamp)}`}
                  meta="预览"
                  onClick={() => openRecentWork(work, index)}
                />
              )
            ))}
          </div>
        </>
      ) : null}

      {openMenu === "status" ? (
        <>
          <UtilityPopoverHeader eyebrow="SYSTEM ACTIVITY" title={systemState.label} />
          <div className="premium-header-utility-list">
            <SystemStatusRow
              icon={FileSearch}
              title="索引服务"
              detail={indexStatusDetail(indexStatusQuery.data?.status, indexStatusQuery.data?.readable, indexStatusQuery.data?.writable)}
              meta={indexStatusMeta(indexStatusQuery.data?.status)}
              tone={indexStatusQuery.isError || indexStatusQuery.data?.status === "NOT_READY" || (indexStatusQuery.data?.status === "READY" && (!indexStatusQuery.data.readable || !indexStatusQuery.data.writable)) ? "error" : indexStatusQuery.data?.status === "REBUILDING" || indexStatusQuery.data?.status === "INITIALIZING" ? "working" : "ready"}
            />
            <SystemStatusRow
              icon={Activity}
              title="后台导入"
              detail={knowledgeBaseStatsQuery.isError ? "暂时无法读取导入状态" : ingestionDetail(ingestionSummary.running, ingestionSummary.documents)}
              meta={knowledgeBaseStatsQuery.isError ? "未知" : ingestionSummary.running > 0 ? `${formatNumber(ingestionSummary.running)} 运行中` : knowledgeBaseStatsQuery.isPending ? "检查中" : "空闲"}
              tone={knowledgeBaseStatsQuery.isError ? "warning" : ingestionSummary.running > 0 ? "working" : "ready"}
            />
            <SystemStatusRow
              icon={Database}
              title="向量存储"
              detail={elasticsearchDetail(elasticsearchQuery.data?.clusterName, elasticsearchQuery.data?.nodeCount)}
              meta={elasticsearchQuery.isError ? "不可用" : elasticsearchQuery.isPending ? "检查中" : elasticsearchStatusMeta(elasticsearchQuery.data?.status)}
              tone={elasticsearchQuery.isError || elasticsearchQuery.data?.connected === false || elasticsearchQuery.data?.status === "red" ? "error" : elasticsearchQuery.data?.status === "yellow" ? "warning" : "ready"}
            />
          </div>
          <button type="button" className="premium-header-utility-footer" onClick={() => { setOpenMenu(null); router.push("/settings"); }}>
            查看系统设置
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div ref={rootRef} className="premium-header-utilities" aria-label="快捷工具">
        <UtilityPill
          buttonRef={(node) => { triggerRefs.current.create = node; }}
          icon={Plus}
          label="新建"
          expanded={openMenu === "create"}
          controls="premium-header-utility-create"
          onClick={() => toggleMenu("create")}
        />
        <UtilityPill
          buttonRef={(node) => { triggerRefs.current.recent = node; }}
          icon={Clock3}
          label="最近工作"
          expanded={openMenu === "recent"}
          controls="premium-header-utility-recent"
          onClick={() => toggleMenu("recent")}
        />
        <UtilityPill
          buttonRef={(node) => { triggerRefs.current.status = node; }}
          label={systemState.label}
          statusTone={systemState.tone}
          expanded={openMenu === "status"}
          controls="premium-header-utility-status"
          onClick={() => toggleMenu("status")}
        />
      </div>
      {popover}
    </>
  );
}

function UtilityPill({
  buttonRef,
  icon: Icon,
  label,
  statusTone,
  expanded,
  controls,
  onClick,
}: {
  buttonRef: (node: HTMLButtonElement | null) => void;
  icon?: UtilityIcon;
  label: string;
  statusTone?: "loading" | "ready" | "working" | "warning" | "error";
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="premium-header-utility-pill"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      onClick={onClick}
    >
      {statusTone ? <span className="premium-header-utility-status-dot" data-tone={statusTone} aria-hidden="true" /> : Icon ? <Icon size={15} strokeWidth={1.8} aria-hidden="true" /> : null}
      <span className="premium-header-utility-label">{label}</span>
      <ChevronDown className="premium-header-utility-chevron" size={13} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function UtilityPopoverHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="premium-header-utility-popover-head">
      <span>{eyebrow}</span>
      <strong>{title}</strong>
    </div>
  );
}

function UtilityAction({
  icon: Icon,
  title,
  detail,
  meta,
  onClick,
}: {
  icon: UtilityIcon;
  title: string;
  detail: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="premium-header-utility-action" onClick={onClick}>
      <span className="premium-header-utility-action-icon"><Icon size={15} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="premium-header-utility-action-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {meta ? <span className="premium-header-utility-meta">{meta}</span> : null}
    </button>
  );
}

function UtilityState({ icon: Icon, label, spinning = false }: { icon: UtilityIcon; label: string; spinning?: boolean }) {
  return (
    <div className="premium-header-utility-state">
      <Icon className={spinning ? "animate-spin" : ""} size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function SystemStatusRow({
  icon: Icon,
  title,
  detail,
  meta,
  tone,
}: {
  icon: UtilityIcon;
  title: string;
  detail: string;
  meta: string;
  tone: "ready" | "working" | "warning" | "error";
}) {
  return (
    <div className="premium-header-utility-status-row">
      <span className="premium-header-utility-action-icon"><Icon size={15} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="premium-header-utility-action-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="premium-header-utility-status-meta" data-tone={tone}>{meta}</span>
    </div>
  );
}

function toTimestamp(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRelativeTime(value?: string) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return "最近";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(timestamp);
}

function indexStatusDetail(status?: string, readable?: boolean, writable?: boolean) {
  if (!status) return "正在读取索引状态";
  if (status === "REBUILDING") return "正在迁移存量向量数据";
  if (status === "INITIALIZING") return "正在初始化检索索引";
  if (status === "NOT_READY") return "索引尚未就绪，请检查设置";
  if (!readable || !writable) return "索引当前不可完整读写";
  return "检索索引可读写";
}

function indexStatusMeta(status?: string) {
  if (status === "REBUILDING") return "重建中";
  if (status === "INITIALIZING") return "初始化";
  if (status === "NOT_READY") return "未就绪";
  if (status === "READY") return "就绪";
  return "检查中";
}

function ingestionDetail(running: number, documents: number) {
  if (running > 0) return `${formatNumber(running)} 个文件正在进入知识库`;
  if (documents > 0) return `${formatNumber(documents)} 个文档已纳入管理`;
  return "暂无正在处理的文件";
}

function elasticsearchDetail(clusterName?: string | null, nodeCount?: number) {
  if (clusterName) return `${clusterName}${nodeCount ? ` · ${formatNumber(nodeCount)} 个节点` : ""}`;
  return "正在读取向量存储状态";
}

function elasticsearchStatusMeta(status?: string | null) {
  if (status === "green") return "正常";
  if (status === "yellow") return "注意";
  if (status === "red") return "异常";
  return status || "正常";
}
