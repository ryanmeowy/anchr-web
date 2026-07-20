export type TraditionalTurnRecoveryOptions<T> = {
  sessionId: string;
  resolveTurnId: () => string | undefined;
  fetchTurn: (sessionId: string, turnId: string, signal: AbortSignal) => Promise<T>;
  isTerminal: (turn: T) => boolean;
  shouldRetry: (error: unknown) => boolean;
  wake: Promise<void>;
  signal: AbortSignal;
  onRecoveryStarted: () => void;
  delayMs: number;
  pollMs: number;
  totalTimeoutMs: number;
};

function waitForDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const handleAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, milliseconds);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function recoverTraditionalTurn<T>({
  sessionId,
  resolveTurnId,
  fetchTurn,
  isTerminal,
  shouldRetry,
  wake,
  signal,
  onRecoveryStarted,
  delayMs,
  pollMs,
  totalTimeoutMs,
}: TraditionalTurnRecoveryOptions<T>): Promise<T | null> {
  const deadline = Date.now() + totalTimeoutMs;
  const delayCompleted = await Promise.race([
    waitForDelay(delayMs, signal),
    wake.then(() => true),
  ]);
  if (!delayCompleted || signal.aborted) return null;

  onRecoveryStarted();
  while (!signal.aborted && Date.now() < deadline) {
    const turnId = resolveTurnId();
    if (turnId) {
      try {
        const turn = await fetchTurn(sessionId, turnId, signal);
        if (isTerminal(turn)) return turn;
      } catch (error) {
        if (signal.aborted) return null;
        if (!shouldRetry(error)) throw error;
      }
    }
    const shouldContinue = await waitForDelay(pollMs, signal);
    if (!shouldContinue) return null;
  }
  return null;
}
