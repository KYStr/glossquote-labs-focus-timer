const ZH_HANT = Object.freeze({
  stateRunning: "進行中",
  stateClockBackward: "裝置時間往回調整，計時已暫停。確認後可繼續剩餘時間。",
  statePaused: "已暫停",
  stateCompleted: "這段計時已結束",
  stateError: "無法取得有效裝置時間。請取消計時後重試。",
  stateReady: "尚未開始",
  buttonPause: "暫停",
  buttonResume: "繼續計時",
  buttonRestart: "再次開始",
  buttonStart: "開始計時",
  buttonCancel: "取消計時",
  durationError: "請輸入 1 至 180 的整數分鐘。",
  statusCancelled: "已取消計時",
  unavailable: "此瀏覽器無法啟動計時。你仍可閱讀使用方式。",
  titleRunning: "{time}｜專注計時",
  titleCompleted: "計時已結束｜專注計時",
});

const EN = Object.freeze({
  stateRunning: "Running",
  stateClockBackward: "The device clock moved backward, so the timer paused. Check the clock, then resume the remaining time.",
  statePaused: "Paused",
  stateCompleted: "This focus session has ended",
  stateError: "The device time is unavailable. Cancel the timer and try again.",
  stateReady: "Not started",
  buttonPause: "Pause",
  buttonResume: "Resume",
  buttonRestart: "Start again",
  buttonStart: "Start timer",
  buttonCancel: "Cancel timer",
  durationError: "Enter a whole number from 1 to 180 minutes.",
  statusCancelled: "Timer cancelled",
  unavailable: "This browser could not start the timer. You can still read the instructions.",
  titleRunning: "{time} | Focus timer",
  titleCompleted: "Timer complete | Focus timer",
});

export const MESSAGES = Object.freeze({
  "zh-Hant": ZH_HANT,
  en: EN,
});

export function getMessages(locale) {
  return locale === "en" ? EN : ZH_HANT;
}
