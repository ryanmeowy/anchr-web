"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  nearestQuestionMarkerIndex,
  questionMarkerCenter,
  questionNavigatorNaturalHeight,
  questionWaveInfluence,
  resolveActiveQuestionIndex,
  resolveQuestionPreviewId,
} from "@/features/ask/question-navigator-model";

export type QuestionNavigationItem = {
  id: string;
  messageId: string;
  content: string;
};

type QuestionNavigationEntry = QuestionNavigationItem & {
  kind: "question";
  questionIndex: number;
} | {
  id: "__load-earlier-questions__";
  messageId: "";
  content: string;
  kind: "load-earlier";
  questionIndex: -1;
};

type QuestionNavigatorProps = {
  questions: QuestionNavigationItem[];
  scrollerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  hasEarlierQuestions: boolean;
  loadingEarlierQuestions: boolean;
  onLoadEarlierQuestions: () => void | Promise<void>;
  onNavigate: (messageId: string) => void;
};

const MARKER_HEIGHT = 12;

export const QuestionNavigator = memo(function QuestionNavigator({
  questions,
  scrollerRef,
  contentRef,
  hasEarlierQuestions,
  loadingEarlierQuestions,
  onLoadEarlierQuestions,
  onNavigate,
}: QuestionNavigatorProps) {
  const tooltipId = useId();
  const trackRef = useRef<HTMLElement | null>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointerYRef = useRef<number | null>(null);
  const [trackHeight, setTrackHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [keyboardFocusedId, setKeyboardFocusedId] = useState<string | null>(null);
  const [pointerY, setPointerY] = useState<number | null>(null);

  const entries = useMemo<QuestionNavigationEntry[]>(() => [
    ...(hasEarlierQuestions ? [{
      id: "__load-earlier-questions__" as const,
      messageId: "" as const,
      content: loadingEarlierQuestions ? "正在加载更早的问题…" : "还有更早的问题，点击继续加载",
      kind: "load-earlier" as const,
      questionIndex: -1 as const,
    }] : []),
    ...questions.map((question, questionIndex) => ({
      ...question,
      kind: "question" as const,
      questionIndex,
    })),
  ], [hasEarlierQuestions, loadingEarlierQuestions, questions]);

  const naturalHeight = questionNavigatorNaturalHeight({ count: entries.length });
  const effectiveTrackHeight = trackHeight || naturalHeight;
  const previewId = resolveQuestionPreviewId({ hoveredId, keyboardFocusedId });
  const previewIndex = entries.findIndex((entry) => entry.id === previewId);
  const previewEntry = previewIndex >= 0 ? entries[previewIndex] : undefined;
  const previewMarkerY = previewIndex >= 0 ? questionMarkerCenter({
    index: previewIndex,
    count: entries.length,
    trackHeight: effectiveTrackHeight,
    markerHeight: MARKER_HEIGHT,
  }) : 0;

  useEffect(() => () => {
    if (pointerFrameRef.current !== null) window.cancelAnimationFrame(pointerFrameRef.current);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    if (!scroller || !content || !track || questions.length === 0) return;

    let frame: number | null = null;
    const sync = () => {
      frame = null;
      setTrackHeight((current) => current === track.clientHeight ? current : track.clientHeight);
      const questionTops = questions.map((question) => {
        const node = content.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(question.messageId)}"]`,
        );
        return node ? content.offsetTop + node.offsetTop : null;
      });
      const nextActiveIndex = resolveActiveQuestionIndex({
        questionTops,
        scrollTop: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
      });
      const nextActiveId = questions[nextActiveIndex]?.id ?? questions[0].id;
      setActiveId((current) => current === nextActiveId ? current : nextActiveId);
    };
    const scheduleSync = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(sync);
    };

    scroller.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleSync);
    observer?.observe(scroller);
    observer?.observe(content);
    observer?.observe(track);
    scheduleSync();

    return () => {
      scroller.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [contentRef, questions, scrollerRef]);

  const activateEntry = useCallback((entry: QuestionNavigationEntry | undefined) => {
    if (!entry) return;
    if (entry.kind === "load-earlier") {
      if (!loadingEarlierQuestions) void onLoadEarlierQuestions();
      return;
    }
    onNavigate(entry.messageId);
  }, [loadingEarlierQuestions, onLoadEarlierQuestions, onNavigate]);

  const handleKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLButtonElement>,
    entryIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowUp") nextIndex = Math.max(0, entryIndex - 1);
    if (event.key === "ArrowDown") nextIndex = Math.min(entries.length - 1, entryIndex + 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = entries.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setKeyboardFocusedId(entries[nextIndex].id);
    buttonRefs.current.get(entries[nextIndex].id)?.focus();
  }, [entries]);

  if (entries.length < 2) return null;

  return (
    <nav
      ref={trackRef}
      className="ask-premium-question-nav"
      aria-label="问题导航"
      style={{
        "--ask-question-nav-natural-height": `${naturalHeight}px`,
      } as CSSProperties}
      onPointerEnter={() => setKeyboardFocusedId(null)}
      onPointerMove={(event) => {
        const track = event.currentTarget;
        const rect = track.getBoundingClientRect();
        pendingPointerYRef.current = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
        if (pointerFrameRef.current !== null) return;
        pointerFrameRef.current = window.requestAnimationFrame(() => {
          pointerFrameRef.current = null;
          const nextPointerY = pendingPointerYRef.current;
          setPointerY(nextPointerY);
          const nextIndex = nextPointerY === null ? -1 : nearestQuestionMarkerIndex({
            pointerY: nextPointerY,
            count: entries.length,
            trackHeight: track.clientHeight,
            markerHeight: MARKER_HEIGHT,
          });
          setHoveredId(nextIndex >= 0 ? entries[nextIndex]?.id ?? null : null);
        });
      }}
      onPointerLeave={() => {
        pendingPointerYRef.current = null;
        if (pointerFrameRef.current !== null) {
          window.cancelAnimationFrame(pointerFrameRef.current);
          pointerFrameRef.current = null;
        }
        setPointerY(null);
        setHoveredId(null);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          activateEntry(entries.find((entry) => entry.id === hoveredId));
        }
      }}
    >
      {entries.map((entry, entryIndex) => {
        const markerY = questionMarkerCenter({
          index: entryIndex,
          count: entries.length,
          trackHeight: effectiveTrackHeight,
          markerHeight: MARKER_HEIGHT,
        });
        const wave = questionWaveInfluence({ pointerY, markerY });
        const isActive = entry.kind === "question" && entry.id === activeId;
        const isPreviewed = entry.id === previewId;
        return (
          <button
            key={entry.id}
            ref={(node) => {
              if (node) buttonRefs.current.set(entry.id, node);
              else buttonRefs.current.delete(entry.id);
            }}
            type="button"
            className="ask-premium-question-nav-item"
            data-active={isActive ? "true" : "false"}
            data-kind={entry.kind}
            data-loading={entry.kind === "load-earlier" && loadingEarlierQuestions ? "true" : "false"}
            data-previewed={isPreviewed ? "true" : "false"}
            aria-current={isActive ? "location" : undefined}
            aria-describedby={isPreviewed ? tooltipId : undefined}
            aria-label={entry.kind === "load-earlier"
              ? entry.content
              : `问题 ${entry.questionIndex + 1}：${entry.content}`}
            disabled={entry.kind === "load-earlier" && loadingEarlierQuestions}
            tabIndex={entry.id === (keyboardFocusedId ?? activeId ?? entries[0]?.id) ? 0 : -1}
            style={{
              "--ask-question-marker-opacity": 0.34 + wave * 0.66,
              "--ask-question-marker-scale": 1 + wave * 1.15,
            } as CSSProperties}
            onClick={(event) => {
              if (event.detail > 0) setKeyboardFocusedId(null);
              activateEntry(entry);
            }}
            onPointerDown={() => setKeyboardFocusedId(null)}
            onFocus={(event) => {
              setKeyboardFocusedId(event.currentTarget.matches(":focus-visible") ? entry.id : null);
            }}
            onBlur={() => setKeyboardFocusedId((current) => current === entry.id ? null : current)}
            onKeyDown={(event) => handleKeyDown(event, entryIndex)}
          >
            <span className="ask-premium-question-nav-mark" aria-hidden="true" />
          </button>
        );
      })}
      {previewEntry ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="ask-premium-question-nav-card"
          style={{
            "--ask-question-card-y": `${previewMarkerY}px`,
          } as CSSProperties}
        >
          <span className="ask-premium-question-nav-card-kicker">
            {previewEntry.kind === "load-earlier"
              ? "历史问题"
              : hasEarlierQuestions ? `已加载问题 ${previewEntry.questionIndex + 1}` : `问题 ${previewEntry.questionIndex + 1}`}
          </span>
          <span className="ask-premium-question-nav-card-text">{previewEntry.content}</span>
        </div>
      ) : null}
    </nav>
  );
}, (previous, next) => (
  previous.scrollerRef === next.scrollerRef
  && previous.contentRef === next.contentRef
  && previous.hasEarlierQuestions === next.hasEarlierQuestions
  && previous.loadingEarlierQuestions === next.loadingEarlierQuestions
  && previous.onLoadEarlierQuestions === next.onLoadEarlierQuestions
  && previous.onNavigate === next.onNavigate
  && previous.questions.length === next.questions.length
  && previous.questions.every((question, index) => {
    const nextQuestion = next.questions[index];
    return question.id === nextQuestion?.id
      && question.messageId === nextQuestion.messageId
      && question.content === nextQuestion.content;
  })
));
