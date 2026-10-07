import assert from "node:assert/strict";
import test from "node:test";
import { getMessages, MESSAGES } from "../public/js/i18n.mjs";

test("supported locales expose the same complete, nonempty message keys", () => {
  assert.deepEqual(Object.keys(MESSAGES).sort(), ["en", "zh-Hant"]);
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES["zh-Hant"]).sort());
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), ["stateRunning", "stateClockBackward", "statePaused", "stateCompleted", "stateError", "stateReady", "buttonPause", "buttonResume", "buttonRestart", "buttonStart", "buttonCancel", "durationError", "statusCancelled", "unavailable", "titleRunning", "titleCompleted"].sort());
  for (const localeMessages of Object.values(MESSAGES)) {
    for (const value of Object.values(localeMessages)) {
      assert.equal(typeof value, "string");
      assert.notEqual(value.trim(), "");
    }
  }
});

test("locale selection returns the requested messages and falls back for unknown locales", () => {
  assert.equal(getMessages("en"), MESSAGES.en);
  assert.equal(getMessages("zh-Hant"), MESSAGES["zh-Hant"]);
  for (const locale of ["unknown", "constructor", "__proto__", null]) assert.equal(getMessages(locale), MESSAGES["zh-Hant"]);
});

test("running titles include the formatted remaining time in both languages", () => {
  assert.equal(MESSAGES["zh-Hant"].titleRunning.replace("{time}", "24:59"), "24:59｜專注計時");
  assert.equal(MESSAGES.en.titleRunning.replace("{time}", "24:59"), "24:59 | Focus timer");
  assert.equal(MESSAGES["zh-Hant"].titleCompleted, "計時已結束｜專注計時");
  assert.equal(MESSAGES.en.titleCompleted, "Timer complete | Focus timer");
});
