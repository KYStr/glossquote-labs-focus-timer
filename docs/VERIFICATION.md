# 專注計時驗證紀錄

## 2026-10-07：T03 排程器與繁中介面

### 自動驗收

- `npm.cmd test`：退出碼 0，29/29 通過。包含 T02 純核心測試、T00 scaffold/server/build 安全回歸，以及 scheduler 的單一 250 ms timeout、epoch/runId 過期回呼隔離、hidden reconciliation、visible 恢復、pagehide stop、取消後舊 callback 無效、到期停止與 dispatch 重入上限。
- `npm.cmd run check`：退出碼 0；檢查 7 個 public assets 與 7 個 Node source files。
- 所有 scheduler 案例使用注入假時鐘及 fake timeout，沒有真實長等待。
- 主代理在相同最終版本上獨立執行 `node --test`（29/29）與 `node scripts/check.mjs`（7 public／7 Node），均退出碼 0。

### IAB 人工觀察

由主代理在本機 IAB 預覽 `http://127.0.0.1:4175/`。目標頁面的 UA 字串曾回報為 Chrome/154.0.0.0；完整嵌入引擎版本未另行確認。

- PASS：鍵盤依序開始、暫停、繼續、取消；焦點保持在相應操作位置。
- PASS：一分鐘倒數可見更新。
- PASS：前景一分鐘計時開始 81 秒後，顯示 00:00、「這段計時已結束」與「再次開始」；primary 焦點保留，沒有自動下一段。這是前景到期觀察，不代表背景或睡眠驗收。
- PASS：將 `<img src=x onerror=alert(1)>` 貼入分鐘欄位後，文字完整保留，沒有建立圖片元素或執行事件處理器。
- PASS：無效分鐘會顯示欄位錯誤並停用開始按鈕。
- PASS：320 CSS px 寬度時 `clientWidth=305`、`scrollWidth=305`，180:00 完整可見，按鈕高度 44 px。
- PASS：重新載入後回到 25:00 初始狀態。

### 尚未驗證

- F20 的 Network 請求、權限提示與持久化檢查：NOT_RUN。
- 螢幕閱讀器、實際 200% 縮放、系統 reduced-motion 切換：NOT_RUN。
- F17–F19 的真實背景長時間、裝置睡眠與 BFCache 命中：NOT_RUN；T01 研究亦未能由 IAB 實證背景 visibility 或 BFCache 命中。
- F24 禁用 JavaScript 的人工瀏覽器案例：NOT_RUN；靜態 HTML 測試確認初始開始按鈕 disabled 並保留 25:00 與載入失敗說明。
- T03 未執行 standalone build；build 行為仍由 T00 scaffold 回歸測試覆蓋，T05 會再跑完整 build 驗證。

這些人工結果只代表列出的觀察，不代表所有平台、背景、睡眠、權限、網路或讀屏驗收已通過。產品仍依賴頁面恢復後校正，不保證背景準時更新；沒有通知或聲音，重新載入會清空計時。

## 2026-10-07：主代理 T04 邊界與失敗流程

新增 test/boundaries.test.mjs：四種已知狀態（初始、取樣、暫停恢復、隱藏恢復）×取消／完成／新一輪／再次暫停恢復／非法時鐘復原，共20組獨立排程交錯。每組都真正保留 clearTimeout 前的 callback 並在新狀態後逆序呼叫，驗證舊 callback 不能改 state、completion 次數或唯一排程。主代理 node --test 49/49、node scripts/check.mjs（7 public/8 Node）退出0。

F24 載入失敗 PASS：獨立 loopback fixture 使用產品實際 HTML/CSS，對 JS 模組請求返回503；真 IAB 顯示25:00、停用的開始與完整限制說明，沒有假開始或spinner。這是HTTP載入失敗，不是瀏覽器全域停用JS。fixture位於根 .runs/focus-timer/load-failure-server.mjs，驗證後只停止該fixture程序並關閉自己的分頁。

F17/F18與F19的BFCache命中、F20完整Network/permissions/storage、讀屏、真200%與reduced-motion切換仍NOT_RUN，沒有被來源掃描或假時鐘測試代替。主代理人工讀取所有產品JS：只用本地核心、DOM、Date.now與timeout，沒有網路/儲存/權限/聲音API；這是來源審查證據。使用者已授權保留人工待驗，T04可繼續，未宣稱完整跨瀏覽器驗收。

## T05/T06 最終繁中本機驗收

主代理check/test/build均退出0，49 tests全部通過；七份dist資產逐一SHA256比對public完全一致。metadata、使用方式與FAQ皆為初始靜態HTML，不依賴計時初始化。T06重用此相同最終版本的測試結果；僅後續文件紀錄變更。F01–F16有精確純邏輯/排程證據，F17–F24的實機分支和NOT_RUN見前述，不把預期或假timer當實機PASS。T07雙語與正式SEO工具鏈尚待整合。

## T07-A 雙語整合：主代理來源與 IAB 驗收

2026-10-07：主代理逐檔讀完整i18n/app、兩語HTML、新增CSS與語言/連結測試。修正getMessages對constructor等繼承key不應回傳非翻譯物件；改成固定en/default選擇，並去除逐字複製整份翻譯字典的冗餘oracle，保留必要keys/非空/預期標題與locale選擇測試。獨立node --test test/i18n.test.mjs test/site-links.test.mjs 5/5退出0。

