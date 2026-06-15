"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  HardDrive,
  Info,
  Loader2,
  Plus,
  Save,
  Shield,
  Stars,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient, getAccessToken, saveAccessToken, clearAccessToken } from "@/lib/api-client";
import type {
  CapabilityConfig,
  CapabilityConfigUpdateRequest,
  CapabilityConnectionTestResult,
  CapabilityParams,
  StorageConfig,
  StorageConfigUpdateRequest,
  StorageConnectionTestResult,
} from "@/lib/types";

// ── constants ───────────────────────────────────────────────────────────────

const FIELD_CLASS = "field mt-1.5" as const;
const EMPTY_PARAMS: CapabilityParams["params"] = [];
const CONFIG_STATUS_DOT_WRAP_CLASS =
  "flex h-6 w-[54px] shrink-0 items-center justify-center" as const;
const CONFIG_STATUS_DOT_CLASS =
  "size-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/10 dark:bg-emerald-300 dark:ring-emerald-300/15" as const;
const CONFIG_ENABLE_BUTTON_CLASS =
  "inline-flex h-6 w-[54px] shrink-0 items-center justify-center whitespace-nowrap rounded-[6px] bg-emerald-100 px-0 font-sans text-xs font-medium leading-none tracking-normal text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:hover:bg-emerald-500/30" as const;

function splitParenLabel(label: string) {
  const match = label.match(/^(.*?)(\s*[(（].*[)）])$/);
  return match ? [match[1].trim(), match[2].trim()] : [label];
}

type CapabilityName = "GENERATION" | "EMBEDDING" | "RERANK" | "MULTI_EMBEDDING";

const CAPABILITY_OPTIONS: { value: CapabilityName; label: string; description: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { value: "GENERATION", label: "Generation", description: "Chat & answer generation", icon: Stars },
  { value: "EMBEDDING", label: "Embedding", description: "Text vectorization", icon: Waypoints },
  { value: "RERANK", label: "Rerank", description: "Search result reranking", icon: ArrowDownUp },
  { value: "MULTI_EMBEDDING", label: "Multi Embedding", description: "Image/text vectorization", icon: Waypoints },
];

// ── capability selector ─────────────────────────────────────────────────────

function CapabilitySelector({
  selectedType,
  onTypeChange,
  configs,
  selectedId,
  onSelect,
  onEnable,
  onAdd,
  isAdding,
}: {
  selectedType: CapabilityName;
  onTypeChange: (t: CapabilityName) => void;
  configs: CapabilityConfig[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onEnable: (id: number) => void;
  onAdd: () => void;
  isAdding: boolean;
}) {
  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false);
  const selectedOption = CAPABILITY_OPTIONS.find((option) => option.value === selectedType) ?? CAPABILITY_OPTIONS[0];
  const SelectedIcon = selectedOption.icon;

  return (
    <div className="space-y-4">
      {/* 模型类型选择 */}
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsTypeMenuOpen(false);
          }
        }}
      >
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">模型类型</span>
        <button
          type="button"
          onClick={() => setIsTypeMenuOpen((open) => !open)}
          className="mt-1.5 inline-flex h-11 w-full items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200"
          aria-expanded={isTypeMenuOpen}
          aria-haspopup="listbox"
        >
          <SelectedIcon size={16} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{selectedOption.label}</span>
          <ChevronDown size={15} className="shrink-0" />
        </button>

        {isTypeMenuOpen ? (
          <div
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-[var(--line)] dark:bg-[var(--surface)]"
            role="listbox"
          >
            {CAPABILITY_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              const selected = selectedType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onTypeChange(option.value);
                    setIsTypeMenuOpen(false);
                  }}
                  className={[
                    "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm",
                    selected
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                      : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300",
                  ].join(" ")}
                  role="option"
                  aria-selected={selected}
                >
                  <OptionIcon size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 已配置模型列表 */}
      <div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">已配置模型</span>
        <div className="mt-1.5 space-y-1">
          {configs.map((config) => (
            <div
              key={config.id}
              className={`flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm transition ${
                selectedId === config.id && !isAdding
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                  : "text-slate-700 hover:bg-[var(--surface-hover)] dark:text-slate-300"
              }`}
            >
              <button type="button" onClick={() => onSelect(config.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm">{config.modelName || config.baseUrl}</div>
                {config.modelName && (
                  <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{config.baseUrl}</div>
                )}
              </button>
              {config.enabled ? (
                <span className={CONFIG_STATUS_DOT_WRAP_CLASS} aria-label="使用中" title="使用中">
                  <span className={CONFIG_STATUS_DOT_CLASS} />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEnable(config.id); }}
                  className={CONFIG_ENABLE_BUTTON_CLASS}
                >
                  启用
                </button>
              )}
            </div>
          ))}
          <button
            onClick={onAdd}
            className={`flex w-full items-center gap-1.5 rounded-[8px] px-3 py-2 text-left text-sm transition ${
              isAdding
                ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                : "text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400"
            }`}
          >
            <Plus size={14} />添加配置
          </button>
        </div>
      </div>
    </div>
  );
}

