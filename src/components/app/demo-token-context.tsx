"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  DEMO_EXHAUSTED_EVENT,
  apiClient,
  clearAccessToken,
  getConfiguredAccessToken,
  getConfiguredAccessTokenRole,
  saveAccessToken,
  type DemoStatus,
  type DemoUsage,
} from "@/lib/api-client";

export type DemoPhase =
  | { kind: "idle" }
  | { kind: "claiming" }
  | { kind: "verifying" }
  | { kind: "closed"; reason: string }
  | { kind: "error"; reason: string };

type DemoContextValue = {
  /** No token yet: the visitor may still browse, but billable calls will fail. */
  hasToken: boolean;
  role: string;
  status: DemoStatus | null;
  usage: DemoUsage | null;
  phase: DemoPhase;
  dialogOpen: boolean;
  /** Opens the claim dialog and asks the server what the demo currently allows. */
  openDialog: () => void;
  closeDialog: () => void;
  /** Claims a token with a Turnstile token. Deliberately never auto-invoked. */
  claim: (turnstileToken: string) => Promise<void>;
  refreshUsage: () => void;
  setPhase: (phase: DemoPhase) => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

function subscribe(callback: () => void) {
  window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getServerToken() {
  return "";
}

export function DemoTokenProvider({ children }: { children: React.ReactNode }) {
  const token = useSyncExternalStore(subscribe, getConfiguredAccessToken, getServerToken);
  const role = useSyncExternalStore(
    subscribe,
    getConfiguredAccessTokenRole,
    () => "",
  );
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [usage, setUsage] = useState<DemoUsage | null>(null);
  const [phase, setPhase] = useState<DemoPhase>({ kind: "idle" });
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadUsage = useCallback(() => {
    if (!token) {
      // Scheduled rather than set inline: the caller may be an effect, and a synchronous set
      // there would cascade renders.
      queueMicrotask(() => setUsage(null));
      return;
    }
    void apiClient
      .demoUsage()
      .then((value) => setUsage(value))
      // A failed usage read must never block the workspace; the button simply shows no counts.
      .catch(() => setUsage(null));
  }, [token]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  // A billable call that lost its credits or its token drops the visitor back to the unclaimed
  // state instead of leaving a workspace that only produces errors.
  useEffect(() => {
    const onExhausted = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      clearAccessToken();
      setUsage(null);
      setPhase(reason === "expired"
        ? { kind: "error", reason: "访问凭证已过期，可重新领取。" }
        : { kind: "error", reason: "试用次数已用完，可重新领取。" });
      setDialogOpen(true);
    };
    window.addEventListener(DEMO_EXHAUSTED_EVENT, onExhausted);
    return () => window.removeEventListener(DEMO_EXHAUSTED_EVENT, onExhausted);
  }, []);

  const openDialog = useCallback(() => {
    setPhase({ kind: "idle" });
    setDialogOpen(true);
    void apiClient
      .demoStatus()
      .then((value) => {
        setStatus(value);
        if (!value.enabled) {
          setPhase({ kind: "closed", reason: "演示环境暂未开放。" });
        } else if (value.closed) {
          setPhase({ kind: "closed", reason: "演示环境暂时关闭，请稍后再试。" });
        }
      })
      .catch(() => setPhase({ kind: "error", reason: "无法连接演示服务，请稍后重试。" }));
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setPhase({ kind: "idle" });
  }, []);

  const claim = useCallback(async (turnstileToken: string) => {
    setPhase({ kind: "verifying" });
    try {
      const issued = await apiClient.issueDemoToken(turnstileToken);
      saveAccessToken(issued.token, issued.role);
      setDialogOpen(false);
      setPhase({ kind: "idle" });
      loadUsage();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "DEMO_QUOTA_EXHAUSTED") {
        setPhase({ kind: "error", reason: "本次试用次数已用完，可再次领取。" });
      } else if (code === "DEMO_DAILY_LIMIT_REACHED") {
        setPhase({ kind: "closed", reason: "今日演示额度已用完，请明天再来。" });
      } else if (code === "DEMO_ISSUE_TOO_FREQUENT") {
        setPhase({ kind: "error", reason: "刚领取过凭证，请稍后再试。" });
      } else if (code === "DEMO_DISABLED") {
        setPhase({ kind: "closed", reason: "演示环境暂时关闭，请稍后再试。" });
      } else if (code === "DEMO_VERIFICATION_FAILED") {
        setPhase({ kind: "error", reason: "人机校验未通过。若安装了广告拦截扩展，请对本站放行后重试。" });
      } else {
        setPhase({ kind: "error", reason: "领取失败，请稍后重试。" });
      }
    }
  }, [loadUsage]);

  const value = useMemo<DemoContextValue>(() => ({
    hasToken: Boolean(token),
    role,
    status,
    usage,
    phase,
    dialogOpen,
    openDialog,
    closeDialog,
    claim,
    refreshUsage: loadUsage,
    setPhase,
  }), [token, role, status, usage, phase, dialogOpen, openDialog, closeDialog, claim, loadUsage]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoToken() {
  const value = useContext(DemoContext);
  if (!value) {
    throw new Error("useDemoToken must be used inside DemoTokenProvider");
  }
  return value;
}
