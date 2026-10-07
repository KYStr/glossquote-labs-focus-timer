import assert from "node:assert/strict";
import test from "node:test";
import { createTimer, transition } from "../public/js/core/timer.mjs";
import { createScheduler } from "../public/js/scheduler.mjs";

// Captured callbacks are deliberately callable after clearTimeout, as if already queued.
function harness() {
  let state = createTimer(1), clock = 1000, visible = true, nextId = 0, completions = 0;
  const pending = new Map(), captured = [];
  const dispatch = (event, timestamp) => {
    const result = transition(state, event, timestamp);
    state = result.state;
    if (result.completedNow) completions += 1;
  };
  const scheduler = createScheduler({
    getState: () => state, dispatch, now: () => clock, isVisible: () => visible,
    setTimeoutFn(callback) {
      assert.equal(pending.size, 0, "a second timeout must never coexist");
      const id = ++nextId;
      pending.set(id, callback); captured.push(callback); return id;
    },
    clearTimeoutFn(id) { pending.delete(id); },
  });
  return {
    get state() { return state; }, get completions() { return completions; },
    pending, captured, scheduler,
    at(value) { clock = value; }, visible(value) { visible = value; },
    event(type) { scheduler.stop(); dispatch({ type }, type === "CANCEL" ? undefined : clock); scheduler.sync(); },
  };
}

const preludes = [
  { name: "fresh", remaining: 60000, setup() {} },
  { name: "sampled", remaining: 59750, setup(h) { h.at(1250); h.scheduler.reconcile(); } },
  { name: "resumed", remaining: 50000, setup(h) { h.at(11000); h.event("PAUSE"); h.at(51000); h.event("RESUME"); } },
  { name: "restored", remaining: 10000, setup(h) { h.visible(false); h.at(11000); h.scheduler.reconcile(); h.visible(true); h.at(51000); h.scheduler.reconcile(); } },
];

for (const prelude of preludes) {
  for (const ending of ["cancel", "complete", "new-run", "pause-resume", "invalid-recover"]) {
    test(`queued callback boundary: ${prelude.name} / ${ending}`, () => {
      const h = harness(); h.event("START"); prelude.setup(h);
      assert.equal(h.state.remainingMs, prelude.remaining);
      const stale = [...h.captured];
      if (ending === "cancel") {
        h.at(300000); h.event("CANCEL");
        assert.equal(h.state.phase, "ready"); assert.equal(h.state.remainingMs, 60000);
      } else if (ending === "complete") {
        h.at(300000); h.scheduler.reconcile();
        assert.equal(h.state.phase, "completed"); assert.equal(h.state.remainingMs, 0);
      } else if (ending === "new-run") {
        h.event("CANCEL"); h.at(200000); h.event("START");
        assert.equal(h.state.phase, "running"); assert.equal(h.state.deadline, 260000);
      } else if (ending === "pause-resume") {
        h.event("PAUSE"); h.at(200000); h.event("RESUME");
        assert.equal(h.state.phase, "running"); assert.equal(h.state.deadline, 200000 + prelude.remaining);
      } else {
        h.at(NaN); h.scheduler.reconcile();
        assert.equal(h.state.phase, "error"); assert.equal(h.state.reason, "CLOCK_INVALID");
        assert.equal(h.state.remainingMs, prelude.remaining);
        h.event("CANCEL"); assert.equal(h.state.phase, "ready");
      }
      const finalState = h.state;
      const finalPending = [...h.pending.keys()];
      h.at(999999);
      for (const callback of stale.reverse()) callback();
      assert.equal(h.state, finalState, "stale callbacks cannot replace current state");
      assert.deepEqual([...h.pending.keys()], finalPending, "stale callbacks cannot change current scheduling");
      assert.equal(h.completions, ending === "complete" ? 1 : 0);
      assert.equal(h.pending.size, ["new-run", "pause-resume"].includes(ending) ? 1 : 0);
      h.scheduler.stop();
    });
  }
}
