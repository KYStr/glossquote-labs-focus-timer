const MAX_DURATION_MS = 180 * 60_000;

export function formatRemaining(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > MAX_DURATION_MS) {
    throw new RangeError("milliseconds must be an integer from 0 through 10800000");
  }

  const totalSeconds = Math.ceil(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
