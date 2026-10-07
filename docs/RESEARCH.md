# 專注計時：生命週期研究

查閱與實測：2026-10-07（Asia/Taipei）。本紀錄是產品T01採用方案的證據，不能替代完整產品的人工睡眠與背景驗收。

## 官方資料與固定決策

- [WHATWG Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)：回呼不保證精準排程。因此250ms timeout只安排重繪，剩餘時間必須以deadline減目前timestamp。
- [ECMAScript Date.now](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date.now)：提供呼叫時的UTC時間值。產品既定以裝置wall clock為基準，往前跳視為經過時間；倒退採保守暫停。
- [W3C High Resolution Time](https://www.w3.org/TR/hr-time-3/)：monotonic時間與可受系統调整的wall clock不同。本次不偷換為performance.now或聲稱可可靠辨識睡眠與手動調快時間。
- [MDN pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event)：pageshow包含初次載入和歷史返回；persisted可用來確認是否從bfcache恢復，單純按Back不等於命中。
- [MDN visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)：hidden時適合停止不必要的畫面更新；可見時依deadline校正一次再排程。

## 真瀏覽器研究（獨立loopback fixture）

Windows帳戶現有Codex in-app browser。fixture顯示UA為Chrome/154.0.0.0；這是頁面暴露字串，未另確認嵌入引擎完整版本。研究fixture位於根.runs/focus-timer/lifecycle-server.mjs，僅在127.0.0.1:4185提供固定HTML/JS，沒有權限、持久化或外部請求，不納入產品發布。

實際載入觀察到pageshow（persisted=false），visibilityState=visible；visibilityState/pageshow/pagehide/AbortController capability皆存在。經真實連結離開，再使用瀏覽器back返回，重新執行script-loaded與pageshow.persisted=false，代表本次是新文件，**未命中BFCache**。另建立第二分頁後，未觀察到原分頁visibilitychange，無法用此IAB控制證實實際hidden→visible。沒有dispatchEvent冒充瀏覽器事件。

證據：根.runs/focus-timer/lifecycle-browser.json。實際裝置睡眠、背景超過一分鐘、確證BFCache命中、其他瀏覽器/真機：NOT_RUN。使用者已明確允許保留人工待驗；這些項目不記PASS，後續VERIFICATION必須保留。

## 可安全實作的恢復策略

固定state內deadline/remaining/lastNow/runId，scheduler另持epoch；任何旧回呼必須先比對runId及epoch，錯誤/暫停/取消/完成先清timeout。hidden先校正一次後停畫面；visible/pageshow先校正一次再排唯一timeout；pagehide只停排程，persisted時保留必要listeners以便恢復，非persisted離開才abort。取消不取時鐘、不補完成事件。重載一定createTimer(25)。

這是規格支持且有capability的設計；核心與scheduler仍須T02/T03的注入時間/排程測試證明。到期不通知、不聲響，不保證關閉/被丟棄頁面後持續工作。手動時钟/Windows睡眠設定不變更。
