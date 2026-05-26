"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Database, KeyRound, MessageCircle, Palette, Save, Search, Shield, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { clearAccessToken, getAccessToken, saveAccessToken, apiClient } from "@/lib/api-client";
import {
  getSecuritySettings,
  getStorageSettings,
  saveSecuritySettings,
  saveStorageSettings,
} from "@/lib/local-settings";

const settingTabs = [
  { label: "通用", icon: SlidersHorizontal },
  { label: "模型连接", icon: Box },
  { label: "检索偏好", icon: Search },
  { label: "存储设置", icon: Database },
  { label: "安全与令牌", icon: Shield },
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => getAccessToken());
  const [storageSettings, setStorageSettings] = useState(() => getStorageSettings());
  const [securitySettings, setSecuritySettings] = useState(() => getSecuritySettings());
  const [storageSaved, setStorageSaved] = useState(false);
  const [securitySaved, setSecuritySaved] = useState(false);

  const providersQuery = useQuery({
    queryKey: ["settings-providers"],
    queryFn: apiClient.providers,
  });

  const searchQuery = useQuery({
    queryKey: ["settings-search"],
    queryFn: apiClient.searchSetting,
  });

  const preferencesQuery = useQuery({
    queryKey: ["settings-preferences"],
    queryFn: apiClient.preferences,
  });

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[30px] font-semibold tracking-normal text-slate-950">偏好设置</h1>
          <p className="mt-1 text-sm text-slate-500">管理个人偏好与系统连接。</p>
        </div>
        <button className="rounded-[8px] border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          帮助文档
        </button>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-6">
        <aside className="space-y-2">
          {settingTabs.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={[
                  "flex h-12 w-full items-center gap-3 rounded-[8px] px-4 text-left text-sm",
                  index === 0 ? "bg-blue-50 font-medium text-blue-600" : "text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </aside>

        <section className="space-y-4">
          <div className="panel p-5">
            <div className="mb-5 flex items-center gap-3">
              <Box size={22} className="text-slate-700" />
              <div>
                <h2 className="text-lg font-semibold text-slate-950">模型连接</h2>
                <p className="text-sm text-slate-500">配置生成模型与嵌入模型，用于回答与检索。</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Field label="生成模型提供商" value={providersQuery.data?.providers?.[0]?.providerName ?? "OpenAI-compatible"} />
              <Field label="Base URL" value={providersQuery.data?.providers?.[0]?.baseUrl ?? "https://api.example.com/v1"} />
              <Field label="模型" value={providersQuery.data?.providers?.[0]?.model ?? "gpt-4o-mini"} />
              <Field label="API Key" value="••••••••••••••••••••••••" />
              <Field label="嵌入模型" value={providersQuery.data?.providers?.[0]?.embeddingModel ?? "text-embedding-3-large"} />
              <Field label="向量维度" value={String(providersQuery.data?.providers?.[0]?.dimension ?? 3072)} />
            </div>
          </div>

          <div className="panel p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageCircle size={21} className="text-slate-700" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">回答偏好</h2>
                  <p className="text-sm text-slate-500">设置回答风格与引用要求。</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-5">
              <Field label="回答模式" value={preferencesQuery.data?.answerMode ?? "严格问答（默认）"} />
              <Field label="引用要求" value={preferencesQuery.data?.citationPolicy ?? "必须引用来源"} />
              <Field label="回答语言" value={preferencesQuery.data?.language ?? "跟随问题语言"} />
            </div>
          </div>

          <div className="panel p-5">
            <div className="mb-5 flex items-center gap-3">
              <Search size={21} className="text-slate-700" />
              <div>
                <h2 className="text-lg font-semibold text-slate-950">检索偏好</h2>
                <p className="text-sm text-slate-500">控制检索与重排序策略。</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-5">
              <Field label="启用重排序" value={searchQuery.data?.rerankEnabled === false ? "关闭" : "开启"} />
              <Field label="返回结果数量" value={String(searchQuery.data?.resultLimit ?? 12)} />
              <Field label="最小相关度阈值" value={String(searchQuery.data?.minScore ?? 0.6)} />
            </div>
          </div>

          <div className="panel p-5">
            <div className="mb-5 flex items-center gap-3">
              <Palette size={21} className="text-slate-700" />
              <div>
                <h2 className="text-lg font-semibold text-slate-950">外观</h2>
                <p className="text-sm text-slate-500">自定义界面外观。</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Segmented label="主题模式" items={["Light", "Dark", "System"]} />
              <Segmented label="字体大小" items={["小", "中（推荐）", "大"]} />
              <Segmented label="密度" items={["舒适（推荐）", "紧凑"]} />
            </div>
          </div>

          <div className="panel p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Database size={21} className="text-slate-700" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">存储设置</h2>
                  <p className="text-sm text-slate-500">配置前端直传 OSS 使用的 Bucket、Endpoint 和对象前缀。</p>
                </div>
              </div>
              {storageSaved ? <span className="text-sm text-emerald-600">已保存</span> : null}
            </div>
            <div className="grid grid-cols-3 gap-5">
              <EditableField
                label="OSS Bucket"
                value={storageSettings.ossBucket}
                placeholder="arg-image"
                onChange={(value) => {
                  setStorageSaved(false);
                  setStorageSettings((current) => ({ ...current, ossBucket: value }));
                }}
              />
              <EditableField
                label="OSS Endpoint"
                value={storageSettings.ossEndpoint}
                placeholder="https://oss-cn-shanghai.aliyuncs.com"
                onChange={(value) => {
                  setStorageSaved(false);
                  setStorageSettings((current) => ({ ...current, ossEndpoint: value }));
                }}
              />
              <EditableField
                label="OSS Key Prefix"
                value={storageSettings.ossPrefix}
                placeholder="uploads/anchr"
                onChange={(value) => {
                  setStorageSaved(false);
                  setStorageSettings((current) => ({ ...current, ossPrefix: value }));
                }}
              />
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  saveStorageSettings({
                    ossBucket: storageSettings.ossBucket.trim(),
                    ossEndpoint: storageSettings.ossEndpoint.trim(),
                    ossPrefix: storageSettings.ossPrefix.trim(),
                  });
                  setStorageSaved(true);
                }}
                className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Save size={17} />
                保存存储设置
              </button>
            </div>
          </div>

          <div className="panel p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <KeyRound size={21} className="text-slate-700" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">安全与令牌</h2>
                  <p className="text-sm text-slate-500">配置访问令牌，以及解密上传 STS 所需的 AES 参数。</p>
                </div>
              </div>
              {securitySaved ? <span className="text-sm text-emerald-600">已保存</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-5">
              <EditableField
                label="APP_ENCRYPT_KEY"
                value={securitySettings.encryptKey}
                placeholder="base64"
                secret
                onChange={(value) => {
                  setSecuritySaved(false);
                  setSecuritySettings((current) => ({ ...current, encryptKey: value }));
                }}
              />
              <EditableField
                label="APP_ENCRYPT_IV"
                value={securitySettings.encryptIv}
                placeholder="base64"
                secret
                onChange={(value) => {
                  setSecuritySaved(false);
                  setSecuritySettings((current) => ({ ...current, encryptIv: value }));
                }}
              />
            </div>

            <div className="mt-5">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">X-Access-Token</span>
                <input
                  value={token}
                  onChange={(event) => {
                    setSecuritySaved(false);
                    setToken(event.target.value);
                  }}
                  className="field mt-2"
                  placeholder="粘贴 X-Access-Token"
                />
              </label>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  saveAccessToken(token);
                  saveSecuritySettings({
                    encryptKey: securitySettings.encryptKey.trim(),
                    encryptIv: securitySettings.encryptIv.trim(),
                  });
                  setSecuritySaved(true);
                  queryClient.invalidateQueries();
                }}
                className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700"
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
                  setSecuritySaved(true);
                  queryClient.invalidateQueries();
                }}
                className="h-11 rounded-[8px] border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                清除
              </button>
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}

function EditableField({
  label,
  value,
  placeholder,
  secret = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  secret?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        value={value}
        type={secret ? "password" : "text"}
        onChange={(event) => onChange(event.target.value)}
        className="field mt-2"
        placeholder={placeholder}
      />
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input readOnly className="field mt-2" value={value} />
    </label>
  );
}

function Segmented({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
      <div className="grid h-10 grid-cols-3 rounded-[8px] border border-slate-200 bg-white p-1">
        {items.map((item, index) => (
          <button
            key={item}
            className={["rounded-[6px] text-xs", index === 0 ? "bg-blue-50 font-medium text-blue-600" : "text-slate-600"].join(" ")}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
