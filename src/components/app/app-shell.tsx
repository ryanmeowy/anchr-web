"use client";

import {
  BookOpen,
  ChevronDown,
  MessageCircle,
  Moon,
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
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-slate-950 dark:bg-[#1f2937] dark:text-slate-200 lg:flex-row">
      <aside className="relative z-20 flex w-full flex-col border-b border-[var(--line)] bg-[var(--surface)] px-4 py-4 dark:border-[#475569] dark:bg-[#243044]/95 lg:fixed lg:inset-y-0 lg:left-0 lg:w-[248px] lg:border-b-0 lg:border-r lg:py-6">
        <Link href="/ask" className="mb-4 flex items-center gap-3 px-2 lg:mb-10 lg:gap-4">
          <LogoMark />
          <span className="text-[24px] font-semibold tracking-normal text-[#0b1118] dark:text-slate-200 lg:text-[30px]">Anchr</span>
        </Link>

        <nav className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex h-11 shrink-0 items-center gap-3 rounded-[8px] px-3 text-[15px] transition lg:h-12 lg:gap-4 lg:px-4 lg:text-[17px]",
                  active
                    ? "bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
                    : "text-slate-700 hover:bg-[var(--surface-hover)] hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#334155] dark:hover:text-slate-50",
                ].join(" ")}
              >
                <Icon size={22} strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden border-t border-[var(--line)] pt-5 dark:border-[#475569] lg:block">
          <div className="flex items-center gap-3 rounded-[8px] px-1 py-2">
            <div className="grid size-12 shrink-0 place-items-center rounded-full border border-blue-200 bg-blue-50 text-lg font-semibold text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300">
              W
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-200">wang.li</div>
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">企业工作区</div>
            </div>
            <ChevronDown size={18} className="text-slate-500 dark:text-slate-400" />
          </div>
        </div>
      </aside>

      <main className="min-h-screen flex-1 lg:ml-[248px]">
        {isAskPage ? (
          <header className="sticky top-0 z-10 flex h-[68px] items-center justify-end bg-[var(--background)] px-4 backdrop-blur dark:bg-[#1f2937]/90 sm:px-6 lg:h-[82px] lg:px-10">
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </header>
        ) : isLibraryPage ? (
          <header className="sticky top-0 z-10 flex h-[68px] items-center justify-end bg-[var(--background)] px-4 backdrop-blur dark:bg-[#1f2937]/90 sm:px-6 lg:h-[82px] lg:px-10">
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </header>
        ) : (
          <header className="sticky top-0 z-10 flex h-[68px] items-center justify-end gap-4 border-b border-[var(--line)] bg-[var(--background)] px-4 backdrop-blur dark:border-[#475569] dark:bg-[#1f2937]/80 sm:px-6 lg:h-[74px] lg:gap-5 lg:px-8">
            <button className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-[var(--surface-hover)] dark:text-slate-300 dark:hover:bg-[#334155]" aria-label="帮助">
              <BookOpen size={22} />
            </button>
            <button
              className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-[var(--surface-hover)] dark:text-blue-300 dark:hover:bg-[#334155]"
              aria-label="切换主题"
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Moon size={21} />
            </button>
            <button className="flex h-10 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-slate-700 dark:border-[#475569] dark:bg-[#2a3648] dark:text-slate-200">
              <span className="grid size-7 place-items-center rounded-full bg-[#fff1b8] font-medium dark:bg-[#2a3648]">W</span>
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
    <div className="inline-flex h-11 items-center rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm dark:border-[#475569] dark:bg-[#2a3648]">
      <button
        className={[
          "grid size-9 place-items-center rounded-[9px] transition",
          theme === "light"
            ? "bg-[var(--surface)] text-blue-600 shadow-sm dark:bg-[#2a3648]"
            : "text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400 dark:hover:bg-[#334155]",
        ].join(" ")}
        aria-label="浅色主题"
        type="button"
        onClick={() => onChange("light")}
      >
        <Sun size={20} />
      </button>
      <button
        className={[
          "grid size-9 place-items-center rounded-[9px] transition",
          theme === "dark"
            ? "bg-slate-800 text-blue-300 shadow-sm"
            : "text-slate-500 hover:bg-[var(--surface-hover)] dark:text-slate-400 dark:hover:bg-[#334155]",
        ].join(" ")}
        aria-label="深色主题"
        type="button"
        onClick={() => onChange("dark")}
      >
        <Moon size={19} />
      </button>
    </div>
  );
}

function LogoMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-11 shrink-0 lg:size-[56px]"
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
        className="fill-white stroke-[#d6dde7] dark:fill-[#243044] dark:stroke-[#64748b]"
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
