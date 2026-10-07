import assert from "node:assert/strict";
import test from "node:test";
import { createTimer, parseDuration, transition } from "../public/js/core/timer.mjs";

const ONE_MINUTE_START = Object.freeze({
  phase: "running",
  minutes: 1,
  durationMs: 60_000,
  remainingMs: 60_000,
  deadline: 61_000,
  lastNow: 1_000,
  runId: 1,
  reason: null,
});

function startOneMinute() {
  const initial = createTimer(1);
  return transition(initial, { type: "START" }, 1_000).state;
}

test("F01 createTimer starts with the requested full duration", () => {
  assert.deepEqual(createTimer(25), {
    phase: "ready",
    minutes: 25,
    durationMs: 1_500_000,
    remainingMs: 1_500_000,
    deadline: null,
    lastNow: null,
    runId: 0,
    reason: null,
  });
  assert.deepEqual(createTimer(1), {
    phase: "ready",
    minutes: 1,
    durationMs: 60_000,
    remainingMs: 60_000,
    deadline: null,
    lastNow: null,
    runId: 0,
    reason: null,
  });
  for (const minutes of [0, 181, 1.5, "1", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createTimer(minutes), RangeError);
  }
});

test("F02 and F03 parse only bounded ASCII minute strings", () => {
  for (const [raw, value] of [["1", 1], ["180", 180], ["025", 25], ["\t 1 \r", 1], ["00000001", 1]]) {
    assert.deepEqual(parseDuration(raw), { ok: true, value });
  }
  for (const raw of ["0", "181", "00000000"]) {
    assert.deepEqual(parseDuration(raw), { ok: false, code: "DURATION_RANGE" });
  }
  for (const raw of ["", "   ", "1.5", "1e2", "-1", "\u00a01\u00a0"]) {
    assert.deepEqual(parseDuration(raw), { ok: false, code: "DURATION_FORMAT" });
  }
  assert.deepEqual(parseDuration("123456789"), { ok: false, code: "DURATION_RANGE" });
  assert.deepEqual(parseDuration("1        "), { ok: false, code: "DURATION_RANGE" });
  for (const raw of [null, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.deepEqual(parseDuration(raw), { ok: false, code: "DURATION_FORMAT" });
  }
});

test("SET_DURATION accepts only valid values while ready or completed", () => {
  const changed = transition(createTimer(25), { type: "SET_DURATION", minutes: 180 }, Symbol());
  assert.deepEqual(changed, {
    state: {
      phase: "ready",
      minutes: 180,
      durationMs: 10_800_000,
      remainingMs: 10_800_000,
      deadline: null,
      lastNow: null,
      runId: 1,
      reason: null,
    },
    completedNow: false,
  });
  const invalid = transition(changed.state, { type: "SET_DURATION", minutes: 181 }, Symbol());
  assert.equal(invalid.state, changed.state);
  assert.equal(invalid.completedNow, false);
  const running = startOneMinute();
  assert.equal(transition(running, { type: "SET_DURATION", minutes: 2 }, Symbol()).state, running);
});

test("F04 and F05 reconcile against the deadline, not tick count", () => {
  const ready = createTimer(1);
  const started = transition(ready, { type: "START" }, 1_000);
  assert.deepEqual(started, { state: ONE_MINUTE_START, completedNow: false });
  assert.deepEqual(ready, {
    phase: "ready",
    minutes: 1,
    durationMs: 60_000,
    remainingMs: 60_000,
    deadline: null,
    lastNow: null,
    runId: 0,
    reason: null,
  });

  const at1250 = transition(started.state, { type: "TICK", runId: 1 }, 1_250);
  assert.deepEqual(at1250, {
    state: { ...ONE_MINUTE_START, remainingMs: 59_750, lastNow: 1_250 },
    completedNow: false,
  });
  const at2250 = transition(at1250.state, { type: "TICK", runId: 1 }, 2_250);
  assert.deepEqual(at2250, {
    state: { ...ONE_MINUTE_START, remainingMs: 58_750, lastNow: 2_250 },
    completedNow: false,
  });
});

test("F06 pauses with sampled remainder and resumes from a new deadline", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  const paused = transition(started, { type: "PAUSE" }, 11_000);
  assert.deepEqual(paused, {
    state: {
      phase: "paused",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 50_000,
      deadline: null,
      lastNow: 11_000,
      runId: 2,
      reason: null,
    },
    completedNow: false,
  });
  assert.deepEqual(transition(paused.state, { type: "RESUME" }, 51_000), {
    state: {
      phase: "running",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 50_000,
      deadline: 101_000,
      lastNow: 51_000,
      runId: 3,
      reason: null,
    },
    completedNow: false,
  });
});

