const MIN_MINUTES = 1;
const MAX_MINUTES = 180;
const MILLISECONDS_PER_MINUTE = 60_000;
const MAX_DURATION_MS = MAX_MINUTES * MILLISECONDS_PER_MINUTE;
const MAX_CLOCK_VALUE = Number.MAX_SAFE_INTEGER - MAX_DURATION_MS;

function isValidMinutes(minutes) {
  return Number.isSafeInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES;
}

function isValidNow(now) {
  return Number.isSafeInteger(now) && now >= 0 && now <= MAX_CLOCK_VALUE;
}

function incrementRunId(state) {
  if (!Number.isSafeInteger(state.runId) || state.runId < 0 || state.runId === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("runId must be a non-overflowing non-negative safe integer");
  }
  return state.runId + 1;
}

function noTransition(state) {
  return { state, completedNow: false };
}

function clockError(state) {
  return {
    state: {
      ...state,
      phase: "error",
      deadline: null,
      runId: incrementRunId(state),
      reason: "CLOCK_INVALID",
    },
    completedNow: false,
  };
}

function reconcile(state, now) {
  if (!isValidNow(now)) return clockError(state);

  if (now < state.lastNow) {
    return {
      state: {
        ...state,
        phase: "paused",
        deadline: null,
        runId: incrementRunId(state),
        reason: "CLOCK_BACKWARD",
      },
      completedNow: false,
    };
  }

  const remainingMs = Math.max(0, state.deadline - now);
  if (remainingMs === 0) {
    return {
      state: {
        ...state,
        phase: "completed",
        remainingMs: 0,
        deadline: null,
        lastNow: now,
        runId: incrementRunId(state),
        reason: null,
      },
      completedNow: true,
    };
  }

  return {
    state: {
      ...state,
      remainingMs,
      lastNow: now,
      reason: null,
    },
    completedNow: false,
  };
}

export function createTimer(minutes) {
  if (!isValidMinutes(minutes)) {
    throw new RangeError("minutes must be an integer from 1 through 180");
  }

  const durationMs = minutes * MILLISECONDS_PER_MINUTE;
  return {
    phase: "ready",
    minutes,
    durationMs,
    remainingMs: durationMs,
    deadline: null,
    lastNow: null,
    runId: 0,
    reason: null,
  };
}

export function parseDuration(raw) {
  if (typeof raw !== "string") return { ok: false, code: "DURATION_FORMAT" };
  if (raw.length > 8) return { ok: false, code: "DURATION_RANGE" };

  const trimmed = raw.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
  if (!/^[0-9]+$/.test(trimmed)) return { ok: false, code: "DURATION_FORMAT" };

  const minutes = Number(trimmed);
  if (!Number.isSafeInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return { ok: false, code: "DURATION_RANGE" };
  }
  return { ok: true, value: minutes };
}

export function transition(state, event, now) {
  if (!state || typeof state !== "object") throw new TypeError("state must be a timer state");
  const type = event?.type;

  if (type === "CANCEL") {
    return {
      state: {
        ...state,
        phase: "ready",
        remainingMs: state.durationMs,
        deadline: null,
        lastNow: null,
        runId: incrementRunId(state),
        reason: null,
      },
      completedNow: false,
    };
  }

  if (type === "SET_DURATION") {
    if (state.phase !== "ready" && state.phase !== "completed") return noTransition(state);
    if (!isValidMinutes(event.minutes)) return noTransition(state);

    const durationMs = event.minutes * MILLISECONDS_PER_MINUTE;
    return {
      state: {
        ...state,
        phase: "ready",
        minutes: event.minutes,
        durationMs,
        remainingMs: durationMs,
        deadline: null,
        lastNow: null,
        runId: incrementRunId(state),
        reason: null,
      },
      completedNow: false,
    };
  }

  if (type === "START") {
    if (state.phase !== "ready" && state.phase !== "completed") return noTransition(state);
    if (!isValidNow(now)) return clockError(state);

    return {
      state: {
        ...state,
        phase: "running",
        remainingMs: state.durationMs,
        deadline: now + state.durationMs,
        lastNow: now,
        runId: incrementRunId(state),
        reason: null,
      },
      completedNow: false,
    };
  }

  if (type === "TICK") {
    if (state.phase !== "running" || event.runId !== state.runId) return noTransition(state);
    return reconcile(state, now);
  }

  if (type === "PAUSE") {
    if (state.phase !== "running") return noTransition(state);
    const result = reconcile(state, now);
    if (result.state.phase !== "running") return result;

    return {
      state: {
        ...result.state,
        phase: "paused",
        deadline: null,
        runId: incrementRunId(result.state),
      },
      completedNow: false,
    };
  }

  if (type === "RESUME") {
    if (state.phase !== "paused") return noTransition(state);
    if (!isValidNow(now)) return clockError(state);

    return {
      state: {
        ...state,
        phase: "running",
        deadline: now + state.remainingMs,
        lastNow: now,
        runId: incrementRunId(state),
        reason: null,
      },
      completedNow: false,
    };
  }

  return noTransition(state);
}
