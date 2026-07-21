import assert from "node:assert/strict";
import test from "node:test";

import { createTypewriterController } from "./typewriter-controller.ts";

function installAnimationClock() {
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  globalThis.window = {
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };

  return {
    frameCount: () => frames.size,
    runFrame(timestamp) {
      const entry = frames.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      frames.delete(id);
      callback(timestamp);
      return true;
    },
    cleanup() {
      delete globalThis.window;
      delete globalThis.document;
    },
  };
}

test("pauses presentation while retaining the queued answer", async () => {
  const clock = installAnimationClock();
  const rendered = [];
  const writer = createTypewriterController({ onRender: (text) => rendered.push(text) });

  writer.pause();
  writer.append("站内切换后继续展示");
  assert.equal(clock.frameCount(), 0);
  assert.deepEqual(rendered, []);

  writer.resume();
  const finished = writer.finish();
  let timestamp = 0;
  while (clock.runFrame(timestamp += 16)) {
    // Drain the deterministic animation queue.
  }
  await finished;

  assert.equal(rendered.at(-1), "站内切换后继续展示");
  writer.cancel();
  clock.cleanup();
});

test("does not advance an answer while presentation is paused mid-stream", () => {
  const clock = installAnimationClock();
  const rendered = [];
  const writer = createTypewriterController({ onRender: (text) => rendered.push(text) });

  writer.append("abcdefghij");
  clock.runFrame(16);
  const beforePause = rendered.at(-1);
  writer.pause();
  assert.equal(clock.frameCount(), 0);
  assert.equal(rendered.at(-1), beforePause);

  writer.cancel();
  clock.cleanup();
});
