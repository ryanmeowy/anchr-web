"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, MessageSquare, Search, Settings, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import {
  ACCESS_TOKEN_CHANGED_EVENT,
  apiClient,
  clearAccessToken,
  getAccessTokenIdentityKey,
  getConfiguredAccessToken,
  getConfiguredAccessTokenRole,
  isAuthenticationError,
  saveAccessToken,
} from "@/lib/api-client";

function LibraryPrototypeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
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

export function PremiumRail() {
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
    guest: { label: "访客", detail: "浏览权限", tone: "guest" },
    admin: { label: "管理员", detail: "所有权限", tone: "admin" },
    user: { label: "用户", detail: "部分权限", tone: "user" },
  }[userStatus];

  const tokenValidationQuery = useQuery({
    queryKey: ["auth", "validate-token", getAccessTokenIdentityKey(configuredAccessToken)],
    queryFn: () => apiClient.validateAccessToken(configuredAccessToken ?? ""),
    enabled: Boolean(configuredAccessToken),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const result = tokenValidationQuery.data;
    if (result && configuredAccessToken) {
      if (result.valid && result.role !== "GUEST") {
        saveAccessToken(configuredAccessToken, result.role);
      } else {
        clearAccessToken();
      }
      return;
    }
    if (isAuthenticationError(tokenValidationQuery.error)) clearAccessToken();
  }, [configuredAccessToken, tokenValidationQuery.data, tokenValidationQuery.error]);

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
                "relative grid size-10 shrink-0 place-items-center rounded-[8px] text-white/65 transition hover:-translate-y-0.5 hover:bg-white/10",
                active ? "bg-white/10" : "",
              ].join(" ")}
              aria-label={item.label}
              title={item.label}
              aria-current={active ? "page" : undefined}
            >
              {active ? <span className="absolute -left-2 h-6 w-1 rounded-full bg-[var(--premium-accent)]" /> : null}
              <Icon className="text-white/65" width={18} height={18} strokeWidth={1.7} />
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2 lg:mt-auto lg:ml-0 lg:grid">
        <div
          className={`premium-user-status is-${statusConfig.tone} flex min-h-11 w-10 shrink-0 flex-col items-center justify-center gap-1 border-0 bg-transparent p-0 text-[9px] font-bold leading-none transition`}
          aria-label={`${statusConfig.label}，${statusConfig.detail}`}
          title={`${statusConfig.label} · ${statusConfig.detail}`}
        >
          <User size={17} strokeWidth={1.7} aria-hidden="true" />
          <span className="whitespace-nowrap">{statusConfig.label}</span>
        </div>
      </div>
    </aside>
  );
}
