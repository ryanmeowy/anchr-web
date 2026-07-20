import assert from "node:assert/strict";
import test from "node:test";

import { recoverTraditionalTurn } from "./traditional-turn-recovery.ts";

function recoveryOptions(overrides = {}) {
  return {
    sessionId: "session-1",
    resolveTurnId: () => "turn-1",
    fetchTurn: async () => ({ status: "TERMINAL" }),
    isTerminal: (turn) => turn.status === "TERMINAL",
    shouldRetry: () => true,
    wake: Promise.resolve(),
    signal: new AbortController().signal,
    onRecoveryStarted: () => undefined,
    delayMs: 100,
    pollMs: 1,
    totalTimeoutMs: 100,
    ...overrides,
  };
}

test("returns the persisted terminal turn after an interrupted stream", async () => {
  let calls = 0;
  const result = await recoverTraditionalTurn(recoveryOptions({
    fetchTurn: async () => {
      calls += 1;
      return { status: calls === 1 ? "PROCESSING" : "TERMINAL" };
    },
  }));

  assert.deepEqual(result, { status: "TERMINAL" });
  assert.equal(calls, 2);
});

test("retries transient lookup failures", async () => {
  const transient = new Error("not persisted yet");
  let calls = 0;
  const result = await recoverTraditionalTurn(recoveryOptions({
    fetchTurn: async () => {
      calls += 1;
      if (calls === 1) throw transient;
      return { status: "TERMINAL" };
    },
    shouldRetry: (error) => error === transient,
  }));

  assert.deepEqual(result, { status: "TERMINAL" });
  assert.equal(calls, 2);
});

test("propagates explicit business errors without waiting for recovery", async () => {
  const businessError = new Error("invalid request");
  await assert.rejects(
    recoverTraditionalTurn(recoveryOptions({
      fetchTurn: async () => {
        throw businessError;
      },
      shouldRetry: () => false,
    })),
    businessError,
  );
});

test("stops immediately when recovery is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  let recoveryStarted = false;
  const result = await recoverTraditionalTurn(recoveryOptions({
    signal: controller.signal,
    wake: new Promise(() => undefined),
    onRecoveryStarted: () => {
      recoveryStarted = true;
    },
  }));

  assert.equal(result, null);
  assert.equal(recoveryStarted, false);
});
