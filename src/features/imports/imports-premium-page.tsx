"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Database,
  Download,
  Folder,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { PremiumRail } from "@/components/app/premium-rail";
import { FileTypeIcon, normalizeExtension } from "@/components/shared/file-type-icon";
import { apiClient } from "@/lib/api-client";
import { formatDateTime, formatFileSize, formatNumber, statusText } from "@/lib/format";
import { buildDisplayNameFromUrl, inferFileType, uploadFilesToOss } from "@/lib/ingestion-files";
import { applyPremiumTheme, getInitialPremiumTheme, type PremiumThemeMode } from "@/lib/premium-theme";
import type {
  IngestionTask,
  IngestionTaskItem,
  IngestionTaskSummary,
  KnowledgeBase,
  SupportedFormat,
} from "@/lib/types";

const MAX_TASK_LIST_SIZE = 100;

const FLOW_STEPS = [
  { key: "UPLOAD", label: "上传", helper: "文件接收与入队" },
  { key: "PARSE", label: "解析", helper: "提取文本与结构" },
  { key: "EMBED", label: "向量化", helper: "生成语义向量" },
  { key: "ASKABLE", label: "可问答", helper: "写入索引后可检索" },
] as const;

type ThemeMode = PremiumThemeMode;

export function ImportsPremiumPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [kbId, setKbId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [isKbMenuOpen, setIsKbMenuOpen] = useState(false);
  const [dedupeStrategy, setDedupeStrategy] = useState("SKIP");
  const [currentTaskId, setCurrentTaskId] = useState("");
  const [files, setFiles] = useState<File[]>([]);

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

  const storageConfigQuery = useQuery({
    queryKey: ["settings", "storage"],
    queryFn: apiClient.getStorageConfig,
    refetchOnWindowFocus: false,
  });

  const embeddingConfigQuery = useQuery({
    queryKey: ["settings", "embedding"],
    queryFn: () => apiClient.getCapabilityConfig("EMBEDDING"),
    refetchOnWindowFocus: false,
  });

  const multiEmbeddingConfigQuery = useQuery({
    queryKey: ["settings", "multi-embedding"],
    queryFn: () => apiClient.getCapabilityConfig("MULTI_EMBEDDING"),
    refetchOnWindowFocus: false,
  });

  const selectedKbId = kbId || kbsQuery.data?.items?.[0]?.id || "";
  const selectedKb = useMemo(
    () => (kbsQuery.data?.items ?? []).find((item) => item.id === selectedKbId) ?? null,
    [kbsQuery.data?.items, selectedKbId],
  );
  const selectedKbLabel = selectedKb?.name ?? "选择知识库";

  const capabilities = capabilitiesQuery.data;
  const supportedFormats = useMemo(
    () => (capabilities?.supportedFormats ?? []).filter((item) => item.enabled),
    [capabilities?.supportedFormats],
  );
  const supportedFormatLabels = useMemo(
    () => supportedFormats.map((item) => supportedFormatDisplayName(item.fileType)),
    [supportedFormats],
  );
  const supportedFormatSummary = capabilitiesQuery.isLoading
    ? "正在加载 /ingestion/capabilities 返回的格式与限制。"
    : supportedFormatLabels.length > 0
      ? `支持 ${supportedFormatLabels.join("、")}。`
      : "接口暂未返回可用支持格式。";
  const accept = useMemo(() => buildAccept(supportedFormats), [supportedFormats]);
  const dedupeOptions = capabilities?.dedupeStrategies ?? [];
  const defaultDedupeStrategy =
    capabilities?.defaultDedupeStrategy && dedupeOptions.includes(capabilities.defaultDedupeStrategy)
      ? capabilities.defaultDedupeStrategy
      : dedupeOptions[0] ?? "";
  const effectiveDedupeStrategy = dedupeOptions.includes(dedupeStrategy) ? dedupeStrategy : defaultDedupeStrategy;
  const capabilitiesReady = Boolean(capabilities && effectiveDedupeStrategy && supportedFormats.length > 0);

  const ingestionTasksQuery = useQuery({
    queryKey: ["ingestion-tasks", "premium", selectedKbId],
    queryFn: () => apiClient.listIngestionTasks(selectedKbId, MAX_TASK_LIST_SIZE),
    enabled: Boolean(selectedKbId),
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const tasks = query.state.data?.items ?? [];
      return tasks.some((task) => !isFinishedTaskStatus(task.status)) ? 5000 : false;
    },
  });

  const activeTaskId = currentTaskId;

  const currentTaskQuery = useQuery({
    queryKey: ["ingestion-task", selectedKbId, activeTaskId],
    queryFn: () => apiClient.getIngestionTask(selectedKbId, activeTaskId),
    enabled: Boolean(selectedKbId && activeTaskId),
    refetchInterval: (query) => (query.state.data && !isFinishedTaskStatus(query.state.data.status) ? 2000 : false),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const configsLoading =
    storageConfigQuery.isLoading ||
    embeddingConfigQuery.isLoading ||
    multiEmbeddingConfigQuery.isLoading;
  const hasStorage = storageConfigQuery.data != null;
  const hasEmbedding =
    (embeddingConfigQuery.data?.length ?? 0) > 0 ||
    (multiEmbeddingConfigQuery.data?.length ?? 0) > 0;
  const missingConfigs = !hasStorage || !hasEmbedding ? { storage: !hasStorage, embedding: !hasEmbedding } : null;
  const currentTask = activeTaskId ? currentTaskQuery.data : undefined;
  const selectedFilesSize = files.reduce((total, file) => total + file.size, 0);

  const createUrlMutation = useMutation({
    mutationFn: () => {
      const trimmedUrl = sourceUrl.trim();
      const displayName = urlTitle.trim() || buildDisplayNameFromUrl(trimmedUrl);

      return apiClient.createUrlIngestionTask(selectedKbId, {
        sourceUrl: trimmedUrl,
        fileName: displayName,
        fileType: inferFileType(displayName || trimmedUrl, undefined, supportedFormats),
        dedupeStrategy: effectiveDedupeStrategy,
      });
    },
    onSuccess: async (task) => {
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      setCurrentTaskId(task.taskId);
      setSourceUrl("");
      setUrlTitle("");
      setShowUrlForm(false);
      setFiles([]);
      await invalidateIngestionQueries(queryClient, selectedKbId);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      validateUploadInput(files, capabilitiesQuery.data?.maxFileSizeBytes, capabilitiesQuery.data?.maxFilesPerBatch);

      const stsToken = await apiClient.getStsToken();
      const items = await uploadFilesToOss(files, stsToken, supportedFormats);

      return apiClient.createUploadIngestionTask(selectedKbId, {
        dedupeStrategy: effectiveDedupeStrategy,
        items,
      });
    },
    onSuccess: async (task) => {
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      setCurrentTaskId(task.taskId);
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await invalidateIngestionQueries(queryClient, selectedKbId);
    },
  });

  const retryTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.retryFailedIngestionTask(selectedKbId, taskId),
    onSuccess: async (task) => {
      setCurrentTaskId(task.taskId);
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      await invalidateIngestionQueries(queryClient, selectedKbId);
    },
  });

  useEffect(() => {
    if (!retryTaskMutation.error) return;

    const timeoutId = window.setTimeout(() => {
      retryTaskMutation.reset();
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [retryTaskMutation]);

  const retryItemMutation = useMutation({
    mutationFn: ({ taskId, itemId }: { taskId: string; itemId: string }) =>
      apiClient.retryIngestionTaskItem(selectedKbId, taskId, itemId),
    onSuccess: async (task) => {
      setCurrentTaskId(task.taskId);
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      await invalidateIngestionQueries(queryClient, selectedKbId);
    },
  });

  const isSubmitting = uploadMutation.isPending || createUrlMutation.isPending;
  const pendingFileCount = files.length;
  const displayedCurrentTask = pendingFileCount > 0 ? undefined : currentTask;
  const progress = summarizeTaskProgress(displayedCurrentTask, isSubmitting);
  const queueIsTaskItems = pendingFileCount === 0 && Boolean(displayedCurrentTask?.items?.length);
  const showQueueEmpty = pendingFileCount === 0 && !displayedCurrentTask?.items?.length;
  const hasFailedCurrentTask = queueIsTaskItems && (displayedCurrentTask?.items?.some((item) => item.status === "FAILED") ?? false);

  function handleFilesSelected(nextFiles: File[]) {
    setFiles(nextFiles);
    uploadMutation.reset();
    createUrlMutation.reset();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      handleFilesSelected(droppedFiles);
    }
  }

  function handleUploadClick() {
    uploadMutation.mutate();
  }

  function handleUrlSubmit() {
    createUrlMutation.mutate();
  }

  if (configsLoading) {
    return (
      <ImportsPremiumShell theme={theme} onThemeChange={setTheme}>
        <StateCard
          theme={theme}
          icon={<Loader2 size={24} className="animate-spin" />}
          title="正在检查导入配置"
          description="稍等片刻，系统正在确认对象存储与向量模型状态。"
        />
      </ImportsPremiumShell>
    );
  }

  if (missingConfigs) {
    return (
      <ImportsPremiumShell theme={theme} onThemeChange={setTheme}>
        <ConfigurationGate missingConfigs={missingConfigs} theme={theme} />
      </ImportsPremiumShell>
    );
  }

  return (
    <ImportsPremiumShell theme={theme} onThemeChange={setTheme}>
      <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr]">
        <header
          className="ask-premium-hero relative grid h-[112px] gap-2 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5"
          style={{ fontFamily: APP_FONT_STACK }}
        >
          <div aria-hidden="true" className="pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]">
            IMPORT
          </div>
          <section className="relative z-10 flex min-w-0 flex-col justify-center gap-2">
            <div>
              <p className="ask-premium-kicker mb-1.5 flex items-center gap-2 text-[10px] font-black text-blue-700">
                <span className="size-1.5 rounded-full bg-[var(--premium-accent)] shadow-[0_0_0_5px_rgba(187,255,102,0.2)]" />
                IMPORTS / INGESTION PIPELINE
              </p>
              <h1 className="max-w-[720px] text-[clamp(16px,2.4vw,34px)] font-black leading-none">
                把资料放进知识库，让它开始流动。
              </h1>
            </div>
          </section>
        </header>

        <main className="ask-premium-main grid min-h-0 min-w-0 items-start gap-3 overflow-auto bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)] px-4 py-3 sm:px-5 lg:h-[111.111%] lg:w-[111.111%] lg:origin-top-left lg:scale-90 lg:grid-cols-[1fr_minmax(308px,363px)] lg:items-stretch lg:overflow-hidden lg:px-5">
          <section className="grid min-h-0 min-w-0 gap-3 overflow-hidden lg:h-full lg:grid-rows-[minmax(200px,0.95fr)_minmax(145px,0.62fr)_minmax(200px,0.9fr)]" aria-label="导入资料">
            <section
              className="imports-panel premium-surface relative grid min-h-[220px] place-items-center overflow-hidden rounded-[8px] p-4 text-center backdrop-blur-xl lg:min-h-0"
              aria-label="上传区域"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <div className="pointer-events-none absolute inset-[9px] rounded-[8px] border border-dashed border-[rgba(49,88,255,0.45)]" />
              <div className="imports-upload-glow-layer pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(49,88,255,0.1),transparent_38%),radial-gradient(circle_at_82%_8%,rgba(187,255,102,0.28),transparent_15rem)]" />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={accept}
                className="sr-only"
                onChange={(event) => handleFilesSelected(Array.from(event.target.files ?? []))}
              />
              <div className="relative z-10 w-full max-w-[560px]">
                <div className="mx-auto mb-3 grid size-12 place-items-center rounded-[8px] bg-[#111315] text-white shadow-[0_22px_48px_rgba(17,19,21,0.22)] dark:bg-white dark:text-[#111315]">
                  <Download size={24} strokeWidth={1.9} />
                </div>
                <h2 className="text-[clamp(20px,2.6vw,34px)] font-black leading-none text-[var(--premium-ink)]">
                  拖入文件，或连接一个远程资料源。
                </h2>
                <p className="mx-auto mt-2 max-w-[520px] text-xs leading-[1.45] text-[var(--premium-ink-soft)]">
                  {supportedFormatSummary}
                  {capabilities ? ` 单文件最大 ${formatFileSize(capabilities.maxFileSizeBytes)}，单次最多 ${capabilities.maxFilesPerBatch} 个文件。` : ""}
                </p>
                <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={BUTTON_FILE_PICKER_CLASS}
                    disabled={isSubmitting}
                  >
                    选择文件
                  </button>
                </div>
                <div className="mt-3 inline-flex min-h-7 items-center gap-2 rounded-full bg-[rgba(49,88,255,0.09)] px-3 text-[11px] font-black text-blue-800 dark:text-blue-200">
                  <ShieldCheck size={14} />
                  文件传输与存储使用加密链路
                </div>
              </div>
            </section>

            <section className="imports-panel premium-surface flex h-[230px] min-h-0 min-w-0 flex-col overflow-hidden rounded-[8px] p-3 backdrop-blur-xl lg:h-full lg:max-h-full" aria-label="文件队列">
              <div className="mb-2 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-[clamp(16px,2vw,22px)] font-black leading-none text-[var(--premium-ink)]">
                    {files.length > 0 ? `已选择 ${formatNumber(files.length)} 个文件` : queueIsTaskItems ? "当前任务文件" : "文件队列"}
                  </h2>
                  <p className="mt-1 text-[11px] text-[var(--premium-muted)]">
                    {files.length > 0
                      ? `总计 ${formatFileSize(selectedFilesSize)}，准备上传到“${selectedKbLabel}”。`
                      : displayedCurrentTask
                        ? `任务 ${displayedCurrentTask.taskId} · ${statusText(displayedCurrentTask.status)}`
                        : "选择文件后会显示在这里。"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {hasFailedCurrentTask && displayedCurrentTask ? (
                    <button
                      type="button"
                      className={BUTTON_RETRY_ALL_CLASS}
                      onClick={() => retryTaskMutation.mutate(displayedCurrentTask.taskId)}
                      disabled={retryTaskMutation.isPending}
                    >
                      {retryTaskMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      重试全部
                    </button>
                  ) : null}
                  {files.length > 0 ? (
                    <button
                      type="button"
                      className={BUTTON_SECONDARY_CLASS}
                      onClick={() => {
                        setFiles([]);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                    >
                      <X size={14} />
                      清空
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleUploadClick}
                    disabled={!selectedKbId || !capabilitiesReady || files.length === 0 || uploadMutation.isPending}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    上传并入库
                  </button>
                </div>
              </div>

              {showUrlForm ? (
                <div className="mb-3 grid shrink-0 gap-2 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] p-2 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                  <label className="relative min-w-0">
                    <span className="sr-only">URL</span>
                    <Link2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--premium-muted)]" size={16} />
                    <input
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      className={FIELD_CLASS + " pl-9"}
                      placeholder="https://example.com/docs/import"
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="sr-only">文件名</span>
                    <input
                      value={urlTitle}
                      onChange={(event) => setUrlTitle(event.target.value)}
                      className={FIELD_CLASS}
                      placeholder="文件名，可选"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleUrlSubmit}
                    disabled={!selectedKbId || !capabilitiesReady || !sourceUrl.trim() || createUrlMutation.isPending}
                    className={BUTTON_PRIMARY_CLASS}
                  >
                    {createUrlMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                    {createUrlMutation.isPending ? "提交中" : "提交导入"}
                  </button>
                </div>
              ) : null}

              <div className="min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto pr-1">
                {showQueueEmpty ? (
                  <EmptyPanel label="暂无待上传文件" />
                ) : files.length > 0 ? (
                  <div className="grid gap-2 xl:grid-cols-2 2xl:grid-cols-3">
                    {files.map((file) => (
                      <PendingFileCard key={`${file.name}-${file.size}-${file.lastModified}`} file={file} supportedFormats={supportedFormats} />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-2 xl:grid-cols-2 2xl:grid-cols-3">
                    {(displayedCurrentTask?.items ?? []).map((item) => (
                      <TaskItemCard
                        key={item.itemId}
                        item={item}
                        taskId={displayedCurrentTask?.taskId ?? ""}
                        canRetry={item.status === "FAILED" && Boolean(displayedCurrentTask?.taskId)}
                        retrying={retryItemMutation.isPending}
                        onRetry={(taskId, itemId) => retryItemMutation.mutate({ taskId, itemId })}
                      />
                    ))}
                  </div>
                )}
              </div>

              <MutationError errors={[uploadMutation.error, createUrlMutation.error, retryTaskMutation.error, retryItemMutation.error]} />
            </section>

            <section className="imports-panel premium-surface flex h-[230px] min-h-0 min-w-0 flex-col overflow-hidden rounded-[8px] p-3 backdrop-blur-xl lg:h-full lg:max-h-full" aria-label="最近导入">
              <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[clamp(16px,2vw,22px)] font-black leading-none text-[var(--premium-ink)]">最近导入</h2>
                  <p className="mt-1 text-[11px] text-[var(--premium-muted)]">追踪当前知识库里的成功、失败和处理中任务。</p>
                </div>
                <button
                  type="button"
                  onClick={() => ingestionTasksQuery.refetch()}
                  className={BUTTON_GHOST_CLASS}
                  disabled={!selectedKbId || ingestionTasksQuery.isFetching}
                >
                  {ingestionTasksQuery.isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  刷新
                </button>
              </div>
              <div className="min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto pr-1">
                {ingestionTasksQuery.isLoading ? (
                  <InlineLoading label="正在加载导入任务" />
                ) : ingestionTasksQuery.isError ? (
                  <InlineError message={(ingestionTasksQuery.error as Error).message} />
                ) : (ingestionTasksQuery.data?.items ?? []).length === 0 ? (
                  <EmptyPanel label="暂无导入记录" />
                ) : (
                  <div className="grid gap-2">
                    {(ingestionTasksQuery.data?.items ?? []).map((task) => (
                      <RecentTaskRow
                        key={task.taskId}
                        task={task}
                        active={task.taskId === activeTaskId}
                        kbName={selectedKbLabel}
                        onSelect={() => setCurrentTaskId(task.taskId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </section>

          <aside className="grid min-h-0 min-w-0 gap-3 lg:h-full lg:grid-rows-[minmax(200px,0.95fr)_minmax(145px,0.62fr)_minmax(200px,0.9fr)]" aria-label="本次导入设置">
            <section className="imports-session-glow premium-surface relative flex min-h-[220px] flex-col overflow-visible rounded-[8px] p-3 backdrop-blur-xl lg:min-h-0">
              <PanelLabel label="IMPORT SESSION" />
              <div className="relative mt-3 grid min-h-0 flex-1 grid-rows-3 gap-2.5">
                <ControlBlock title="目标知识库">
                  <KnowledgeBasePicker
                    items={kbsQuery.data?.items ?? []}
                    selectedKbId={selectedKbId}
                    selectedLabel={selectedKbLabel}
                    isOpen={isKbMenuOpen}
                    isLoading={kbsQuery.isLoading}
                    onToggle={() => setIsKbMenuOpen((open) => !open)}
                    onClose={() => setIsKbMenuOpen(false)}
                    onSelect={(nextKbId) => {
                      setKbId(nextKbId);
                      setCurrentTaskId("");
                    }}
                  />
                </ControlBlock>
                <ControlBlock title="去重策略">
                  <DedupeStrategyPicker
                    options={dedupeOptions}
                    value={effectiveDedupeStrategy}
                    defaultValue={defaultDedupeStrategy}
                    isLoading={capabilitiesQuery.isLoading}
                    onSelect={setDedupeStrategy}
                  />
                </ControlBlock>
                <ControlBlock title="支持格式">
                  <SupportedFormatGrid formats={supportedFormats} isLoading={capabilitiesQuery.isLoading} />
                </ControlBlock>
              </div>
            </section>

            <TaskSummaryPanel currentTask={displayedCurrentTask} pendingFileCount={pendingFileCount} />

            <PipelinePanel progress={progress} pendingFileCount={pendingFileCount} />
          </aside>
        </main>
      </div>
    </ImportsPremiumShell>
  );
}

function ImportsPremiumShell({
  theme,
  onThemeChange,
  children,
}: {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  children: ReactNode;
}) {
  return (
    <div className="premium-theme ask-premium-page imports-premium-page min-h-screen overflow-x-hidden bg-[#f7f7f2] tracking-normal text-[#111315]" data-theme={theme} data-premium-theme={theme} style={{ fontFamily: IMPORTS_FONT_STACK }}>
      <div aria-hidden="true" className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(var(--premium-bg-grid)_1px,transparent_1px),linear-gradient(90deg,var(--premium-bg-grid)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div aria-hidden="true" className="ask-premium-glow-bg pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_78%_8%,var(--premium-glow-primary),transparent_28rem),radial-gradient(circle_at_14%_92%,var(--premium-glow-secondary),transparent_30rem)]" />
      <div className="relative min-h-screen overflow-x-hidden p-0 lg:p-6">
        <div className="ask-premium-shell grid min-h-screen overflow-hidden border border-black/15 bg-white/70 shadow-[0_24px_80px_rgba(17,19,21,0.12)] backdrop-blur-2xl lg:min-h-[calc(100vh-48px)] lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-[8px]">
          <PremiumRail theme={theme} onThemeChange={onThemeChange} />
          {children}
        </div>
      </div>
    </div>
  );
}

function StateCard({
  theme,
  icon,
  title,
  description,
}: {
  theme: ThemeMode;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className={`grid min-h-0 min-w-0 place-items-center px-4 ${statePageBackgroundClass(theme)}`}>
      <div className="premium-surface grid w-full max-w-[420px] place-items-center rounded-[8px] p-6 text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-[8px] bg-[#111315] text-white dark:bg-white dark:text-[#111315]">
          {icon}
        </div>
        <h1 className="text-xl font-black leading-none text-[var(--premium-ink)]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">{description}</p>
      </div>
    </div>
  );
}

function ConfigurationGate({
  missingConfigs,
  theme,
}: {
  missingConfigs: { storage: boolean; embedding: boolean };
  theme: ThemeMode;
}) {
  return (
    <div className={`grid min-h-0 min-w-0 place-items-center px-4 ${statePageBackgroundClass(theme)}`}>
      <div className="premium-surface w-full max-w-[460px] rounded-[8px] p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-[8px] bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
          <Info size={24} />
        </div>
        <h1 className="text-xl font-black leading-none text-[var(--premium-ink)]">需要先完成配置</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--premium-ink-soft)]">上传文件前需要配置对象存储和 Embedding 模型。</p>
        <div className="mx-auto mt-4 grid max-w-[280px] gap-2 text-left text-sm font-bold text-[var(--premium-ink-soft)]">
          <ConfigStateRow label="对象存储" missing={missingConfigs.storage} />
          <ConfigStateRow label="Embedding 模型" missing={missingConfigs.embedding} />
        </div>
        <Link href="/settings" className={`${BUTTON_PRIMARY_CLASS} mt-5 justify-center`}>
          <span className="text-white dark:text-[#111315]">前往设置</span>
        </Link>
      </div>
    </div>
  );
}

function statePageBackgroundClass(theme: ThemeMode) {
  return theme === "dark"
    ? "bg-[#070908]"
    : "bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4)),radial-gradient(circle_at_82%_5%,rgba(187,255,102,0.32),transparent_26rem)]";
}

function ConfigStateRow({ label, missing }: { label: string; missing: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-3 py-2">
      <span>{label}</span>
      <span className={missing ? "text-rose-600 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}>
        {missing ? "未配置" : "已就绪"}
      </span>
    </div>
  );
}

function PendingFileCard({ file, supportedFormats }: { file: File; supportedFormats: SupportedFormat[] }) {
  const fileType = inferFileType(file.name, file.type, supportedFormats);

  return (
    <article className="grid min-h-[58px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border border-black/10 bg-white/55 p-2 dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel-muted)]">
      <FileTypeIcon fileName={file.name} sourceType={fileType} className="size-9" />
      <div className="min-w-0">
        <strong className="block truncate text-[13px] text-[var(--premium-ink)]">{file.name}</strong>
        <span className="mt-1 block truncate text-xs text-[var(--premium-muted)]">
          {formatFileSize(file.size)} · {formatLabel(fileType)}
        </span>
      </div>
      <StatusBadge status="PENDING" />
    </article>
  );
}

function TaskItemCard({
  item,
  taskId,
  canRetry,
  retrying,
  onRetry,
}: {
  item: IngestionTaskItem;
  taskId: string;
  canRetry: boolean;
  retrying: boolean;
  onRetry: (taskId: string, itemId: string) => void;
}) {
  const title = item.fileName || item.sourceUrl || "未命名文件";

  return (
    <article className="grid min-h-[58px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border border-black/10 bg-white/55 p-2 dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel-muted)]">
      <FileTypeIcon fileName={title} sourceType={item.sourceUrl ? "URL" : undefined} className="size-9" />
      <div className="min-w-0">
        <strong className="block truncate text-[13px] text-[var(--premium-ink)]">{title}</strong>
        <span className="mt-1 block truncate text-xs text-[var(--premium-muted)]">
          {stageText(item.stage)} · {Math.max(0, Math.min(100, item.progress ?? 0))}%
          {item.errorMessage ? ` · ${item.errorMessage}` : ""}
        </span>
      </div>
      {canRetry ? (
        <button
          type="button"
          onClick={() => onRetry(taskId, item.itemId)}
          disabled={retrying}
          className={BUTTON_RETRY_CLASS}
        >
          {retrying ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
          重试
        </button>
      ) : (
        <StatusBadge status={item.status} progress={item.progress} />
      )}
    </article>
  );
}

function RecentTaskRow({
  task,
  active,
  kbName,
  onSelect,
}: {
  task: IngestionTaskSummary;
  active: boolean;
  kbName: string;
  onSelect: () => void;
}) {
  const progress = task.totalCount > 0 ? Math.round(((task.successCount + task.failureCount) / task.totalCount) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "grid min-h-[56px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] border p-2 text-left transition hover:translate-x-1",
        active
          ? "border-[rgba(49,88,255,0.28)] bg-[rgba(49,88,255,0.08)]"
          : "border-black/10 bg-white/50 hover:bg-white/70 dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel)] dark:hover:bg-[var(--premium-panel-strong)]",
      ].join(" ")}
    >
      <StatusDot status={task.status} />
      <span className="min-w-0">
        <strong className="block truncate text-xs leading-tight text-[var(--premium-ink)]">{kbName}</strong>
        <span className="mt-1 block truncate text-[11px] leading-tight text-[var(--premium-muted)]">
          任务 {task.taskId} · 成功 {formatNumber(task.successCount)} / 失败 {formatNumber(task.failureCount)} / 处理中 {formatNumber(task.runningCount)}
        </span>
      </span>
      <StatusBadge status={task.status} progress={progress} />
    </button>
  );
}

function KnowledgeBasePicker({
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
      <button type="button" onClick={onToggle} className={SELECT_BUTTON_CLASS} aria-expanded={isOpen} aria-haspopup="listbox">
        <Database size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>

      {isOpen ? (
        <div className="premium-elevated absolute left-0 right-0 top-[calc(100%+6px)] z-[80] max-h-[118px] overflow-auto rounded-[8px] p-1.5" role="listbox">
          {isLoading ? (
            <div className="px-3 py-3 text-[12px] font-extrabold text-[var(--premium-muted)]">加载知识库...</div>
          ) : items.length > 0 ? (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onClose();
                }}
                className={[
                  "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[12px] font-extrabold",
                  selectedKbId === item.id
                    ? "bg-[rgba(49,88,255,0.12)] font-bold text-blue-700 dark:text-blue-200"
                    : "text-[var(--premium-ink-soft)] hover:bg-[var(--premium-panel-muted)]",
                ].join(" ")}
                role="option"
                aria-selected={selectedKbId === item.id}
              >
                <Folder size={15} className="shrink-0" />
                <span className="truncate">{item.name}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-[12px] font-extrabold text-[var(--premium-muted)]">暂无可选知识库</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DedupeStrategyPicker({
  options,
  value,
  defaultValue,
  isLoading,
  onSelect,
}: {
  options: string[];
  value: string;
  defaultValue: string;
  isLoading: boolean;
  onSelect: (value: string) => void;
}) {
  if (isLoading) {
    return <div className="rounded-[8px] bg-white/60 px-2.5 py-2 text-[11px] font-black text-[var(--premium-muted)] dark:bg-[var(--premium-panel-muted)]">正在加载策略</div>;
  }

  if (options.length === 0) {
    return <div className="rounded-[8px] bg-white/60 px-2.5 py-2 text-[11px] font-black text-[var(--premium-muted)] dark:bg-[var(--premium-panel-muted)]">接口未返回策略</div>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(72px,1fr))] gap-1.5" role="radiogroup" aria-label="去重策略">
      {options.map((item) => {
        const selected = value === item;

        return (
          <button
            key={item}
            type="button"
            onClick={() => onSelect(item)}
            className={[
              "inline-flex min-h-9 items-center justify-center rounded-[8px] border px-2 text-center text-[11px] font-black leading-none transition",
              selected
                ? "border-[rgba(49,88,255,0.28)] bg-[rgba(49,88,255,0.12)] text-blue-700 dark:text-blue-200"
                : "border-black/10 bg-white/60 text-[var(--premium-ink-soft)] hover:bg-white/80 dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel-strong)] dark:hover:bg-[var(--premium-panel)]",
            ].join(" ")}
            role="radio"
            aria-checked={selected}
          >
            <span className="max-w-full truncate">{dedupeDisplayName(item, defaultValue)}</span>
          </button>
        );
      })}
    </div>
  );
}

function SupportedFormatGrid({ formats, isLoading }: { formats: SupportedFormat[]; isLoading: boolean }) {
  if (isLoading) {
    return <div className="rounded-[8px] bg-white/60 px-2.5 py-2 text-[11px] font-black text-[var(--premium-muted)] dark:bg-[var(--premium-panel-muted)]">正在加载格式</div>;
  }

  if (formats.length === 0) {
    return <div className="rounded-[8px] bg-white/60 px-2.5 py-2 text-[11px] font-black text-[var(--premium-muted)] dark:bg-[var(--premium-panel-muted)]">接口未返回可用格式</div>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(64px,1fr))] gap-1.5">
      {formats.map((format) => (
        <FormatBadge key={format.fileType} format={format} />
      ))}
    </div>
  );
}

function ControlBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col gap-1 rounded-[8px] border border-black/10 bg-white/55 px-[7px] pb-2.5 pt-[7px] shadow-[0_10px_24px_rgba(17,19,21,0.05)] dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel)]">
      <h3 className="text-[10px] font-black uppercase tracking-[0.05em] text-[var(--premium-muted)]">{title}</h3>
      <div className="my-auto">{children}</div>
    </div>
  );
}

function FormatBadge({ format }: { format: SupportedFormat }) {
  return (
    <div className="grid min-h-9 place-items-center rounded-[8px] border border-black/10 bg-white/60 px-2 text-center text-[11px] font-black leading-none text-[var(--premium-ink-soft)] dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel-strong)]">
      <span className="max-w-full truncate">{supportedFormatDisplayName(format.fileType)}</span>
    </div>
  );
}

function TaskSummaryPanel({ currentTask, pendingFileCount }: { currentTask?: IngestionTask; pendingFileCount: number }) {
  const total = currentTask?.totalCount ?? pendingFileCount;
  const success = currentTask?.successCount ?? 0;
  const failed = currentTask?.failureCount ?? 0;
  const running = currentTask?.runningCount ?? (pendingFileCount > 0 ? pendingFileCount : 0);

  return (
    <section className="imports-task-glow premium-surface relative flex min-h-0 flex-col overflow-hidden rounded-[8px] p-3 backdrop-blur-xl lg:min-h-0">
      <PanelLabel label="CURRENT TASK" value={running > 0 ? `${formatNumber(running)} 处理中` : statusText(currentTask?.status)} />
      <div className="mt-3 grid gap-3 rounded-[8px] border border-[rgba(49,88,255,0.14)] bg-white/50 px-2.5 py-3 dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel-strong)]">
        <div className="flex items-baseline gap-2">
          <strong className="text-[22px] font-black leading-none text-[var(--premium-ink)]">{formatNumber(total)}</strong>
          <span className="text-[11px] text-[var(--premium-muted)]">当前导入文件总数</span>
        </div>
        <TaskBar success={success} failed={failed} running={running} total={total} />
      </div>
      <div className="mt-7 grid grid-cols-3 gap-2">
        <TaskStat label="成功" value={success} tone="success" />
        <TaskStat label="失败" value={failed} tone="failed" />
        <TaskStat label="处理中" value={running} tone="running" />
      </div>
      {currentTask?.updatedAt ? (
        <p className="mt-3 text-[11px] text-[var(--premium-muted)]">更新于 {formatDateTime(currentTask.updatedAt)}</p>
      ) : null}
    </section>
  );
}

function PipelinePanel({ progress, pendingFileCount }: { progress: ReturnType<typeof summarizeTaskProgress>; pendingFileCount: number }) {
  const activeStep = FLOW_STEPS.find((step) => step.key === progress.currentStep);
  const percent = progress.currentStep ? progress.progress : 0;
  const hasPendingFiles = pendingFileCount > 0 && !activeStep;
  const statusTitle = activeStep ? `${activeStep.label}进行中` : hasPendingFiles ? "等待上传" : "等待导入任务";
  const statusHelper = activeStep
    ? activeStep.helper
    : hasPendingFiles
      ? `已选择 ${formatNumber(pendingFileCount)} 个文件，点击上传并入库后进入流水线。`
      : "创建任务后会自动进入上传、解析、向量化和索引流程。";

  return (
    <section className="imports-pipeline-glow premium-surface relative flex min-h-[240px] flex-col overflow-hidden rounded-[8px] p-3 backdrop-blur-xl lg:min-h-0">
      <PanelLabel label="PIPELINE FLOW" value={`${percent}%`} />
      <div className="mt-3 grid gap-2 rounded-[8px] border border-[rgba(49,88,255,0.14)] bg-white/50 p-3 dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel-strong)]">
        <div>
          <strong className="block text-xs text-[var(--premium-ink)]">{statusTitle}</strong>
          <span className="mt-1 block text-[11px] leading-[1.35] text-[var(--premium-muted)]">
            {statusHelper}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-[#343a36]" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-[linear-gradient(90deg,var(--premium-blue),var(--premium-accent))] shadow-[0_0_18px_rgba(49,88,255,0.28)]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <div className="mt-3 grid flex-1 gap-2 sm:grid-cols-2">
        {FLOW_STEPS.map((step, index) => {
          const done = progress.completedSteps.has(step.key);
          const active = progress.currentStep === step.key;

          return (
            <div
              key={step.key}
              className={[
                "relative grid min-h-[82px] grid-cols-[auto_minmax(0,1fr)] gap-2 overflow-hidden rounded-[8px] border p-2.5",
                done
                  ? "border-[rgba(187,255,102,0.36)] bg-[rgba(187,255,102,0.16)] dark:border-[#566b31] dark:bg-[#1d2817]"
                  : active
                    ? "border-[rgba(49,88,255,0.28)] bg-[rgba(49,88,255,0.08)] dark:border-[#43548d] dark:bg-[#151b34]"
                    : "border-black/10 bg-white/50 dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel)]",
              ].join(" ")}
            >
              <span className="absolute -bottom-5 -right-4 text-[54px] font-black leading-none text-black/[0.05] dark:text-white/[0.045]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={[
                  "grid size-7 place-items-center rounded-full text-[11px] font-black",
                  done
                    ? "bg-[var(--premium-accent)] text-[#111315]"
                    : active
                      ? "bg-[var(--premium-blue)] text-white shadow-[0_0_0_5px_rgba(49,88,255,0.12)] dark:bg-[#6f83d6] dark:shadow-[0_0_0_5px_#202744]"
                      : "bg-black/10 text-[var(--premium-muted)] dark:bg-[var(--premium-panel-muted)]",
                ].join(" ")}
              >
                {done ? <Check size={14} /> : index + 1}
              </span>
              <div className="min-w-0 pr-8">
                <strong className="block truncate text-xs leading-tight text-[var(--premium-ink)]">{step.label}</strong>
                <span className="mt-1 block text-[10px] leading-snug text-[var(--premium-muted)]">{step.helper}</span>
              </div>
              <span
                className={[
                  "absolute right-2 top-2 rounded-full px-1.5 py-1 text-[10px] font-black",
                  done
                    ? "bg-[rgba(187,255,102,0.28)] text-[#426b09] dark:bg-[#8fab57] dark:text-[#111315]"
                    : "bg-black/5 text-[var(--premium-muted)] dark:bg-[var(--premium-panel-muted)]",
                ].join(" ")}
              >
                {done ? "完成" : active ? `${progress.progress}%` : "等待"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TaskBar({ success, failed, running, total }: { success: number; failed: number; running: number; total: number }) {
  const denominator = Math.max(total, success + failed + running, 1);
  const queued = Math.max(0, denominator - success - failed - running);

  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-black/10 dark:bg-[#343a36]" aria-hidden="true">
      <span className="h-full bg-[var(--premium-accent)]" style={{ width: `${(success / denominator) * 100}%` }} />
      <span className="h-full bg-rose-500" style={{ width: `${(failed / denominator) * 100}%` }} />
      <span className="h-full bg-[var(--premium-blue)]" style={{ width: `${(running / denominator) * 100}%` }} />
      <span className="h-full bg-black/10 dark:bg-[#343a36]" style={{ width: `${(queued / denominator) * 100}%` }} />
    </div>
  );
}

function TaskStat({ label, value, tone }: { label: string; value: number; tone: "success" | "failed" | "running" }) {
  const ring = tone === "success"
    ? "border-emerald-400/30 bg-[rgba(187,255,102,0.18)] dark:border-[#82975a] dark:bg-[#35482a]"
    : tone === "failed"
      ? "border-rose-400/30 bg-rose-500/10 dark:border-[#a96660] dark:bg-[#56302d]"
      : "border-blue-400/30 bg-blue-500/10 dark:border-[#6b7ec0] dark:bg-[#2b3560]";
  const color = tone === "success"
    ? "text-emerald-800 dark:text-[#d5e8a6]"
    : tone === "failed"
      ? "text-rose-700 dark:text-[#ffc4be]"
      : "text-blue-800 dark:text-[#d1dcff]";

  return (
    <span className={`flex items-center gap-2 rounded-[8px] border px-2.5 py-4 ${ring}`}>
      <b className={`text-[17px] font-black leading-none ${color}`}>{formatNumber(value)}</b>
      <span className="text-[11px] font-black text-[var(--premium-muted)]">{label}</span>
    </span>
  );
}

function PanelLabel({ label, value }: { label: string; value?: string }) {
  return (
    <p className="flex items-center justify-between gap-3 text-xs font-black text-[var(--premium-muted)]">
      <span>{label}</span>
      {value ? <span>{value}</span> : null}
    </p>
  );
}

function StatusBadge({ status, progress }: { status: string; progress?: number }) {
  const text =
    status === "RUNNING"
      ? `${stageStatusText(status)} ${Math.max(0, Math.min(100, progress ?? 0))}%`
      : status === "SKIPPED"
        ? "已跳过"
        : statusText(status);
  const tone =
    status === "SUCCESS" || status === "COMPLETED" || status === "SKIPPED"
      ? "border-emerald-400/30 bg-[rgba(187,255,102,0.28)] text-emerald-800 dark:border-[#82975a] dark:bg-[#35482a] dark:text-[#d5e8a6]"
      : status === "FAILED" || status === "PARTIAL_SUCCESS"
        ? "border-rose-400/30 bg-rose-500/15 text-rose-700 dark:border-[#a96660] dark:bg-[#56302d] dark:text-[#ffc4be]"
        : status === "RUNNING"
          ? "border-blue-400/30 bg-blue-500/10 text-blue-800 dark:border-[#6b7ec0] dark:bg-[#2b3560] dark:text-[#d1dcff]"
          : "border-black/10 bg-black/5 text-[var(--premium-muted)] dark:border-[var(--premium-line)] dark:bg-[var(--premium-panel-muted)]";

  return (
    <span className={`inline-grid min-h-7 min-w-[58px] place-items-center whitespace-nowrap rounded-full border px-2 text-[11px] font-black leading-none ${tone}`}>
      {text}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "SUCCESS" || status === "COMPLETED" || status === "SKIPPED") {
    return <span className="grid size-7 place-items-center rounded-full border border-transparent bg-[rgba(187,255,102,0.28)] text-sm font-black text-emerald-800 dark:border-[#82975a] dark:bg-[#35482a] dark:text-[#d5e8a6]">✓</span>;
  }
  if (status === "FAILED" || status === "PARTIAL_SUCCESS") {
    return <span className="grid size-7 place-items-center rounded-full border border-transparent bg-rose-500/15 text-sm font-black text-rose-700 dark:border-[#a96660] dark:bg-[#56302d] dark:text-[#ffc4be]">!</span>;
  }

  return <span className="grid size-7 place-items-center rounded-full border border-transparent bg-blue-500/10 text-sm font-black text-blue-700 dark:border-[#6b7ec0] dark:bg-[#2b3560] dark:text-[#d1dcff]">•</span>;
}

function InlineLoading({ label }: { label: string }) {
  return (
    <div className="grid min-h-32 place-items-center rounded-[8px] border border-dashed border-[var(--premium-line)] text-sm text-[var(--premium-muted)]">
      <span className="inline-flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" />
        {label}
      </span>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 items-center gap-2 rounded-[8px] border border-rose-400/30 bg-rose-500/10 px-3 text-sm text-rose-700 dark:text-rose-200">
      <AlertCircle size={17} />
      <span className="min-w-0 truncate">{message}</span>
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="grid min-h-32 place-items-center rounded-[8px] border border-dashed border-[var(--premium-line)] px-4 text-center text-sm text-[var(--premium-muted)]">
      {label}
    </div>
  );
}

function MutationError({ errors }: { errors: Array<unknown> }) {
  const error = errors.find(Boolean) as Error | undefined;
  if (!error) return null;

  return (
    <div className="mt-3 flex shrink-0 items-center gap-2 rounded-[8px] border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-200">
      <AlertCircle size={15} />
      <span className="min-w-0 truncate">{error.message}</span>
    </div>
  );
}

async function invalidateIngestionQueries(queryClient: ReturnType<typeof useQueryClient>, kbId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["ingestion-tasks", "premium", kbId] }),
    queryClient.invalidateQueries({ queryKey: ["ingestion-tasks", kbId] }),
    queryClient.invalidateQueries({ queryKey: ["activity", "recent-document"] }),
    queryClient.invalidateQueries({ queryKey: ["kbs"] }),
  ]);
}

function validateUploadInput(files: File[], maxFileSizeBytes?: number, maxFilesPerBatch?: number) {
  if (files.length === 0) {
    throw new Error("请选择至少一个文件。");
  }
  if (!maxFilesPerBatch || !maxFileSizeBytes) {
    return;
  }
  if (files.length > maxFilesPerBatch) {
    throw new Error(`单批最多上传 ${maxFilesPerBatch} 个文件。`);
  }
  const oversize = files.find((file) => file.size > maxFileSizeBytes);
  if (oversize) {
    throw new Error(`${oversize.name} 超过单文件大小上限 ${formatFileSize(maxFileSizeBytes)}。`);
  }
}

function summarizeTaskProgress(task?: IngestionTask, submitting = false) {
  if (!task || !task.items?.length) {
    return { currentStep: submitting ? "UPLOAD" : "", progress: submitting ? 8 : 0, completedSteps: new Set<string>() };
  }

  const runningItem = task.items.find((item) => item.status === "RUNNING" || item.status === "PENDING") ?? task.items[0];
  const currentStep = mapStageToFlowStep(runningItem.stage, runningItem.status);
  const progress = task.status === "SUCCESS" ? 100 : Math.max(0, Math.min(100, runningItem.progress ?? 0));
  const completedSteps = new Set<string>();

  for (const step of FLOW_STEPS) {
    if (flowStepOrder(step.key) < flowStepOrder(currentStep) || task.status === "SUCCESS") {
      completedSteps.add(step.key);
    }
  }

  return { currentStep, progress, completedSteps };
}

function mapStageToFlowStep(stage: string, status: string) {
  if (status === "SUCCESS" || status === "SKIPPED" || stage === "ASKABLE") return "ASKABLE";
  if (stage === "EMBED") return "EMBED";
  if (stage === "PARSE" || stage === "CHUNK") return "PARSE";
  if (stage === "INDEX") return "ASKABLE";
  return "UPLOAD";
}

function flowStepOrder(step: string) {
  return FLOW_STEPS.findIndex((item) => item.key === step);
}

function isFinishedTaskStatus(status: string) {
  return status === "SUCCESS" || status === "COMPLETED" || status === "FAILED" || status === "PARTIAL_SUCCESS" || status === "SKIPPED";
}

function buildAccept(formats: SupportedFormat[]) {
  return formats
    .flatMap((item) => item.extensions)
    .map((extension) => `.${normalizeExtension(extension)}`)
    .join(",");
}

function formatLabel(fileType: string) {
  const map: Record<string, string> = {
    PDF: "PDF",
    TXT: "TXT",
    MD: "Markdown",
    MARKDOWN: "Markdown",
    DOC: "Word",
    DOCX: "Word",
    XLS: "Excel",
    XLSX: "Excel",
    CSV: "CSV",
    HTML: "HTML",
    URL: "URL",
    PPT: "PPT",
    PPTX: "PPT",
    ZIP: "ZIP",
    IMAGE: "图片",
  };

  return map[fileType] ?? fileType;
}

function supportedFormatDisplayName(fileType: string) {
  const map: Record<string, string> = {
    PDF: "PDF",
    TXT: "TXT",
    IMAGE: "IMG",
    MARKDOWN: "MD",
  };

  return map[fileType] ?? fileType;
}

function dedupeDisplayName(strategy: string, defaultStrategy: string) {
  const map: Record<string, string> = {
    SKIP: "跳过",
    OVERWRITE: "覆盖",
    VERSIONED: "版本链",
  };
  const label = map[strategy] ?? strategy;

  return label;
}

function stageText(stage: string) {
  const map: Record<string, string> = {
    UPLOAD: "上传",
    PARSE: "解析",
    CHUNK: "切片",
    EMBED: "向量化",
    INDEX: "入库",
    ASKABLE: "可问答",
  };

  return map[stage] ?? stage;
}

function stageStatusText(status: string) {
  return status === "RUNNING" ? "处理中" : statusText(status);
}

const IMPORTS_FONT_STACK =
  '"Sora", "Outfit", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const APP_FONT_STACK =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const BUTTON_PRIMARY_CLASS =
  "imports-primary-action inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-[#111315] px-3.5 text-[12px] font-black text-white shadow-[0_16px_38px_rgba(17,19,21,0.2)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white disabled:translate-y-0 disabled:bg-[#111315]/35 disabled:shadow-none";

const BUTTON_FILE_PICKER_CLASS =
  "inline-flex min-h-9 items-center justify-center rounded-full bg-[#111315] px-3.5 text-[11px] font-black leading-none text-white shadow-[0_16px_38px_rgba(17,19,21,0.2)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white disabled:translate-y-0 disabled:bg-[#111315]/35 disabled:shadow-none dark:bg-white dark:text-[#111315] dark:hover:bg-[var(--premium-blue)] dark:hover:text-white";

const BUTTON_SECONDARY_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] bg-[rgba(255,253,245,0.7)] px-3 text-[12px] font-black text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5 hover:border-[var(--premium-blue)] hover:bg-[var(--premium-blue)] hover:text-white disabled:translate-y-0 disabled:opacity-50 dark:bg-[var(--premium-panel-strong)] dark:hover:bg-[var(--premium-blue)]";

const BUTTON_GHOST_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-[12px] font-black text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5 hover:border-[var(--premium-blue)] hover:bg-[var(--premium-blue)] hover:text-white disabled:translate-y-0 disabled:opacity-50";

const BUTTON_RETRY_CLASS =
  "inline-flex min-h-7 items-center justify-center justify-self-end gap-[5px] whitespace-nowrap rounded-full border border-[rgba(255,102,89,0.3)] bg-[rgba(255,102,89,0.12)] px-[11px] text-[11px] font-black leading-none text-[#a93527] transition hover:-translate-y-px hover:bg-[rgba(255,102,89,0.2)] disabled:translate-y-0 disabled:opacity-50 dark:border-[#7d3834] dark:bg-[#3a1716] dark:text-[#ffb4ad] dark:hover:bg-[#4a201d] dark:disabled:border-[#3d2422] dark:disabled:bg-[#281615] dark:disabled:text-[#a97873] dark:disabled:opacity-100";

const BUTTON_RETRY_ALL_CLASS =
  "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgba(255,102,89,0.3)] bg-[rgba(255,102,89,0.12)] px-[13px] text-[11px] font-black leading-none text-[#a93527] transition hover:-translate-y-px hover:bg-[rgba(255,102,89,0.2)] disabled:translate-y-0 disabled:opacity-50 dark:border-[#7d3834] dark:bg-[#3a1716] dark:text-[#ffb4ad] dark:hover:bg-[#4a201d] dark:disabled:border-[#3d2422] dark:disabled:bg-[#281615] dark:disabled:text-[#a97873] dark:disabled:opacity-100";

const FIELD_CLASS =
  "h-9 w-full rounded-[8px] border border-[var(--premium-line)] bg-white/70 px-3 text-[12px] text-[var(--premium-ink)] outline-none transition placeholder:text-[var(--premium-muted)] focus:border-[var(--premium-focus-line)] focus:bg-[var(--premium-elevated)] focus:shadow-[0_0_0_3px_var(--premium-focus-ring)] dark:bg-[var(--premium-panel-strong)]";

const SELECT_BUTTON_CLASS =
  "inline-flex min-h-9 w-full items-center gap-2 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-2.5 text-[12px] font-extrabold leading-none text-[var(--premium-ink)] transition hover:bg-[var(--premium-elevated)]";
