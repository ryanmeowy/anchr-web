"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  KeyRound,
  Loader2,
  Save,
  Shield,
  Stars,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, getAccessToken, saveAccessToken, clearAccessToken } from "@/lib/api-client";
import { getSecuritySettings, saveSecuritySettings } from "@/lib/local-settings";
import type {
  CapabilityConfig,
  CapabilityConfigUpdateRequest,
  CapabilityConnectionTestResult,
  StorageConfig,
  StorageConfigUpdateRequest,
  StorageConnectionTestResult,
} from "@/lib/types";

// ── helpers ────────────────────────────────────────────────────────────────

const FIELD_CLASS =
  "field mt-1.5" as const;

function fieldId(capability: string, name: string) {
  return `${capability}-${name}`;
}

// ── capability panel ───────────────────────────────────────────────────────

function CapabilityPanel({
  capability,
  title,
  description,
  icon: Icon,
  extraFields,
}: {
  capability: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  extraFields?: { key: string; label: string; placeholder?: string; secret?: boolean }[];
}) {
  const queryClient = useQueryClient();

  const queryKey = ["settings", capability.toLowerCase()];
  const configQuery = useQuery({
    queryKey,
    queryFn: () => {
      switch (capability) {
        case "GENERATION":
          return apiClient.getGenerationConfig();
        case "RERANK":
          return apiClient.getRerankConfig();
        case "MULTI_EMBEDDING":
          return apiClient.getMultiEmbeddingConfig();
        default:
          return apiClient.getEmbeddingConfig();
      }
    },
  });

  // local form state
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<CapabilityConnectionTestResult | null>(null);
  const initialized = useRef(false);

  // sync query data → local state (once)
  useEffect(() => {
    if (configQuery.data && !initialized.current) {
      setBaseUrl(configQuery.data.baseUrl ?? "");
      setModelName(configQuery.data.modelName ?? "");
      if (extraFields) {
        const ex: Record<string, string> = {};
        for (const f of extraFields) {
          const val = (configQuery.data as Record<string, unknown>)[f.key];
          ex[f.key] = typeof val === "string" ? val : "";
        }
        setExtra(ex);
      }
      initialized.current = true;
    }
  }, [configQuery.data, extraFields]);

  const clearTestResult = useCallback(() => setTestResult(null), []);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: CapabilityConfigUpdateRequest = {
        baseUrl: baseUrl.trim(),
        modelName: modelName.trim() || undefined,
      };
      if (apiKey.trim()) {
        body.apiKey = apiKey.trim();
      }
      if (extraFields) {
        for (const f of extraFields) {
          (body as Record<string, unknown>)[f.key] = extra[f.key]?.trim() || undefined;
        }
      }
      switch (capability) {
        case "GENERATION":
          return apiClient.updateGenerationConfig(body);
        case "RERANK":
          return apiClient.updateRerankConfig(body);
        case "MULTI_EMBEDDING":
          return apiClient.updateMultiEmbeddingConfig(body);
        default:
          return apiClient.updateEmbeddingConfig(body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiClient.testConnection({
        capability,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName.trim() || undefined,
      }),
    onSuccess: (result) => setTestResult(result),
  });

  const canSave = baseUrl.trim().length > 0;
  const canTest = canSave && apiKey.trim().length > 0;

  return (
    <div className="panel p-5">
      {/* header */}
      <div className="mb-5 flex items-center gap-3">
        <Icon size={22} className="text-slate-700 dark:text-slate-300" />
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        {saved ? (
          <span className="ml-auto text-sm font-medium text-emerald-600 dark:text-emerald-400">
            已保存
          </span>
        ) : null}
      </div>

      {/* fields */}
      <div className="space-y-4">
        <label htmlFor={fieldId(capability, "baseUrl")} className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Base URL
          </span>
          <input
            id={fieldId(capability, "baseUrl")}
            className={FIELD_CLASS}
            value={baseUrl}
            placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setSaved(false);
              clearTestResult();
            }}
          />
        </label>

        <label htmlFor={fieldId(capability, "apiKey")} className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            API Key
          </span>
          <input
            id={fieldId(capability, "apiKey")}
            type="password"
            className={FIELD_CLASS}
            value={apiKey}
            placeholder={configQuery.data?.apiKeyMasked ? `(已保存: ${configQuery.data.apiKeyMasked})` : "sk-..."}
            onChange={(e) => {
              setApiKey(e.target.value);
              setSaved(false);
              clearTestResult();
            }}
          />
        </label>

        <label htmlFor={fieldId(capability, "model")} className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Model
          </span>
          <input
            id={fieldId(capability, "model")}
            className={FIELD_CLASS}
            value={modelName}
            placeholder={
              capability === "GENERATION"
                ? "qwen-plus"
                : capability === "RERANK"
                  ? "gte-rerank-v2"
                  : "text-embedding-v4"
            }
            onChange={(e) => {
              setModelName(e.target.value);
              setSaved(false);
              clearTestResult();
            }}
          />
        </label>

        {extraFields?.map((f) => (
          <label key={f.key} htmlFor={fieldId(capability, f.key)} className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {f.label}
            </span>
            <input
              id={fieldId(capability, f.key)}
              type={f.secret ? "password" : "text"}
              className={FIELD_CLASS}
              value={extra[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => {
                setExtra((prev) => ({ ...prev, [f.key]: e.target.value }));
                setSaved(false);
                clearTestResult();
              }}
            />
          </label>
        ))}
      </div>

      {/* test result */}
      {testResult && (
        <div
          className={`mt-4 inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm ${
            testResult.success
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          测试{testResult.success ? "连通" : "失败"}
          {testResult.latencyMs > 0 ? ` (${testResult.latencyMs}ms)` : ""}
          {!testResult.success && testResult.message ? `: ${testResult.message}` : ""}
        </div>
      )}

      {/* save error */}
      {saveMutation.error && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          {saveMutation.error instanceof Error ? saveMutation.error.message : "保存失败"}
        </div>
      )}

      {/* actions */}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={!canTest || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] disabled:opacity-50 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
        >
          {testMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : null}
          {testMutation.isPending ? "测试中..." : "测试连接"}
        </button>

        <button
          type="button"
          disabled={!canSave || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {saveMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={17} />
          )}
          {saveMutation.isPending ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "storage"] });
      setSaved(true);
      setAccessKey("");
      setSecretKey("");
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiClient.testStorage({
        endpoint: endpoint.trim(),
        accessKey: accessKey.trim(),
        secretKey: secretKey.trim(),
        bucket: bucket.trim(),
      }),
    onSuccess: (result) => setTestResult(result),
  });

  const canSave = endpoint.trim() && bucket.trim();
  const canTest = canSave && accessKey.trim() && secretKey.trim();

  return (
    <div className="panel p-5">
      <div className="mb-5 flex items-center gap-3">
        <Globe size={22} className="text-slate-700 dark:text-slate-300" />
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">存储设置</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            配置对象存储的连接参数，用于文件上传与预览。
          </p>
        </div>
        {saved ? (
          <span className="ml-auto text-sm font-medium text-emerald-600 dark:text-emerald-400">
            已保存
          </span>
        ) : null}
      </div>

      <div className="space-y-4">
        <label htmlFor="storage-endpoint" className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Endpoint</span>
          <input
            id="storage-endpoint"
            className={FIELD_CLASS}
            value={endpoint}
            placeholder="https://oss-cn-hangzhou.aliyuncs.com"
            onChange={(e) => { setEndpoint(e.target.value); setSaved(false); clearTestResult(); }}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label htmlFor="storage-ak" className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Access Key
            </span>
            <input
              id="storage-ak"
              type="password"
              className={FIELD_CLASS}
              value={accessKey}
              placeholder={configQuery.data?.accessKeyMasked ? `(已保存: ${configQuery.data.accessKeyMasked})` : "ak-..."}
              onChange={(e) => { setAccessKey(e.target.value); setSaved(false); clearTestResult(); }}
            />
          </label>

          <label htmlFor="storage-sk" className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Secret Key
            </span>
            <input
              id="storage-sk"
              type="password"
              className={FIELD_CLASS}
              value={secretKey}
              placeholder={configQuery.data?.secretKeyMasked ? `(已保存: ${configQuery.data.secretKeyMasked})` : "sk-..."}
              onChange={(e) => { setSecretKey(e.target.value); setSaved(false); clearTestResult(); }}
            />
          </label>
        </div>

        <label htmlFor="storage-bucket" className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Bucket</span>
          <input
            id="storage-bucket"
            className={FIELD_CLASS}
            value={bucket}
            placeholder="anchr-dev"
            onChange={(e) => { setBucket(e.target.value); setSaved(false); clearTestResult(); }}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label htmlFor="storage-region" className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Region</span>
            <input
              id="storage-region"
              className={FIELD_CLASS}
              value={region}
              placeholder="cn-hangzhou"
              onChange={(e) => { setRegion(e.target.value); setSaved(false); clearTestResult(); }}
            />
          </label>

          <label htmlFor="storage-prefix" className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Key Prefix
            </span>
            <input
              id="storage-prefix"
              className={FIELD_CLASS}
              value={prefix}
              placeholder="anchr-dev/"
              onChange={(e) => { setPrefix(e.target.value); setSaved(false); clearTestResult(); }}
            />
          </label>

          <label htmlFor="storage-role-arn" className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Role ARN
            </span>
            <input
              id="storage-role-arn"
              className={FIELD_CLASS}
              value={roleArn}
              placeholder="acs:ram::..."
              onChange={(e) => { setRoleArn(e.target.value); setSaved(false); clearTestResult(); }}
            />
          </label>
        </div>
      </div>

      {/* test result */}
      {testResult && (
        <div
          className={`mt-4 inline-flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm ${
            testResult.success
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
          }`}
        >
          {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          测试{testResult.success ? "连通" : "失败"}
          {testResult.latencyMs > 0 ? ` (${testResult.latencyMs}ms)` : ""}
          {!testResult.success && testResult.message ? `: ${testResult.message}` : ""}
        </div>
      )}

      {/* save error */}
      {saveMutation.error && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[8px] bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <AlertCircle size={16} />
          {saveMutation.error instanceof Error ? saveMutation.error.message : "保存失败"}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={!canTest || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] disabled:opacity-50 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
        >
          {testMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
          {testMutation.isPending ? "测试中..." : "测试连接"}
        </button>

        <button
          type="button"
          disabled={!canSave || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {saveMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={17} />
          )}
          {saveMutation.isPending ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

// ── security panel ──────────────────────────────────────────────────────────

function SecurityPanel() {
  const [token, setToken] = useState(() => getAccessToken());
  const [securitySettings, setSecuritySettings] = useState(() => getSecuritySettings());
  const [saved, setSaved] = useState(false);

  return (
    <div className="panel p-5">
      <div className="mb-5 flex items-center gap-3">
        <Shield size={22} className="text-slate-700 dark:text-slate-300" />
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">安全与令牌</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            配置访问令牌与上传解密参数。
          </p>
        </div>
        {saved ? (
          <span className="ml-auto text-sm font-medium text-emerald-600 dark:text-emerald-400">
            已保存
          </span>
        ) : null}
      </div>

      <div className="space-y-4">
        <label htmlFor="access-token" className="block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            X-Access-Token
          </span>
          <input
            id="access-token"
            className={FIELD_CLASS}
            value={token}
            placeholder="粘贴 X-Access-Token"
            onChange={(e) => {
              setToken(e.target.value);
              setSaved(false);
            }}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label htmlFor="encrypt-key" className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              APP_ENCRYPT_KEY
            </span>
            <input
              id="encrypt-key"
              type="password"
              className={FIELD_CLASS}
              value={securitySettings.encryptKey}
              placeholder="base64"
              onChange={(e) => {
                setSecuritySettings((prev) => ({ ...prev, encryptKey: e.target.value }));
                setSaved(false);
              }}
            />
          </label>

          <label htmlFor="encrypt-iv" className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              APP_ENCRYPT_IV
            </span>
            <input
              id="encrypt-iv"
              type="password"
              className={FIELD_CLASS}
              value={securitySettings.encryptIv}
              placeholder="base64"
              onChange={(e) => {
                setSecuritySettings((prev) => ({ ...prev, encryptIv: e.target.value }));
                setSaved(false);
              }}
            />
          </label>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            saveAccessToken(token);
            saveSecuritySettings({
              encryptKey: securitySettings.encryptKey.trim(),
              encryptIv: securitySettings.encryptIv.trim(),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] hover:bg-blue-700 disabled:bg-slate-300"
        >
          <Save size={17} />
          保存安全设置
        </button>

        <button
          type="button"
          onClick={() => {
            clearAccessToken();
            saveSecuritySettings({ encryptKey: "", encryptIv: "" });
            setToken("");
            setSecuritySettings({ encryptKey: "", encryptIv: "" });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]"
        >
          清除
        </button>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  return (
    <div className="min-h-[calc(100vh-68px)] px-4 pb-8 sm:px-6 lg:min-h-[calc(100vh-82px)] lg:px-10 lg:pb-10">
      <div className="mx-auto max-w-[1320px] pt-4 lg:pt-6">
        {/* header */}
        <div className="mb-7 lg:mb-9 flex items-start justify-between">
          <div>
            <h1 className="text-[30px] font-semibold tracking-normal text-slate-950 dark:text-slate-100">
              偏好设置
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              管理 AI 能力连接与存储配置。
            </p>
          </div>
          <button className="inline-flex h-11 items-center gap-1.5 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-semibold text-slate-700 hover:bg-[var(--surface-hover)] dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200 dark:hover:bg-[var(--surface-hover)]">
            帮助文档
            <ArrowUpRight size={15} />
          </button>
        </div>

        {/* panels */}
        <div className="max-w-[720px] space-y-5">
          <CapabilityPanel
            capability="GENERATION"
            title="生成模型"
            description="配置对话与回答生成的模型连接参数。"
            icon={Stars}
          />

          <CapabilityPanel
            capability="EMBEDDING"
            title="嵌入模型"
            description="配置文本向量化的模型连接参数。"
            icon={Waypoints}
          />

          <CapabilityPanel
            capability="RERANK"
            title="重排序模型"
            description="配置搜索结果重排序的模型连接参数。"
            icon={Globe}
          />

          <CapabilityPanel
            capability="MULTI_EMBEDDING"
            title="多模态嵌入模型"
            description="配置图片向量化的模型连接参数。"
            icon={Waypoints}
          />

          <StoragePanel />

          <SecurityPanel />
        </div>
      </div>
    </div>
  );
}
