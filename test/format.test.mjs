import assert from "node:assert/strict";
import test from "node:test";
import { formatRemaining } from "../public/js/core/format.mjs";

test("F14 formatRemaining rounds partial seconds upward with fixed seconds", () => {
  for (const [milliseconds, expected] of [
    [0, "00:00"],
    [1, "00:01"],
    [999, "00:01"],
    [1_000, "00:01"],
    [59_750, "01:00"],
    [60_001, "01:01"],
    [58_750, "00:59"],
    [1_500_000, "25:00"],
    [10_800_000, "180:00"],
  ]) {
    assert.equal(formatRemaining(milliseconds), expected);
  }
});

test("formatRemaining rejects values outside its exact timer domain", () => {
  for (const milliseconds of [-1, 10_800_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000"]) {
    assert.throws(() => formatRemaining(milliseconds), RangeError);
  }
});
