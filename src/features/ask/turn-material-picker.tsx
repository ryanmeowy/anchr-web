"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Folder, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { AssetScope } from "@/lib/asset-scope";
import { MAX_TURN_MATERIALS } from "./turn-material-scope";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export function TurnMaterialPicker({ knowledgeBases, selected, onToggle, onClear, onDone }: {
  knowledgeBases: Array<{ id: string; name: string }>;
  selected: AssetScope[];
  onToggle: (scope: AssetScope) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [kbIdValue, setKbId] = useState(knowledgeBases[0]?.id ?? "");
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);
  const normalizedKeyword = keyword.trim();
  useEffect(() => {
    if (normalizedKeyword === debouncedKeyword) return;
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(normalizedKeyword);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [normalizedKeyword, debouncedKeyword]);
  const kbId = knowledgeBases.some((kb) => kb.id === kbIdValue) ? kbIdValue : knowledgeBases[0]?.id ?? "";
  const documentsQuery = useQuery({
    queryKey: ["ask", "turn-materials", kbId, debouncedKeyword, page],
    queryFn: () => apiClient.listKnowledgeBaseDocuments(kbId, {
      page, size: PAGE_SIZE, keyword: debouncedKeyword || undefined, availabilityStatus: "ANSWERABLE",
    }),
    enabled: Boolean(kbId),
  });
  const totalPages = Math.max(1, Math.ceil((documentsQuery.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="grid gap-2 text-[var(--premium-ink)]">
      <div className="flex items-center justify-between px-2 pt-1">
        <strong className="text-xs">选择资料</strong>
        <span className="text-[11px] text-[var(--premium-muted)]" aria-live="polite">已选 {selected.length}/{MAX_TURN_MATERIALS} 份</span>
      </div>
      <p className="px-2 text-[11px] text-[var(--premium-muted)]">仅用于下一条消息，最多选 {MAX_TURN_MATERIALS} 份资料。</p>
      {knowledgeBases.length ? (
        <>
          <KnowledgeBaseSelect
            knowledgeBases={knowledgeBases}
            value={kbId}
            onChange={(id) => { setKbId(id); setPage(1); }}
          />
          <label className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-2">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              aria-label="搜索本轮资料"
              placeholder="搜索文档名称"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
              className="h-9 min-w-0 w-full bg-transparent text-xs outline-none"
            />
          </label>
          <div className="grid max-h-44 overflow-y-auto overscroll-contain" aria-label="可选资料" aria-busy={documentsQuery.isFetching}>
            {documentsQuery.isPending ? (
              <div className="grid h-20 place-items-center" role="status" aria-label="正在加载资料"><span className="ask-premium-spinner" aria-hidden="true" /></div>
            ) : documentsQuery.isError ? (
              <div className="p-2 text-xs" role="alert">
                <p>资料加载失败，请重试。</p>
                <button type="button" className="mt-2 underline" onClick={() => void documentsQuery.refetch()}>重新加载</button>
              </div>
            ) : documentsQuery.data?.items.length ? documentsQuery.data.items.map((document) => {
              const checked = selected.some((scope) => scope.assetId === document.id);
              const atLimit = !checked && selected.length >= MAX_TURN_MATERIALS;
              return (
                <button
                  key={document.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  data-selected={checked}
                  aria-label={document.fileName}
                  title={atLimit ? `最多选择 ${MAX_TURN_MATERIALS} 份资料，请先取消一份` : document.fileName}
                  disabled={atLimit}
                  onClick={() => onToggle({ assetId: document.id, kbId: document.kbId, fileName: document.fileName })}
                  className={[
                    "ask-premium-menu-option relative isolate flex min-h-11 min-w-0 w-full items-center gap-3 overflow-hidden rounded-[8px] p-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--premium-blue)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:transform-none",
                    checked ? "text-blue-700" : "text-slate-700",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "ask-premium-menu-option-indicator grid size-4 shrink-0 place-items-center rounded-full border text-white",
                      checked ? "border-blue-600 bg-blue-600" : "border-black/15 bg-white text-transparent",
                    ].join(" ")}
                    aria-hidden="true"
                  >
                    <Check className="ask-premium-menu-option-check" size={12} strokeWidth={2.4} />
                  </span>
                  <FileText size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="min-w-0">
                    <strong className="block truncate text-xs text-[#111315]">{document.fileName}</strong>
                    <small className="mt-0.5 block truncate text-[11px] text-slate-500">{document.fileType} · 可问答</small>
                  </span>
                </button>
              );
            }) : <p className="p-3 text-xs text-[var(--premium-muted)]">{debouncedKeyword ? "没有找到匹配的可问答资料" : "此知识库暂无可问答资料"}</p>}
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center justify-between px-2 text-xs">
              <button type="button" aria-label="资料上一页" disabled={page <= 1 || documentsQuery.isFetching} onClick={() => setPage((value) => value - 1)} className="grid size-8 place-items-center disabled:opacity-35"><ChevronLeft size={16} /></button>
              <span>第 {page} / {totalPages} 页</span>
              <button type="button" aria-label="资料下一页" disabled={page >= totalPages || documentsQuery.isFetching} onClick={() => setPage((value) => value + 1)} className="grid size-8 place-items-center disabled:opacity-35"><ChevronRight size={16} /></button>
            </div>
          ) : null}
        </>
      ) : <p className="p-3 text-xs text-[var(--premium-muted)]">请先选择知识库。</p>}
      <div className="flex items-center justify-between border-t border-[var(--premium-line)] pt-2 text-xs">
        <button type="button" disabled={!selected.length} onClick={onClear} className="rounded-full px-3 py-2 disabled:opacity-35">清空选择</button>
        <button type="button" onClick={onDone} className="ask-premium-materials-done rounded-full bg-[var(--premium-ink)] px-4 py-2 text-[var(--premium-bg)] transition-transform duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none">完成</button>
      </div>
    </div>
  );
}

function KnowledgeBaseSelect({ knowledgeBases, value, onChange }: {
  knowledgeBases: Array<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, knowledgeBases.findIndex((kb) => kb.id === value));
  const selectedName = knowledgeBases[selectedIndex]?.name ?? "选择知识库";

  useEffect(() => {
    if (!open) return;
    optionRefs.current[selectedIndex]?.focus({ preventScroll: true });
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, selectedIndex]);

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDownCapture={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`资料所属知识库：${selectedName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={selectedName}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-[8px] border border-[var(--premium-line)] bg-[var(--premium-panel-strong)] px-3 text-left text-xs transition-colors hover:border-[var(--premium-line-strong)] hover:bg-[var(--premium-panel-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--premium-focus-line)] aria-expanded:border-[var(--premium-focus-line)]"
      >
        <Folder size={15} className="shrink-0 text-[var(--premium-muted)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-semibold">{selectedName}</span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--premium-muted)] transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="资料所属知识库"
          className="absolute inset-x-0 top-full z-10 mt-1.5 grid max-h-40 gap-0.5 overflow-y-auto overscroll-contain rounded-[10px] border border-[var(--premium-line-strong)] bg-[var(--premium-elevated)] p-1 shadow-lg"
          onKeyDown={(event) => {
            const current = optionRefs.current.findIndex((option) => option === document.activeElement);
            let next = current;
            if (event.key === "ArrowDown") next = (current + 1) % knowledgeBases.length;
            else if (event.key === "ArrowUp") next = (current - 1 + knowledgeBases.length) % knowledgeBases.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = knowledgeBases.length - 1;
            else return;
            event.preventDefault();
            optionRefs.current[next]?.focus();
          }}
        >
          {knowledgeBases.map((kb, index) => (
            <button
              key={kb.id}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={kb.id === value}
              data-selected={kb.id === value}
              tabIndex={-1}
              title={kb.name}
              onClick={() => {
                onChange(kb.id);
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
              }}
              className="ask-premium-menu-option relative isolate flex min-h-10 min-w-0 items-center gap-2.5 overflow-hidden rounded-[7px] px-2.5 text-left text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--premium-focus-line)]"
            >
              <span className={`ask-premium-menu-option-indicator grid size-4 shrink-0 place-items-center rounded-full border ${kb.id === value ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-transparent"}`} aria-hidden="true">
                <Check className="ask-premium-menu-option-check" size={12} strokeWidth={2.4} />
              </span>
              <span className="min-w-0 truncate font-semibold text-[var(--premium-ink)]">{kb.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