test("F07 PAUSE reconciles an elapsed deadline as one completion", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  assert.deepEqual(transition(started, { type: "PAUSE" }, 61_000), {
    state: {
      phase: "completed",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 0,
      deadline: null,
      lastNow: 61_000,
      runId: 2,
      reason: null,
    },
    completedNow: true,
  });
});

test("F08 CANCEL resets before stale ticks and does not inspect now", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  const canceled = transition(started, { type: "CANCEL" }, Symbol());
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
  assert.deepEqual(transition(canceled.state, { type: "TICK", runId: 1 }, 61_000), {
    state: canceled.state,
    completedNow: false,
  });
});

test("F09 duplicate START is inert and completed START begins a fresh full run", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  assert.equal(transition(started, { type: "START" }, Symbol()).state, started);
  const completed = transition(started, { type: "TICK", runId: 1 }, 61_000).state;
  assert.deepEqual(completed, {
    phase: "completed",
    minutes: 1,
    durationMs: 60_000,
    remainingMs: 0,
    deadline: null,
    lastNow: 61_000,
    runId: 2,
    reason: null,
  });
  assert.deepEqual(transition(completed, { type: "START" }, 70_000), {
    state: {
      phase: "running",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 60_000,
      deadline: 130_000,
      lastNow: 70_000,
      runId: 3,
      reason: null,
    },
    completedNow: false,
  });
});

test("F10 completes once and ignores later ticks from the completed run", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  const first = transition(started, { type: "TICK", runId: 1 }, 61_000);
  assert.equal(first.completedNow, true);
  assert.equal(first.state.phase, "completed");
  for (const now of [61_001, 99_999]) {
    assert.deepEqual(transition(first.state, { type: "TICK", runId: 1 }, now), {
      state: first.state,
      completedNow: false,
    });
  }
});

test("F11 a late reconciliation completes directly without intermediate ticks", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  assert.deepEqual(transition(started, { type: "TICK", runId: 1 }, 181_000), {
    state: {
      phase: "completed",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 0,
      deadline: null,
      lastNow: 181_000,
      runId: 2,
      reason: null,
    },
    completedNow: true,
  });
});

test("F12 a one-millisecond clock rollback pauses with the prior remaining sample", () => {
  const started = transition(createTimer(1), { type: "START" }, 10_000).state;
  const sampled = transition(started, { type: "TICK", runId: 1 }, 20_000).state;
  assert.deepEqual(sampled, {
    phase: "running",
    minutes: 1,
    durationMs: 60_000,
    remainingMs: 50_000,
    deadline: 70_000,
    lastNow: 20_000,
    runId: 1,
    reason: null,
  });
  const rolledBack = transition(sampled, { type: "TICK", runId: 1 }, 19_999);
  assert.deepEqual(rolledBack, {
    state: {
      phase: "paused",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 50_000,
      deadline: null,
      lastNow: 20_000,
      runId: 2,
      reason: "CLOCK_BACKWARD",
    },
    completedNow: false,
  });
  assert.deepEqual(transition(rolledBack.state, { type: "RESUME" }, 30_000), {
    state: {
      phase: "running",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 50_000,
      deadline: 80_000,
      lastNow: 30_000,
      runId: 3,
      reason: null,
    },
    completedNow: false,
  });
});

test("F13 invalid clock enters error without losing the last remaining sample", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  const invalid = transition(started, { type: "TICK", runId: 1 }, Number.NaN);
  assert.deepEqual(invalid, {
    state: {
      phase: "error",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 60_000,
      deadline: null,
      lastNow: 1_000,
      runId: 2,
      reason: "CLOCK_INVALID",
    },
    completedNow: false,
  });
  assert.equal(transition(invalid.state, { type: "RESUME" }, 2_000).state, invalid.state);
  assert.deepEqual(transition(invalid.state, { type: "CANCEL" }, undefined), {
    state: {
      phase: "ready",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 60_000,
      deadline: null,
      lastNow: null,
      runId: 3,
      reason: null,
    },
    completedNow: false,
  });
});

