import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  {
    name: "Traditional Chinese",
    path: "public/index.html",
    locale: "zh-Hant",
    alternates: [
      ["en", "./en/index.html"],
      ["zh-Hant", "./index.html"],
    ],
    stylesheetPrefix: "./",
    script: "./js/app.mjs",
    languageLink: "./en/index.html",
    home: "https://glossquote.com/index.html",
    unit: "https://units.glossquote.com/index.html",
    date: "https://date.glossquote.com/index.html",
    title: "專注計時器｜設定分鐘、暫停與繼續 — GlossQuote-Labs",
    faqHeadings: [
      "關閉頁面後會提醒我嗎？",
      "切到其他分頁會停止嗎？",
      "時間到了會自動開始休息嗎？",
      "更改電腦時間會怎樣？",
      "會記錄我的專注時數嗎？",
    ],
    limits: ["沒有聲音或系統通知", "裝置睡眠也可能延後更新", "往前調整可能讓計時提前結束", "切換語言", "託管服務仍會收到一般連線資訊"],
  },
  {
    name: "English",
    path: "public/en/index.html",
    locale: "en",
    alternates: [
      ["zh-Hant", "../index.html"],
      ["en", "./index.html"],
    ],
    stylesheetPrefix: "../",
    script: "../js/app.mjs",
    languageLink: "../index.html",
    home: "https://glossquote.com/en/index.html",
    unit: "https://units.glossquote.com/en/index.html",
    date: "https://date.glossquote.com/en/index.html",
    title: "Focus timer | Set minutes, pause, and resume — GlossQuote-Labs",
    faqHeadings: [
      "Will I get an alert if I close the page?",
      "Does it stop when I switch tabs?",
      "Will it start a break automatically?",
      "What if I change the device clock?",
      "Does it save my focus history?",
    ],
    limits: ["no sound or system notifications", "Sleep can also delay updates", "Moving it forward can end the timer early", "switching languages", "hosting service still receives ordinary connection information"],
  },
];

function extractLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    attrs: match[1],
    text: match[2].replace(/<[^>]+>/g, "").trim(),
  }));
}

for (const page of pages) {
  test(`${page.name} page has complete metadata, accessible fallback, and family links`, async () => {
    const html = await readFile(resolve(projectRoot, page.path), "utf8");
    assert.match(html, new RegExp(`<html lang="${page.locale}">`));
    assert.match(html, new RegExp(`<title>${page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/title>`));
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.match(html, /<meta property="og:title" content="[^"]+">/);
    assert.match(html, /<meta property="og:description" content="[^"]+">/);
    assert.match(html, /<meta property="og:type" content="website">/);
    assert.match(html, /<meta property="og:locale" content="[^"]+">/);
    assert.match(html, /<meta property="og:site_name" content="GlossQuote-Labs">/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.doesNotMatch(html, /rel="canonical"|rel="preload"/i);

    const alternates = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)]
      .map((match) => [match[1], match[2]]);
    assert.deepEqual(alternates, page.alternates);

    const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
    assert.deepEqual(stylesheets, [`${page.stylesheetPrefix}styles/tokens.css`, `${page.stylesheetPrefix}styles/app.css`]);
    assert.match(html, new RegExp(`<script type="module" src="${page.script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"><\\/script>`));
    for (const asset of [...stylesheets, page.script]) {
      await access(resolve(resolve(projectRoot, page.path, ".."), asset.replace(/^\.\//, "")));
    }

    assert.match(html, /id="minutes-input"[\s\S]*?type="text"[\s\S]*?inputmode="numeric"[\s\S]*?value="25"[\s\S]*?aria-describedby="minutes-help minutes-error"/);
    assert.doesNotMatch(html, /id="minutes-input"[^>]*maxlength=/i);
    assert.match(html, /id="remaining-time"[^>]*>25:00<\/p>/);
    assert.doesNotMatch(html, /id="remaining-time"[^>]*aria-live=/i);
    assert.match(html, /id="timer-status"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /id="start-button"[^>]*disabled/);
    assert.match(html, /id="minutes-error"[^>]*hidden[^>]*>[^<]+<\/p>/);
    assert.match(html, /id="availability"[^>]*>[^<]+<\/p>/);

    for (const heading of page.faqHeadings) assert.ok(html.includes(`<h3>${heading}</h3>`), `missing FAQ: ${heading}`);
    assert.equal([...html.matchAll(/<h3>/g)].length, 5, "the page should contain five FAQ entries");
    for (const limitation of page.limits) assert.ok(html.includes(limitation), `missing limitation: ${limitation}`);

    const links = extractLinks(html);
    assert.ok(links.some((link) => link.attrs.includes(`href="${page.home}"`)), "missing same-language family home link");
    assert.ok(links.some((link) => link.attrs.includes(`href="${page.unit}"`)), "missing same-language unit converter link");
    assert.ok(links.some((link) => link.attrs.includes(`href="${page.date}"`)), "missing same-language date calculator link");
    assert.ok(links.some((link) => link.attrs.includes(`href="${page.languageLink}"`)), "missing language switch link");
    assert.ok(links.every((link) => !/\b(?:target|ping)\s*=/i.test(link.attrs)), "links must stay simple anchors");
    assert.ok(links.every((link) => link.text.length > 0), "links must have accessible text");
  });
}
