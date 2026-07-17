"use client";

import { CircleUserRound, Download, MessageSquare, Search, Settings, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  apiClient,
  clearAccessToken,
  getConfiguredAccessToken,
  getConfiguredAccessTokenRole,
  saveAccessToken,
} from "@/lib/api-client";
import type { PremiumThemeMode } from "@/lib/premium-theme";

function LibraryPrototypeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
    </svg>
  );
}

function ThemeSwitchGlyph() {
  return (
    <svg className="premium-theme-glyph" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <mask id="anchr-theme-moon-mask">
        <rect x="0" y="0" width="100%" height="100%" fill="white" />
        <circle className="premium-theme-moon-cutout" cx="24" cy="10" r="6" fill="black" />
      </mask>
      <circle className="premium-theme-sun" cx="12" cy="12" r="6" mask="url(#anchr-theme-moon-mask)" fill="currentColor" />
      <g className="premium-theme-beams" stroke="currentColor">
        <line x1="12" y1="1.5" x2="12" y2="2.8" />
        <line x1="12" y1="21.2" x2="12" y2="22.5" />
        <line x1="1.5" y1="12" x2="2.8" y2="12" />
        <line x1="21.2" y1="12" x2="22.5" y2="12" />
        <line x1="4.58" y1="4.58" x2="5.49" y2="5.49" />
        <line x1="19.42" y1="4.58" x2="18.51" y2="5.49" />
        <line x1="4.58" y1="19.42" x2="5.49" y2="18.51" />
        <line x1="19.42" y1="19.42" x2="18.51" y2="18.51" />
      </g>
    </svg>
  );
}

const navItems = [
  { href: "/ask", label: "Ask", icon: MessageSquare },
  { href: "/library", label: "Library", icon: LibraryPrototypeIcon },
  { href: "/search", label: "Search", icon: Search },
  { href: "/imports", label: "Imports", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings },
] satisfies Array<{ href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }>;

function subscribeConfiguredAccessToken(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, callback);
  };
}

function getServerConfiguredAccessToken() {
  return null;
}

function getServerAccessTokenRole() {
  return "GUEST" as const;
}

export function PremiumRail({
  theme,
  onThemeChange,
}: {
  theme: PremiumThemeMode;
  onThemeChange: (theme: PremiumThemeMode) => void;
}) {
  const pathname = usePathname();
  const configuredAccessToken = useSyncExternalStore(
    subscribeConfiguredAccessToken,
    getConfiguredAccessToken,
    getServerConfiguredAccessToken,
  );
  const configuredRole = useSyncExternalStore(
    subscribeConfiguredAccessToken,
    getConfiguredAccessTokenRole,
    getServerAccessTokenRole,
  );
  const userStatus = configuredRole === "ADMIN" ? "admin" : configuredRole === "USER" ? "user" : "guest";
  const statusConfig = {
    guest: { label: "访客", detail: "浏览权限", icon: UserRound, tone: "guest" },
    admin: { label: "管理员", detail: "所有权限", icon: ShieldCheck, tone: "admin" },
    user: { label: "用户", detail: "部分权限", icon: CircleUserRound, tone: "user" },
  }[userStatus];
  const StatusIcon = statusConfig.icon;

  useEffect(() => {
    if (!configuredAccessToken) return;
    let cancelled = false;

    void apiClient.validateAccessToken(configuredAccessToken)
      .then((result) => {
        if (cancelled) return;
        if (result.valid && result.role !== "GUEST") {
          saveAccessToken(configuredAccessToken, result.role);
          return;
        }
        clearAccessToken();
      })
      .catch(() => {
        if (!cancelled) clearAccessToken();
      });

    return () => {
      cancelled = true;
    };
  }, [configuredAccessToken]);

  return (
    <aside className="premium-rail flex items-center justify-between gap-3 overflow-x-auto border-b border-white/10 bg-[#111315] px-4 py-3 text-white lg:w-[60px] lg:flex-col lg:justify-start lg:overflow-visible lg:border-b-0 lg:border-r lg:px-2 lg:py-3" aria-label="主导航">
      <Link href="/ask" className="grid size-10 shrink-0 place-items-center rounded-[8px] border border-white/20 bg-white text-lg font-black leading-none" aria-label="Anchr 首页">
        <span style={{ color: "#111315" }}>A</span>
      </Link>
      <nav className="flex gap-2 lg:mt-3 lg:grid lg:gap-2.5" aria-label="工作区">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "relative grid size-10 shrink-0 place-items-center rounded-[8px] transition hover:-translate-y-0.5 hover:bg-white/10",
                active ? "bg-white/10 text-white" : "text-white/65 hover:text-white",
              ].join(" ")}
              aria-label={item.label}
              title={item.label}
              aria-current={active ? "page" : undefined}
            >
              {active ? <span className="absolute -left-2 h-6 w-1 rounded-full bg-[#bbff66]" /> : null}
              <Icon width={20} height={20} strokeWidth={1.9} />
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2 lg:mt-auto lg:ml-0 lg:grid">
        <button
          type="button"
          className="relative hidden size-10 shrink-0 place-items-center border-0 bg-transparent text-white/72 hover:text-white focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bbff66] lg:grid"
          data-theme={theme}
          aria-label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
          aria-pressed={theme === "dark"}
          title={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
        >
          <ThemeSwitchGlyph />
        </button>
        <div
          className={`premium-user-status is-${statusConfig.tone} group relative flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-black transition lg:min-h-11 lg:w-10 lg:flex-col lg:justify-center lg:gap-0 lg:rounded-[8px] lg:px-1`}
          aria-label={`${statusConfig.label}，${statusConfig.detail}`}
          title={`${statusConfig.label} · ${statusConfig.detail}`}
        >
          <StatusIcon size={15} strokeWidth={2} aria-hidden="true" />
          <span className="whitespace-nowrap lg:hidden">{statusConfig.label} · {statusConfig.detail}</span>
          <span className="hidden text-[9px] leading-3 lg:block">{statusConfig.label}</span>
          <span className="pointer-events-none absolute bottom-full right-0 z-[120] mb-2 hidden whitespace-nowrap rounded-[6px] border border-white/15 bg-[#25282b] px-2.5 py-2 text-[10px] font-bold text-white shadow-xl group-hover:block group-focus-visible:block lg:bottom-auto lg:left-full lg:right-auto lg:ml-2">
            {statusConfig.label} · {statusConfig.detail}
          </span>
        </div>
      </div>
    </aside>
  );
}
