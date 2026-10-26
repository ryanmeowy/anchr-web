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
  statusLoaded: boolean;
  usage: DemoUsage | null;
  phase: DemoPhase;
  dialogOpen: boolean;
  /** True once the entry human check has passed. Gates the workspace, not the claim. */
  verified: boolean;
  verifying: boolean;
  sceneId: string | null;
  captchaPrefix: string | null;
  captchaRegion: string;
  /** Records a CAPTCHA pass. Issues nothing. */
  verify: (captchaVerifyParam: string) => Promise<void>;
  retryVerify: (reason: string | null) => void;
  /** Opens the claim dialog. Requires a completed verification. */
  openDialog: () => void;
  closeDialog: () => void;
  /** Claims a token using the stored verification. */
  claim: () => Promise<void>;
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
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [usage, setUsage] = useState<DemoUsage | null>(null);
  const [phase, setPhase] = useState<DemoPhase>({ kind: "idle" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // Turnstile tokens are single use. The one obtained at the door is what the claim spends,
  // so the visitor is not asked to solve the check twice.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

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

  // Status decides whether the door widget can render at all, so it is fetched on mount rather
  // than lazily when the claim dialog opens.
  useEffect(() => {
    void apiClient
      .demoStatus()
      .then((value) => {
        setStatus(value);
        setStatusLoaded(true);
        if (!value.enabled) {
          setPhase({ kind: "closed", reason: "演示环境暂未开放。" });
        } else if (value.closed) {
          setPhase({ kind: "closed", reason: "演示环境暂时关闭，请稍后再试。" });
        }
      })
      .catch(() => {
        setStatusLoaded(true);
        setPhase({ kind: "error", reason: "无法连接演示服务，请刷新重试。" });
      });
  }, []);

  // A token that expired or ran out is simply "no token": the visitor keeps working as a guest
  // and the sidebar offers a fresh claim. Popping a dialog here interrupted browsing with an
  // error the visitor could do nothing about at that moment.
  useEffect(() => {
    const onExhausted = () => {
      clearAccessToken();
      setUsage(null);
      setPhase({ kind: "idle" });
      setDialogOpen(false);
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

  /**
   * Records the entry human check. It deliberately issues nothing: a visitor who only wants to
   * browse should not consume a trial. The token is held for the claim to spend.
   */
  const verify = useCallback(async (captchaVerifyParam: string) => {
    setVerifying(true);
    setPhase({ kind: "idle" });
    // Keep the parameter: issuing later reuses it, so the visitor solves the puzzle once.
    setChallengeToken(captchaVerifyParam);
    setVerified(true);
    setVerifying(false);
  }, []);

  const retryVerify = useCallback((reason: string | null) => {
    setVerified(false);
    setChallengeToken(null);
    setPhase(reason ? { kind: "error", reason } : { kind: "idle" });
  }, []);

  const claim = useCallback(async () => {
    setPhase({ kind: "verifying" });
    try {
      if (!challengeToken) {
        // The held token expired (Turnstile tokens last minutes). Ask for the check again
        // instead of failing with an unhelpful message.
        setVerified(false);
        setPhase({ kind: "error", reason: "人机校验已过期，请重新完成校验。" });
        return;
      }
      const issued = await apiClient.issueDemoToken(challengeToken);
      saveAccessToken(issued.token, issued.role);
      setDialogOpen(false);
      setPhase({ kind: "idle" });
      loadUsage();
      setChallengeToken(null);
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
  }, [challengeToken, loadUsage]);

  const value = useMemo<DemoContextValue>(() => ({
    hasToken: Boolean(token),
    role,
    status,
    statusLoaded,
    usage,
    phase,
    dialogOpen,
    verified,
    verifying,
    sceneId: status?.sceneId ?? null,
    captchaPrefix: status?.prefix ?? null,
    captchaRegion: "cn-shanghai",
    verify,
    retryVerify,
    openDialog,
    closeDialog,
    claim,
    refreshUsage: loadUsage,
    setPhase,
  }), [token, role, status, statusLoaded, usage, phase, dialogOpen, verified, verifying,
       verify, retryVerify, openDialog, closeDialog, claim, loadUsage]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoToken() {
  const value = useContext(DemoContext);
  if (!value) {
    throw new Error("useDemoToken must be used inside DemoTokenProvider");
  }
  return value;
}
