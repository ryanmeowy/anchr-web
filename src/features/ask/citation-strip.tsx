"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { CitationChunk, ConversationCitation } from "@/lib/types";

type Props = {
  citations: ConversationCitation[];
  assetNames: Record<string, string>;
  onPreview: (citation: ConversationCitation, index: number, chunk: CitationChunk, label: string) => void;
};

/** Shared citation navigation for synchronous answers, task results and history. */
export function CitationStrip({ citations, assetNames, onPreview }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [active, setActive] = useState<number | null>(null);
  const visible = citations;
  const selected = active === null ? null : visible[active];
  const fileName = (citation: ConversationCitation) => citation.fileName?.trim()
    || (citation.assetId ? assetNames[citation.assetId]?.trim() : undefined) || "引用来源";

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setEdges({ left: element.scrollLeft > 1,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); };
  }, [citations, assetNames]);

  useEffect(() => {
    if (active === null) return;
    const modal = dialog.current;
    const opener = trigger.current;
    modal?.showModal();
    return () => {
      modal?.close();
      opener?.focus({ preventScroll: true });
    };
  }, [active]);

  const move = (direction: number) => {
    const element = scroller.current;
    element?.scrollBy({ left: direction * element.clientWidth * 0.8,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  const preview = (citation: ConversationCitation, index: number, chunk: CitationChunk) => {
    setActive(null);
    onPreview(citation, index, chunk, chunk.citationLabel ?? String(citation.citationIndex ?? index + 1));
  };

  return (
    <div className="mt-4 flex min-w-0 max-w-full items-center gap-1" aria-label="引用来源">
      {edges.left || edges.right ? (
        <button type="button" onClick={() => move(-1)} disabled={!edges.left} aria-label="向左查看引用"
          className="grid size-7 shrink-0 place-items-center rounded-full border border-current/10 disabled:opacity-25">
          <ChevronLeft size={15} />
        </button>
      ) : null}
      <div className="relative min-w-0 flex-1">
        <div ref={scroller} className="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visible.map((citation, index) => (
            <button key={citation.assetId ?? `citation-${index}`} type="button"
              style={{ maxWidth: 240 }}
              disabled={!citation.chunks?.length} aria-haspopup={citation.chunks?.length > 1 ? "dialog" : undefined}
              onFocus={(event) => {
                const parent = scroller.current;
                if (!parent) return;
                const child = event.currentTarget.getBoundingClientRect();
                const box = parent.getBoundingClientRect();
                if (child.left < box.left) parent.scrollLeft -= box.left - child.left;
                else if (child.right > box.right) parent.scrollLeft += child.right - box.right;
              }}
              onClick={(event) => {
                if (citation.chunks.length === 1) preview(citation, index, citation.chunks[0]);
                else { trigger.current = event.currentTarget; setActive(index); }
              }}
              className="ask-premium-citation inline-flex min-h-[30px] max-w-[240px] shrink-0 items-center gap-1.5 rounded-full border border-black/10 bg-[#f7f7f2]/85 px-2.5 text-[11px] text-[#111315] transition hover:bg-[#111315] hover:text-white disabled:opacity-60"
              title={`[${citation.citationIndex ?? index + 1}] ${fileName(citation)} · 引用 ${citation.chunks.length} 处`}>
              <span className="shrink-0">[{citation.citationIndex ?? index + 1}]</span>
              <span className="min-w-0 truncate">{fileName(citation)}</span>
              <span className="shrink-0 opacity-65">引用 {citation.chunks.length} 处</span>
            </button>
          ))}
        </div>
        {edges.left ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-[var(--background,#fff)] to-transparent" /> : null}
        {edges.right ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-3 bg-gradient-to-l from-[var(--background,#fff)] to-transparent" /> : null}
      </div>
      {edges.left || edges.right ? (
        <button type="button" onClick={() => move(1)} disabled={!edges.right} aria-label="向右查看引用"
          className="grid size-7 shrink-0 place-items-center rounded-full border border-current/10 disabled:opacity-25">
          <ChevronRight size={15} />
        </button>
      ) : null}
      {selected && active !== null && typeof document !== "undefined" ? createPortal(
        <dialog ref={dialog} aria-label={`${fileName(selected)}的引用片段`} onCancel={() => setActive(null)}
          onClick={(event) => { if (event.target === event.currentTarget) setActive(null); }}
          className="fixed inset-0 m-auto max-h-[70dvh] w-[min(440px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-black/10 bg-[#f7f7f2] p-4 text-[#111315] shadow-xl backdrop:bg-black/25 dark:border-white/15 dark:bg-[#20221f] dark:text-white">
          <div className="mb-3 flex items-start justify-between gap-3">
            <strong className="min-w-0 break-words text-sm">{fileName(selected)}</strong>
            <button type="button" autoFocus onClick={() => setActive(null)} aria-label="关闭引用片段" className="shrink-0 rounded-full p-1"><X size={18} /></button>
          </div>
          <div className="space-y-2">
            {selected.chunks.map((chunk) => (
              <button type="button" key={chunk.segmentId} disabled={!chunk.segmentId}
                onClick={() => preview(selected, active, chunk)}
                className="block w-full rounded-xl border border-current/10 p-3 text-left hover:bg-black/5 dark:hover:bg-white/5">
                <span className="text-xs font-semibold">[{chunk.citationLabel ?? selected.citationIndex ?? active + 1}]{chunk.pageNo != null ? ` · 第 ${chunk.pageNo} 页` : ""}</span>
                <span className="mt-1 block line-clamp-3 break-words text-xs leading-5 opacity-70">{(chunk.snippet || chunk.title || "查看原文片段").replace(/<\/?em\b[^>]*>/gi, "")}</span>
              </button>
            ))}
          </div>
        </dialog>, document.body,
      ) : null}
    </div>
  );
}
