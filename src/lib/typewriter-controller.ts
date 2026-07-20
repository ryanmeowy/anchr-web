export type TypewriterController = {
  append: (text: string) => void;
  replace: (text: string) => void;
  finish: () => Promise<void>;
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
    if (cancelled || scheduled || rendered.length >= target.length) {
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

    let commonLength = 0;
    while (commonLength < rendered.length
      && commonLength < next.length
      && rendered[commonLength] === next[commonLength]) {
      commonLength += 1;
    }

    // A reconnect can provide a corrected canonical snapshot. Keep the shared
    // prefix and type only the remaining suffix instead of flashing the full text.
    if (commonLength < rendered.length) {
      rendered = next.slice(0, commonLength);
      characterBudget = 0;
      onRender(rendered.join(""));
    }
    target = next;
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
