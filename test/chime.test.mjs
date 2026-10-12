import test from "node:test";
import assert from "node:assert/strict";
import { createChime, CHIME_LIMITS } from "../public/js/chime.mjs";
import { createTimer, transition } from "../public/js/core/timer.mjs";
import { createScheduler } from "../public/js/scheduler.mjs";

const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

function fixture({ resume = "ok", closeFails = false, nodeFails = false } = {}) {
  const contexts = [], timers = new Map(), status = [], deferred = [];
  let sequence = 0;
  const sound = createChime({
    createContext: resume === "unsupported" ? null : () => {
      const context = {
        state: "suspended", currentTime: 10, destination: {}, oscillators: [], gains: [], closes: 0, resumes: 0,
        resume() {
          this.resumes += 1;
          if (resume === "reject") return Promise.reject(new Error("fake rejection"));
          if (resume === "throw") throw new Error("fake exception");
          if (resume === "deferred") return new Promise((resolve, reject) => deferred.push({ resolve: () => { this.state = "running"; resolve(); }, reject }));
          this.state = "running";
          return Promise.resolve();
        },
        close() { this.closes += 1; if (closeFails) return Promise.reject(new Error("fake close")); this.state = "closed"; return Promise.resolve(); },
        createOscillator() {
          const oscillator = { starts: [], stops: [], disconnected: false, onended: null,
            frequency: { values: [], setValueAtTime(value, at) { this.values.push([value, at]); } },
            connect() {}, disconnect() { this.disconnected = true; },
            start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); },
          };
          this.oscillators.push(oscillator);
          return oscillator;
        },
        createGain() {
          if (nodeFails) throw new Error("fake node creation");
          const gain = { disconnected: false, connect() {}, disconnect() { this.disconnected = true; },
            gain: { values: [], setValueAtTime(value, at) { this.values.push([value, at]); }, linearRampToValueAtTime(value, at) { this.values.push([value, at]); } },
          };
          this.gains.push(gain); return gain;
        },
      };
      contexts.push(context); return context;
    },
    setTimeoutFn(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeoutFn(id) { timers.delete(id); }, onStatus(code) { status.push(code); },
  });
  return { sound, contexts, timers, status, deferred,
    end() { contexts.at(-1)?.oscillators.at(-1)?.onended?.(); },
    runDelay(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } },
  };
}

test("default and silent sessions never construct or resume audio", async () => {
  const f = fixture();
  assert.equal(f.contexts.length, 0);
  await f.sound.startFromGesture();
  f.sound.pause(); await f.sound.resumeFromGesture();
  assert.equal(f.sound.complete(), false);
  assert.equal(f.contexts.length, 0);
  assert.equal(f.timers.size, 0);
});

test("preview is explicit, finite, low gain, and does not enable the option", async () => {
  const f = fixture();
  assert.equal(await f.sound.testFromGesture(), true);
  const c = f.contexts[0], oscillator = c.oscillators[0];
  assert.equal(f.sound.inspect().enabled, false);
  assert.equal(oscillator.type, "sine");
  assert.deepEqual(oscillator.frequency.values, [[660, 10]]);
  assert.deepEqual(oscillator.starts, [10]);
  assert.equal(oscillator.stops[0], 10.6);
  assert.ok(oscillator.stops[0] - oscillator.starts[0] <= 1.5);
  assert.deepEqual(c.gains[0].gain.values, [[0, 10], [0.04, 10.02], [0, 10.6]]);
  assert.ok(c.gains[0].gain.values.every(([gain]) => gain >= 0 && gain <= 0.04));
  f.end(); await flush();
  assert.equal(c.closes, 1);
  assert.ok(oscillator.disconnected && c.gains[0].disconnected);
  assert.equal(f.sound.inspect().context, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.status.includes("test"), true);
});

test("preview watchdog cleans up if ended is not delivered", async () => {
  const f = fixture(); await f.sound.testFromGesture();
  f.runDelay(CHIME_LIMITS.cleanupMs); await flush();
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.sound.inspect().playing, false);
  assert.equal(f.timers.size, 0);
});

test("repeated preview reuses one context and detaches old nodes and callbacks", async () => {
  const f = fixture(); await f.sound.testFromGesture();
  const old = f.contexts[0].oscillators[0], staleEnd = old.onended;
  await f.sound.testFromGesture();
  assert.equal(f.contexts.length, 1);
  assert.ok(old.disconnected);
  assert.equal(f.contexts[0].oscillators.length, 2);
  staleEnd();
  assert.equal(f.sound.inspect().playing, true);
  assert.equal(f.timers.size, 1);
  f.end(); await flush();
  assert.equal(f.timers.size, 0);
});

test("enabling probes without a tone or retained ready-page context; completion is once", async () => {
  const f = fixture(); await f.sound.setEnabledFromGesture(true); await flush();
  assert.equal(f.contexts[0].oscillators.length, 0);
  assert.equal(f.contexts[0].closes, 1);
  await f.sound.startFromGesture();
  const c = f.contexts[1];
  assert.equal(f.sound.complete(), true);
  assert.equal(f.sound.complete(), false);
  assert.equal(c.oscillators.length, 1);
  f.end(); await flush();
  assert.equal(c.closes, 1);
  await f.sound.startFromGesture();
  assert.equal(f.sound.complete(), true);
  assert.equal(f.contexts[2].oscillators.length, 1);
  f.sound.cancel(); await flush();
});

