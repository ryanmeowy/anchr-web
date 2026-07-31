"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type {
  RuntimeConfigGroup,
  RuntimeConfigType,
  RuntimeConfigUpdateRequest,
} from "@/lib/types";

type FieldDefinition = {
  key: string;
  label: string;
  description: string;
  kind?: "boolean" | "enum" | "number";
  options?: string[];
  unit?: string;
  step?: string;
};

const PANEL_CLASS =
  "rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] p-3 shadow-[var(--premium-tight-shadow)] backdrop-blur-xl";
const FIELD_CLASS = "settings-field premium-focusable";
const BUTTON_PRIMARY_CLASS =
  "settings-primary-action inline-flex min-h-[34px] items-center justify-center gap-2 rounded-full border-0 bg-[var(--premium-ink)] px-3.5 text-[12px] font-black leading-none text-white shadow-[0_16px_38px_rgba(16,18,20,0.2)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] disabled:translate-y-0 disabled:opacity-50";

const TYPE_LABELS: Record<RuntimeConfigType, { label: string; description: string }> = {
  SEARCH: { label: "搜索", description: "召回、向量路由与重排参数" },
  CONVERSATION: { label: "会话", description: "意图路由与传统回答兜底" },
  AGENT: { label: "Agent", description: "预算、超时和文档总结限制" },
  INGESTION: { label: "导入", description: "解析、Embedding 与 Docling 限制" },
  OUTBOX: { label: "Outbox", description: "清理事件批量、重试和保留策略" },
};

const TYPE_ORDER = Object.keys(TYPE_LABELS) as RuntimeConfigType[];

const FIELDS: Record<RuntimeConfigType, FieldDefinition[]> = {
  SEARCH: [
    field("rankConstant", "RRF Rank Constant", "RRF 排名平滑常数"),
    field("candidateMultiplier", "候选倍数", "相对最终返回数量扩大的召回倍数"),
    field("maxCandidates", "最大候选数", "进入融合阶段的候选上限"),
    field("textTopK", "文本向量 Top K", "文本 Segment 的向量召回上限"),
    field("documentImageTopK", "图片向量 Top K", "文档图片的向量召回上限"),
    decimal("textSimilarity", "文本相似度阈值", "文本向量最低相似度"),
    decimal("documentImageSimilarity", "图片相似度阈值", "图片向量最低相似度"),
    field("maxDocChars", "重排文本上限", "每个候选进入 Rerank 的最大字符数", "字符"),
    bool("windowEnabled", "启用重排窗口", "关闭时对全部候选执行重排"),
    field("windowSize", "窗口大小", "固定重排候选窗口"),
    field("windowFactor", "窗口倍数", "未设置固定窗口时相对 limit 的倍数"),
    field("windowMin", "最小窗口", "重排窗口最小值"),
    field("windowMax", "最大窗口", "重排窗口最大值"),
    decimal("fusionAlpha", "召回融合权重", "RRF 分数在最终融合中的权重"),
    decimal("fusionBeta", "重排融合权重", "Rerank 分数在最终融合中的权重"),
  ],
  CONVERSATION: [
    bool("intentRoutingEnabled", "启用意图路由", "是否调用模型判断 CHAT、KB_QUERY 或 OTHER"),
    field("intentContextTurnLimit", "上下文轮数", "意图判断读取的最近对话轮数"),
    field("intentTimeoutSeconds", "意图模型超时", "意图判断单次模型调用超时", "秒"),
    bool("legacyEvidenceFallbackEnabled", "传统证据兜底", "生成失败时是否使用传统证据拼装回答"),
  ],
  AGENT: [
    bool("enabled", "启用 Agent", "允许会话进入 Agent 工作流"),
    enumeration("toolCallMode", "工具调用模式", "模型工具调用协议", ["AUTO", "NATIVE", "JSON"]),
    enumeration("nativeToolChoice", "原生工具策略", "原生工具调用选择策略", ["AUTO", "REQUIRED"]),
    bool("fallbackToTraditional", "传统 RAG 兜底", "Agent 失败时是否退回传统 RAG"),
    field("maxSteps", "最大步骤数", "单个 Agent Run 的步骤预算"),
    field("maxToolCalls", "最大工具调用数", "单个 Agent Run 的工具调用预算"),
    field("totalTimeoutSeconds", "Run 总超时", "单个 Agent Run 的总时间预算", "秒"),
    field("modelTimeoutSeconds", "模型超时", "Agent 单次模型调用超时", "秒"),
    field("taskTimeoutSeconds", "异步任务超时", "文档总结任务单次执行总超时", "秒"),
    field("taskModelTimeoutSeconds", "任务模型超时", "文档总结单次模型调用超时", "秒"),
    field("taskMaxRetries", "任务最大重试", "失败后的重试次数，允许为 0"),
    field("runtimeSnapshotTtlSeconds", "运行快照 TTL", "Agent 运行状态在 Redis 中的保留时间", "秒"),
    field("summaryMaxDocuments", "总结文档上限", "一次文档总结允许的文档数量"),
    field("summaryMaxSegments", "总结 Segment 上限", "一次文档总结允许读取的 Segment 数量"),
    field("summaryMaxChars", "总结字符上限", "一次文档总结允许读取的总字符数", "字符"),
    field("summaryBatchChars", "总结批次字符数", "Map/Reduce 每个批次的字符上限", "字符"),
  ],
  INGESTION: [
    field("claimBatchSize", "领取批量", "一次调度扫描领取的任务项数量"),
    field("parsePollIntervalSeconds", "解析轮询间隔", "查询 Docling 任务状态的间隔", "秒"),
    field("parseStageTimeoutMinutes", "解析阶段超时", "单个 Docling 解析阶段总超时", "分钟"),
    field("stageMaxRetries", "解析最大重试", "Docling 暂时性失败的恢复次数"),
    field("embeddingMinIntervalMs", "Embedding 最小间隔", "Embedding 请求之间的最小等待时间", "毫秒"),
    field("embeddingRateLimitMaxAttempts", "限流最大尝试", "Embedding 限流后的最大尝试次数"),
    field("embeddingRateLimitBackoffMs", "限流退避时间", "Embedding 限流后的基础退避时间", "毫秒"),
    bool("embeddedImageUploadEnabled", "上传内嵌图片", "允许 Docling 上传解析出的内嵌图片"),
    field("doclingMaxResponseMiB", "Docling 响应上限", "单次 Docling Job 响应允许的最大体积", "MiB"),
  ],
  OUTBOX: [
    field("batchSize", "处理批量", "一次轮询领取的 Outbox 事件数量"),
    field("maxAttempts", "最大尝试次数", "事件进入 FAILED 前的最大尝试次数"),
    field("retentionDays", "保留天数", "已完成事件在清理前的保留时间", "天"),
    field("cleanupBatchSize", "清理批量", "一次定时清理删除的最大事件数量"),
  ],
};

