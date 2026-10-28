"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
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
  verifying: boolean;
  sceneId: string | null;
  rawSceneId: string | null;
  encryptedSceneId: string | null;
  captchaPrefix: string | null;
  captchaRegion: string;
  /** Records a CAPTCHA pass. Issues nothing. */
  /** Opens the claim dialog. Requires a completed verification. */
  openDialog: () => void;
  closeDialog: () => void;
  /** Claims a token using the stored verification. */
  claim: (captchaVerifyParam: string) => Promise<void>;
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
  const autoOpenedRef = useRef(false);

  const loadUsage = useCallback(() => {
    // Usage is a claimed-token concept; a guest token has no credits and the endpoint requires
    // USER, so asking would only produce a 403.
    if (!token || role === "GUEST") {
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
  }, [token, role]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  // Show the guide once per mount for an unclaimed visitor; dismissing it is respected until the
  // next visit, which is what the design asks for.
  useEffect(() => {
    if (autoOpenedRef.current || !statusLoaded) return;
    if (role === "ADMIN" || role === "USER") return;
    autoOpenedRef.current = true;
    // Deferred: opening synchronously inside the effect cascades renders.
    queueMicrotask(() => setDialogOpen(true));
  }, [statusLoaded, role]);

  /**
   * A visitor gets a read-only GUEST token on arrival, so browsing never hits a 401 and never
   * needs a claim. Claiming upgrades that token to USER, which is what unlocks asking, uploading
   * and metering.
   */
  useEffect(() => {
    // Runs before the human check completes: a guest token only grants reads, so issuing it early
    // is harmless and means the workspace has data the moment the check passes.
    if (token) return;
    let cancelled = false;
    void apiClient
      .guestDemoToken()
      .then((issued) => {
        if (cancelled) return;
        saveAccessToken(issued.token, issued.role);
      })
      .catch(() => {
        // Browsing without any token is degraded but not broken; the sidebar still offers a claim.
      });
    return () => {
      cancelled = true;
    };
  }, [token, role]);

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
    // The CAPTCHA SDK appends its own fixed-position overlay to <body>, outside React's tree, so
    // unmounting our bubble leaves a full-screen layer that cannot be dismissed. Drop it here;
    // otherwise closing the dialog traps the visitor on a page they cannot click.
    document
      .querySelectorAll(".aliyunCaptcha-top, #aliyunCaptcha-window-popup")
      .forEach((node) => node.remove());
  }, []);

  /**
   * Records the entry human check. It deliberately issues nothing: a visitor who only wants to
   * browse should not consume a trial. The token is held for the claim to spend.
   */
  const claim = useCallback(async (captchaVerifyParam: string) => {
    setPhase({ kind: "verifying" });
    try {
      const issued = await apiClient.issueDemoToken(captchaVerifyParam);
      saveAccessToken(issued.token, issued.role);
      setDialogOpen(false);
      setPhase({ kind: "idle" });
      loadUsage();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "DEMO_QUOTA_EXHAUSTED") {
        // One token at a time: credits running out does not free the browser to claim again, so
        // "claim another" would promise something the server refuses.
        setPhase({ kind: "error", reason: "本次试用次数已用完，有效期结束后可重新领取。" });
      } else if (code === "DEMO_DAILY_LIMIT_REACHED") {
        setPhase({ kind: "closed", reason: "今日演示额度已用完，请明天再来。" });
      } else if (code === "DEMO_ISSUE_TOO_FREQUENT") {
        setPhase({ kind: "error", reason: "刚领取过凭证，请稍后再试。" });
      } else if (code === "DEMO_TOKEN_STILL_ACTIVE") {
        // The current token still has life in it; waiting a moment does not help, expiry does.
        setPhase({ kind: "error", reason: "演示令牌仍然有效，有效期结束后即可重新领取。" });
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
    statusLoaded,
    usage,
    phase,
    dialogOpen,
    verifying: phase.kind === "verifying",
    sceneId: status?.sceneId ?? null,
    rawSceneId: status?.sceneId ?? null,
    encryptedSceneId: status?.encryptedSceneId ?? null,
    captchaPrefix: status?.prefix ?? null,
    // The client SDK accepts only cn / sgp / ga. The server-side region
    // (cn-shanghai) is a different value and must not be passed here.
    captchaRegion: "cn",
    openDialog,
    closeDialog,
    claim,
    refreshUsage: loadUsage,
    setPhase,
  }), [token, role, status, statusLoaded, usage, phase, dialogOpen, openDialog, closeDialog, claim, loadUsage]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoToken() {
  const value = useContext(DemoContext);
  if (!value) {
    throw new Error("useDemoToken must be used inside DemoTokenProvider");
  }
  return value;
}
