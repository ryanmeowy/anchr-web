"use client";

import { Download, MessageSquare, Moon, Search, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import type { PremiumThemeMode } from "@/lib/premium-theme";

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

export function PremiumRail({
  theme,
  onThemeChange,
}: {
  theme: PremiumThemeMode;
  onThemeChange: (theme: PremiumThemeMode) => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex items-center justify-between gap-3 overflow-x-auto border-b border-white/10 bg-[#111315] px-4 py-3 text-white lg:w-[72px] lg:flex-col lg:justify-start lg:overflow-visible lg:border-b-0 lg:border-r lg:px-3 lg:py-4" aria-label="主导航">
      <Link href="/ask" className="grid size-12 shrink-0 place-items-center rounded-[8px] border border-white/20 bg-white text-xl font-black leading-none" aria-label="Anchr 首页">
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
                "relative grid size-11 shrink-0 place-items-center rounded-[8px] transition hover:-translate-y-0.5 hover:bg-white/10",
                active ? "bg-white/10 text-white" : "text-white/65 hover:text-white",
              ].join(" ")}
              aria-label={item.label}
              title={item.label}
              aria-current={active ? "page" : undefined}
            >
              {active ? <span className="absolute -left-3 h-6 w-1 rounded-full bg-[#bbff66]" /> : null}
              <Icon width={20} height={20} strokeWidth={1.9} />
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto hidden h-20 w-11 shrink-0 grid-rows-2 overflow-hidden rounded-full border border-white/15 bg-white/10 lg:mt-auto lg:ml-0 lg:grid">
        <button
          type="button"
          className={[
            "grid place-items-center transition",
            theme === "light" ? "bg-white text-blue-600" : "text-white/70 hover:bg-white/10 hover:text-white",
          ].join(" ")}
          aria-label="浅色主题"
          aria-pressed={theme === "light"}
          title="浅色主题"
          onClick={() => onThemeChange("light")}
        >
          <Sun size={16} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className={[
            "grid place-items-center transition",
            theme === "dark" ? "bg-white text-blue-600" : "text-white/70 hover:bg-white/10 hover:text-white",
          ].join(" ")}
          aria-label="深色主题"
          aria-pressed={theme === "dark"}
          title="深色主题"
          onClick={() => onThemeChange("dark")}
        >
          <Moon size={15} strokeWidth={1.9} />
        </button>
      </div>
    </aside>
  );
}