function field(
  key: string,
  label: string,
  description: string,
  unit?: string,
): FieldDefinition {
  return { key, label, description, kind: "number", unit };
}

function decimal(key: string, label: string, description: string): FieldDefinition {
  return { key, label, description, kind: "number", step: "0.01" };
}

function bool(key: string, label: string, description: string): FieldDefinition {
  return { key, label, description, kind: "boolean" };
}

function enumeration(
  key: string,
  label: string,
  description: string,
  options: string[],
): FieldDefinition {
  return { key, label, description, kind: "enum", options };
}

function groupValues(group: RuntimeConfigGroup | undefined) {
  return Object.fromEntries((group?.params ?? []).map((param) => [param.key, param.value]));
}

export function RuntimeConfigPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<RuntimeConfigType>("SEARCH");
  const [drafts, setDrafts] = useState<
    Partial<Record<RuntimeConfigType, Record<string, string>>>
  >({});
  const [saved, setSaved] = useState(false);

  const configQuery = useQuery({
    queryKey: ["settings", "runtime"],
    queryFn: apiClient.getRuntimeConfig,
  });
  const selectedGroup = useMemo(
    () => configQuery.data?.groups.find((group) => group.type === selectedType),
    [configQuery.data, selectedType],
  );

  const updateMutation = useMutation({
    mutationFn: (body: RuntimeConfigUpdateRequest) => apiClient.updateRuntimeConfig(body),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "runtime"], (current: typeof configQuery.data) => {
        if (!current) return current;
        return {
          groups: current.groups.map((group) => group.type === updated.type ? updated : group),
        };
      });
      setDrafts((current) => ({ ...current, [updated.type]: groupValues(updated) }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2400);
    },
  });

  const definitions = FIELDS[selectedType];
  const values = drafts[selectedType] ?? groupValues(selectedGroup);
  const loading = configQuery.isPending;
  const canSave = canEdit && !loading && !updateMutation.isPending;

  return (
    <div className="grid min-w-0 gap-3 lg:h-full lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] lg:items-stretch">
      <aside className={`${PANEL_CLASS} grid content-start gap-1.5 lg:h-full lg:min-h-0 lg:overflow-y-auto`} aria-label="运行参数分区">
        <div className="mb-2">
          <h2 className="text-[20px] font-black leading-none text-[var(--premium-ink)]">运行参数</h2>
          <p className="mt-1.5 text-[11px] font-bold leading-normal text-[var(--premium-muted)]">
            保存后覆盖当前值
          </p>
        </div>
        {TYPE_ORDER.map((type) => {
          const active = type === selectedType;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={[
                "rounded-[8px] border px-3 py-2.5 text-left transition",
                active
                  ? "border-[var(--premium-focus-line)] bg-[rgba(137,199,119,0.14)] text-[var(--premium-ink)]"
                  : "border-transparent text-[var(--premium-ink-soft)] hover:border-[var(--premium-line)] hover:bg-[var(--premium-panel-muted)]",
              ].join(" ")}
            >
              <strong className="block text-xs font-black">{TYPE_LABELS[type].label}</strong>
              <span className="mt-1 block text-[10px] font-bold leading-normal text-[var(--premium-muted)]">
                {TYPE_LABELS[type].description}
              </span>
            </button>
          );
        })}
      </aside>

      <section className={`${PANEL_CLASS} min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden`} aria-label={`${TYPE_LABELS[selectedType].label}运行参数`}>
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--premium-line)] pb-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#89c777]">
              {selectedType}
            </p>
            <h2 className="mt-1 text-[clamp(18px,2vw,24px)] font-black leading-none text-[var(--premium-ink)]">
              {TYPE_LABELS[selectedType].label}参数
            </h2>
            <p className="mt-1.5 text-[11px] font-bold text-[var(--premium-muted)]">
              {TYPE_LABELS[selectedType].description}
            </p>
          </div>
          {!canEdit ? (
            <span className="rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-muted)] px-3 py-1.5 text-[10px] font-black text-[var(--premium-muted)]">
              只读
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="grid min-h-48 place-items-center text-[var(--premium-muted)] lg:min-h-0 lg:flex-1">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : configQuery.isError ? (
          <div className="mt-3 rounded-[8px] border border-rose-400/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-600 dark:text-rose-300">
            运行参数加载失败，请稍后重试。
          </div>
        ) : (
          <>
            <div className="mt-3 grid min-w-0 content-start gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-3 lg:overflow-y-auto lg:pr-1">
              {definitions.map((definition) => (
                <label key={definition.key} className="settings-form-field min-w-0">
                  <span className="flex items-center justify-between gap-3">
                    <span>{definition.label}</span>
                    {definition.unit ? (
                      <small className="text-[10px] font-black text-[var(--premium-muted)]">
                        {definition.unit}
                      </small>
                    ) : null}
                  </span>
                  {definition.kind === "boolean" ? (
                    <select
                      className={`${FIELD_CLASS} settings-select`}
                      value={values[definition.key] ?? "false"}
                      disabled={!canEdit}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [selectedType]: {
                          ...(current[selectedType] ?? groupValues(selectedGroup)),
                          [definition.key]: event.target.value,
                        },
                      }))}
                    >
                      <option value="true">启用</option>
                      <option value="false">停用</option>
                    </select>
                  ) : definition.kind === "enum" ? (
                    <select
                      className={`${FIELD_CLASS} settings-select`}
                      value={values[definition.key] ?? definition.options?.[0] ?? ""}
                      disabled={!canEdit}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [selectedType]: {
                          ...(current[selectedType] ?? groupValues(selectedGroup)),
                          [definition.key]: event.target.value,
                        },
                      }))}
                    >
                      {definition.options?.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={`${FIELD_CLASS} settings-number-field`}
                      type="number"
                      min="0"
                      step={definition.step ?? "1"}
                      value={values[definition.key] ?? ""}
                      disabled={!canEdit}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [selectedType]: {
                          ...(current[selectedType] ?? groupValues(selectedGroup)),
                          [definition.key]: event.target.value,
                        },
                      }))}
                    />
                  )}
                  <small className="text-[10px] font-bold leading-normal text-[var(--premium-muted)]">
                    {definition.description}
                  </small>
                </label>
              ))}
            </div>

            <div className="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--premium-line)] pt-3">
              {updateMutation.isError ? (
                <span className="mr-auto text-[11px] font-bold text-rose-600 dark:text-rose-300">
                  {updateMutation.error instanceof Error
                    ? updateMutation.error.message
                    : "保存失败，请检查参数后重试"}
                </span>
              ) : null}
              {saved ? (
                <span className="mr-auto inline-flex items-center gap-1.5 text-[11px] font-black text-[#89c777]">
                  <CheckCircle2 size={15} />
                  已保存并生效
                </span>
              ) : null}
              <button
                type="button"
                className={BUTTON_PRIMARY_CLASS}
                disabled={!canSave}
                onClick={() => updateMutation.mutate({
                  type: selectedType,
                  params: definitions.map((definition) => ({
                    key: definition.key,
                    value: values[definition.key] ?? "",
                  })),
                })}
              >
                {updateMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                保存当前分区
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