test("clock bounds admit the last safe deadline and reject values outside the domain", () => {
  const maxNow = Number.MAX_SAFE_INTEGER - 10_800_000;
  const started = transition(createTimer(180), { type: "START" }, maxNow);
  assert.equal(started.state.deadline, Number.MAX_SAFE_INTEGER);
  assert.equal(started.state.runId, 1);
  const invalid = transition(createTimer(1), { type: "START" }, maxNow + 1);
  assert.equal(invalid.state.phase, "error");
  assert.equal(invalid.state.reason, "CLOCK_INVALID");
  assert.equal(invalid.state.remainingMs, 60_000);
});

test("unknown and incompatible events preserve state without validating now", () => {
  const ready = createTimer(1);
  assert.equal(transition(ready, { type: "UNKNOWN" }, Symbol()).state, ready);
  assert.equal(transition(ready, { type: "PAUSE" }, Symbol()).state, ready);
  const started = transition(ready, { type: "START" }, 1_000).state;
  assert.equal(transition(started, { type: "START" }, Symbol()).state, started);
  assert.equal(transition(started, { type: "RESUME" }, Symbol()).state, started);
});

test("cancel and completion reject stale run ids across 20 event-order combinations", () => {
  const prefixes = [
    [],
    [{ type: "TICK", runId: 1, now: 1_250 }],
    [{ type: "TICK", runId: 1, now: 2_000 }],
    [{ type: "TICK", runId: 1, now: 59_999 }],
    [{ type: "START", now: 5_000 }],
    [{ type: "SET_DURATION", minutes: 2, now: Symbol() }],
    [{ type: "UNKNOWN", now: Symbol() }],
    [{ type: "TICK", runId: 1, now: 1_250 }, { type: "TICK", runId: 1, now: 2_250 }],
    [{ type: "TICK", runId: 1, now: 5_000 }, { type: "START", now: Symbol() }],
    [{ type: "SET_DURATION", minutes: 181, now: Symbol() }, { type: "TICK", runId: 1, now: 30_000 }],
  ];

  for (const [index, prefix] of prefixes.entries()) {
    let state = startOneMinute();
    assert.deepEqual(state, ONE_MINUTE_START);
    for (const item of prefix) {
      const { now, ...event } = item;
      state = transition(state, event, now).state;
    }
    const canceled = transition(state, { type: "CANCEL" }, Symbol());
    assert.deepEqual(canceled.state, {
      phase: "ready",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 60_000,
      deadline: null,
      lastNow: null,
      runId: 2,
      reason: null,
    });
    assert.deepEqual(transition(canceled.state, { type: "TICK", runId: 1 }, 61_000 + index), {
      state: canceled.state,
      completedNow: false,
    });
  }

  for (const [index, prefix] of prefixes.entries()) {
    let state = startOneMinute();
    for (const item of prefix) {
      const { now, ...event } = item;
      state = transition(state, event, now).state;
    }
    const completed = transition(state, { type: "TICK", runId: 1 }, 61_000);
    assert.equal(completed.completedNow, true);
    assert.deepEqual(completed.state, {
      phase: "completed",
      minutes: 1,
      durationMs: 60_000,
      remainingMs: 0,
      deadline: null,
      lastNow: 61_000,
      runId: 2,
      reason: null,
    });
    assert.deepEqual(transition(completed.state, { type: "TICK", runId: 1 }, 61_001 + index), {
      state: completed.state,
      completedNow: false,
    });
  }
});

test("F16 cancellation after the deadline does not reconcile into completion", () => {
  const started = transition(createTimer(1), { type: "START" }, 1_000).state;
  const expected = {
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
  };
  assert.deepEqual(transition(started, { type: "CANCEL" }, 61_001), expected);
  assert.deepEqual(transition(started, { type: "CANCEL" }, Symbol()), expected);
});
