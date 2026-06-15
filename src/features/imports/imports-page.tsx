"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileUp,
  Folder,
  Info,
  Link2,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import { formatDateTime, formatFileSize, statusText } from "@/lib/format";
import { buildDisplayNameFromUrl, inferFileType, uploadFilesToOss } from "@/lib/ingestion-files";
import type { IngestionTask, IngestionTaskItem, KnowledgeBase, SupportedFormat } from "@/lib/types";

const RECENT_TASK_LIMIT = 10;
const RECENT_ITEM_LIMIT = 8;
const FLOW_STEPS = [
  { key: "UPLOAD", label: "上传", helper: "文件接收与入队" },
  { key: "PARSE", label: "解析", helper: "提取文本与结构" },
  { key: "EMBED", label: "向量化", helper: "生成语义向量" },
  { key: "ASKABLE", label: "可问答", helper: "写入索引后可检索" },
];

type RecentImportItem = {
  taskId: string;
  taskStatus: string;
  sourceType: string;
  kbId: string;
  createdAt?: string;
  item: IngestionTaskItem;
};

export function ImportsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kbId, setKbId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [isKbMenuOpen, setIsKbMenuOpen] = useState(false);
  const [isDedupeMenuOpen, setIsDedupeMenuOpen] = useState(false);
  const [dedupeStrategy, setDedupeStrategy] = useState("SKIP");
  const [currentTaskId, setCurrentTaskId] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const capabilitiesQuery = useQuery({
    queryKey: ["ingestion-capabilities"],
    queryFn: apiClient.ingestionCapabilities,
  });

  const selectedKbId = kbId || kbsQuery.data?.items?.[0]?.id || "";
  const selectedKb = useMemo(
    () => (kbsQuery.data?.items ?? []).find((item) => item.id === selectedKbId),
    [kbsQuery.data?.items, selectedKbId],
  );
  const selectedKbLabel = selectedKb?.name ?? "选择知识库";

  const supportedFormats = useMemo(
    () => (capabilitiesQuery.data?.supportedFormats ?? []).filter((item) => item.enabled),
    [capabilitiesQuery.data?.supportedFormats],
  );

  const accept = useMemo(() => buildAccept(supportedFormats), [supportedFormats]);

  const tasksQuery = useQuery({
    queryKey: ["ingestion-tasks", selectedKbId],
    queryFn: () => apiClient.listIngestionTasks(selectedKbId, RECENT_TASK_LIMIT),
    enabled: Boolean(selectedKbId),
    refetchInterval: (query) => (hasRunningTask(query.state.data?.items) ? 2000 : false),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const taskDetailsQueries = useQueries({
    queries: (tasksQuery.data?.items ?? []).map((task) => ({
      queryKey: ["ingestion-task", selectedKbId, task.taskId],
      queryFn: () => apiClient.getIngestionTask(selectedKbId, task.taskId),
      enabled: Boolean(selectedKbId),
      refetchInterval: isFinishedTaskStatus(task.status) ? false : 2000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });

  const currentTaskQuery = useQuery({
    queryKey: ["ingestion-task", selectedKbId, currentTaskId],
    queryFn: () => apiClient.getIngestionTask(selectedKbId, currentTaskId),
    enabled: Boolean(selectedKbId && currentTaskId),
    refetchInterval: (query) => (query.state.data && !isFinishedTaskStatus(query.state.data.status) ? 2000 : false),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const taskDetails = useMemo(
    () => taskDetailsQueries.map((query) => query.data).filter(Boolean) as IngestionTask[],
    [taskDetailsQueries],
  );

  const recentItems = useMemo(
    () => flattenRecentItems(taskDetails).slice(0, RECENT_ITEM_LIMIT),
    [taskDetails],
  );

  const currentTask = currentTaskId ? currentTaskQuery.data ?? taskDetails.find((task) => task.taskId === currentTaskId) : undefined;
  const selectedFilesSize = files.reduce((total, file) => total + file.size, 0);
  const defaultDedupeStrategy = capabilitiesQuery.data?.defaultDedupeStrategy ?? "SKIP";
  const dedupeOptions = capabilitiesQuery.data?.dedupeStrategies ?? [defaultDedupeStrategy];

  const createUrlMutation = useMutation({
    mutationFn: () => {
      const trimmedUrl = sourceUrl.trim();
      const displayName = urlTitle.trim() || buildDisplayNameFromUrl(trimmedUrl);

      return apiClient.createUrlIngestionTask(selectedKbId, {
        sourceUrl: trimmedUrl,
        fileName: displayName,
        fileType: inferFileType(displayName || trimmedUrl, undefined, supportedFormats),
        dedupeStrategy,
      });
    },
    onSuccess: (task) => {
      setSourceUrl("");
      setUrlTitle("");
      setShowUrlForm(false);
      setCurrentTaskId(task.taskId);
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      invalidateIngestionQueries(queryClient, selectedKbId);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      validateUploadInput(files, capabilitiesQuery.data?.maxFileSizeBytes, capabilitiesQuery.data?.maxFilesPerBatch);

      const stsToken = await apiClient.getStsToken();
      const items = await uploadFilesToOss(files, stsToken, supportedFormats);

      return apiClient.createUploadIngestionTask(selectedKbId, {
        dedupeStrategy,
        items,
      });
    },
    onSuccess: (task) => {
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setCurrentTaskId(task.taskId);
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      invalidateIngestionQueries(queryClient, selectedKbId);
    },
  });

  const retryTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.retryFailedIngestionTask(selectedKbId, taskId),
    onSuccess: (task) => {
      setCurrentTaskId(task.taskId);
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      invalidateIngestionQueries(queryClient, selectedKbId);
      queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
  });

  const retryItemMutation = useMutation({
    mutationFn: ({ taskId, itemId }: { taskId: string; itemId: string }) =>
      apiClient.retryIngestionTaskItem(selectedKbId, taskId, itemId),
    onSuccess: (task) => {
      setCurrentTaskId(task.taskId);
      queryClient.setQueryData(["ingestion-task", selectedKbId, task.taskId], task);
      invalidateIngestionQueries(queryClient, selectedKbId);
      queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
  });

  const currentProgress = summarizeTaskProgress(currentTask, uploadMutation.isPending || createUrlMutation.isPending);

  function handleFilesSelected(nextFiles: File[]) {
    setFiles(nextFiles);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      handleFilesSelected(droppedFiles);
    }
  }

  function handleUploadClick() {
    uploadMutation.mutate();
  }

  return (
    <div className="min-h-[calc(100vh-68px)] px-4 pb-8 sm:px-6 lg:min-h-[calc(100vh-82px)] lg:px-10 lg:pb-10">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-7 lg:mb-9">
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-normal text-slate-950 dark:text-slate-200 lg:text-[30px]">导入资料</h1>
            <Info size={22} className="text-slate-500 dark:text-slate-400" />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">将资料导入知识库，开始检索与问答</p>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1320px] gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
        <section className="min-w-0">
          <div className="panel p-4 sm:p-5">
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              className="grid min-h-[310px] place-items-center rounded-[8px] border border-dashed border-blue-300 bg-[var(--background)] p-6 text-center dark:border-blue-500/45 dark:bg-[var(--background)]"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={accept}
                className="sr-only"
                onChange={(event) => handleFilesSelected(Array.from(event.target.files ?? []))}
              />
              <div className="w-full max-w-[640px]">
                <div className="mx-auto grid size-16 place-items-center rounded-[8px] border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300">
                  <Upload size={30} strokeWidth={1.8} />
                </div>
                <div className="mt-6 text-[20px] font-semibold tracking-normal text-slate-950 dark:text-slate-200">
                  拖入 PDF、Word、Excel、图片或粘贴链接
                </div>
                <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  单个文件最大 {formatFileSize(capabilitiesQuery.data?.maxFileSizeBytes)}，单次最多 {capabilitiesQuery.data?.maxFilesPerBatch ?? "-"} 个文件
                </div>
                <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-11 min-w-40 items-center justify-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 disabled:bg-slate-300"
                    disabled={uploadMutation.isPending}
                  >
                    <FileUp size={17} />
                    选择文件
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUrlForm((value) => !value)}
                    className="inline-flex h-11 min-w-40 items-center justify-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-200"
                  >
                    <Link2 size={17} />
                    URL 导入
                  </button>
                </div>
                <div className="mt-6 inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <ShieldCheck size={16} className="text-blue-600 dark:text-blue-300" />
                  文件在传输和存储中均已加密，保障数据安全
                </div>
              </div>
            </div>

            {files.length > 0 ? (
              <div className="mt-4 rounded-[8px] border border-[var(--line)] bg-[var(--background)] p-3 dark:bg-[#0d1117]">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    已选择 {files.length} 个文件
                    <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">{formatFileSize(selectedFilesSize)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  >
                    清空
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {files.map((file) => (
                    <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex min-w-0 items-center gap-3 rounded-[8px] bg-[var(--surface)] px-3 py-2">
                      <FileTypeIcon fileName={file.name} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{file.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{formatFileSize(file.size)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleUploadClick}
                    disabled={!selectedKbId || files.length === 0 || uploadMutation.isPending}
                    className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {uploadMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {uploadMutation.isPending ? "上传中" : "上传并入库"}
                  </button>
                </div>
              </div>
            ) : null}

            {showUrlForm ? (
              <div className="mt-4 grid gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--background)] p-3 dark:bg-[#0d1117] lg:grid-cols-[minmax(0,1fr)_220px_auto]">
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    className="field pl-10"
                    placeholder="https://example.com/policy/reimburse/2024"
                  />
                </div>
                <input
                  value={urlTitle}
                  onChange={(event) => setUrlTitle(event.target.value)}
                  className="field"
                  placeholder="文件名，可选"
                />
                <button
                  type="button"
                  onClick={() => createUrlMutation.mutate()}
                  disabled={!selectedKbId || !sourceUrl.trim() || createUrlMutation.isPending}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                >
                  {createUrlMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                  {createUrlMutation.isPending ? "提交中" : "提交导入"}
                </button>
              </div>
            ) : null}

            {uploadMutation.error ? <div className="mt-4"><ErrorBlock message={(uploadMutation.error as Error).message} /></div> : null}
            {createUrlMutation.error ? <div className="mt-4"><ErrorBlock message={(createUrlMutation.error as Error).message} /></div> : null}
          </div>

          <div className="mt-6 panel p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-slate-950 dark:text-slate-200">最近导入</h2>
              <button
                type="button"
                onClick={() => tasksQuery.refetch()}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300"
              >
                查看全部
              </button>
            </div>

            {tasksQuery.isLoading ? <LoadingBlock label="正在加载导入任务" /> : null}
            {tasksQuery.isError ? <ErrorBlock message={(tasksQuery.error as Error).message} onRetry={() => tasksQuery.refetch()} /> : null}
            {!tasksQuery.isLoading && !tasksQuery.isError && recentItems.length === 0 ? (
              <div className="flex min-h-36 items-center justify-center rounded-[8px] border border-dashed border-[var(--line)] text-sm text-slate-500 dark:text-slate-400">
                暂无导入记录
              </div>
            ) : null}
            {recentItems.length > 0 ? (
              <div className="divide-y divide-[var(--line)]">
                {recentItems.map((recentItem) => (
                  <RecentImportRow
                    key={`${recentItem.taskId}-${recentItem.item.itemId}`}
                    recentItem={recentItem}
                    kbName={findKbName(kbsQuery.data?.items, recentItem.kbId)}
                    onRetry={() => retryItemMutation.mutate({ taskId: recentItem.taskId, itemId: recentItem.item.itemId })}
                    retrying={retryItemMutation.isPending && retryItemMutation.variables?.itemId === recentItem.item.itemId}
                  />
                ))}
              </div>
            ) : null}
            {retryItemMutation.error ? <div className="mt-4"><ErrorBlock message={(retryItemMutation.error as Error).message} /></div> : null}
            {retryTaskMutation.error ? <div className="mt-4"><ErrorBlock message={(retryTaskMutation.error as Error).message} /></div> : null}
          </div>
        </section>

        <aside className="space-y-5">
          <div className="panel p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-200">本次导入</h2>
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  setSourceUrl("");
                  setUrlTitle("");
                  setCurrentTaskId("");
                  setDedupeStrategy(defaultDedupeStrategy);
                }}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300"
              >
                重置
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">目标知识库</label>
                <ImportKnowledgeBasePicker
                  items={kbsQuery.data?.items ?? []}
                  selectedKbId={selectedKbId}
                  selectedLabel={selectedKbLabel}
                  isOpen={isKbMenuOpen}
                  isLoading={kbsQuery.isLoading}
                  onToggle={() => setIsKbMenuOpen((open) => !open)}
                  onClose={() => setIsKbMenuOpen(false)}
                  onSelect={setKbId}
                />
                <div className="mt-2 min-h-5 text-sm text-slate-500 dark:text-slate-400">
                  {selectedKb?.description || "请选择本次资料要导入的知识库"}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">支持格式</label>
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {supportedFormats.map((format) => (
                    <SupportedFormatBadge key={format.fileType} format={format} />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">去重策略</label>
                <DedupeStrategyPicker
                  options={dedupeOptions}
                  value={dedupeStrategy}
                  isOpen={isDedupeMenuOpen}
                  onToggle={() => setIsDedupeMenuOpen((open) => !open)}
                  onClose={() => setIsDedupeMenuOpen(false)}
                  onSelect={setDedupeStrategy}
                />
              </div>

              <div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">导入流程</div>
                <div className="mt-4 space-y-0">
                  {FLOW_STEPS.map((step, index) => (
                    <FlowStep
                      key={step.key}
                      index={index}
                      step={step}
                      currentStep={currentProgress.currentStep}
                      completed={currentProgress.completedSteps.has(step.key)}
                      progress={currentProgress.progress}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-[8px] border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-slate-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-slate-300">
                <div className="flex items-start gap-2">
                  <Sparkles size={17} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" />
                  <span>导入完成后，AI 将自动生成摘要，便于快速了解内容。</span>
                </div>
              </div>

              {currentTask && canRetryTask(currentTask) ? (
                <button
                  type="button"
                  onClick={() => retryTaskMutation.mutate(currentTask.taskId)}
                  disabled={retryTaskMutation.isPending}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] disabled:text-slate-400 dark:text-slate-200"
                >
                  <RotateCcw size={16} />
                  {retryTaskMutation.isPending ? "重试中" : "重试失败项"}
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

    </div>
  );
}

function invalidateIngestionQueries(queryClient: ReturnType<typeof useQueryClient>, kbId: string) {
  queryClient.invalidateQueries({ queryKey: ["ingestion-tasks", kbId] });
}

function RecentImportRow({
  recentItem,
  kbName,
  onRetry,
  retrying,
}: {
  recentItem: RecentImportItem;
  kbName: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const item = recentItem.item;
  const title = item.fileName || item.sourceUrl || "未命名资料";
  const failed = item.status === "FAILED";
  const running = item.status === "RUNNING" || item.status === "PENDING";

  return (
    <div className="grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-3 lg:grid-cols-[auto_minmax(0,1fr)_110px_92px_88px_auto]">
      <TimelineDot status={item.status} />
      <div className="flex min-w-0 items-center gap-3">
        <FileTypeIcon fileName={title} sourceType={recentItem.sourceType} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
          <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">导入至：{kbName}</div>
          {failed && item.errorMessage ? (
            <div className="mt-1 truncate text-xs font-medium text-red-500">{item.errorMessage}</div>
          ) : null}
        </div>
      </div>
      <div className="hidden lg:block">
        <StatusPill status={item.status} progress={item.progress} />
      </div>
      <div className="hidden text-sm text-slate-500 dark:text-slate-400 lg:block">
        {running ? stageText(item.stage) : item.status === "SUCCESS" || item.status === "SKIPPED" ? "已完成" : "未完成"}
      </div>
      <div className="hidden text-sm text-slate-500 dark:text-slate-400 lg:block">{formatDateTime(item.finishedAt ?? item.updatedAt ?? recentItem.createdAt)}</div>
      <div className="flex justify-end gap-2">
        {failed ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs font-medium text-slate-700 hover:bg-[var(--surface-hover)] disabled:text-slate-400 dark:text-slate-200"
          >
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            重试
          </button>
        ) : null}
        <ChevronRight size={18} className="mt-1 text-slate-400" />
      </div>
      <div className="col-span-2 lg:hidden">
        <StatusPill status={item.status} progress={item.progress} />
      </div>
    </div>
  );
}

function ImportKnowledgeBasePicker({
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
      className="relative mt-2"
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
                  "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm",
                  selectedKbId === item.id
                    ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                    : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300",
                ].join(" ")}
                role="option"
                aria-selected={selectedKbId === item.id}
              >
                <Folder size={16} className="shrink-0" />
                <span className="truncate">{item.name}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">暂无可选知识库</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DedupeStrategyPicker({
  options,
  value,
  isOpen,
  onToggle,
  onClose,
  onSelect,
}: {
  options: string[];
  value: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  return (
    <div
      className="relative mt-2"
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
        <ShieldCheck size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{dedupeLabel(value)}</span>
        <ChevronDown size={15} className="shrink-0" />
      </button>

      {isOpen ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-[var(--line)] dark:bg-[var(--surface)]"
          role="listbox"
        >
          {options.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                onSelect(item);
                onClose();
              }}
              className={[
                "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm",
                value === item
                  ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                  : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300",
              ].join(" ")}
              role="option"
              aria-selected={value === item}
            >
              <ShieldCheck size={16} className="shrink-0" />
              <span className="truncate">{dedupeLabel(item)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SupportedFormatBadge({ format }: { format: SupportedFormat }) {
  return (
    <div className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-[8px] bg-[var(--background)] px-1.5 text-center dark:bg-[#0d1117]">
      <FileTypeIcon fileName={format.extensions[0] ? `file.${normalizeExtension(format.extensions[0])}` : format.fileType} sourceType={format.fileType} compact />
      <span className="max-w-full truncate text-xs text-slate-600 dark:text-slate-300">{formatLabel(format.fileType)}</span>
    </div>
  );
}

function FileTypeIcon({
  fileName,
  sourceType,
  compact = false,
  className = "",
}: {
  fileName: string;
  sourceType?: string;
  compact?: boolean;
  className?: string;
}) {
  const type = sourceType === "URL" ? "URL" : inferIconType(fileName, sourceType);
  const size = compact ? "size-5" : "size-11";
  const iconSize = compact ? 14 : 24;
  const shared = `${size} grid place-items-center rounded-[8px] ${className}`;

  if (type === "PDF") {
    return <span className={`${shared} border border-red-200 bg-red-50 text-red-500`}><FileText size={iconSize} /></span>;
  }
  if (type === "DOCX") {
    return <span className={`${shared} border border-blue-200 bg-blue-50 text-blue-600`}><FileType2 size={iconSize} /></span>;
  }
  if (type === "XLSX" || type === "CSV") {
    return <span className={`${shared} border border-emerald-200 bg-emerald-50 text-emerald-600`}><FileSpreadsheet size={iconSize} /></span>;
  }
  if (type === "IMAGE") {
    return <span className={`${shared} border border-violet-200 bg-violet-50 text-violet-600`}><FileImage size={iconSize} /></span>;
  }
  if (type === "ZIP") {
    return <span className={`${shared} border border-amber-200 bg-amber-50 text-amber-600`}><FileArchive size={iconSize} /></span>;
  }
  if (type === "URL") {
    return <span className={`${shared} border border-slate-200 bg-slate-100 text-slate-600`}><Link2 size={iconSize} /></span>;
  }

  return <span className={`${shared} border border-slate-200 bg-slate-50 text-slate-600`}><FileText size={iconSize} /></span>;
}

function TimelineDot({ status }: { status: string }) {
  if (status === "SUCCESS" || status === "SKIPPED") {
    return (
      <span className="grid size-5 place-items-center rounded-full border border-emerald-300 bg-emerald-50 text-emerald-600">
        <Check size={13} strokeWidth={2.4} />
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="grid size-5 place-items-center rounded-full border border-red-300 bg-red-50 text-red-500">
        <AlertCircle size={13} />
      </span>
    );
  }

  return <span className="size-5 rounded-full border-2 border-blue-500 bg-[var(--surface)]" />;
}

function StatusPill({ status, progress }: { status: string; progress: number }) {
  if (status === "RUNNING") {
    return (
      <span className="inline-flex h-7 items-center rounded-full bg-blue-50 px-3 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
        解析中 {progress}%
      </span>
    );
  }
  if (status === "SUCCESS" || status === "SKIPPED") {
    return (
      <span className="inline-flex h-7 items-center rounded-full bg-emerald-50 px-3 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
        {status === "SKIPPED" ? "已跳过" : "已完成"}
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="inline-flex h-7 items-center rounded-full bg-red-50 px-3 text-xs font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">
        失败
      </span>
    );
  }

  return (
    <span className="inline-flex h-7 items-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {statusText(status)}
    </span>
  );
}

function FlowStep({
  index,
  step,
  currentStep,
  completed,
  progress,
}: {
  index: number;
  step: { key: string; label: string; helper: string };
  currentStep: string;
  completed: boolean;
  progress: number;
}) {
  const active = currentStep === step.key;
  const waiting = !completed && !active;

  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-3">
      <div className="flex flex-col items-center">
        <span
          className={[
            "grid size-7 place-items-center rounded-full text-sm font-semibold",
            completed ? "bg-blue-600 text-white" : active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
          ].join(" ")}
        >
          {completed ? <Check size={15} /> : index + 1}
        </span>
        {index < FLOW_STEPS.length - 1 ? <span className="h-8 w-px bg-[var(--line)]" /> : null}
      </div>
      <div className="pb-4">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{step.label}</div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{step.helper}</div>
      </div>
      <div className="pb-4 text-sm font-medium text-slate-500 dark:text-slate-400">
        {completed ? <span className="text-emerald-600 dark:text-emerald-300">已完成</span> : active ? <span className="text-blue-600 dark:text-blue-300">{progress}%</span> : waiting ? "等待中" : null}
      </div>
    </div>
  );
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

function hasRunningTask(tasks?: Array<{ status: string }>) {
  return Boolean(tasks?.some((task) => !isFinishedTaskStatus(task.status)));
}

function isFinishedTaskStatus(status: string) {
  return status === "SUCCESS" || status === "FAILED" || status === "PARTIAL_SUCCESS" || status === "SKIPPED";
}

function canRetryTask(task: { status: string; failureCount: number }) {
  return task.failureCount > 0 && task.status !== "RUNNING";
}

function flattenRecentItems(tasks: IngestionTask[]) {
  return tasks
    .flatMap((task) =>
      (task.items ?? []).map((item) => ({
        taskId: task.taskId,
        taskStatus: task.status,
        sourceType: task.sourceType,
        kbId: task.kbId,
        createdAt: task.createdAt,
        item,
      })),
    )
    .toSorted((first, second) => {
      const firstTime = new Date(first.item.updatedAt ?? first.createdAt ?? 0).getTime();
      const secondTime = new Date(second.item.updatedAt ?? second.createdAt ?? 0).getTime();
      return secondTime - firstTime;
    });
}

function summarizeTaskProgress(task?: IngestionTask, submitting = false) {
  if (!task || !task.items?.length) {
    return { currentStep: submitting ? "UPLOAD" : "", progress: 0, completedSteps: new Set<string>() };
  }

  const runningItem = task.items.find((item) => item.status === "RUNNING" || item.status === "PENDING") ?? task.items[0];
  const currentStep = mapStageToFlowStep(runningItem.stage, runningItem.status);
  const progress = Math.max(0, Math.min(100, runningItem.progress ?? 0));
  const completedSteps = new Set<string>();

  for (const step of FLOW_STEPS) {
    if (flowStepOrder(step.key) < flowStepOrder(currentStep) || task.status === "SUCCESS") {
      completedSteps.add(step.key);
    }
  }

  return { currentStep, progress, completedSteps };
}

function mapStageToFlowStep(stage: string, status: string) {
  if (status === "SUCCESS" || stage === "ASKABLE") return "ASKABLE";
  if (stage === "EMBED") return "EMBED";
  if (stage === "PARSE" || stage === "CHUNK") return "PARSE";
  if (stage === "INDEX") return "ASKABLE";
  return "UPLOAD";
}

function flowStepOrder(step: string) {
  return FLOW_STEPS.findIndex((item) => item.key === step);
}

function stageText(stage: string) {
  const map: Record<string, string> = {
    UPLOAD: "上传",
    PARSE: "解析",
    CHUNK: "分块",
    EMBED: "向量化",
    INDEX: "索引",
    ASKABLE: "可问答",
  };

  return map[stage] ?? stage;
}

function inferIconType(fileName: string, sourceType?: string) {
  if (sourceType && sourceType !== "UPLOAD") {
    return sourceType;
  }

  const extension = fileName.split("?")[0]?.split("#")[0]?.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "pdf") return "PDF";
  if (extension === "docx" || extension === "doc") return "DOCX";
  if (extension === "xlsx" || extension === "xls" || extension === "csv") return "XLSX";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "IMAGE";
  if (extension === "zip") return "ZIP";
  if (extension === "md" || extension === "markdown") return "MD";

  return "TEXT";
}

function buildAccept(formats: SupportedFormat[]) {
  return formats
    .flatMap((item) => item.extensions)
    .map((extension) => `.${normalizeExtension(extension)}`)
    .join(",");
}

function normalizeExtension(extension: string) {
  return extension.trim().replace(/^\./, "").toLowerCase();
}

function formatLabel(fileType: string) {
  const map: Record<string, string> = {
    PDF: "PDF",
    TXT: "TXT",
    MD: "Markdown",
    DOCX: "Word",
    XLSX: "Excel",
    CSV: "CSV",
    HTML: "HTML",
    URL: "URL",
    PPTX: "PPT",
    ZIP: "ZIP",
    IMAGE: "图片",
  };

  return map[fileType] ?? fileType;
}

function dedupeLabel(strategy: string) {
  const map: Record<string, string> = {
    SKIP: "按文件哈希去重（推荐）",
    OVERWRITE: "覆盖已有文档",
    VERSIONED: "保留为新版本",
  };

  return map[strategy] ?? strategy;
}

function findKbName(items: KnowledgeBase[] | undefined, kbId: string) {
  return items?.find((item) => item.id === kbId)?.name ?? "知识库";
}
