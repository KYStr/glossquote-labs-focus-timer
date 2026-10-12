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

計時器預設無聲。可明確開啟「到期播放提示音」，或按「試聽」播放本機 0.6 秒短音；不載入外部音檔、不保存選項。每段到期只嘗試一次，取消、暫停、關閉選項或離開頁面會停止並清理音訊。沒有系統通知、震動、自動休息或跨分頁同步；靜音、瀏覽器限制、背景與睡眠仍可能延遲或無聲，請以畫面為準。

U07-OPT-IN-CHIME-20261013 是本次來源候選升級，尚待主代理 review／正式部署與新版外部驗收；以下 2026-10-09 hosting 紀錄是此前版本，不代表提示音升級已上線。

2026-10-09 已正式上線：[繁體中文](https://focus.glossquote.com/index.html) · [English](https://focus.glossquote.com/en/index.html)。32 項正式 HTTPS 檢查通過，11 個公開資產與審查過的建置逐位元組相同；双語首頁已列出本工具。瀏覽器人工驗收中明列的 `NOT_RUN` 項目（包括真實睡眠、確認 BFCache 命中、完整 Network／permissions／storage、讀屏、200% 縮放、reduced-motion 與其他裝置）仍待實測，搜尋引擎收錄亦未確認，詳見 `docs/VERIFICATION.md`。

## English

The focus timer runs one session at a time. Set 1–180 minutes, then start, pause, resume, or cancel. Traditional Chinese and English pages use the same local timer logic; no account, notification permission, or runtime network service is required.

Use `npm.cmd run dev`, `npm.cmd test`, `npm.cmd run check`, and `npm.cmd run build` for local work. Preview builds remain `noindex, nofollow`. Prepare production files with the explicit `--production --cloudflare --site-url https://focus.glossquote.com/` flags, then run the same flags with `scripts/check.mjs` to verify the output.

Development requires Node.js 24+. There are no package dependencies or `npm install` step. Sound is off by default; opt in to a short 0.6-second local chime or use Test sound without enabling it. No external audio files or saved preference. Mute, browser policy, background throttling, and sleep may delay or silence it; check the screen. There are no system notifications, vibration, automatic breaks, or cross-tab sync. Reloading and changing languages reset the session and sound option. The U07 source upgrade awaits primary review, live deployment, and a new external review. The 2026-10-09 verified hosting refers to the earlier release. Manual `NOT_RUN` items and indexing remain unverified.
