export const CHIME_LIMITS = Object.freeze({ seconds: 0.6, peakGain: 0.04, frequency: 660, cleanupMs: 650, resumeMs: 2000 });

export function createChime({ createContext, setTimeoutFn, clearTimeoutFn, onStatus = () => {} }) {
  let enabled = false;
  let running = false;
  let reminded = false;
  let context = null;
  let closing = false;
  let pending = null;
  let tone = null;

  function stopTone() {
    const old = tone;
    tone = null;
    if (!old) return;
    clearTimeoutFn(old.timeout);
    old.oscillator.onended = null;
    try { old.oscillator.stop(); } catch { /* Already stopped. */ }
    try { old.oscillator.disconnect(); } catch { /* Best-effort graph cleanup. */ }
    try { old.gain.disconnect(); } catch { /* Context close also releases the graph. */ }
  }

  function closeContext() {
    pending?.cancel();
    stopTone();
    if (!context || closing) return;
    const old = context;
    closing = true;
    try {
      Promise.resolve(old.close()).then(() => {
        if (context === old) context = null;
        closing = false;
      }, () => onStatus("cleanup"));
    } catch {
      // Keep the closing latch: never allocate another context after failed cleanup.
      onStatus("cleanup");
    }
  }

  function playTone(preview) {
    stopTone();
    if (!context || closing || context.state !== "running") return false;
    const keepForSession = preview && enabled && running;
    const current = { oscillator: null, gain: null, timeout: null };
    try {
      const now = context.currentTime;
      if (!Number.isFinite(now) || now < 0) throw new Error("Invalid audio clock");
      current.oscillator = context.createOscillator();
      current.gain = context.createGain();
      tone = current;
      current.oscillator.type = "sine";
      current.oscillator.frequency.setValueAtTime(CHIME_LIMITS.frequency, now);
      current.gain.gain.setValueAtTime(0, now);
      current.gain.gain.linearRampToValueAtTime(CHIME_LIMITS.peakGain, now + 0.02);
      current.gain.gain.linearRampToValueAtTime(0, now + CHIME_LIMITS.seconds);
      current.oscillator.connect(current.gain);
      current.gain.connect(context.destination);
      const finish = () => {
        if (tone !== current) return;
        stopTone();
        if (!keepForSession || !enabled || !running) closeContext();
        // Keep the attempted-playback message visible; it never claims audibility.
      };
      current.oscillator.onended = finish;
      current.timeout = setTimeoutFn(finish, CHIME_LIMITS.cleanupMs);
      current.oscillator.start(now);
      current.oscillator.stop(now + CHIME_LIMITS.seconds);
      onStatus(preview ? "test" : "attempted");
      return true;
    } catch {
      // Also release a partially constructed graph if a node factory failed.
      if (!tone) {
        try { current.oscillator?.disconnect(); } catch { /* Cleanup continues. */ }
        try { current.gain?.disconnect(); } catch { /* Cleanup continues. */ }
      }
      closeContext();
      onStatus("blocked");
      return false;
    }
  }

  // Called only by handlers for a checkbox, preview, start, or resume gesture.
  function prepareFromGesture(preview = false) {
    pending?.cancel();
    stopTone();
    if (closing) {
      onStatus("cleanup");
      return Promise.resolve(false);
    }
    if (typeof createContext !== "function") {
      onStatus("unsupported");
      return Promise.resolve(false);
    }
    try { context ??= createContext(); } catch {
      onStatus("unsupported");
      return Promise.resolve(false);
    }
    onStatus("preparing");
    return new Promise((resolve) => {
      const operation = { timeout: null, cancel: null };
      const settle = (ready, cancelled = false) => {
        if (pending !== operation) return;
        pending = null;
        clearTimeoutFn(operation.timeout);
        if (cancelled) { resolve(false); return; }
        if (!ready || context?.state !== "running") {
          closeContext();
          onStatus("blocked");
          resolve(false);
        } else if (preview) {
          resolve(playTone(true));
        } else {
          if (!enabled || !running) closeContext();
          onStatus(enabled ? "enabled" : "off");
          resolve(true);
        }
      };
      operation.cancel = () => settle(false, true);
      pending = operation;
      operation.timeout = setTimeoutFn(() => settle(false), CHIME_LIMITS.resumeMs);
      try {
        // Invoke resume synchronously inside the original user gesture.
        Promise.resolve(context.resume()).then(() => settle(true), () => settle(false));
      } catch { settle(false); }
    });
  }

  function setEnabledFromGesture(value, timerRunning = running) {
    enabled = value === true;
    // Lifecycle cleanup can stop audio while the timer still runs. Only a
    // new gesture may re-arm it, using the caller's reconciled timer state.
    running = timerRunning === true && !reminded;
    if (!enabled) {
      closeContext();
      onStatus("off");
      return Promise.resolve(false);
    }
    return prepareFromGesture();
  }

  function startFromGesture() {
    running = true;
    reminded = false;
    if (enabled) return prepareFromGesture();
    closeContext();
    onStatus("off");
    return Promise.resolve(false);
  }

  function resumeFromGesture() {
    running = true;
    return enabled ? prepareFromGesture() : Promise.resolve(false);
  }

  function stop() {
    running = false;
    closeContext();
    onStatus(enabled ? "stopped" : "off");
  }

  function cancel() {
    reminded = true;
    stop();
  }

  function complete() {
    if (reminded) return false;
    const wasRunning = running;
    running = false;
    reminded = true;
    if (wasRunning && enabled && !pending && playTone(false)) return true;
    closeContext();
    onStatus(enabled ? "unready" : "off");
    return false;
  }

  return {
    setEnabledFromGesture, startFromGesture, resumeFromGesture,
    testFromGesture: () => prepareFromGesture(true),
    pause: stop, fail: cancel, cancel, pageHide: stop, complete,
    inspect: () => ({ enabled, running, reminded, context: context !== null, closing, pending: pending !== null, playing: tone !== null }),
  };
}

export function createBrowserChime(browser, onStatus) {
  let Context;
  try { Context = browser.AudioContext ?? browser.webkitAudioContext; } catch { /* Unsupported audio must not disable the timer. */ }
  return createChime({
    createContext: typeof Context === "function" ? () => new Context() : null,
    setTimeoutFn: (callback, delay) => browser.setTimeout(callback, delay),
    clearTimeoutFn: (handle) => browser.clearTimeout(handle),
    onStatus,
  });
}
