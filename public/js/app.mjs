import { createTimer, parseDuration, transition } from "./core/timer.mjs";
import { formatRemaining } from "./core/format.mjs";
import { createScheduler } from "./scheduler.mjs";
import { getMessages } from "./i18n.mjs";

const messages = getMessages(document.documentElement.lang);
const INITIAL_TITLE = document.title;
const startButton = document.getElementById("start-button");
const cancelButton = document.getElementById("cancel-button");
const minutesInput = document.getElementById("minutes-input");
const minutesError = document.getElementById("minutes-error");
const remainingTime = document.getElementById("remaining-time");
const timerStatus = document.getElementById("timer-status");
const availability = document.getElementById("availability");

let state = null;
let scheduler = null;
let controller = null;
let available = false;
let statusOverride = null;

function assertBrowserApis() {
  if (
    !startButton ||
    !cancelButton ||
    !minutesInput ||
    !minutesError ||
    !remainingTime ||
    !timerStatus ||
    !availability ||
    typeof Date.now !== "function" ||
    typeof window.setTimeout !== "function" ||
    typeof window.clearTimeout !== "function" ||
    typeof document.addEventListener !== "function" ||
    typeof window.addEventListener !== "function" ||
    typeof window.AbortController !== "function" ||
    typeof document.visibilityState !== "string"
  ) {
    throw new Error("Required browser APIs are unavailable.");
  }
}

function describeState(current) {
  if (current.phase === "running") return messages.stateRunning;
  if (current.phase === "paused" && current.reason === "CLOCK_BACKWARD") {
    return messages.stateClockBackward;
  }
  if (current.phase === "paused") return messages.statePaused;
  if (current.phase === "completed") return messages.stateCompleted;
  if (current.phase === "error") return messages.stateError;
  return messages.stateReady;
}

function render() {
  if (!state) return;

  const cancelHadFocus = document.activeElement === cancelButton;
  const editable = state.phase === "ready" || state.phase === "completed";
  const duration = editable ? parseDuration(minutesInput.value) : { ok: true, value: state.minutes };
  const invalidDuration = editable && !duration.ok;
  const formattedTime = formatRemaining(state.remainingMs);
  const statusText = statusOverride ?? describeState(state);

  minutesInput.disabled = !editable;
  minutesInput.setAttribute("aria-invalid", String(invalidDuration));
  minutesError.hidden = !invalidDuration;
  if (invalidDuration && minutesError.textContent !== messages.durationError) {
    minutesError.textContent = messages.durationError;
  }

  if (remainingTime.textContent !== formattedTime) remainingTime.textContent = formattedTime;
  if (timerStatus.textContent !== statusText) timerStatus.textContent = statusText;
  cancelButton.hidden = state.phase !== "running" && state.phase !== "paused" && state.phase !== "error";
  cancelButton.textContent = messages.buttonCancel;

  if (state.phase === "running") startButton.textContent = messages.buttonPause;
  else if (state.phase === "paused") startButton.textContent = messages.buttonResume;
  else if (state.phase === "completed") startButton.textContent = messages.buttonRestart;
  else startButton.textContent = messages.buttonStart;

  startButton.disabled = !available || state.phase === "error" || !duration.ok;
  if (cancelButton.hidden && cancelHadFocus) startButton.focus();

  let nextTitle = INITIAL_TITLE;
  if (state.phase === "running") nextTitle = messages.titleRunning.replace("{time}", formattedTime);
  else if (state.phase === "completed") nextTitle = messages.titleCompleted;
  if (document.title !== nextTitle) document.title = nextTitle;
}

function dispatch(event, timestamp) {
  const previousPhase = state.phase;
  const result = transition(state, event, timestamp);
  state = result.state;
  if (event.type === "CANCEL") statusOverride = messages.statusCancelled;
  else if (result.state.phase !== previousPhase) statusOverride = null;
  render();
  return result;
}

function applyUserEvent(event, timestamp) {
  scheduler.stop();
  dispatch(event, timestamp);
  scheduler.sync();
}

function handlePrimaryAction() {
  if (state.phase === "running") {
    applyUserEvent({ type: "PAUSE" }, Date.now());
    return;
  }
  if (state.phase === "paused") {
    applyUserEvent({ type: "RESUME" }, Date.now());
    return;
  }
  if (state.phase === "ready" || state.phase === "completed") {
    applyUserEvent({ type: "START" }, Date.now());
  }
}

function handleMinutesInput() {
  if (state.phase !== "ready" && state.phase !== "completed") return;
  const parsed = parseDuration(minutesInput.value);
  if (parsed.ok) dispatch({ type: "SET_DURATION", minutes: parsed.value });
  else render();
}

function cancelTimer() {
  applyUserEvent({ type: "CANCEL" });
}

function handleVisibilityChange() {
  scheduler.reconcile();
}

function handlePageShow() {
  scheduler.reconcile();
}

function handlePageHide(event) {
  scheduler.stop();
  if (!event.persisted) controller.abort();
}

try {
  assertBrowserApis();
  state = createTimer(25);
  controller = new window.AbortController();
  scheduler = createScheduler({
    getState: () => state,
    dispatch,
    now: () => Date.now(),
    setTimeoutFn: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeoutFn: (handle) => window.clearTimeout(handle),
    isVisible: () => document.visibilityState === "visible",
  });

  startButton.addEventListener("click", handlePrimaryAction, { signal: controller.signal });
  cancelButton.addEventListener("click", cancelTimer, { signal: controller.signal });
  minutesInput.addEventListener("input", handleMinutesInput, { signal: controller.signal });
  document.addEventListener("visibilitychange", handleVisibilityChange, { signal: controller.signal });
  window.addEventListener("pageshow", handlePageShow, { signal: controller.signal });
  window.addEventListener("pagehide", handlePageHide, { signal: controller.signal });

  available = true;
  availability.hidden = true;
  scheduler.sync();
  render();
} catch {
  scheduler?.stop();
  controller?.abort();
  startButton?.setAttribute("disabled", "");
  if (availability) {
    availability.hidden = false;
    availability.textContent = messages.unavailable;
  }
}
