"use client";

import {
  BookOpen,
  ChevronDown,
  MessageCircle,
  Moon,
  PanelLeftClose,
  Search,
  Settings,
  Sun,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "anchr.theme";
const SIDEBAR_COLLAPSED_KEY = "anchr.sidebarCollapsed";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const navItems = [
  { href: "/ask", label: "Ask", icon: MessageCircle },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/search", label: "Search", icon: Search },
  { href: "/imports", label: "Imports", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAskPage = pathname === "/ask";
  const isLibraryPage = pathname === "/library";
  const isSettingsPage = pathname === "/settings";
  const isSimpleHeaderPage =
    isAskPage || isLibraryPage || pathname === "/search" || pathname === "/imports" || pathname === "/settings" || pathname.startsWith("/preview");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarHydrated, setSidebarHydrated] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTheme(getInitialTheme());
      setThemeHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
      setSidebarHydrated(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!themeHydrated) return;

    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeHydrated]);

  useEffect(() => {
    if (!sidebarHydrated) return;

    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed, sidebarHydrated]);

  if (isAskPage || isLibraryPage || isSettingsPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-slate-950 dark:bg-[var(--background)] dark:text-slate-200 lg:flex-row">
      <aside
        className={[
          "relative z-20 flex w-full flex-col border-b border-[var(--line)] bg-[var(--surface)] px-4 py-4 dark:border-[var(--line)] dark:bg-[#161b22]/95",
          "lg:fixed lg:inset-y-0 lg:left-0 lg:border-b-0 lg:border-r lg:py-6 lg:transition-[width] lg:duration-200 lg:ease-out",
          collapsed ? "lg:w-[64px]" : "lg:w-[220px]",
        ].join(" ")}
      >
        <div
          className={[
            "mb-4 flex items-center px-1 lg:mb-8",
            collapsed ? "justify-center" : "justify-between",
          ].join(" ")}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="grid place-items-center rounded-[8px] hover:bg-[var(--surface-hover)] dark:hover:bg-[var(--surface-hover)]"
              aria-label="展开侧边栏"
              title="展开侧边栏"
            >
              <LogoMark />
            </button>
          ) : (
            <>
              <Link href="/ask" aria-label="Anchr 首页">
                <LogoMark />
              </Link>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="grid size-9 place-items-center rounded-[8px] text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400 dark:hover:bg-[var(--surface-hover)]"
                aria-label="折叠侧边栏"
                title="折叠侧边栏"
              >
                <PanelLeftClose size={18} />
              </button>
            </>
          )}
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:space-y-1 lg:overflow-visible lg:pb-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={[
                  "flex h-10 shrink-0 items-center rounded-[8px] text-[14px] transition",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                  active
                    ? "bg-[var(--surface-hover)] font-medium text-slate-950 dark:bg-[var(--surface-hover)] dark:text-slate-50"
                    : "text-slate-700 hover:bg-[var(--surface-hover)] hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[var(--surface-hover)] dark:hover:text-slate-50",
                ].join(" ")}
              >
                <Icon size={18} strokeWidth={1.8} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {isAskPage ? (
          <div
            id="ask-conversations-slot"
            className={[
              "-mx-1 mt-4 min-h-0 flex-1 flex-col border-t border-[var(--line)] pt-4 dark:border-[var(--line)]",
              collapsed ? "hidden" : "hidden lg:flex",
            ].join(" ")}
          />
        ) : null}

      </aside>

      <main
        className={[
          "min-h-screen flex-1 transition-[margin] duration-200 ease-out",
          collapsed ? "lg:ml-[64px]" : "lg:ml-[220px]",
        ].join(" ")}
      >
        {isSimpleHeaderPage ? (
          <header className="sticky top-0 z-10 bg-[var(--background)] px-4 sm:px-6 lg:px-10">
            <div className="mx-auto flex h-[68px] max-w-[1320px] items-center justify-end lg:h-[82px]">
              <ThemeSwitcher theme={theme} onChange={setTheme} />
            </div>
          </header>
        ) : (
          <header className="sticky top-0 z-10 flex h-[68px] items-center justify-end gap-4 border-b border-[var(--line)] bg-[var(--background)] px-4 backdrop-blur dark:border-[var(--line)] dark:bg-[#0d1117]/80 sm:px-6 lg:h-[74px] lg:gap-5 lg:px-8">
            <button className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-[var(--surface-hover)] dark:text-slate-300 dark:hover:bg-[var(--surface-hover)]" aria-label="帮助">
              <BookOpen size={22} />
            </button>
            <button
              className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-[var(--surface-hover)] dark:text-blue-300 dark:hover:bg-[var(--surface-hover)]"
              aria-label="切换主题"
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Moon size={21} />
            </button>
            <button className="flex h-10 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-slate-700 dark:border-[var(--line)] dark:bg-[var(--surface)] dark:text-slate-200">
              <span className="grid size-7 place-items-center rounded-full bg-[#fff1b8] font-medium dark:bg-[var(--surface)]">W</span>
              <ChevronDown size={17} />
            </button>
          </header>
        )}

        {children}
      </main>
    </div>
  );
}

function ThemeSwitcher({ theme, onChange }: { theme: ThemeMode; onChange: (theme: ThemeMode) => void }) {
  return (
    <div className="inline-flex h-9 items-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-0.5 shadow-[0_4px_14px_rgba(15,23,42,0.05)] dark:border-[var(--line)] dark:bg-[var(--surface)]">
      <button
        className={[
          "grid size-7 place-items-center rounded-[8px] transition",
          theme === "light"
            ? "bg-white text-blue-600 shadow-[0_1px_5px_rgba(15,23,42,0.12)] dark:bg-[var(--surface-hover)] dark:text-blue-300"
            : "text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400 dark:hover:bg-[var(--surface-hover)]",
        ].join(" ")}
        aria-label="浅色主题"
        type="button"
        onClick={() => onChange("light")}
      >
        <Sun size={16} strokeWidth={1.9} />
      </button>
      <button
        className={[
          "grid size-7 place-items-center rounded-[8px] transition",
          theme === "dark"
            ? "bg-[var(--surface-hover)] text-blue-300 shadow-[0_1px_5px_rgba(0,0,0,0.18)]"
            : "text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400 dark:hover:bg-[var(--surface-hover)]",
        ].join(" ")}
        aria-label="深色主题"
        type="button"
        onClick={() => onChange("dark")}
      >
        <Moon size={15} strokeWidth={1.9} />
      </button>
    </div>
  );
}

function LogoMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-9 shrink-0 lg:size-8"
      viewBox="0 0 76 76"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1.5"
        y="1.5"
        width="73"
        height="73"
        rx="17.5"
        className="fill-white stroke-[#d6dde7] dark:fill-[#161b22] dark:stroke-[#30363d]"
        strokeWidth="1.5"
      />
      <path
        d="M30 24H22C19.7909 24 18 25.7909 18 28V48C18 50.2091 19.7909 52 22 52H30"
        stroke="#2f6bff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="38" cy="38" r="6" fill="#2f6bff" />
      <path
        d="M46 24H54C56.2091 24 58 25.7909 58 28V48C58 50.2091 56.2091 52 54 52H46"
        className="stroke-[#111820] dark:stroke-slate-100"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
