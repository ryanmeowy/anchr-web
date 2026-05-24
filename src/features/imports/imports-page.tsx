"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Link2, RotateCcw, Upload, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { KbSelect } from "@/components/ui/kb-select";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import { formatFileSize, statusText } from "@/lib/format";
import { buildDisplayNameFromUrl, inferFileType, uploadFilesToOss } from "@/lib/ingestion-files";
import { getSecuritySettings, getStorageSettings } from "@/lib/local-settings";

export function ImportsPage() {
  const queryClient = useQueryClient();
  const [kbId, setKbId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [dedupeStrategy, setDedupeStrategy] = useState("SKIP");
  const [files, setFiles] = useState<File[]>([]);
  const [storageSettings] = useState(() => getStorageSettings());
  const [securitySettings] = useState(() => getSecuritySettings());

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const capabilitiesQuery = useQuery({
    queryKey: ["ingestion-capabilities"],
    queryFn: apiClient.ingestionCapabilities,
  });

  const selectedKbId = kbId || kbsQuery.data?.items?.[0]?.id || "";

  const tasksQuery = useQuery({
    queryKey: ["ingestion-tasks", selectedKbId],
    queryFn: () => apiClient.listIngestionTasks(selectedKbId, 10),
    enabled: Boolean(selectedKbId),
    refetchInterval: (query) => (hasRunningTask(query.state.data?.items) ? 2000 : false),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createUrlIngestionTask(selectedKbId, {
        sourceUrl: sourceUrl.trim(),
        fileName: fileName.trim() || buildDisplayNameFromUrl(sourceUrl.trim()),
        fileType: inferFileType(fileName.trim() || sourceUrl.trim(), undefined, supportedFormats),
        dedupeStrategy,
      }),
    onSuccess: () => {
      setSourceUrl("");
      setFileName("");
      queryClient.invalidateQueries({ queryKey: ["ingestion-tasks", selectedKbId] });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      validateUploadInput(files, capabilitiesQuery.data?.maxFileSizeBytes, capabilitiesQuery.data?.maxFilesPerBatch);
      validateOssConfig(storageSettings.ossBucket, storageSettings.ossEndpoint, securitySettings.encryptKey, securitySettings.encryptIv);
      const encryptedCredential = await apiClient.encryptedSts();
      const items = await uploadFilesToOss(files, encryptedCredential, {
        bucket: storageSettings.ossBucket.trim(),
        endpoint: storageSettings.ossEndpoint.trim(),
        keyPrefix: storageSettings.ossPrefix.trim(),
        encryptKey: securitySettings.encryptKey.trim(),
        encryptIv: securitySettings.encryptIv.trim(),
      }, supportedFormats);

      return apiClient.createUploadIngestionTask(selectedKbId, {
        dedupeStrategy,
        items,
      });
    },
    onSuccess: () => {
      setFiles([]);
      queryClient.invalidateQueries({ queryKey: ["ingestion-tasks", selectedKbId] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.retryFailedIngestionTask(selectedKbId, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ingestion-tasks", selectedKbId] });
      queryClient.invalidateQueries({ queryKey: ["kbs"] });
    },
  });

  const supportedFormats = (capabilitiesQuery.data?.supportedFormats ?? []).filter((item) => item.enabled);
  const accept = supportedFormats.flatMap((item) => item.extensions.map((extension) => `.${extension}`)).join(",");

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 px-8 py-8">
      <section>
        <div className="mb-6">
          <h1 className="text-[30px] font-semibold tracking-normal text-slate-950">导入资料</h1>
          <p className="mt-1 text-sm text-slate-500">URL 可以是网页，也可以是 PDF、DOCX、XLSX、CSV、PPTX、ZIP 等文件下载地址。</p>
        </div>

        <div className="panel p-5">
          <label className="block rounded-[8px] border border-dashed border-blue-300 bg-blue-50/50 p-8 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-[8px] bg-white text-blue-600">
              <Upload size={24} />
            </div>
            <div className="mt-4 text-lg font-semibold text-slate-950">拖拽文件到这里</div>
            <div className="mt-2 text-sm text-slate-500">选择文件后会先直传 OSS，再提交知识库入库任务。</div>
            <input
              type="file"
              multiple
              accept={accept}
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          {files.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`} className="flex items-center justify-between rounded-[8px] border border-slate-200 px-3 py-2 text-sm">
                  <span className="truncate text-slate-700">{file.name}</span>
                  <span className="shrink-0 text-slate-500">{formatFileSize(file.size)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-[1fr_1fr] gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700">目标知识库</label>
              <div className="mt-2">
                <KbSelect items={kbsQuery.data?.items ?? []} value={selectedKbId} onChange={setKbId} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">去重策略</label>
              <select value={dedupeStrategy} onChange={(event) => setDedupeStrategy(event.target.value)} className="field mt-2">
                {(capabilitiesQuery.data?.dedupeStrategies ?? ["SKIP"]).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="min-w-0 text-sm text-slate-600">
              <div className="font-medium text-slate-900">文件上传配置从 Settings 读取</div>
              <div className="mt-1 truncate">
                Bucket：{storageSettings.ossBucket || "未配置"} / Endpoint：{storageSettings.ossEndpoint || "未配置"}
              </div>
            </div>
            <Link
              href="/settings"
              className="h-11 shrink-0 rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              配置
            </Link>
            <button
              type="button"
              onClick={() => uploadMutation.mutate()}
              disabled={!selectedKbId || files.length === 0 || uploadMutation.isPending}
              className="h-11 shrink-0 rounded-[8px] bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {uploadMutation.isPending ? "上传中" : "上传并入库"}
            </button>
          </div>
          {uploadMutation.error ? <div className="mt-4"><ErrorBlock message={(uploadMutation.error as Error).message} /></div> : null}

          <div className="mt-5 grid grid-cols-[1fr_260px_auto] gap-3">
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="field pl-10" placeholder="https://example.com/files/policy.pdf" />
            </div>
            <input value={fileName} onChange={(event) => setFileName(event.target.value)} className="field" placeholder="文件名，可选" />
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={!selectedKbId || !sourceUrl.trim() || createMutation.isPending}
              className="h-11 rounded-[8px] bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
            >
              {createMutation.isPending ? "提交中" : "提交导入"}
            </button>
          </div>
          {createMutation.error ? <div className="mt-4"><ErrorBlock message={(createMutation.error as Error).message} /></div> : null}
        </div>

        <div className="mt-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-950">最近导入</h2>
          {tasksQuery.isLoading ? <LoadingBlock label="正在加载导入任务" /> : null}
          {tasksQuery.isError ? <ErrorBlock message={(tasksQuery.error as Error).message} onRetry={() => tasksQuery.refetch()} /> : null}
          <div className="space-y-3">
            {(tasksQuery.data?.items ?? []).map((task) => (
              <div key={task.taskId} className="panel p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950">{task.sourceType} 导入任务</div>
                    <div className="mt-1 text-xs text-slate-500">
                      成功 {task.successCount} / 失败 {task.failureCount} / 总数 {task.totalCount}
                    </div>
                    {task.failureReason ? (
                      <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 break-words">{task.failureReason}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canRetryTask(task) ? (
                      <button
                        type="button"
                        onClick={() => retryMutation.mutate(task.taskId)}
                        disabled={retryMutation.isPending}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
                      >
                        <RotateCcw size={14} />
                        {retryMutation.isPending && retryMutation.variables === task.taskId ? "重试中" : "重试"}
                      </button>
                    ) : null}
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{statusText(task.status)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {retryMutation.error ? <div className="mt-4"><ErrorBlock message={(retryMutation.error as Error).message} /></div> : null}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="panel p-5">
          <h2 className="text-base font-semibold text-slate-950">本次导入</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <Row label="目标知识库" value={(kbsQuery.data?.items ?? []).find((item) => item.id === selectedKbId)?.name ?? "-"} />
            <Row label="最大文件" value={formatFileSize(capabilitiesQuery.data?.maxFileSizeBytes)} />
            <Row label="批次数量" value={String(capabilitiesQuery.data?.maxFilesPerBatch ?? "-")} />
            <Row label="去重策略" value={dedupeStrategy} />
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="text-base font-semibold text-slate-950">OSS 跨域要求</h2>
          <div className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
            <div>Origin：当前前端地址</div>
            <div>Methods：PUT、OPTIONS、GET、HEAD</div>
            <div>AllowedHeader：建议先配置 *</div>
            <div>ExposeHeader：ETag、x-oss-request-id</div>
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="text-base font-semibold text-slate-950">支持格式</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {supportedFormats.map((item) => (
              <span key={item.fileType} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                {item.fileType}
              </span>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <Workflow size={18} />
            处理流程
          </div>
          <div className="mt-4 space-y-3">
            {(capabilitiesQuery.data?.ingestionStages ?? ["SUBMITTED", "PARSING", "INDEXING", "DONE"]).map((item, index) => (
              <div key={item} className="flex items-center gap-3 text-sm text-slate-600">
                <span className="grid size-6 place-items-center rounded-full bg-blue-50 text-xs font-medium text-blue-600">{index + 1}</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </aside>
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
  return status === "SUCCESS"
    || status === "FAILED"
    || status === "PARTIAL_SUCCESS"
    || status === "SKIPPED";
}

function canRetryTask(task: { status: string; failureCount: number }) {
  return task.failureCount > 0 && (task.status === "FAILED" || task.status === "PARTIAL_SUCCESS");
}

function validateOssConfig(bucket: string, endpoint: string, encryptKey: string, encryptIv: string) {
  if (!bucket.trim()) {
    throw new Error("请填写 OSS Bucket。");
  }
  if (!endpoint.trim()) {
    throw new Error("请填写 OSS Endpoint。");
  }
  if (!encryptKey.trim() || !encryptIv.trim()) {
    throw new Error("请填写 APP_ENCRYPT_KEY 和 APP_ENCRYPT_IV，用于解密 /api/v1/auth/sts 返回的凭证。");
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
