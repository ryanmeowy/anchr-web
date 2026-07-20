"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  LockKeyhole,
  Loader2,
  Stars,
  Waypoints,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { PremiumRail } from "@/components/app/premium-rail";
import { PremiumHeaderUtilities } from "@/components/app/premium-header-utilities";
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  apiClient,
  clearAccessToken,
  getConfiguredAccessToken,
  saveAccessToken,
} from "@/lib/api-client";
import {
  getIndexCompatibilityIssue,
  hasIndexRebuildFailed,
} from "@/lib/index-status";
import { PREMIUM_THEME, type PremiumThemeMode } from "@/lib/premium-theme";
import type {
  CapabilityConfig,
  CapabilityConfigUpdateRequest,
  CapabilityConnectionTestResult,
  CapabilityParams,
  SegmentIndexStatus,
  StorageConnectionTestResult,
  StorageConfigUpdateRequest,
} from "@/lib/types";

type CapabilityName = "GENERATION" | "EMBEDDING" | "RERANK" | "MULTI_EMBEDDING";

type CapabilitySelection = {
  type: CapabilityName;
  configId: number | null;
  mode: "select" | "add";
};

type RebuildDialogState =
  | {
      phase: "CONFIRM_SWITCH";
      capability: CapabilityName;
      id: number;
    }
  | {
      phase: "CONFIRM_REBUILD";
      taskId: string;
      actualDim?: number;
      expectedDim?: number;
      reason?: string;
    }
  | {
      phase: "ERROR";
      error: string;
    }
  | null;

