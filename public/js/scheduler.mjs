const TICK_INTERVAL_MS = 250;

export function createScheduler({ getState, dispatch, now, setTimeoutFn, clearTimeoutFn, isVisible }) {
  let epoch = 0;
  let pending = null;

  function stop() {
    epoch += 1;
    const scheduled = pending;
    pending = null;
    if (scheduled !== null) clearTimeoutFn(scheduled.handle);
  }

  function sync() {
    stop();
    const state = getState();
    if (state.phase !== "running" || !isVisible()) return;

    const scheduled = {
      epoch,
      runId: state.runId,
      handle: null,
    };
    pending = scheduled;
    scheduled.handle = setTimeoutFn(() => {
      if (pending !== scheduled || epoch !== scheduled.epoch) return;
      pending = null;

      const current = getState();
      if (current.phase !== "running" || current.runId !== scheduled.runId || !isVisible()) return;

      dispatch({ type: "TICK", runId: scheduled.runId }, now());
      if (epoch === scheduled.epoch && pending === null) sync();
    }, TICK_INTERVAL_MS);
  }

  function reconcile() {
    stop();
    const state = getState();
    if (state.phase === "running") {
      dispatch({ type: "TICK", runId: state.runId }, now());
    }
    sync();
  }

  return { sync, reconcile, stop };
}