真實IAB：繁中啟動1分鐘後以語言連結進英文，確實到/en/index.html並顯示25:00、Not started；英文0分鐘顯示英文錯誤且Start timer停用；輸入180可開始，鍵盤Pause/Resume/Cancel全部英文，取消返回180:00且focus回Start timer。英文320px時client/scrollWidth同為305，180:00完整；所有可見a/button高度44px。英文品牌連結實際到https://glossquote.com/en/index.html。最後重新開繁中初始頁，保存根.runs/focus-timer/focus-preview.jpg。這些是本機UI與回首頁連結證據，不代表focus正式域名已部署。核心timer/scheduler未改。發布工具鏈與完整整合check仍待T07-B。

## T07 最終整合驗收（2026-10-07）

主代理逐檔審查兩位子代理的實際實作及測試，修正 release 對註解中的重複標籤誤置換、fixture 共用暫存父資料夾的清理競爭，保留既有檔案與路徑安全檢查。最終版本由主代理獨立執行：

- `node --test`：exit 0，59/59。涵蓋核心、排程、交錯、雙語、工具連結、HTTP、來源／build 安全與正式 SEO／輸出完整性。
- `node scripts/check.mjs`：exit 0，9 public assets／13 Node source files。
- `node scripts/build.mjs`：exit 0，preview 9 files；主代理逐檔 SHA256 比對 public 完全相同。
- Wrangler 4.147.0 `deploy --dry-run --config wrangler.jsonc --outdir <task-owned path>`：exit 0；自動執行正式 build 13 files 與正式 check（9 public／13 Node／13 production）通過，0 bindings。Wrangler 的 assets directory 訊息包含目錄項目；實際輸出只有 13 個檔案。僅使用隔離的程序環境，無雲端上傳、無讀取帳戶憑證。

雙語正式 HTML 有各自 canonical、互相對應的 hreflang、index/follow、OpenGraph URL；產生 sitemap.xml、robots.txt、安全標頭及明確路徑重新導向。預覽仍 noindex。這是正式產物的驗證，不代表 focus.glossquote.com 已部署或搜尋引擎已收錄。

首頁加入 focus-timer 草稿、兩語資料齊全且 URL／publishedAt 為 null。主代理首頁 12/12 tests、source check、production build／output check 均 exit 0；五份首頁公開資產與當前線上內容 byte-identical。草稿不會出現在正式工具列表。

T07 沒有修改純核心與 scheduler。原人工 NOT_RUN 均保留；沒有把靜態掃描、假時鐘、前景計時或 CSS viewport 模擬冒充真背景、睡眠、BFCache、Network／權限／儲存、讀屏、真縮放或真裝置。最終本機必要驗收 PASS（使用者已授權人工例外），實際 hosting 尚未部署。

實際委派：`/root/ft_t00_luna`（T00／T02／T03／T07-A）與 `/root/ft_release_luna`（T07-B），均以工具明確要求 `gpt-6-luna`、`max` 並接受。主代理保留架構、研究、邊界驗證、整合、瀏覽器與發布責任；沒有再次委派。模型底層實際路由無獨立證據，標為未確認；不以代理自述核實。

## 2026-10-09 real release verification

The primary deployed the reviewed production assets to focus.glossquote.com using the user-designated credential file, under the explicit narrow authorization recorded in the repository contract. No credential content was printed or published. Worker version: 63fef14e-9d29-4ed9-8d49-598e23bfef0e. All 32 real HTTPS checks passed: GET/HEAD, exact bytes of 11 public assets, bilingual canonical/hreflang/indexability, robots/sitemap, MIME/security headers, root/language redirects and 404 paths. The live homepage was updated only after the tool passed these checks; both catalog pages list the tool with its actual 2026-10-09 first release date and matching-language URLs.

Primary live IAB verification: a real one-minute Chinese session reached 00:00 and the completed message; switching to English reset to 25:00; a two-minute English session started, paused showing 01:58, resumed and was cancelled. The English home link reached the verified English catalog. This is an actual browser smoke check, not background/sleep/BFCache certification. Existing NOT_RUN items and the previously passed 59 offline tests remain recorded above. No functional source changed in this deployment.

## 2026-10-09 external-audit UI clarification

The focus readout now shows `—:—` while the editable minutes field contains an invalid value. The existing validation error and disabled Start button remain active. This is a display-only state: the timer's last valid `remainingMs`, deadline, scheduler, and core algorithm are unchanged; entering a valid value updates the preview through the existing `SET_DURATION` path.

The visible usage note in both languages now states that reloading, leaving the page, or switching languages clears the timer. The device-clock and background/sleep update caveat remains in the note.

Automated acceptance run from `tool-projects/07-focus-timer`:

- `npm.cmd test`: exit 0, 59/59 tests passed.
- `npm.cmd run check`: exit 0, 9 public assets and 13 Node source files checked.

This change has no DOM test harness; no static test was added that merely mirrors the new copy or rendering expression. The delegated work did not run a browser or production build. Primary browser verification remains pending for invalid `181` → `—:—`, valid `180` → `180:00`, and the reset notice in both language pages. Live deploy/source publication and the broader M12 gates are owned by the primary.

Primary local verification (2026-10-09): reviewed all three product diffs against the previous published source; independently ran `node --test` (59/59) and production Cloudflare build (13 files, including production-output validation). Real IAB at loopback preview: zh invalid `181`, `0`, `-1`, `1.5`, empty all show `—:—`, visible error and disabled Start; valid `180` restores `180:00`, clears error and enables Start. English `181`/`180` passed the same checks. English start → pause → resume → cancel returned `180:00`/Timer cancelled. Language navigation reset to `25:00`; both visible reset notices verified. These are actual browser interactions, not simulated DOM tests. Existing manual NOT_RUN exceptions remain.