// ── config editor ───────────────────────────────────────────────────────────

function ConfigEditor({
  capability,
  config,
  isNew,
  onSaved,
}: {
  capability: CapabilityName;
  config: CapabilityConfig | null;
  isNew: boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["settings", capability.toLowerCase()];

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<CapabilityConnectionTestResult | null>(null);
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const initialized = useRef(false);

  const paramsQuery = useQuery({
    queryKey: [...queryKey, "params"],
    queryFn: () => apiClient.getCapabilityParams(capability),
  });
  const paramItems = paramsQuery.data?.params ?? EMPTY_PARAMS;

  // track the config id that was last synced to avoid duplicate init
  const lastSyncedId = useRef<number | null>(null);

  // sync config → form
  useEffect(() => {
    if (isNew) {
      if (lastSyncedId.current !== null) {
        // switching from edit to add
        setBaseUrl("");
        setApiKey("");
        setModelName("");
        setExtra({});
        lastSyncedId.current = null;
      }
    } else if (config && config.id !== lastSyncedId.current) {
      setBaseUrl(config.baseUrl);
      setModelName(config.modelName ?? "");
      lastSyncedId.current = config.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, isNew]);

  // sync extra config when params arrive (separate effect to avoid paramItems churn)
  const syncedExtraConfigId = useRef<number | null>(null);
  useEffect(() => {
    if (config && paramItems.length > 0 && config.id !== syncedExtraConfigId.current) {
      setExtra(fromExtraConfig(config.extraConfig ?? {}, paramItems));
      syncedExtraConfigId.current = config.id;
    }
  }, [config, paramItems]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: CapabilityConfigUpdateRequest = {
        baseUrl: baseUrl.trim(),
        modelName: modelName.trim() || undefined,
        extraConfig: toExtraConfig(extra, paramItems),
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (isNew || !config) {
        return apiClient.createCapabilityConfig(capability, body);
      }
      return apiClient.updateCapabilityConfig(capability, config.id, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!config) return Promise.resolve(null);
      return apiClient.deleteCapabilityConfig(capability, config.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      onSaved();
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiClient.testConnection({
        capability,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        modelName: modelName.trim() || undefined,
        configId: config && !isNew ? config.id : undefined,
      }),
    onSuccess: (result) => setTestResult(result),
  });

  const canSave = baseUrl.trim().length > 0;
  const canTest = canSave && (apiKey.trim().length > 0 || (config && !isNew));

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        {(() => {
          const opt = CAPABILITY_OPTIONS.find((o) => o.value === capability);
          const Icon = opt?.icon ?? Globe;
          return <Icon size={22} className="text-slate-700 dark:text-slate-300" />;
        })()}
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            {CAPABILITY_OPTIONS.find((o) => o.value === capability)?.label ?? capability}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isNew ? "新建配置" : config?.modelName ?? "新建配置"}
          </p>
        </div>
        {saved && (
          <span className="ml-auto text-sm font-medium text-emerald-600 dark:text-emerald-400">已保存</span>
        )}
      </div>

      {capability === "MULTI_EMBEDDING" && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-[8px] border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-slate-300">
          <Info size={16} className="text-blue-500" />
          当前仅支持百炼平台多模态模型
        </div>
      )}

      <div className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Base URL</span>
          <input className={FIELD_CLASS} value={baseUrl}
            placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            onChange={(e) => { setBaseUrl(e.target.value); setSaved(false); setTestResult(null); }} />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">API Key</span>
          <input type="password" className={FIELD_CLASS} value={apiKey}
            placeholder={!isNew && config?.apiKeyMasked ? `(已保存: ${config.apiKeyMasked})` : "sk-..."}
            onChange={(e) => { setApiKey(e.target.value); setSaved(false); }} />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Model</span>
          <input className={FIELD_CLASS} value={modelName}
            placeholder={capability === "GENERATION" ? "qwen-plus" : capability === "RERANK" ? "gte-rerank-v2" : "text-embedding-v4"}
            onChange={(e) => { setModelName(e.target.value); setSaved(false); }} />
        </label>

        <div>
          <button
            type="button"
            onClick={() => setParamsExpanded((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
          >
            {paramsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            可选参数
          </button>
          {paramsExpanded && (
            <div className="mt-2 space-y-2">
              {paramsQuery.isLoading ? (
                <div className="text-xs text-slate-400">加载中...</div>
              ) : paramItems.length === 0 ? (
                <div className="text-xs text-slate-400">无</div>
              ) : (
                <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                  {paramItems.map((p) => (
                    <label key={p.key} className="grid grid-cols-[5rem_minmax(0,130px)] items-center gap-2">
                      <span className="text-right text-xs leading-tight text-slate-500 dark:text-slate-400">
                        {splitParenLabel(p.label).map((part) => (
                          <span key={part} className="block whitespace-nowrap">{part}</span>
                        ))}
                      </span>
                      <input
                        className="field h-8 text-sm"
                        value={extra[p.key] ?? ""}
                        placeholder={p.key}
                        onChange={(e) => { setExtra((prev) => ({ ...prev, [p.key]: e.target.value })); setSaved(false); }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {testResult && (
        <div className={`mt-4 inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm ${
          testResult.success
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
        }`}>
          {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          测试{testResult.success ? "连通" : "失败"}
          {testResult.latencyMs > 0 ? ` (${testResult.latencyMs}ms)` : ""}
          {!testResult.success && testResult.message ? `: ${testResult.message}` : ""}
        </div>
      )}

      {saveMutation.error && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          {saveMutation.error instanceof Error ? saveMutation.error.message : "保存失败"}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button" disabled={!canTest || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] disabled:opacity-50 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
        >
          {testMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          {testMutation.isPending ? "测试中..." : "测试连接"}
        </button>
        <button
          type="button" disabled={!canSave || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={17} />}
          {saveMutation.isPending ? "保存中..." : "保存"}
        </button>
        {!isNew && config && (
          <button
            type="button" onClick={() => { if (confirm("确定删除？")) deleteMutation.mutate(); }}
            className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-[var(--line)] dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            <Trash2 size={17} />删除
          </button>
        )}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fromExtraConfig(json: Record<string, unknown> | undefined, params: CapabilityParams["params"]) {
  const result: Record<string, string> = {};
  if (!json) return result;
  for (const p of params) {
    const v = json[p.key];
    if (v !== undefined && v !== null) result[p.key] = String(v);
  }
  return result;
}

function toExtraConfig(extra: Record<string, string>, params: CapabilityParams["params"]) {
  const result: Record<string, unknown> = {};
  for (const p of params) {
    const v = extra[p.key]?.trim();
    if (v) result[p.key] = v;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// ── storage panel ───────────────────────────────────────────────────────────

function StoragePanel() {
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ["settings", "storage"],
    queryFn: apiClient.getStorageConfig,
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

  const clearTestResult = () => setTestResult(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: StorageConfigUpdateRequest = {
        endpoint: endpoint.trim(), bucket: bucket.trim(),
        region: region.trim() || undefined, prefix: prefix.trim() || undefined,
        roleArn: roleArn.trim() || undefined,
      };
      if (accessKey.trim()) body.accessKey = accessKey.trim();
      if (secretKey.trim()) body.secretKey = secretKey.trim();
      return apiClient.updateStorageConfig(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "storage"] });
      setSaved(true); setAccessKey(""); setSecretKey("");
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const testMutation = useMutation({
    mutationFn: () => apiClient.testStorage({
      endpoint: endpoint.trim(),
      accessKey: accessKey.trim() || undefined,
      secretKey: secretKey.trim() || undefined,
      bucket: bucket.trim(),
      configId: configQuery.data && !accessKey.trim() && !secretKey.trim() ? configQuery.data.id : undefined,
    }),
    onSuccess: (result) => setTestResult(result),
  });

  const canSave = endpoint.trim() && bucket.trim();
  const canTest = canSave && ((accessKey.trim() && secretKey.trim()) || configQuery.data != null);

  return (
    <div className="panel p-5">
      <div className="mb-5 flex items-center gap-3">
        <HardDrive size={22} className="text-slate-700 dark:text-slate-300" />
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">存储设置</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">配置对象存储的连接参数。</p>
        </div>
        {saved ? <span className="ml-auto text-sm font-medium text-emerald-600 dark:text-emerald-400">已保存</span> : null}
      </div>
      <div className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Endpoint</span>
          <input className={FIELD_CLASS} value={endpoint} placeholder="https://oss-cn-hangzhou.aliyuncs.com"
            onChange={(e) => { setEndpoint(e.target.value); setSaved(false); clearTestResult(); }} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Access Key</span>
            <input type="password" className={FIELD_CLASS} value={accessKey}
              placeholder={configQuery.data?.accessKeyMasked ? `(已保存: ${configQuery.data.accessKeyMasked})` : ""}
              onChange={(e) => { setAccessKey(e.target.value); setSaved(false); clearTestResult(); }} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Secret Key</span>
            <input type="password" className={FIELD_CLASS} value={secretKey}
              placeholder={configQuery.data?.secretKeyMasked ? `(已保存: ${configQuery.data.secretKeyMasked})` : ""}
              onChange={(e) => { setSecretKey(e.target.value); setSaved(false); clearTestResult(); }} />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Bucket</span>
          <input className={FIELD_CLASS} value={bucket} placeholder="anchr-dev"
            onChange={(e) => { setBucket(e.target.value); setSaved(false); clearTestResult(); }} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Region</span>
            <input className={FIELD_CLASS} value={region} placeholder="cn-hangzhou"
              onChange={(e) => { setRegion(e.target.value); setSaved(false); clearTestResult(); }} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Key Prefix</span>
            <input className={FIELD_CLASS} value={prefix} placeholder="anchr-dev/"
              onChange={(e) => { setPrefix(e.target.value); setSaved(false); clearTestResult(); }} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Role ARN</span>
            <input className={FIELD_CLASS} value={roleArn} placeholder="acs:ram::..."
              onChange={(e) => { setRoleArn(e.target.value); setSaved(false); clearTestResult(); }} />
          </label>
        </div>
      </div>
      {testResult && (
        <div className={`mt-4 inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm ${testResult.success ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"}`}>
          {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          测试{testResult.success ? "连通" : "失败"}{testResult.latencyMs > 0 ? ` (${testResult.latencyMs}ms)` : ""}
          {!testResult.success && testResult.message ? `: ${testResult.message}` : ""}
        </div>
      )}
      {saveMutation.error && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />{saveMutation.error instanceof Error ? saveMutation.error.message : "保存失败"}
        </div>
      )}
      <div className="mt-5 flex items-center gap-3">
        <button type="button" disabled={!canTest || testMutation.isPending} onClick={() => testMutation.mutate()}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] disabled:opacity-50 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]">
          {testMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          {testMutation.isPending ? "测试中..." : "测试连接"}
        </button>
        <button type="button" disabled={!canSave || saveMutation.isPending} onClick={() => saveMutation.mutate()}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700">
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={17} />}
          {saveMutation.isPending ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

// ── security panel ──────────────────────────────────────────────────────────

function SecurityPanel() {
  const [token, setToken] = useState(() => getAccessToken());
  const [saved, setSaved] = useState(false);

  return (
    <div className="panel p-5">
      <div className="mb-5 flex items-center gap-3">
        <Shield size={22} className="text-slate-700 dark:text-slate-300" />
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">访问令牌</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">配置 API 访问令牌。</p>
        </div>
        {saved ? <span className="ml-auto text-sm font-medium text-emerald-600 dark:text-emerald-400">已保存</span> : null}
      </div>
      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">X-Access-Token</span>
        <input className={FIELD_CLASS} value={token} placeholder="粘贴 X-Access-Token"
          onChange={(e) => { setToken(e.target.value); setSaved(false); }} />
      </label>
      <div className="mt-5 flex items-center gap-3">
        <button type="button" onClick={() => {
          saveAccessToken(token);
          setSaved(true); setTimeout(() => setSaved(false), 2000);
        }}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 disabled:bg-slate-300">
          <Save size={17} />保存
        </button>
        <button type="button" onClick={() => {
          clearAccessToken();
          setToken("");
          setSaved(true); setTimeout(() => setSaved(false), 2000);
        }}
          className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]">
          清除
        </button>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<CapabilityName>("GENERATION");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const queryKey = ["settings", selectedType.toLowerCase(), "all"];
  const allQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.getAllCapabilityConfigs(selectedType),
  });
  const configs = allQuery.data ?? [];

  // find the selected config
  const selectedConfig = useMemo(() => {
    if (isAdding) return null;
    return configs.find((c) => c.id === selectedId) ?? null;
  }, [configs, selectedId, isAdding]);

  // auto-select enabled config when switching type or after data loads
  useEffect(() => {
    if (configs.length === 0) {
      setSelectedId(null);
      setIsAdding(true);
      return;
    }
    const enabled = configs.find((c) => c.enabled);
    if (enabled) {
      setSelectedId(enabled.id);
      setIsAdding(false);
    } else {
      setSelectedId(configs[0].id);
      setIsAdding(false);
    }
  }, [configs]);

  const handleTypeChange = useCallback((type: CapabilityName) => {
    setSelectedType(type);
    setSelectedId(null);
    setIsAdding(false);
  }, []);

  const handleSelect = useCallback((id: number) => {
    setSelectedId(id);
    setIsAdding(false);
  }, []);

  const enableMutation = useMutation({
    mutationFn: (id: number) => apiClient.selectCapabilityConfig(selectedType, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const reindexMutation = useMutation({
    mutationFn: () => apiClient.reindexCapability(),
  });

  const [pendingEnableId, setPendingEnableId] = useState<number | null>(null);

  const handleEnable = useCallback((id: number) => {
    const isEmbeddingSwitch = selectedType === "EMBEDDING" || selectedType === "MULTI_EMBEDDING";
    if (isEmbeddingSwitch) {
      setPendingEnableId(id);
      return;
    }
    enableMutation.mutate(id);
  }, [enableMutation, selectedType]);

  const confirmEnable = useCallback(() => {
    if (pendingEnableId == null) return;
    const id = pendingEnableId;
    setPendingEnableId(null);
    enableMutation.mutate(id, {
      onSuccess: () => reindexMutation.mutate(),
    });
  }, [pendingEnableId, enableMutation, reindexMutation, selectedType]);

  const handleAdd = useCallback(() => {
    setSelectedId(null);
    setIsAdding(true);
  }, []);

  const handleSaved = useCallback(() => {
    // after save, invalidate will reload configs, the useEffect will handle selection
  }, []);

  return (
    <div className="min-h-[calc(100vh-68px)] px-4 pb-8 sm:px-6 lg:min-h-[calc(100vh-82px)] lg:px-10 lg:pb-10">
      <div className="mx-auto max-w-[1320px] pt-4 lg:pt-6">
        <div className="mb-7 lg:mb-9">
          <h1 className="text-[30px] font-semibold tracking-normal text-slate-950 dark:text-slate-100">偏好设置</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">管理 AI 能力连接与存储配置。</p>
        </div>

        {/* 模型配置: 左右分栏 */}
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
          {/* 左侧: 选择器 */}
          <div className="panel p-5">
            <CapabilitySelector
              selectedType={selectedType}
              onTypeChange={handleTypeChange}
              configs={configs}
              selectedId={selectedId}
              onSelect={handleSelect}
              onEnable={handleEnable}
              onAdd={handleAdd}
              isAdding={isAdding}
            />
          </div>

          {/* 右侧: 编辑器 */}
          <div className="panel p-5">
            <ConfigEditor
              capability={selectedType}
              config={selectedConfig}
              isNew={isAdding}
              onSaved={handleSaved}
            />
          </div>
        </div>

        {/* 存储 + 安全: 左右并排 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
          <StoragePanel />
          <SecurityPanel />
        </div>
      </div>

      {/* Embedding switch confirmation modal */}
      {pendingEnableId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-[420px] rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-[var(--line)] dark:bg-[var(--surface)]">
            <div className="flex items-start justify-between">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
                <AlertTriangle size={24} className="text-amber-600 dark:text-amber-400" />
              </div>
              <button onClick={() => setPendingEnableId(null)} className="grid size-8 place-items-center rounded-[7px] text-slate-400 hover:bg-[var(--surface-hover)] dark:text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 text-center">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">确认切换 Embedding 模型</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                切换 Embedding 模型将导致已有的向量数据失效，系统会清除已有向量并重新生成，期间系统不可用。
              </p>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setPendingEnableId(null)}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] border border-[var(--line)] bg-[var(--surface)] text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200">
                取消
              </button>
              <button type="button" onClick={confirmEnable}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] bg-amber-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(217,119,6,0.28)] hover:bg-amber-700">
                确定切换
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
