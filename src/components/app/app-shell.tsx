"use client";

import {
  BookOpen,
  ChevronDown,
  HelpCircle,
  Library,
  MessageCircle,
  Moon,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/ask", label: "Ask", icon: MessageCircle },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/search", label: "Search", icon: Search },
  { href: "/imports", label: "Imports", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#f7f9fc] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[248px] flex-col border-r border-slate-200 bg-white/95 px-4 py-6">
        <Link href="/ask" className="mb-10 flex items-center gap-3 px-2">
          <div className="grid size-9 place-items-center rounded-[8px] bg-blue-600 text-white">
            <Library size={22} strokeWidth={2.4} />
          </div>
          <span className="text-[26px] font-semibold tracking-normal text-slate-950">Anchr</span>
        </Link>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex h-12 items-center gap-4 rounded-[8px] px-4 text-[17px] transition",
                  active
                    ? "bg-blue-50 font-medium text-blue-600"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-950",
                ].join(" ")}
              >
                <Icon size={22} strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-slate-200 pt-5">
          <div className="flex items-center gap-3 rounded-[8px] px-1 py-2">
            <div className="grid size-12 shrink-0 place-items-center rounded-full border border-blue-200 bg-blue-50 text-lg font-semibold text-blue-600">
              W
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900">wang.li</div>
              <div className="truncate text-xs text-slate-500">企业工作区</div>
            </div>
            <ChevronDown size={18} className="text-slate-500" />
          </div>
        </div>
      </aside>

      <main className="ml-[248px] min-h-screen flex-1">
        <header className="sticky top-0 z-10 flex h-[74px] items-center justify-end gap-5 border-b border-slate-200 bg-white/80 px-8 backdrop-blur">
          <button className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-slate-100" aria-label="帮助">
            <HelpCircle size={22} />
          </button>
          <button className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-slate-100" aria-label="主题">
            <Moon size={21} />
          </button>
          <button className="flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <span className="grid size-7 place-items-center rounded-full bg-slate-100 font-medium">W</span>
            <ChevronDown size={17} />
          </button>
        </header>

        {children}
      </main>
    </div>
  );
}