for (const action of ["cancel", "pause", "fail", "pageHide"]) {
  test(`${action} stops preview, closes audio, clears timeouts and prevents automatic completion`, async () => {
    const f = fixture(); await f.sound.setEnabledFromGesture(true); await flush();
    await f.sound.startFromGesture(); await f.sound.testFromGesture();
    const c = f.contexts.at(-1), staleEnd = c.oscillators[0].onended;
    f.sound[action](); await flush(); staleEnd();
    assert.equal(f.sound.complete(), false);
    assert.equal(c.closes, 1);
    assert.ok(c.oscillators[0].disconnected && c.gains[0].disconnected);
    assert.equal(f.timers.size, 0);
    assert.equal(f.sound.inspect().context, false);
  });
}

test("turning off stops an in-progress completion tone immediately", async () => {
  const f = fixture(); await f.sound.setEnabledFromGesture(true); await flush();
  await f.sound.startFromGesture(); f.sound.complete();
  const c = f.contexts.at(-1);
  await f.sound.setEnabledFromGesture(false); await flush();
  assert.equal(c.closes, 1); assert.ok(c.oscillators[0].disconnected);
  assert.equal(f.timers.size, 0); assert.equal(f.status.at(-1), "off");
});

for (const resume of ["unsupported", "reject", "throw"]) {
  test(`${resume} is reported and does not make a session audible`, async () => {
    const f = fixture({ resume });
    assert.equal(await f.sound.setEnabledFromGesture(true), false); await flush();
    assert.ok(f.status.includes(resume === "unsupported" ? "unsupported" : "blocked"));
    assert.equal(await f.sound.startFromGesture(), false); await flush();
    assert.equal(f.sound.complete(), false);
    assert.equal(f.timers.size, 0);
    assert.ok(f.contexts.every(c => c.closes === 1 && c.oscillators.length === 0));
  });
}

for (const action of ["cancel", "pageHide", "off"]) {
  test(`late resume after ${action} cannot play or allocate again`, async () => {
    const f = fixture({ resume: "deferred" });
    const waiting = f.sound.testFromGesture();
    if (action === "off") await f.sound.setEnabledFromGesture(false); else f.sound[action]();
    assert.equal(await waiting, false); await flush();
    f.deferred[0].resolve(); await flush();
    assert.equal(f.contexts.length, 1);
    assert.equal(f.contexts[0].oscillators.length, 0);
    assert.equal(f.contexts[0].closes, 1);
    assert.equal(f.timers.size, 0);
  });
}

test("resume timeout releases its context and never plays on a late resolution", async () => {
  const f = fixture({ resume: "deferred" }); const waiting = f.sound.testFromGesture();
  f.runDelay(CHIME_LIMITS.resumeMs);
  assert.equal(await waiting, false); await flush();
  f.deferred[0].resolve(); await flush();
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.contexts[0].oscillators.length, 0);
  assert.equal(f.timers.size, 0);
});

test("node creation failure closes the partial graph; failed close prevents allocation growth", async () => {
  const f = fixture({ nodeFails: true }); assert.equal(await f.sound.testFromGesture(), false); await flush();
  assert.ok(f.contexts[0].oscillators[0].disconnected);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.timers.size, 0);
  const blocked = fixture({ closeFails: true });
  await blocked.sound.testFromGesture(); blocked.end(); await flush();
  assert.equal(await blocked.sound.testFromGesture(), false);
  assert.equal(blocked.contexts.length, 1);
  assert.equal(blocked.status.at(-1), "cleanup");
});

test("actual timer and scheduler completion flags suppress repeated/background/cancelled callbacks", async () => {
  const f = fixture(); await f.sound.setEnabledFromGesture(true); await flush();
  let state = createTimer(1), now = 1000, visible = true, scheduled = null;
  const scheduler = createScheduler({ getState: () => state, now: () => now,
    isVisible: () => visible, setTimeoutFn(callback) { scheduled = callback; return 1; }, clearTimeoutFn() { scheduled = null; },
    dispatch(event, timestamp) { const result = transition(state, event, timestamp); state = result.state; if (result.completedNow) f.sound.complete(); return result; },
  });
  state = transition(state, { type: "START" }, now).state;
  await f.sound.startFromGesture(); scheduler.sync(); const old = scheduled;
  visible = false; now = 70_000; scheduler.reconcile();
  visible = true; scheduler.reconcile(); old(); scheduler.reconcile();
  assert.equal(state.phase, "completed");
  assert.equal(f.contexts.at(-1).oscillators.length, 1);
  f.end(); await flush();
  state = transition(state, { type: "START" }, now).state; await f.sound.startFromGesture(); scheduler.sync();
  const stale = scheduled, last = f.contexts.at(-1);
  state = transition(state, { type: "CANCEL" }).state; f.sound.cancel(); scheduler.sync();
  now = 140_000; stale(); await flush();
  assert.equal(state.phase, "ready"); assert.equal(last.oscillators.length, 0); assert.equal(last.closes, 1);
  assert.equal(f.timers.size, 0);
});