type CapabilityOption = {
  value: CapabilityName;
  label: string;
  description: string;
  modelLabel: string;
  code: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

type CapabilityConfigSaveVariables = {
  body: CapabilityConfigUpdateRequest;
  previousConfig: CapabilityConfig | null;
  creating: boolean;
};

const EMPTY_PARAMS: CapabilityParams["params"] = [];
const ADD_CONFIG_VALUE = "__add_config__";
const FIELD_CLASS = "settings-field premium-focusable";
const FORM_GRID_CLASS = "settings-form-grid";
const FORM_FIELD_CLASS = "settings-form-field";
const PANEL_CLASS =
  "rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel)] p-3 shadow-[var(--premium-tight-shadow)] backdrop-blur-xl";
const BUTTON_PRIMARY_CLASS =
  "settings-primary-action inline-flex min-h-[34px] items-center justify-center gap-2 rounded-full border-0 bg-[var(--premium-ink)] px-3.5 text-[12px] font-black leading-none text-white shadow-[0_16px_38px_rgba(16,18,20,0.2)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] disabled:translate-y-0 disabled:opacity-50";
const BUTTON_SECONDARY_CLASS =
  "settings-secondary-action inline-flex min-h-[34px] items-center justify-center gap-2 rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-2.5 text-[12px] font-black leading-none text-[var(--premium-ink-soft)] transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] hover:text-white disabled:translate-y-0 disabled:opacity-50";
const STATUS_ACTION_CLASS =
  "inline-flex h-5 shrink-0 items-center justify-center rounded-full border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-2 text-[10px] font-black leading-none text-[var(--premium-ink-soft)] transition hover:border-[var(--premium-blue)] hover:text-[var(--premium-blue)]";
const SUCCESS_PILL_CLASS =
  "settings-success-pill inline-flex min-h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[rgba(187,255,102,0.28)] px-2.5 text-[11px] font-black text-[#426b09]";
const ACTION_BUTTON_LABEL_CLASS =
  "block max-w-full truncate text-center text-[12px] font-black leading-none";
const ENABLE_BUTTON_LABEL_CLASS =
  "block max-w-full truncate text-center text-[11px] font-black leading-none";
const INFO_NOTICE_CLASS =
  "mb-4 inline-flex items-center gap-2 rounded-[8px] border border-[rgba(75,141,230,0.22)] bg-[rgba(75,141,230,0.12)] px-3 py-2 text-[11px] font-black leading-[1.55] text-[#4b8de6]";
const CAPABILITY_OPTIONS: CapabilityOption[] = [
  { value: "GENERATION", label: "Generation", description: "Chat & answer generation", modelLabel: "生成模型", code: "GEN", icon: Stars },
  { value: "EMBEDDING", label: "Embedding", description: "Text vectorization", modelLabel: "向量模型", code: "EMB", icon: Waypoints },
  { value: "RERANK", label: "Rerank", description: "Search reranking", modelLabel: "重排模型", code: "RRK", icon: ArrowDownUp },
  { value: "MULTI_EMBEDDING", label: "Multi Embedding", description: "Image/text vectorization", modelLabel: "多模态模型", code: "IMG", icon: Waypoints },
];

const DEFAULT_MODEL_BY_CAPABILITY: Record<CapabilityName, string> = {
  GENERATION: "qwen-plus",
  EMBEDDING: "text-embedding-v4",
  RERANK: "gte-rerank-v2",
  MULTI_EMBEDDING: "multimodal-embedding-v1",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function subscribeAccessToken(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("storage", callback);
  window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
  };
}

function getClientAccessTokenSnapshot(): string | null {
  return getConfiguredAccessToken();
}

function getServerAccessTokenSnapshot(): string | null {
  return null;
}

function useAccessTokenSnapshot() {
  return useSyncExternalStore(subscribeAccessToken, getClientAccessTokenSnapshot, getServerAccessTokenSnapshot);
}

function capabilityQueryKey(capability: CapabilityName) {
  return ["settings", capability.toLowerCase(), "all"] as const;
}

function paramsQueryKey(capability: CapabilityName) {
  return ["settings", capability.toLowerCase(), "params"] as const;
}

function fromExtraConfig(json: Record<string, unknown> | undefined, params: CapabilityParams["params"]) {
  const result: Record<string, string> = {};
  if (!json) return result;
  for (const param of params) {
    const value = json[param.key];
    if (value !== undefined && value !== null) result[param.key] = String(value);
  }
  return result;
}

function toExtraConfig(extra: Record<string, string>, params: CapabilityParams["params"]) {
  const result: Record<string, unknown> = {};
  for (const param of params) {
    const value = extra[param.key]?.trim();
    if (value) result[param.key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeProfileText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeProfileBaseUrl(value: unknown) {
  let normalized = normalizeProfileText(value);
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function profileDimensionValue(
  extraConfig: Record<string, unknown> | null | undefined,
  params: CapabilityParams["params"],
) {
  if (!extraConfig) return "";
  const dimensionKey = params.find(isVectorDimensionParam)?.key ?? "dimensions";
  return normalizeProfileText(extraConfig[dimensionKey]);
}

function embeddingProfileInputChanged(
  capability: CapabilityName,
  currentConfig: CapabilityConfig | null,
  nextConfig: CapabilityConfigUpdateRequest,
  params: CapabilityParams["params"],
) {
  if (!embeddingSwitchAffects(capability) || !currentConfig) return false;
  return normalizeProfileBaseUrl(currentConfig.baseUrl) !== normalizeProfileBaseUrl(nextConfig.baseUrl)
    || normalizeProfileText(currentConfig.modelName) !== normalizeProfileText(nextConfig.modelName)
    || profileDimensionValue(currentConfig.extraConfig, params) !== profileDimensionValue(nextConfig.extraConfig, params);
}

function splitParenLabel(label: string) {
  const match = label.match(/^(.*?)(\s*[(（].*[)）])$/);
  return match ? [match[1].trim(), match[2].trim()] : [label];
}

function enabledConfig(configs: CapabilityConfig[]) {
  return configs.find((config) => config.enabled) ?? null;
}

function preferredConfig(configs: CapabilityConfig[]) {
  return enabledConfig(configs) ?? configs[0] ?? null;
}

function embeddingSwitchAffects(capability: CapabilityName) {
  return capability === "EMBEDDING" || capability === "MULTI_EMBEDDING";
}

function isVectorDimensionParam(param: CapabilityParams["params"][number]) {
  const normalizedKey = param.key.replace(/[^a-z]/gi, "").toLowerCase();
  return normalizedKey.includes("dimension") || /向量维度|dimension/i.test(param.label);
}

function affectedCapabilitiesFor(capability: CapabilityName) {
  return embeddingSwitchAffects(capability)
    ? (["EMBEDDING", "MULTI_EMBEDDING"] as CapabilityName[])
    : [capability];
}

function PendingNotice({ message }: { message: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[8px] bg-amber-50 px-3 py-2 text-[11px] font-black leading-[1.55] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
      <Info size={16} />
      {message}
    </div>
  );
}

function ResultPill({ result }: { result: CapabilityConnectionTestResult | StorageConnectionTestResult | null }) {
  if (!result) return null;

  return (
    <span
      className={
        result.success
          ? SUCCESS_PILL_CLASS
          : "inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full bg-rose-50 px-3 text-xs font-black text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
      }
    >
      {result.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
      {result.success ? "连接成功" : result.message || "连接失败"}
      {result.success && result.latencyMs > 0 ? ` · ${result.latencyMs}ms` : ""}
    </span>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel = "确认",
  pending,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[360px] rounded-[8px] border border-[var(--premium-line)] bg-[rgba(255,253,245,0.92)] p-4 shadow-[var(--premium-menu-shadow)] backdrop-blur-xl dark:bg-[var(--premium-elevated)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="settings-dialog-icon grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--premium-ink)] text-white shadow-[0_14px_32px_rgba(17,19,21,0.16)]">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[18px] font-black leading-none text-[var(--premium-ink)]">{title}</h2>
              <p className="mt-2 text-xs font-black leading-[1.55] text-[var(--premium-muted)]">{description}</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={pending} className="grid size-8 shrink-0 place-items-center rounded-[8px] text-[var(--premium-muted)] hover:bg-white/70 disabled:opacity-50 dark:hover:bg-[var(--premium-panel-muted)]" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={pending} className={`${BUTTON_SECONDARY_CLASS} flex-1`}>
            取消
          </button>
          <button type="button" onClick={onConfirm} disabled={pending} className={`${BUTTON_PRIMARY_CLASS} flex-1`}>
            {pending ? <Loader2 size={16} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPremiumPage() {
  const queryClient = useQueryClient();
  const configuredAccessToken = useAccessTokenSnapshot();
  const isGuest = configuredAccessToken === "";
  const tokenResolved = configuredAccessToken !== null;
  const hasOwnerAccess = Boolean(configuredAccessToken);
  const theme: PremiumThemeMode = PREMIUM_THEME;
  const [selection, setSelection] = useState<CapabilitySelection>({
    type: "GENERATION",
    configId: null,
    mode: "select",
  });
  const [rebuildDialog, setRebuildDialog] = useState<RebuildDialogState>(null);
  const [enablingTarget, setEnablingTarget] = useState<{ capability: CapabilityName; id: number } | null>(null);
  const [enableError, setEnableError] = useState<{ capability: CapabilityName; message: string } | null>(null);

  useEffect(() => {
    if (!enableError) return;
    const timer = window.setTimeout(() => setEnableError(null), 3000);
    return () => window.clearTimeout(timer);
  }, [enableError]);

  useEffect(() => {
    if (!isGuest) return;
    CAPABILITY_OPTIONS.forEach((option) => {
      void queryClient.cancelQueries({ queryKey: paramsQueryKey(option.value) });
      queryClient.removeQueries({ queryKey: paramsQueryKey(option.value) });
    });
  }, [isGuest, queryClient]);

  const generationQuery = useQuery({
    queryKey: capabilityQueryKey("GENERATION"),
    queryFn: () => apiClient.getAllCapabilityConfigs("GENERATION"),
    enabled: tokenResolved,
  });
  const embeddingQuery = useQuery({
    queryKey: capabilityQueryKey("EMBEDDING"),
    queryFn: () => apiClient.getAllCapabilityConfigs("EMBEDDING"),
    enabled: tokenResolved,
  });
  const rerankQuery = useQuery({
    queryKey: capabilityQueryKey("RERANK"),
    queryFn: () => apiClient.getAllCapabilityConfigs("RERANK"),
    enabled: tokenResolved,
  });
  const multiEmbeddingQuery = useQuery({
    queryKey: capabilityQueryKey("MULTI_EMBEDDING"),
    queryFn: () => apiClient.getAllCapabilityConfigs("MULTI_EMBEDDING"),
    enabled: tokenResolved,
  });
  const storageStatusQuery = useQuery({
    queryKey: ["settings", "storage"],
    queryFn: apiClient.getStorageConfig,
    enabled: tokenResolved,
  });

  const configsByCapability = useMemo<Record<CapabilityName, CapabilityConfig[]>>(
    () => ({
      GENERATION: generationQuery.data ?? [],
      EMBEDDING: embeddingQuery.data ?? [],
      RERANK: rerankQuery.data ?? [],
      MULTI_EMBEDDING: multiEmbeddingQuery.data ?? [],
    }),
    [embeddingQuery.data, generationQuery.data, multiEmbeddingQuery.data, rerankQuery.data],
  );

  const selectedType = selection.type;
  const selectedId = selection.configId;
  const configs = configsByCapability[selectedType];
  const selectedConfigsLoaded =
    selectedType === "GENERATION" ? generationQuery.isSuccess
    : selectedType === "EMBEDDING" ? embeddingQuery.isSuccess
    : selectedType === "RERANK" ? rerankQuery.isSuccess
    : multiEmbeddingQuery.isSuccess;
  const isAdding =
    selection.mode === "add" ||
    (selectedConfigsLoaded && configs.length === 0);
  const selectedConfig = useMemo(() => {
    if (isAdding) return null;
    return configs.find((config) => config.id === selectedId) ?? preferredConfig(configs);
  }, [configs, isAdding, selectedId]);

  const refreshCapabilityConfigs = useCallback(async (capability: CapabilityName) => {
    const affectedCapabilities = affectedCapabilitiesFor(capability);

    await Promise.all(
      affectedCapabilities.map((affectedCapability) =>
        queryClient.invalidateQueries({ queryKey: capabilityQueryKey(affectedCapability) }),
      ),
    );
  }, [queryClient]);

  const markCapabilityConfigEnabled = useCallback((capability: CapabilityName, id: number) => {
    const affectedCapabilities = affectedCapabilitiesFor(capability);

    affectedCapabilities.forEach((affectedCapability) => {
      queryClient.setQueryData<CapabilityConfig[]>(capabilityQueryKey(affectedCapability), (currentConfigs) => {
        if (!currentConfigs) return currentConfigs;
        return currentConfigs.map((config) => ({
          ...config,
          enabled: affectedCapability === capability ? config.id === id : false,
        }));
      });
    });
  }, [queryClient]);

  const enableMutation = useMutation({
    mutationFn: ({ capability, id }: { capability: CapabilityName; id: number }) => apiClient.selectCapabilityConfig(capability, id),
    onMutate: (variables) => {
      setEnablingTarget(variables);
      setEnableError(null);
    },
    onSuccess: (_, variables) => {
      markCapabilityConfigEnabled(variables.capability, variables.id);
      void refreshCapabilityConfigs(variables.capability);
    },
    onError: (error, variables) => {
      setEnableError({
        capability: variables.capability,
        message: getErrorMessage(error, "启用失败，请稍后重试"),
      });
    },
    onSettled: () => {
      setEnablingTarget(null);
    },
  });

  const indexStatusQuery = useQuery({
    queryKey: ["index", "status"],
    queryFn: () => apiClient.getIndexStatus(),
    retry: false,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      const status = query.state.data?.status;
      if (status === "INITIALIZING" || status === "REBUILDING") return 2000;
      if (status === "NOT_READY") return 5000;
      return 30000;
    },
  });

  const prepareRebuildMutation = useMutation({
    mutationFn: () => apiClient.prepareIndexRebuild(),
  });

  const confirmRebuildMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const refreshed = await queryClient.fetchQuery({
        queryKey: ["index", "status"],
        queryFn: () => apiClient.getIndexStatus(),
      });
      if (refreshed.pendingRebuild?.taskId !== taskId) {
        throw new Error("重建任务已被新的配置变更替换，请重新确认最新任务。");
      }
      const confirmed = await apiClient.confirmIndexRebuild(taskId);
      if (!confirmed) {
        throw new Error("重建任务已被新的配置变更替换，请重新确认最新任务。");
      }
      return confirmed;
    },
  });

  const retryIndexMutation = useMutation({
    mutationFn: () => apiClient.retryIndexCreate(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["index", "status"] }),
  });

  const hasEnabledEmbeddingConfig = useMemo(
    () =>
      configsByCapability.EMBEDDING.some((config) => config.enabled) ||
      configsByCapability.MULTI_EMBEDDING.some((config) => config.enabled),
    [configsByCapability],
  );

  const handleEnable = useCallback((capability: CapabilityName, id: number) => {
    if (embeddingSwitchAffects(capability) && hasEnabledEmbeddingConfig) {
      setRebuildDialog({ phase: "CONFIRM_SWITCH", capability, id });
      return;
    }
    enableMutation.mutate({ capability, id });
  }, [enableMutation, hasEnabledEmbeddingConfig]);

  const showRebuildConfirmation = useCallback((
    taskId: string,
    status?: SegmentIndexStatus,
  ) => {
    setRebuildDialog({
      phase: "CONFIRM_REBUILD",
      taskId,
      actualDim: status?.actualDim ?? undefined,
      expectedDim: status?.expectedDim ?? undefined,
      reason: status?.pendingRebuild?.reason,
    });
  }, []);

  const prepareRebuild = useCallback(async ({ manual = false }: { manual?: boolean } = {}) => {
    try {
      const taskId = await prepareRebuildMutation.mutateAsync();
      const refreshed = await indexStatusQuery.refetch();
      if (taskId) {
        showRebuildConfirmation(taskId, refreshed.data ?? indexStatusQuery.data);
        return;
      }
      if (!manual) {
        setRebuildDialog(null);
        return;
      }
      setRebuildDialog({
        phase: "ERROR",
        error: "当前无需重建，或索引状态暂不满足重建条件。",
      });
    } catch (error) {
      setRebuildDialog({
        phase: "ERROR",
        error: getErrorMessage(error, "准备重建失败"),
      });
    }
  }, [indexStatusQuery, prepareRebuildMutation, showRebuildConfirmation]);

  const confirmSwitch = useCallback(() => {
    if (rebuildDialog?.phase !== "CONFIRM_SWITCH") return;
    const { capability, id } = rebuildDialog;
    enableMutation.mutate(
      { capability, id },
      {
        onSuccess: async () => {
          if (embeddingSwitchAffects(capability)) {
            await prepareRebuild();
          } else {
            setRebuildDialog(null);
          }
        },
        onError: (error) => {
          setRebuildDialog({ phase: "ERROR", error: getErrorMessage(error, "启用失败") });
        },
      },
    );
  }, [rebuildDialog, enableMutation, prepareRebuild]);

  const confirmRebuild = useCallback(() => {
    if (rebuildDialog?.phase !== "CONFIRM_REBUILD") return;
    confirmRebuildMutation.mutate(rebuildDialog.taskId, {
      onSuccess: () => {
        setRebuildDialog(null);
        void queryClient.invalidateQueries({ queryKey: ["index", "status"] });
      },
      onError: (error) => {
        setRebuildDialog({ phase: "ERROR", error: getErrorMessage(error, "确认重建失败") });
      },
    });
  }, [rebuildDialog, confirmRebuildMutation, queryClient]);

  const enabledConfigsByCapability = useMemo(
    () => ({
      GENERATION: enabledConfig(configsByCapability.GENERATION),
      EMBEDDING: enabledConfig(configsByCapability.EMBEDDING),
      RERANK: enabledConfig(configsByCapability.RERANK),
      MULTI_EMBEDDING: enabledConfig(configsByCapability.MULTI_EMBEDDING),
    }),
    [configsByCapability],
  );
  return (
    <div className="premium-theme ask-premium-page settings-premium-page premium-no-ambient-glow min-h-screen overflow-x-hidden bg-[#f7f7f2] tracking-normal text-[#111315]" data-theme={theme} data-premium-theme={theme}>
      <div aria-hidden="true" className="ask-premium-grid-bg pointer-events-none fixed inset-0 bg-[linear-gradient(var(--premium-bg-grid)_1px,transparent_1px),linear-gradient(90deg,var(--premium-bg-grid)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />

      <div className="relative h-screen overflow-hidden p-0">
        <div className="ask-premium-shell grid h-screen min-h-0 overflow-hidden border-0 bg-white/70 shadow-none backdrop-blur-2xl lg:grid-cols-[60px_minmax(0,1fr)]">
          <PremiumRail />

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_1fr]">
            <header className="ask-premium-hero relative grid h-[112px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-b border-black/10 px-4 py-3 sm:px-5 lg:px-5">
              <div aria-hidden="true" className="ask-premium-watermark pointer-events-none absolute bottom-[-18px] right-4 text-[clamp(48px,9vw,132px)] font-black leading-[0.8] text-black/[0.05] dark:text-white/[0.045]">
                SETTINGS
              </div>
              <section className="premium-page-header-content relative z-10 flex min-w-0 flex-col justify-center gap-2">
                <div>
                  <p className="ask-premium-kicker ask-premium-mode-kicker mb-1.5 text-[10px] font-black">
                    SETTINGS / SYSTEM CONFIGURATION
                  </p>
                  <h1 className="max-w-[720px] text-[clamp(16px,2.4vw,34px)] font-black leading-none">
                    把模型、存储与访问令牌调成一条稳定链路。
                  </h1>
                </div>
              </section>
              <PremiumHeaderUtilities theme={theme} />
            </header>

            <main className="ask-premium-main settings-no-ambient-glow min-h-0 min-w-0 overflow-auto bg-[linear-gradient(90deg,rgba(255,255,255,0.82),rgba(255,255,255,0.4))] px-5 pb-4 pt-3">
              <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
                <CapabilitySelector
                  selectedType={selectedType}
                  configsByCapability={configsByCapability}
                  selectedId={selectedId}
                  isAdding={isAdding}
                  allowAdd={hasOwnerAccess}
                  onTypeChange={(type) => {
                    setSelection({ type, configId: null, mode: "select" });
                  }}
                  onSelect={(type, id) => {
                    setSelection({ type, configId: id, mode: "select" });
                  }}
                  onEnable={handleEnable}
                  enablingTarget={enablingTarget}
                  enableError={enableError}
                  onAdd={(type) => {
                    setSelection({ type, configId: null, mode: "add" });
                  }}
                />

                <section className="grid min-w-0 gap-3">
                  <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                    <ConfigPanel
                      key={`${selectedType}-${selectedConfig?.id ?? "new"}-${isAdding ? "new" : "edit"}-${hasOwnerAccess ? "owner" : "guest"}`}
                      capability={selectedType}
                      config={hasOwnerAccess ? selectedConfig : null}
                      isNew={hasOwnerAccess && isAdding}
                      restricted={!hasOwnerAccess}
                      restrictedMessage={configuredAccessToken == null ? "正在检查访问权限" : "访客状态无法查看"}
                      onSaved={(savedConfig) => {
                        setSelection({
                          type: selectedType,
                          configId: savedConfig.id,
                          mode: "select",
                        });
                      }}
                      onActiveEmbeddingUpdated={() => void prepareRebuild()}
                      onDeleted={() => {
                        setSelection({
                          type: selectedType,
                          configId: null,
                          mode: "select",
                        });
                      }}
                    />
                    <RuntimeStatusPanel
                      enabledConfigs={enabledConfigsByCapability}
                      configsByCapability={configsByCapability}
                      indexStatus={indexStatusQuery.data}
                      indexStatusLoading={indexStatusQuery.isPending}
                      indexStatusError={indexStatusQuery.isError}
                      onRefreshIndex={() => void indexStatusQuery.refetch()}
                      onRetryIndex={() => retryIndexMutation.mutate()}
                      onPrepareRebuild={() => void prepareRebuild({ manual: true })}
                      onConfirmPendingRebuild={(taskId) =>
                        showRebuildConfirmation(taskId, indexStatusQuery.data)}
                      storageConfigured={isGuest
                        ? Boolean(storageStatusQuery.data?.enabled)
                        : Boolean(storageStatusQuery.data?.endpoint && storageStatusQuery.data?.bucket)}
                      storageLoading={!tokenResolved || storageStatusQuery.isLoading}
                    />
                  </div>

                  <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                    <StoragePanel
                      restricted={!hasOwnerAccess}
                      restrictedMessage={configuredAccessToken == null ? "正在检查访问权限" : "访客状态无法查看"}
                    />
                    <SecurityPanel />
                  </div>
                </section>
              </div>
            </main>
          </div>
        </div>
      </div>

      {hasOwnerAccess && rebuildDialog != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[440px] rounded-[8px] border border-[var(--premium-line)] bg-[rgba(255,253,245,0.92)] p-4 shadow-[var(--premium-menu-shadow)] backdrop-blur-xl dark:bg-[var(--premium-elevated)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="settings-dialog-icon grid size-10 shrink-0 place-items-center rounded-[8px] bg-[var(--premium-ink)] text-white shadow-[0_14px_32px_rgba(17,19,21,0.16)]">
                  {rebuildDialog.phase === "ERROR" ? <AlertCircle size={19} /> : <AlertTriangle size={19} />}
                </span>
                <div className="min-w-0">
                  <h2 className="text-[clamp(18px,2vw,24px)] font-black leading-none text-[var(--premium-ink)]">
                    {rebuildDialog.phase === "CONFIRM_SWITCH" ? "确认切换 Embedding 模型"
                     : rebuildDialog.phase === "CONFIRM_REBUILD" ? "确认重建索引"
                     : "操作失败"}
                  </h2>
                  <p className="mt-1 text-xs font-black text-[var(--premium-muted)]">
                    {rebuildDialog.phase === "CONFIRM_SWITCH" ? "VECTOR INDEX REBUILD"
                     : rebuildDialog.phase === "CONFIRM_REBUILD" ? "DIMENSION MIGRATION"
                     : "ERROR"}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setRebuildDialog(null)} className="grid size-8 shrink-0 place-items-center rounded-[8px] text-[var(--premium-muted)] hover:bg-white/70 dark:hover:bg-[var(--premium-panel-muted)]" aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 rounded-[8px] border border-[rgba(49,88,255,0.16)] bg-[rgba(49,88,255,0.08)] p-3 text-[11px] font-black leading-[1.55] text-[var(--premium-ink-soft)]">
              {rebuildDialog.phase === "CONFIRM_SWITCH" ? (
                <p>切换 Embedding 或 Multi Embedding 模型将触发向量重建流程，期间系统不可用。</p>
              ) : rebuildDialog.phase === "CONFIRM_REBUILD" ? (
                <p>
                  {rebuildDialog.reason ??
                    `索引配置将从当前模型${rebuildDialog.actualDim != null ? `（${rebuildDialog.actualDim} 维）` : ""}迁移到目标模型${rebuildDialog.expectedDim != null ? `（${rebuildDialog.expectedDim} 维）` : ""}，期间检索功能暂不可用。`}
                </p>
              ) : (
                <p>{rebuildDialog.error ?? "发生未知错误"}</p>
              )}
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setRebuildDialog(null)} className={`${BUTTON_SECONDARY_CLASS} flex-1`}>
                取消
              </button>
              <button
                type="button"
                disabled={enableMutation.isPending || prepareRebuildMutation.isPending || confirmRebuildMutation.isPending}
              onClick={() => {
                if (rebuildDialog.phase === "CONFIRM_SWITCH") confirmSwitch();
                else if (rebuildDialog.phase === "CONFIRM_REBUILD") confirmRebuild();
                else setRebuildDialog(null);
              }}
                className={`${BUTTON_PRIMARY_CLASS} flex-1`}
              >
                {enableMutation.isPending || prepareRebuildMutation.isPending || confirmRebuildMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : null}
                {rebuildDialog.phase === "CONFIRM_SWITCH" ? "确定切换"
                 : rebuildDialog.phase === "CONFIRM_REBUILD" ? "确认重建"
                 : "关闭"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RestrictedPanelOverlay({ title, message }: { title: string; message: string }) {
  return (
    <div className="absolute inset-0 z-20 rounded-[8px] bg-[rgb(27,27,27)] p-3">
      <h2 className="relative z-10 text-[clamp(18px,2vw,24px)] font-black leading-none text-[#f4f7ec]">{title}</h2>
      <div className="absolute inset-x-3 bottom-3 top-[52px] grid place-items-center px-4">
        <div className="inline-flex max-w-full items-center justify-center gap-2.5 text-[rgba(244,247,236,0.58)]">
          <LockKeyhole className="shrink-0" size={16} strokeWidth={1.8} aria-hidden="true" />
          <p className="text-xs font-semibold leading-5">{message}</p>
        </div>
      </div>
    </div>
  );
}

function CapabilitySelector({
  selectedType,
  configsByCapability,
  selectedId,
  isAdding,
  allowAdd,
  onTypeChange,
  onSelect,
  onEnable,
  enablingTarget,
  enableError,
  onAdd,
}: {
  selectedType: CapabilityName;
  configsByCapability: Record<CapabilityName, CapabilityConfig[]>;
  selectedId: number | null;
  isAdding: boolean;
  allowAdd: boolean;
  onTypeChange: (type: CapabilityName) => void;
  onSelect: (type: CapabilityName, id: number) => void;
  onEnable: (capability: CapabilityName, id: number) => void;
  enablingTarget: { capability: CapabilityName; id: number } | null;
  enableError: { capability: CapabilityName; message: string } | null;
  onAdd: (type: CapabilityName) => void;
}) {
  return (
    <aside className={`${PANEL_CLASS} grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3`} aria-label="能力配置导航">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black text-[var(--premium-muted)]">MODEL CAPABILITIES</p>
      </div>

      <div className="grid min-h-0 grid-rows-4 gap-2.5">
        {CAPABILITY_OPTIONS.map((option) => {
          const configs = configsByCapability[option.value];
          const enabled = enabledConfig(configs);
          const active = option.value === selectedType;
          const defaultConfig = enabled ?? configs[0] ?? null;
          const selectedConfigId = active && isAdding ? ADD_CONFIG_VALUE : active && selectedId != null ? selectedId : defaultConfig?.id ?? "";
          const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? defaultConfig;
          const canEnable = Boolean(selectedConfig && !selectedConfig.enabled);
          const isCapabilityEnabling = enablingTarget?.capability === option.value;
          const isSelectedConfigEnabling = isCapabilityEnabling && enablingTarget?.id === selectedConfig?.id;
          const currentEnableError = enableError?.capability === option.value ? enableError.message : null;

          return (
            <article
              key={option.value}
              className={[
                "grid min-h-0 cursor-pointer content-between gap-2 rounded-[8px] border p-[10px] text-left transition hover:translate-x-[3px]",
                active
                  ? "border-[rgba(49,88,255,0.34)] bg-white/70"
                  : "border-[rgba(16,18,20,0.1)] bg-white/50 hover:border-[rgba(49,88,255,0.34)] hover:bg-white/70 dark:bg-[var(--premium-panel-muted)]",
              ].join(" ")}
              data-capability={option.value}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest(".settings-config-menu")) return;
                if (selectedConfig) {
                  onSelect(option.value, selectedConfig.id);
                } else {
                  onTypeChange(option.value);
                }
              }}
            >
              <button
                type="button"
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-left"
                aria-pressed={active}
              >
                <span className="settings-capability-icon grid size-[34px] place-items-center rounded-[8px] bg-[var(--premium-ink)] text-[11px] font-black text-white">
                  {option.code}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-xs font-black leading-tight text-[var(--premium-ink)]">{option.label}</strong>
                  <span className="block truncate text-xs text-[var(--premium-muted)]">{option.description}</span>
                </span>
                <span className="grid size-8 place-items-center" aria-label={enabled ? "已启用" : "未启用"} title={enabled ? "已启用" : "未启用"}>
                  <span className={enabled ? "size-2 rounded-full bg-[#89c777]" : "size-2 rounded-full bg-[var(--premium-muted)]/40"} />
                </span>
              </button>

              <div className="grid gap-1 text-[11px] font-black text-[var(--premium-ink-soft)]">
                <span>{option.modelLabel}</span>
                <CapabilityConfigPicker
                  configs={configs}
                  value={selectedConfigId}
                  ariaLabel={`选择 ${option.label} 模型`}
                  allowAdd={allowAdd}
                  onSelect={(value) => {
                    if (value === ADD_CONFIG_VALUE) {
                      onAdd(option.value);
                      return;
                    }
                    const id = Number(value);
                    if (Number.isFinite(id)) {
                      onSelect(option.value, id);
                    }
                  }}
                />
              </div>

              <div className="settings-current-enabled text-[11px] font-black text-[var(--premium-muted)]">
                当前启用 <strong className="text-[var(--premium-ink)]">{enabled?.modelName || enabled?.baseUrl || (configs.length > 0 ? "未启用" : "未配置")}</strong>
              </div>

              <button
                type="button"
                disabled={!selectedConfig || !canEnable || isCapabilityEnabling}
                data-enable-state={isSelectedConfigEnabling ? "loading" : canEnable ? "available" : selectedConfig ? "current" : "empty"}
                onClick={() => {
                  if (selectedConfig) {
                    onSelect(option.value, selectedConfig.id);
                    onEnable(option.value, selectedConfig.id);
                  }
                }}
                className="settings-enable-button inline-flex min-h-[30px] w-full items-center justify-center rounded-full border border-[rgba(49,88,255,0.24)] bg-[var(--premium-ink)] px-3 text-[11px] font-black text-white transition hover:-translate-y-0.5 hover:bg-[var(--premium-blue)] disabled:border-[rgba(66,107,9,0.24)] disabled:bg-[rgba(187,255,102,0.22)] disabled:text-[#426b09] disabled:opacity-100"
              >
                <span className={ENABLE_BUTTON_LABEL_CLASS}>
                  {isSelectedConfigEnabling ? "启用中..." : canEnable ? "启用选中模型" : selectedConfig ? "当前已启用" : "暂无可启用模型"}
                </span>
              </button>
              {currentEnableError ? (
                <div className="rounded-[8px] bg-rose-50 px-2.5 py-2 text-[11px] font-black leading-[1.45] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {currentEnableError}
                </div>
              ) : null}
            </article>
          );
        })}

      </div>
    </aside>
  );
}

function CapabilityConfigPicker({
  configs,
  value,
  ariaLabel,
  onSelect,
  allowAdd = true,
}: {
  configs: CapabilityConfig[];
  value: number | string;
  ariaLabel: string;
  onSelect: (value: string) => void;
  allowAdd?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedValue = String(value);
  const selectedConfig = configs.find((config) => String(config.id) === selectedValue);
  const selectedLabel = selectedValue === ADD_CONFIG_VALUE
    ? "添加配置"
    : selectedConfig
      ? `${selectedConfig.modelName || selectedConfig.baseUrl}${selectedConfig.enabled ? " · 已启用" : ""}`
      : "暂无配置";

  const handleSelect = (nextValue: string) => {
    onSelect(nextValue);
    setIsOpen(false);
  };

  return (
    <div
      className="settings-config-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="settings-config-select"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDown size={15} className="settings-config-chevron" />
      </button>

      {isOpen ? (
        <div className="settings-config-menu" role="listbox">
          {configs.length === 0 ? (
            <div className="settings-config-empty">暂无配置</div>
          ) : (
            configs.map((config) => {
              const optionValue = String(config.id);
              const selected = optionValue === selectedValue;
              return (
                <button
                  key={config.id}
                  type="button"
                  onClick={() => handleSelect(optionValue)}
                  className={["settings-config-option", selected ? "is-selected" : ""].join(" ")}
                  role="option"
                  aria-selected={selected}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {config.modelName || config.baseUrl}
                    {config.enabled ? " · 已启用" : ""}
                  </span>
                  {selected ? <Check size={12} /> : null}
                </button>
              );
            })
          )}
          {allowAdd ? (
            <button
              type="button"
              onClick={() => handleSelect(ADD_CONFIG_VALUE)}
              className={[
                "settings-config-option settings-config-add",
                selectedValue === ADD_CONFIG_VALUE ? "is-selected" : "",
              ].join(" ")}
              role="option"
              aria-selected={selectedValue === ADD_CONFIG_VALUE}
            >
              <span className="min-w-0 flex-1 truncate">+ 添加配置</span>
              {selectedValue === ADD_CONFIG_VALUE ? <Check size={12} /> : null}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConfigPanel({
  capability,
  config,
  isNew,
  restricted,
  restrictedMessage,
  onSaved,
  onActiveEmbeddingUpdated,
  onDeleted,
}: {
  capability: CapabilityName;
  config: CapabilityConfig | null;
  isNew: boolean;
  restricted: boolean;
  restrictedMessage: string;
  onSaved: (savedConfig: CapabilityConfig) => void;
  onActiveEmbeddingUpdated: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const option = CAPABILITY_OPTIONS.find((item) => item.value === capability) ?? CAPABILITY_OPTIONS[0];
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<CapabilityConnectionTestResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingProfileUpdateSave, setPendingProfileUpdateSave] =
    useState<CapabilityConfigSaveVariables | null>(null);

  const paramsQuery = useQuery({
    queryKey: paramsQueryKey(capability),
    queryFn: () => apiClient.getCapabilityParams(capability),
    enabled: !restricted,
  });
  const paramItems = paramsQuery.data?.params ?? EMPTY_PARAMS;
  const requiresVectorDimension = embeddingSwitchAffects(capability);
  const vectorDimensionParam = paramItems.find(isVectorDimensionParam);

  useEffect(() => {
    if (!testResult) return;
    const timer = window.setTimeout(() => setTestResult(null), 3000);
    return () => window.clearTimeout(timer);
  }, [testResult]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (isNew || !config) {
        setBaseUrl("");
        setApiKey("");
        setModelName("");
        setExtra({});
        setTestResult(null);
        setValidationError(null);
        setDeleteNotice(null);
        setDeleteConfirmOpen(false);
        setPendingProfileUpdateSave(null);
        return;
      }
      setBaseUrl(config.baseUrl ?? "");
      setApiKey("");
      setModelName(config.modelName ?? "");
      setExtra(fromExtraConfig(config.extraConfig ?? {}, paramItems));
      setTestResult(null);
      setValidationError(null);
      setDeleteNotice(null);
      setDeleteConfirmOpen(false);
      setPendingProfileUpdateSave(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [capability, config, isNew, paramItems]);

  const clearFeedback = () => {
    setSaved(false);
    setTestResult(null);
    setValidationError(null);
    setDeleteNotice(null);
  };

  const getValidationError = () => {
    if (!requiresVectorDimension) return null;
    if (paramsQuery.isLoading) return "向量维度参数仍在加载，请稍后重试";
    if (paramsQuery.isError) return "向量维度参数加载失败，请刷新后重试";
    if (!vectorDimensionParam) return "未找到向量维度参数，请刷新后重试";

    const value = extra[vectorDimensionParam.key]?.trim() ?? "";
    if (!value) return "向量维度为必填项";
    if (!/^\d+$/.test(value) || Number(value) <= 0) return "向量维度必须为正整数";
    return null;
  };

  const currentCapabilityConfig = useMemo<CapabilityConfigUpdateRequest>(() => ({
    baseUrl: baseUrl.trim(),
    modelName: modelName.trim() || undefined,
    extraConfig: toExtraConfig(extra, paramItems),
  }), [baseUrl, extra, modelName, paramItems]);

  const savedConfigIdForTest = config && !isNew && !apiKey.trim() ? config.id : undefined;
  const canSave = baseUrl.trim().length > 0;
  const canTest = canSave && (apiKey.trim().length > 0 || savedConfigIdForTest != null);

  const saveRequiresRebuild = useCallback((variables: CapabilityConfigSaveVariables) =>
    !variables.creating
      && Boolean(variables.previousConfig?.enabled)
      && embeddingProfileInputChanged(capability, variables.previousConfig, variables.body, paramItems),
  [capability, paramItems]);

  const saveMutation = useMutation({
    mutationFn: ({ body, previousConfig, creating }: CapabilityConfigSaveVariables) => {
      if (creating || !previousConfig) {
        return apiClient.createCapabilityConfig(capability, body);
      }
      return apiClient.updateCapabilityConfig(capability, previousConfig.id, body);
    },
    onSuccess: async (savedConfig, variables) => {
      const shouldPrepareRebuild = saveRequiresRebuild(variables);
      setApiKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      await queryClient.invalidateQueries({ queryKey: capabilityQueryKey(capability) });
      onSaved(savedConfig);
      if (shouldPrepareRebuild) {
        onActiveEmbeddingUpdated();
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (target: { capability: CapabilityName; id: number }) =>
      apiClient.deleteCapabilityConfig(target.capability, target.id),
    onSuccess: async (_, target) => {
      setDeleteConfirmOpen(false);
      setApiKey("");
      setSaved(false);
      setTestResult(null);
      setDeleteNotice("删除成功，配置已移除");
      queryClient.setQueryData<CapabilityConfig[]>(capabilityQueryKey(target.capability), (currentConfigs) =>
        currentConfigs?.filter((item) => item.id !== target.id) ?? currentConfigs,
      );
      onDeleted();

      const affectedCapabilities = affectedCapabilitiesFor(target.capability);
      await Promise.all(
        affectedCapabilities.map((affectedCapability) =>
          queryClient.invalidateQueries({ queryKey: capabilityQueryKey(affectedCapability) }),
        ),
      );
    },
  });

  const handleDelete = () => {
    if (!config || isNew) return;
    deleteMutation.mutate({ capability, id: config.id });
  };

  const testMutation = useMutation({
    mutationFn: () => {
      const body: CapabilityConfigUpdateRequest = { ...currentCapabilityConfig };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      return apiClient.testConnection({
        capability,
        ...body,
        configId: savedConfigIdForTest,
      });
    },
    onMutate: () => setTestResult(null),
    onSuccess: (result) => setTestResult(result),
    onError: (error) => {
      setTestResult({
        success: false,
        latencyMs: 0,
        message: getErrorMessage(error, "连接失败"),
      });
    },
  });

  const handleSave = () => {
    const error = getValidationError();
    if (error) {
      setValidationError(error);
      setParamsExpanded(true);
      return;
    }
    setValidationError(null);
    const body: CapabilityConfigUpdateRequest = { ...currentCapabilityConfig };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    const variables: CapabilityConfigSaveVariables = {
      body,
      previousConfig: config,
      creating: isNew || !config,
    };
    if (saveRequiresRebuild(variables)) {
      setPendingProfileUpdateSave(variables);
      return;
    }
    saveMutation.mutate(variables);
  };

  const handleConfirmProfileUpdate = () => {
    if (!pendingProfileUpdateSave) return;
    const variables = pendingProfileUpdateSave;
    setPendingProfileUpdateSave(null);
    saveMutation.mutate(variables);
  };

  const handleTest = () => {
    const error = getValidationError();
    if (error) {
      setValidationError(error);
      setParamsExpanded(true);
      return;
    }
    setValidationError(null);
    testMutation.mutate();
  };

  return (
    <article className={`${PANEL_CLASS} relative min-w-0`} aria-label="模型配置">
      {restricted ? <RestrictedPanelOverlay title="模型配置" message={restrictedMessage} /> : null}
      <div inert={restricted ? true : undefined} aria-hidden={restricted || undefined}>
      <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[clamp(18px,2vw,24px)] font-black leading-none text-[var(--premium-ink)]">{option.label} 配置</h2>
          <p className="mt-1 truncate text-[11px] leading-normal text-[var(--premium-muted)]">
            当前使用 {modelName || config?.modelName || DEFAULT_MODEL_BY_CAPABILITY[capability]}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ResultPill result={testResult} />
          {saved ? <span className={SUCCESS_PILL_CLASS}>保存成功</span> : null}
        </div>
      </div>

      {(capability === "MULTI_EMBEDDING" || capability === "RERANK") ? (
        <div className={INFO_NOTICE_CLASS}>
          <Info size={16} className="shrink-0 text-current" />
          当前仅支持百炼平台
        </div>
      ) : null}

      <div className={FORM_GRID_CLASS}>
        <label className={FORM_FIELD_CLASS}>
          <span>Base URL</span>
          <input
            className={FIELD_CLASS}
            value={baseUrl}
            placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            onChange={(event) => {
              setBaseUrl(event.target.value);
              clearFeedback();
            }}
          />
        </label>
        <div className={`${FORM_GRID_CLASS} sm:grid-cols-2`}>
          <label className={FORM_FIELD_CLASS}>
            <span>API Key</span>
            <input
              className={FIELD_CLASS}
              type="password"
              value={apiKey}
              placeholder={!isNew && config?.apiKeyMasked ? `(已保存: ${config.apiKeyMasked})` : "sk-..."}
              onChange={(event) => {
                setApiKey(event.target.value);
                clearFeedback();
              }}
            />
          </label>
          <label className={FORM_FIELD_CLASS}>
            <span>Model</span>
            <input
              className={FIELD_CLASS}
              value={modelName}
              placeholder={DEFAULT_MODEL_BY_CAPABILITY[capability]}
              onChange={(event) => {
                setModelName(event.target.value);
                clearFeedback();
              }}
            />
          </label>
        </div>

        <div className="settings-advanced-config">
          <button
            type="button"
            onClick={() => setParamsExpanded((value) => !value)}
            className="settings-advanced-summary premium-focusable"
            aria-expanded={paramsExpanded}
          >
            <span>参数配置</span>
            <span aria-hidden="true">{paramsExpanded ? "-" : "+"}</span>
          </button>
          {paramsExpanded ? (
            <div className="mt-3">
              {paramsQuery.isLoading ? <p className="text-[11px] leading-normal text-[var(--premium-muted)]">加载中...</p> : null}
              {!paramsQuery.isLoading && paramItems.length === 0 ? <p className="text-[11px] leading-normal text-[var(--premium-muted)]">无可选参数</p> : null}
              {paramItems.length > 0 ? (
                <div className={`${FORM_GRID_CLASS} sm:grid-cols-2`}>
                  {paramItems.map((param) => {
                    const isRequiredDimension = requiresVectorDimension && isVectorDimensionParam(param);
                    return (
                      <label key={param.key} className={`${FORM_FIELD_CLASS} settings-param-field`}>
                        <span>
                          {splitParenLabel(param.label).map((part) => <span key={part} className="mr-1">{part}</span>)}
                          {isRequiredDimension ? <span className="text-rose-600 dark:text-rose-300" aria-hidden="true">*</span> : null}
                        </span>
                        <input
                          className={FIELD_CLASS}
                          value={extra[param.key] ?? ""}
                          placeholder={param.key}
                          type={isRequiredDimension ? "number" : "text"}
                          min={isRequiredDimension ? 1 : undefined}
                          step={isRequiredDimension ? 1 : undefined}
                          required={isRequiredDimension}
                          aria-required={isRequiredDimension || undefined}
                          aria-invalid={isRequiredDimension && Boolean(validationError) ? true : undefined}
                          onChange={(event) => {
                            setExtra((previous) => ({ ...previous, [param.key]: event.target.value }));
                            clearFeedback();
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {validationError ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-[11px] font-black leading-[1.55] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          {validationError}
        </div>
      ) : null}
      {deleteNotice ? <div className="mt-4"><PendingNotice message={deleteNotice} /></div> : null}
      {saveMutation.error ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-[11px] font-black leading-[1.55] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          保存失败：{getErrorMessage(saveMutation.error, "请稍后重试")}
        </div>
      ) : null}
      {deleteMutation.error ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-[11px] font-black leading-[1.55] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          删除失败：{getErrorMessage(deleteMutation.error, "请稍后重试")}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!canSave || saveMutation.isPending || deleteMutation.isPending} onClick={handleSave} className={BUTTON_PRIMARY_CLASS}>
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          <span className={ACTION_BUTTON_LABEL_CLASS}>{saveMutation.isPending ? "保存中..." : "保存"}</span>
        </button>
        <button type="button" disabled={isNew || !config || deleteMutation.isPending || saveMutation.isPending} onClick={() => setDeleteConfirmOpen(true)} className={BUTTON_SECONDARY_CLASS}>
          {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          <span className={ACTION_BUTTON_LABEL_CLASS}>{deleteMutation.isPending ? "删除中..." : "删除"}</span>
        </button>
        <button type="button" disabled={!canTest || testMutation.isPending || deleteMutation.isPending} onClick={handleTest} className={BUTTON_SECONDARY_CLASS}>
          {testMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          <span className={ACTION_BUTTON_LABEL_CLASS}>{testMutation.isPending ? "测试中..." : "测试连接"}</span>
        </button>
      </div>
      {pendingProfileUpdateSave ? (
        <ConfirmDialog
          title="确认更新向量模型配置？"
          description="本次更新会修改当前启用的 Embedding 配置，保存后需要重建索引；重建期间系统不可用。确认提交更新吗？"
          confirmLabel="确认更新"
          pending={saveMutation.isPending}
          onCancel={() => setPendingProfileUpdateSave(null)}
          onConfirm={handleConfirmProfileUpdate}
        />
      ) : null}
      {deleteConfirmOpen ? (
        <ConfirmDialog
          title="删除配置？"
          description="删除后将从列表移除。"
          confirmLabel="删除"
          pending={deleteMutation.isPending}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={handleDelete}
        />
      ) : null}
      </div>
    </article>
  );
}

function RuntimeStatusPanel({
  enabledConfigs,
  configsByCapability,
  indexStatus,
  indexStatusLoading,
  indexStatusError,
  onRefreshIndex,
  onRetryIndex,
  onPrepareRebuild,
  onConfirmPendingRebuild,
  storageConfigured,
  storageLoading,
}: {
  enabledConfigs: Record<CapabilityName, CapabilityConfig | null>;
  configsByCapability: Record<CapabilityName, CapabilityConfig[]>;
  indexStatus?: SegmentIndexStatus;
  indexStatusLoading: boolean;
  indexStatusError: boolean;
  onRefreshIndex: () => void;
  onRetryIndex: () => void;
  onPrepareRebuild: () => void;
  onConfirmPendingRebuild: (taskId: string) => void;
  storageConfigured: boolean;
  storageLoading: boolean;
}) {
  const token = useAccessTokenSnapshot();
  const enabledCount = Object.values(enabledConfigs).filter(Boolean).length;
  const tokenStatus = token == null ? "检查中" : token ? "已启用" : "访客";
  const compatibilityIssue = indexStatus ? getIndexCompatibilityIssue(indexStatus) : null;
  const rebuildFailed = indexStatus ? hasIndexRebuildFailed(indexStatus) : false;
  const indexUnavailable =
    indexStatus?.status === "READY" && (!indexStatus.readable || !indexStatus.writable);
  const indexStatusLabel = indexStatusError
    ? "未知"
    : indexStatusLoading || !indexStatus
      ? "检查中"
      : indexStatus.status === "INITIALIZING"
        ? "初始化中"
        : indexStatus.status === "REBUILDING"
          ? "重建中"
          : indexStatus.status === "NOT_READY"
            ? indexStatus.lastError ? "初始化失败" : "未就绪"
            : rebuildFailed
              ? "重建失败"
              : indexStatus.pendingRebuild
                ? "待确认"
                : compatibilityIssue === "DIMENSION_AND_PROFILE"
                  ? "模型与维度不匹配"
                  : compatibilityIssue === "DIMENSION"
                    ? "维度不匹配"
                    : compatibilityIssue === "PROFILE"
                      ? "模型配置不匹配"
                      : indexUnavailable
                        ? "暂不可用"
                        : "已就绪";
  const indexStatusHasError =
    indexStatusError ||
    indexStatus?.status === "NOT_READY" ||
    rebuildFailed ||
    Boolean(compatibilityIssue) ||
    indexUnavailable;
  const rebuildPhaseLabel =
    indexStatus?.rebuildProgress?.phase === "PREPARING"
      ? "准备重建中"
      : indexStatus?.rebuildProgress?.phase === "MIGRATING"
      ? "迁移数据中"
      : indexStatus?.rebuildProgress?.phase === "SWITCHING_ALIAS"
        ? "切换索引中"
        : indexStatus?.rebuildProgress?.phase === "COMPLETED"
          ? "重建完成"
          : indexStatus?.rebuildProgress?.phase === "FAILED"
            ? "重建失败"
            : null;

  return (
    <article className={`${PANEL_CLASS} grid content-start gap-3`} aria-label="运行状态">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[clamp(18px,2vw,24px)] font-black leading-none text-[var(--premium-ink)]">运行状态</h2>
          <p className="mt-1 text-[11px] leading-normal text-[var(--premium-muted)]">查看当前模型、存储与访问令牌状态</p>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="settings-status-card grid gap-2 rounded-[8px] border border-[rgba(16,18,20,0.1)] bg-white/50 p-2.5 dark:bg-[var(--premium-panel-muted)]">
          <div className="flex items-center justify-between gap-3 text-xs font-black leading-normal text-[var(--premium-ink-soft)]">
            <span>模型启用状态</span>
            <strong className="text-[#89c777]" data-status="enabled">{enabledCount}/4 已启用</strong>
          </div>
          <div className="grid gap-2">
            {CAPABILITY_OPTIONS.map((option) => {
              const enabledConfig = enabledConfigs[option.value];
              const configured = configsByCapability[option.value].length > 0;
              const enabled = Boolean(enabledConfig);
              const statusLabel = enabled
                ? enabledConfig?.modelName || enabledConfig?.baseUrl
                : configured
                  ? "未启用"
                  : "未配置";
              const rowStatusClass = enabled
                ? "bg-[rgba(137,199,119,0.14)]"
                : configured
                  ? "bg-[rgba(143,150,157,0.14)] dark:bg-white/10"
                  : "bg-white/65 dark:bg-white/10";
              const statusClass = enabled ? "text-[#89c777]" : "text-[var(--premium-muted)]";
              return (
                <div
                  key={option.value}
                  className={[
                    "settings-status-row flex items-center justify-between gap-3 rounded-[8px] p-2 text-xs font-black",
                    rowStatusClass,
                  ].join(" ")}
                  data-status={enabled ? "enabled" : configured ? "disabled" : "empty"}
                >
                  <span className="shrink-0 text-[var(--premium-muted)]">{option.label}</span>
                  <strong className={["min-w-0 text-right [overflow-wrap:anywhere]", statusClass].join(" ")}>
                    {statusLabel}
                  </strong>
                </div>
              );
            })}
         </div>
       </div>

        <div className="settings-status-card grid gap-2 rounded-[8px] border border-[rgba(16,18,20,0.1)] bg-white/50 p-2.5 dark:bg-[var(--premium-panel-muted)]">
          <div className="flex items-center justify-between gap-3 text-xs font-black leading-normal text-[var(--premium-ink-soft)]">
            <span>索引状态</span>
            <div className="flex items-center gap-2">
              <strong className={
                indexStatusHasError ? "text-rose-600 dark:text-rose-300"
                : indexStatusLoading || !indexStatus ? "text-[var(--premium-muted)]"
                : indexStatus.status === "REBUILDING" || indexStatus.status === "INITIALIZING" ? "text-[var(--premium-blue)]"
                : indexStatus.pendingRebuild ? "text-amber-600 dark:text-amber-300"
                : "text-[#89c777]"
              } data-status={
                indexStatusHasError ? "error"
                : indexStatusLoading || !indexStatus ? "muted"
                : indexStatusLabel === "已就绪" ? "success"
                : undefined
              }>
                {indexStatusLabel}
              </strong>
              {indexStatusError ? (
                <button type="button" onClick={onRefreshIndex} className={STATUS_ACTION_CLASS}>
                  重新检查
                </button>
              ) : null}
              {indexStatus?.status === "NOT_READY" && indexStatus.lastError ? (
                <button type="button" onClick={onRetryIndex} className={STATUS_ACTION_CLASS}>
                  重试
                </button>
              ) : null}
              {indexStatus?.status === "READY" && indexStatus.pendingRebuild ? (
                <button
                  type="button"
                  onClick={() => onConfirmPendingRebuild(indexStatus.pendingRebuild!.taskId)}
                  className={STATUS_ACTION_CLASS}
                >
                  {rebuildFailed ? "重试重建" : "确认重建"}
                </button>
              ) : null}
              {indexStatus?.status === "READY" && !indexStatus.pendingRebuild && compatibilityIssue ? (
                <button type="button" onClick={onPrepareRebuild} className={STATUS_ACTION_CLASS}>
                  重建
                </button>
              ) : null}
            </div>
          </div>
          {indexStatus?.status === "REBUILDING" && indexStatus.rebuildProgress ? (
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-[#343a36]" aria-hidden="true">
                <span
                  className="block h-full rounded-full bg-[linear-gradient(90deg,var(--premium-blue),var(--premium-accent))] shadow-[0_0_18px_rgba(49,88,255,0.28)]"
                  style={{ width: `${indexStatus.rebuildProgress.total > 0 ? Math.round((indexStatus.rebuildProgress.migrated / indexStatus.rebuildProgress.total) * 100) : 0}%` }}
                />
              </div>
              <span className="text-[10px] font-black text-[var(--premium-muted)]">
                {rebuildPhaseLabel ? `${rebuildPhaseLabel} · ` : ""}
                {indexStatus.rebuildProgress.migrated}/{indexStatus.rebuildProgress.total}
              </span>
            </div>
          ) : null}
          {rebuildFailed && indexStatus?.lastError ? (
            <p className="text-[10px] font-bold leading-normal text-rose-600 dark:text-rose-300">
              {indexStatus.lastError}
            </p>
          ) : indexStatus?.pendingRebuild?.reason ? (
            <p className="text-[10px] font-bold leading-normal text-[var(--premium-muted)]">
              {indexStatus.pendingRebuild.reason}
            </p>
          ) : null}
        </div>

        <div className="settings-status-card rounded-[8px] border border-[rgba(16,18,20,0.1)] bg-white/50 p-2.5 dark:bg-[var(--premium-panel-muted)]">
          <div className="flex items-center justify-between gap-3 text-xs font-black leading-normal text-[var(--premium-ink-soft)]">
            <span>存储配置状态</span>
            <strong
              className={storageConfigured && !storageLoading ? "text-[#89c777]" : "text-[var(--premium-muted)]"}
              data-status={storageConfigured && !storageLoading ? "success" : "muted"}
            >
              {storageLoading ? "检查中" : storageConfigured ? "已配置" : "未配置"}
            </strong>
          </div>
        </div>

        <div className="settings-status-card rounded-[8px] border border-[rgba(16,18,20,0.1)] bg-white/50 p-2.5 dark:bg-[var(--premium-panel-muted)]">
          <div className="flex items-center justify-between gap-3 text-xs font-black leading-normal text-[var(--premium-ink-soft)]">
            <span>Token 配置状态</span>
            <strong
              className={token == null ? "text-[var(--premium-muted)]" : "text-[#89c777]"}
              data-status={token == null ? "muted" : "success"}
            >
              {tokenStatus}
            </strong>
          </div>
        </div>
      </div>
    </article>
  );
}

function StoragePanel({
  restricted,
  restrictedMessage,
}: {
  restricted: boolean;
  restrictedMessage: string;
}) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["settings", "storage"],
    queryFn: apiClient.getStorageConfig,
    enabled: !restricted,
  });

  const [endpoint, setEndpoint] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [prefix, setPrefix] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<StorageConnectionTestResult | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (configQuery.data && !initialized.current) {
      setEndpoint(configQuery.data.endpoint ?? "");
      setBucket(configQuery.data.bucket ?? "");
      setRegion(configQuery.data.region ?? "");
      setPrefix(configQuery.data.prefix ?? "");
      setRoleArn(configQuery.data.roleArn ?? "");
      initialized.current = true;
    }
  }, [configQuery.data]);

  useEffect(() => {
    if (!testResult) return;
    const timer = window.setTimeout(() => setTestResult(null), 3000);
    return () => window.clearTimeout(timer);
  }, [testResult]);

  const clearFeedback = () => {
    setSaved(false);
    setTestResult(null);
    setDeleteNotice(null);
    setDeleteError(null);
    setDeleteConfirmOpen(false);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: StorageConfigUpdateRequest = {
        endpoint: endpoint.trim(),
        bucket: bucket.trim(),
        region: region.trim() || undefined,
        prefix: prefix.trim() || undefined,
        roleArn: roleArn.trim() || undefined,
      };
      if (accessKey.trim()) body.accessKey = accessKey.trim();
      if (secretKey.trim()) body.secretKey = secretKey.trim();
      return apiClient.updateStorageConfig(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "storage"] });
      setAccessKey("");
      setSecretKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    },
  });

  const currentStorageTestConfig = useMemo(() => ({
    endpoint: endpoint.trim(),
    bucket: bucket.trim(),
  }), [bucket, endpoint]);

  const savedStorageTestConfig = useMemo(() => {
    if (!configQuery.data) return null;
    return {
      endpoint: configQuery.data.endpoint?.trim() ?? "",
      bucket: configQuery.data.bucket?.trim() ?? "",
    };
  }, [configQuery.data]);

  const hasUnsavedStorageTestChanges = !savedStorageTestConfig || (
    currentStorageTestConfig.endpoint !== savedStorageTestConfig.endpoint ||
    currentStorageTestConfig.bucket !== savedStorageTestConfig.bucket
  );
  const shouldUseSavedStorageConfig = Boolean(configQuery.data && !hasUnsavedStorageTestChanges && !accessKey.trim() && !secretKey.trim());
  const canSave = Boolean(endpoint.trim() && bucket.trim());
  const canTest = canSave && ((accessKey.trim() && secretKey.trim()) || shouldUseSavedStorageConfig);

  const testMutation = useMutation({
    mutationFn: () => apiClient.testStorage({
      endpoint: endpoint.trim(),
      accessKey: accessKey.trim() || undefined,
      secretKey: secretKey.trim() || undefined,
      bucket: bucket.trim(),
      configId: shouldUseSavedStorageConfig ? configQuery.data?.id : undefined,
    }),
    onMutate: () => setTestResult(null),
    onSuccess: (result) => setTestResult(result),
    onError: (error) => {
      setTestResult({
        success: false,
        latencyMs: 0,
        message: getErrorMessage(error, "连接失败"),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteStorageConfig(id),
    onMutate: () => {
      setDeleteNotice(null);
      setDeleteError(null);
    },
    onSuccess: async () => {
      setDeleteConfirmOpen(false);
      setEndpoint("");
      setAccessKey("");
      setSecretKey("");
      setBucket("");
      setRegion("");
      setPrefix("");
      setRoleArn("");
      setSaved(false);
      setTestResult(null);
      setDeleteNotice("删除成功，存储配置已归档");
      setDeleteError(null);
      initialized.current = false;
      await queryClient.invalidateQueries({ queryKey: ["settings", "storage"] });
    },
    onError: (error) => {
      setDeleteError(getErrorMessage(error, "请稍后重试"));
    },
  });

  useEffect(() => {
    if (!deleteNotice && !deleteError) return;
    const timer = window.setTimeout(() => {
      setDeleteNotice(null);
      setDeleteError(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [deleteError, deleteNotice]);

  const handleDelete = () => {
    const id = configQuery.data?.id;
    if (!id) return;
    deleteMutation.mutate(id);
  };

  return (
    <article className={`${PANEL_CLASS} relative min-w-0`} aria-label="存储设置">
      {restricted ? <RestrictedPanelOverlay title="存储设置" message={restrictedMessage} /> : null}
      <div inert={restricted ? true : undefined} aria-hidden={restricted || undefined}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[clamp(18px,2vw,24px)] font-black leading-none text-[var(--premium-ink)]">存储设置</h2>
          <p className="mt-1 text-[11px] leading-normal text-[var(--premium-muted)]">配置对象存储的连接参数</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ResultPill result={testResult} />
          {saved ? <span className={SUCCESS_PILL_CLASS}>保存成功</span> : null}
        </div>
      </div>

      <div className={INFO_NOTICE_CLASS}>
        <Info size={16} className="shrink-0 text-current" />
        当前仅支持阿里云 OSS
      </div>

      <div className={FORM_GRID_CLASS}>
        <label className={FORM_FIELD_CLASS}>
          <span>Endpoint</span>
          <input className={FIELD_CLASS} value={endpoint} placeholder="https://oss-cn-hangzhou.aliyuncs.com" onChange={(event) => { setEndpoint(event.target.value); clearFeedback(); }} />
        </label>
        <div className={`${FORM_GRID_CLASS} sm:grid-cols-2`}>
          <label className={FORM_FIELD_CLASS}>
            <span>Access Key</span>
            <input className={FIELD_CLASS} type="password" value={accessKey} placeholder={configQuery.data?.accessKeyMasked ? `(已保存: ${configQuery.data.accessKeyMasked})` : ""} onChange={(event) => { setAccessKey(event.target.value); clearFeedback(); }} />
          </label>
          <label className={FORM_FIELD_CLASS}>
            <span>Secret Key</span>
            <input className={FIELD_CLASS} type="password" value={secretKey} placeholder={configQuery.data?.secretKeyMasked ? `(已保存: ${configQuery.data.secretKeyMasked})` : ""} onChange={(event) => { setSecretKey(event.target.value); clearFeedback(); }} />
          </label>
        </div>
        <div className={`${FORM_GRID_CLASS} sm:grid-cols-3`}>
          <label className={FORM_FIELD_CLASS}>
            <span>Bucket</span>
            <input className={FIELD_CLASS} value={bucket} placeholder="anchr-dev" onChange={(event) => { setBucket(event.target.value); clearFeedback(); }} />
          </label>
          <label className={FORM_FIELD_CLASS}>
            <span>Region</span>
            <input className={FIELD_CLASS} value={region} placeholder="cn-hangzhou" onChange={(event) => { setRegion(event.target.value); clearFeedback(); }} />
          </label>
          <label className={FORM_FIELD_CLASS}>
            <span>Prefix</span>
            <input className={FIELD_CLASS} value={prefix} placeholder="anchr-dev/" onChange={(event) => { setPrefix(event.target.value); clearFeedback(); }} />
          </label>
        </div>
        <label className={FORM_FIELD_CLASS}>
          <span>Role ARN</span>
          <input className={FIELD_CLASS} value={roleArn} placeholder="acs:ram::..." onChange={(event) => { setRoleArn(event.target.value); clearFeedback(); }} />
        </label>
      </div>

      {deleteNotice ? <div className="mt-4"><PendingNotice message={deleteNotice} /></div> : null}
      {saveMutation.error ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-[11px] font-black leading-[1.55] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          保存失败：{getErrorMessage(saveMutation.error, "请稍后重试")}
        </div>
      ) : null}
      {deleteError ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-[11px] font-black leading-[1.55] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          删除失败：{deleteError}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!canSave || saveMutation.isPending || deleteMutation.isPending} onClick={() => saveMutation.mutate()} className={BUTTON_PRIMARY_CLASS}>
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          <span className={ACTION_BUTTON_LABEL_CLASS}>{saveMutation.isPending ? "保存中..." : "保存"}</span>
        </button>
        <button type="button" disabled={!configQuery.data?.id || deleteMutation.isPending || saveMutation.isPending} onClick={() => setDeleteConfirmOpen(true)} className={BUTTON_SECONDARY_CLASS}>
          {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          <span className={ACTION_BUTTON_LABEL_CLASS}>{deleteMutation.isPending ? "删除中..." : "删除"}</span>
        </button>
        <button type="button" disabled={!canTest || testMutation.isPending || deleteMutation.isPending} onClick={() => testMutation.mutate()} className={BUTTON_SECONDARY_CLASS}>
          {testMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          <span className={ACTION_BUTTON_LABEL_CLASS}>{testMutation.isPending ? "测试中..." : "测试连接"}</span>
        </button>
      </div>
      {deleteConfirmOpen ? (
        <ConfirmDialog
          title="删除存储配置？"
          description="删除后当前配置将失效。"
          confirmLabel="删除"
          pending={deleteMutation.isPending}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={handleDelete}
        />
      ) : null}
      </div>
    </article>
  );
}

function maskToken(t: string): string {
  if (t.length <= 12) return "******";
  return t.slice(0, 6) + "******" + t.slice(-6);
}

function SecurityPanel() {
  const storedToken = useAccessTokenSnapshot();
  const [tokenDraft, setTokenDraft] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const token = tokenDraft ?? storedToken ?? "";
  const displayToken = tokenDraft !== null ? tokenDraft : storedToken ? maskToken(storedToken) : "";

  return (
    <article className={`${PANEL_CLASS} min-w-0`} aria-label="访问令牌">
      <div className="mb-4 flex items-start gap-3">
        <div>
          <h2 className="text-[clamp(18px,2vw,24px)] font-black leading-none text-[var(--premium-ink)]">访问令牌</h2>
          <p className="mt-1 text-[11px] leading-normal text-[var(--premium-muted)]">用于接口访问认证</p>
        </div>
        {saved ? <span className={`${SUCCESS_PILL_CLASS} settings-token-success-pill ml-auto`}>保存成功</span> : null}
      </div>

      <label className={FORM_FIELD_CLASS}>
        <span>配置 Token</span>
        <input
          className={`${FIELD_CLASS} settings-token-input`}
          value={displayToken}
          placeholder="粘贴 X-Access-Token"
          onChange={(event) => {
            setTokenDraft(event.target.value);
            setSaved(false);
            setSaveError(null);
          }}
        />
      </label>

      {saveError ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-[11px] font-black leading-[1.55] text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          保存失败：{saveError}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={savingToken}
          onClick={async () => {
            const normalizedToken = token.trim();
            setSavingToken(true);
            try {
              if (!normalizedToken) {
                clearAccessToken();
                setTokenDraft("");
                setSaveError(null);
                setSaved(true);
                window.setTimeout(() => setSaved(false), 2000);
                return;
              }

              const validation = await apiClient.validateAccessToken(normalizedToken);
              if (!validation.valid || validation.role === "GUEST") {
                throw new Error(validation.role === "GUEST" ? "访客 Token 不会保存" : "Token 无效");
              }
              if (validation.role !== "ADMIN" && validation.role !== "USER") {
                throw new Error("Token 角色无效");
              }

              saveAccessToken(normalizedToken, validation.role);
              setTokenDraft(null);
              setSaveError(null);
              setSaved(true);
              window.setTimeout(() => setSaved(false), 2000);
            } catch (error) {
              setSaved(false);
              setSaveError(getErrorMessage(error, "Token 校验失败，请稍后重试"));
            } finally {
              setSavingToken(false);
            }
          }}
          className={BUTTON_PRIMARY_CLASS}
        >
          {savingToken ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          <span className={ACTION_BUTTON_LABEL_CLASS}>{savingToken ? "校验中" : "保存"}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              clearAccessToken();
              setTokenDraft("");
              setSaveError(null);
              setSaved(true);
              window.setTimeout(() => setSaved(false), 2000);
            } catch (error) {
              setSaved(false);
              setSaveError(getErrorMessage(error, "请稍后重试"));
            }
          }}
          className={BUTTON_SECONDARY_CLASS}
        >
          <span className={ACTION_BUTTON_LABEL_CLASS}>清除</span>
        </button>
      </div>
    </article>
  );
}
