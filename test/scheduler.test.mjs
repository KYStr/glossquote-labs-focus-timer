import assert from "node:assert/strict";
import test from "node:test";
import { createTimer, transition } from "../public/js/core/timer.mjs";
import { createScheduler } from "../public/js/scheduler.mjs";

class FakeTimers {
  nextId = 1;
  pending = new Map();
  created = new Map();
  cleared = [];

  setTimeoutFn = (callback, delay) => {
    const id = this.nextId;
    this.nextId += 1;
    const scheduled = { callback, delay };
    this.pending.set(id, scheduled);
    this.created.set(id, scheduled);
    return id;
  };

  clearTimeoutFn = (id) => {
    this.cleared.push(id);
    this.pending.delete(id);
  };

  fire(id) {
    const scheduled = this.pending.get(id);
    assert.ok(scheduled, `expected active fake timeout ${id}`);
    this.pending.delete(id);
    scheduled.callback();
  }

  fireCaptured(id) {
    const scheduled = this.created.get(id);
    assert.ok(scheduled, `expected captured fake timeout ${id}`);
    scheduled.callback();
  }
}

function makeHarness({ visible = true, afterDispatch = null } = {}) {
  const timers = new FakeTimers();
  let currentTime = 1_000;
  let currentState = transition(createTimer(1), { type: "START" }, currentTime).state;
  const events = [];
  let scheduler;

  const dispatch = (event, timestamp) => {
    const result = transition(currentState, event, timestamp);
    currentState = result.state;
    events.push({ event: { ...event }, timestamp, completedNow: result.completedNow });
    afterDispatch?.({ event, timestamp, scheduler });
    return result;
  };

  scheduler = createScheduler({
    getState: () => currentState,
    dispatch,
    now: () => currentTime,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    isVisible: () => visible,
  });

  return {
    get state() {
      return currentState;
    },
    events,
    scheduler,
    timers,
    dispatch,
    setTime(value) {
      currentTime = value;
    },
    setVisible(value) {
      visible = value;
    },
  };
}

test("sync keeps one visible 250 ms timeout and stale callbacks cannot dispatch", () => {
  const harness = makeHarness();
  harness.scheduler.sync();
  const firstId = [...harness.timers.pending.keys()][0];
  assert.equal(harness.timers.pending.size, 1);
  assert.equal(harness.timers.pending.get(firstId).delay, 250);

  harness.scheduler.sync();
  const secondId = [...harness.timers.pending.keys()][0];
  assert.equal(harness.timers.pending.size, 1);
  assert.deepEqual(harness.timers.cleared, [firstId]);
  harness.timers.fireCaptured(firstId);
  assert.equal(harness.events.length, 0);

  harness.setTime(1_250);
  harness.timers.fire(secondId);
  assert.deepEqual(harness.events, [
    { event: { type: "TICK", runId: 1 }, timestamp: 1_250, completedNow: false },
  ]);
  assert.equal(harness.state.remainingMs, 59_750);
  assert.equal(harness.timers.pending.size, 1);
  harness.scheduler.stop();
  assert.equal(harness.timers.pending.size, 0);
});

test("hidden reconciliation, visible restoration, and pagehide isolate callbacks by epoch", () => {
  const harness = makeHarness();
  harness.scheduler.sync();
  const beforeHideId = [...harness.timers.pending.keys()][0];

  harness.setVisible(false);
  harness.setTime(11_000);
  harness.scheduler.reconcile();
  assert.equal(harness.state.remainingMs, 50_000);
  assert.equal(harness.state.runId, 1);
  assert.equal(harness.timers.pending.size, 0);
  assert.deepEqual(harness.events[0], {
    event: { type: "TICK", runId: 1 },
    timestamp: 11_000,
    completedNow: false,
  });
  harness.timers.fireCaptured(beforeHideId);
  assert.equal(harness.events.length, 1);

  harness.setVisible(true);
  harness.setTime(12_000);
  harness.scheduler.reconcile();
  assert.equal(harness.state.remainingMs, 49_000);
  assert.equal(harness.state.runId, 1);
  assert.equal(harness.timers.pending.size, 1);
  const beforePageHideId = [...harness.timers.pending.keys()][0];

  harness.scheduler.stop();
  assert.equal(harness.timers.pending.size, 0);
  harness.timers.fireCaptured(beforePageHideId);
  assert.equal(harness.events.length, 2);
  assert.equal(harness.state.runId, 1);

  harness.setTime(15_000);
  harness.scheduler.reconcile();
  assert.equal(harness.state.remainingMs, 46_000);
  assert.equal(harness.state.runId, 1);
  assert.equal(harness.events.length, 3);
  assert.equal(harness.timers.pending.size, 1);
  harness.timers.fireCaptured(beforeHideId);
  harness.timers.fireCaptured(beforePageHideId);
  assert.equal(harness.events.length, 3);
  assert.equal(harness.timers.pending.size, 1);
});

test("expired callback completes once and leaves no scheduled timeout", () => {
  const harness = makeHarness();
  harness.setTime(61_000);
  harness.scheduler.sync();
  const timeoutId = [...harness.timers.pending.keys()][0];
  harness.timers.fire(timeoutId);

  assert.equal(harness.state.phase, "completed");
  assert.equal(harness.state.remainingMs, 0);
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].completedNow, true);
  assert.equal(harness.timers.pending.size, 0);
  harness.timers.fireCaptured(timeoutId);
  assert.equal(harness.events.length, 1);
  assert.equal(harness.timers.pending.size, 0);
});

test("cancel stops the captured callback before it can complete or reschedule", () => {
  const harness = makeHarness();
  harness.scheduler.sync();
  const capturedId = [...harness.timers.pending.keys()][0];

  harness.scheduler.stop();
  const canceled = harness.dispatch({ type: "CANCEL" }, Symbol());
  harness.scheduler.sync();
  harness.timers.fireCaptured(capturedId);

  assert.deepEqual(canceled, {
    state: {
      phase: "ready",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 60_000,
      deadline: null,
      lastNow: null,
      runId: 2,
      reason: null,
    },
    completedNow: false,
  });
  assert.deepEqual(harness.state, canceled.state);
  assert.equal(harness.events.filter(({ completedNow }) => completedNow).length, 0);
  assert.equal(harness.timers.pending.size, 0);
});

test("dispatch reentry cannot leave more than one active timeout", () => {
  const harness = makeHarness({ afterDispatch: ({ scheduler }) => scheduler?.sync() });
  harness.scheduler.sync();
  const timeoutId = [...harness.timers.pending.keys()][0];
  harness.setTime(2_000);
  harness.timers.fire(timeoutId);

  assert.equal(harness.events.length, 1);
  assert.equal(harness.timers.pending.size, 1);
  harness.scheduler.stop();
  assert.equal(harness.timers.pending.size, 0);
});
