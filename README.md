# GlossQuote Focus Timer

專注計時器提供單段倒數：設定 1–180 分鐘，開始、暫停、繼續或取消。繁體中文與英文頁面共用本機計時邏輯，計時與操作不需要帳號、通知權限或網路服務。

開發工具需要 Node.js 24+。本工具沒有套件依賴，不需要執行 `npm install`。

## 本機工具

- `npm.cmd run dev`：在 `127.0.0.1:4175` 提供雙語本機預覽；`/en` 與 `/en/` 會轉到 `/en/index.html`。
- `npm.cmd test`：執行離線 Node 測試。
- `npm.cmd run check`：檢查頁面、資產路徑、模組語法及禁止的網路／儲存能力。
- `npm.cmd run build`：建立可預覽的 `dist/`；預覽 HTML 保持 `noindex, nofollow`。
- 正式靜態產物：`node scripts/build.mjs --production --cloudflare --site-url https://focus.glossquote.com/`。
- 正式輸出檢查：`node scripts/check.mjs --production --cloudflare --site-url https://focus.glossquote.com/`。

正式模式會生成雙語 canonical 與 reciprocal hreflang、robots.txt、sitemap.xml、Cloudflare `_headers` 和 `_redirects`。`wrangler.jsonc` 的自動 build 會先建立正式產物，再執行正式輸出檢查。

## 使用限制與發布狀態

計時器不提供通知、聲音、震動、自動休息或跨分頁同步。重新整理會清除目前計時；背景分頁與裝置睡眠可能延遲畫面更新，系統時間變動也會影響倒數。

正式產物與 Cloudflare 設定已備妥，目前尚未部署；不要把正式 SEO 產物當成上線證明。瀏覽器人工驗收中明列的 `NOT_RUN` 項目（包括真實睡眠、確認 BFCache 命中、完整 Network／permissions／storage、讀屏、200% 縮放、reduced-motion 與其他裝置）仍待實測，詳見 `docs/VERIFICATION.md`。

## English

The focus timer runs one session at a time. Set 1–180 minutes, then start, pause, resume, or cancel. Traditional Chinese and English pages use the same local timer logic; no account, notification permission, or runtime network service is required.

Use `npm.cmd run dev`, `npm.cmd test`, `npm.cmd run check`, and `npm.cmd run build` for local work. Preview builds remain `noindex, nofollow`. Prepare production files with the explicit `--production --cloudflare --site-url https://focus.glossquote.com/` flags, then run the same flags with `scripts/check.mjs` to verify the output.

Development requires Node.js 24+. The project has no package dependencies and does not need `npm install`. There are no notifications, sounds, vibration, automatic breaks, or cross-tab sync. Reloading clears the session. Background tabs and device sleep can delay screen updates, and system clock changes affect the countdown. Hosting has not been deployed. Manual checks marked `NOT_RUN` remain pending in `docs/VERIFICATION.md`.
