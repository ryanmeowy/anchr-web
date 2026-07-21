export type TypewriterController = {
  append: (text: string) => void;
  replace: (text: string) => void;
  finish: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  hasContent: () => boolean;
};

type TypewriterControllerOptions = {
  initialText?: string;
  onRender: (text: string) => void;
};

const CHARACTERS_PER_SECOND = 240;
const MAX_CHARACTERS_PER_TICK = 8;
const FALLBACK_TICK_MS = 48;

function characters(value: string) {
  return Array.from(value);
}

/**
 * Owns presentation pacing for one answer. Network readers enqueue canonical text
 * immediately while React receives small time-based batches for smooth rendering.
 */
export function createTypewriterController({
  initialText = "",
  onRender,
}: TypewriterControllerOptions): TypewriterController {
  let rendered = characters(initialText);
  let target = [...rendered];
  let frame: number | null = null;
  let fallbackTimer: number | null = null;
  let scheduled = false;
  let paused = false;
  let cancelled = false;
  let lastTickAt: number | null = null;
  let characterBudget = 0;
  const drainWaiters = new Set<() => void>();

  const settleIfIdle = () => {
    if (scheduled || rendered.length !== target.length) return;
    drainWaiters.forEach((resolve) => resolve());
    drainWaiters.clear();
  };

  const clearScheduledCallbacks = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    frame = null;
    fallbackTimer = null;
  };

  const schedule = () => {
    if (cancelled || paused || scheduled || rendered.length >= target.length) {
      settleIfIdle();
      return;
    }
    scheduled = true;
    frame = window.requestAnimationFrame(runTick);
    fallbackTimer = window.setTimeout(() => runTick(performance.now()), FALLBACK_TICK_MS);
  };

  function runTick(timestamp: number) {
    if (!scheduled) return;
    scheduled = false;
    clearScheduledCallbacks();
    if (cancelled) {
      settleIfIdle();
      return;
    }

    const elapsed = lastTickAt === null
      ? 1000 / 60
      : Math.max(0, Math.min(100, timestamp - lastTickAt));
    lastTickAt = timestamp;
    characterBudget += elapsed * CHARACTERS_PER_SECOND / 1000;
    const remaining = target.length - rendered.length;
    if (remaining <= 0) {
      characterBudget = 0;
      settleIfIdle();
      return;
    }

    const count = Math.min(
      remaining,
      MAX_CHARACTERS_PER_TICK,
      Math.max(1, Math.floor(characterBudget)),
    );
    rendered.push(...target.slice(rendered.length, rendered.length + count));
    characterBudget = Math.max(0, characterBudget - count);
    onRender(rendered.join(""));
    schedule();
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible" || cancelled) return;
    lastTickAt = null;
    if (!scheduled && rendered.length < target.length) schedule();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const replace = (text: string) => {
    if (cancelled) return;
    const next = characters(text);
    if (next.length === target.length && next.every((value, index) => value === target[index])) return;

    const renderedIsPrefix = rendered.length <= next.length
      && rendered.every((value, index) => value === next[index]);
    target = next;

    // Canonical corrections must not visibly rewind to a shared prefix and type
    // the answer a second time. Extend a valid prefix normally; otherwise switch
    // to the corrected snapshot atomically.
    if (!renderedIsPrefix) {
      scheduled = false;
      clearScheduledCallbacks();
      rendered = [...next];
      characterBudget = 0;
      lastTickAt = null;
      onRender(rendered.join(""));
      settleIfIdle();
      return;
    }
    schedule();
  };

  return {
    append(text) {
      if (cancelled || !text) return;
      target.push(...characters(text));
      schedule();
    },
    replace,
    finish() {
      if (cancelled || (!scheduled && rendered.length === target.length)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        drainWaiters.add(resolve);
        schedule();
      });
    },
    pause() {
      if (cancelled || paused) return;
      paused = true;
      scheduled = false;
      clearScheduledCallbacks();
      lastTickAt = null;
    },
    resume() {
      if (cancelled || !paused) return;
      paused = false;
      lastTickAt = null;
      schedule();
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      scheduled = false;
      clearScheduledCallbacks();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      drainWaiters.forEach((resolve) => resolve());
      drainWaiters.clear();
    },
    hasContent() {
      return target.length > 0;
    },
  };
}
