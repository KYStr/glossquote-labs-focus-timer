import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildProject } from "../scripts/build.mjs";
import { checkReleaseOutput, runProjectCheck } from "../scripts/check.mjs";
import { cloudflarePolicy } from "../scripts/cloudflare.mjs";
import { assertProductionHtml, parseReleaseArgs, previewSeoTags, productionHtml, releasePolicy } from "../scripts/release.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEMP = resolve(ROOT, "test/.tmp");
const SITE = "https://focus.glossquote.com/";

function contained(root, path) {
  const part = relative(root, path);
  return part !== "" && !isAbsolute(part) && part.split(sep)[0] !== "..";
}

async function removeOwnedTree(directory, allowedRoot) {
  const canonicalRoot = await realpath(allowedRoot);
  const canonicalDirectory = await realpath(directory);
  assert.ok(contained(canonicalRoot, canonicalDirectory));
  assert.equal((await lstat(canonicalDirectory)).isSymbolicLink(), false);
  for (const entry of await readdir(canonicalDirectory, { withFileTypes: true })) {
    const child = resolve(canonicalDirectory, entry.name);
    const info = await lstat(child);
    if (info.isSymbolicLink()) throw new Error("Release fixture cleanup encountered a link.");
    if (info.isDirectory()) await removeOwnedTree(child, canonicalRoot);
    else if (info.isFile()) await rm(child);
    else throw new Error("Release fixture cleanup encountered an unsupported path.");
  }
  await rmdir(canonicalDirectory);
}

async function writeFixtureProject(projectRoot) {
  await mkdir(resolve(projectRoot, "public/en"), { recursive: true });
  await mkdir(resolve(projectRoot, "public/styles"), { recursive: true });
  await mkdir(resolve(projectRoot, "public/js"), { recursive: true });
  await mkdir(resolve(projectRoot, "scripts"), { recursive: true });
  await mkdir(resolve(projectRoot, "test"), { recursive: true });
  await writeFile(resolve(projectRoot, "package.json"), JSON.stringify({
    name: "fixture-focus-timer",
    version: "0.1.0",
    private: true,
    type: "module",
    engines: { node: ">=24" },
    scripts: {
      dev: "node scripts/serve.mjs",
      test: "node --test",
      check: "node scripts/check.mjs",
      build: "node scripts/build.mjs",
    },
  }), "utf8");
  const chineseMetadata = previewSeoTags("index.html").join("\n");
  const englishMetadata = previewSeoTags("en/index.html").join("\n");
  await writeFile(resolve(projectRoot, "public/index.html"), `<!doctype html>
<html lang="zh-Hant"><head><title>Fixture</title>
${chineseMetadata}
<link rel="stylesheet" href="./styles/tokens.css">
<link rel="stylesheet" href="./styles/app.css">
<script type="module" src="./js/app.mjs"></script>
</head><body><a href="https://glossquote.com/index.html">Home</a></body></html>`, "utf8");
  await writeFile(resolve(projectRoot, "public/en/index.html"), `<!doctype html>
<html lang="en"><head><title>Fixture</title>
${englishMetadata}
<link rel="stylesheet" href="../styles/tokens.css">
<link rel="stylesheet" href="../styles/app.css">
<script type="module" src="../js/app.mjs"></script>
</head><body><a href="https://glossquote.com/en/index.html">Home</a></body></html>`, "utf8");
  await writeFile(resolve(projectRoot, "public/styles/tokens.css"), ":root { color-scheme: light; }\n", "utf8");
  await writeFile(resolve(projectRoot, "public/styles/app.css"), "body { margin: 0; }\n", "utf8");
  await writeFile(resolve(projectRoot, "public/js/app.mjs"), "export const app = true;\n", "utf8");
  await writeFile(resolve(projectRoot, "public/js/i18n.mjs"), "export const locale = 'en';\n", "utf8");
  for (const name of ["serve.mjs", "check.mjs", "build.mjs", "release.mjs", "cloudflare.mjs"]) {
    await writeFile(resolve(projectRoot, "scripts", name), "export {};\n", "utf8");
  }
  await writeFile(resolve(projectRoot, "test/scaffold.test.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "test/release.test.mjs"), "export {};\n", "utf8");
}

async function withFixture(action) {
  await mkdir(TEMP, { recursive: true });
  const tempInfo = await lstat(TEMP);
  assert.equal(tempInfo.isSymbolicLink(), false);
  assert.ok(contained(await realpath(ROOT), await realpath(TEMP)));
  const workspace = await mkdtemp(resolve(TEMP, "release-"));
  const projectRoot = resolve(workspace, "product");
  await mkdir(projectRoot);
  try {
    await writeFixtureProject(projectRoot);
    return await action(projectRoot);
  } finally {
    const canonicalWorkspace = await realpath(workspace);
    assert.ok(contained(await realpath(TEMP), canonicalWorkspace));
    await removeOwnedTree(canonicalWorkspace, TEMP);
  }
}

const build = (projectPath, options = {}) => buildProject({ projectPath, check: runProjectCheck, ...options });

test("production arguments require the exact Cloudflare origin and all explicit flags", () => {
  assert.deepEqual(parseReleaseArgs([]), { production: false });
  assert.deepEqual(parseReleaseArgs(["--production", "--cloudflare", "--site-url", SITE]), {
    production: true,
    cloudflare: true,
    siteUrl: SITE,
  });
  for (const args of [
    ["--production"],
    ["--production", "--site-url", SITE],
    ["--cloudflare", "--site-url", SITE],
    ["--production", "--cloudflare"],
    ["--production", "--cloudflare", "--site-url", "https://focus.example.invalid/"],
    ["--production", "--production", "--cloudflare", "--site-url", SITE],
    ["--production", "--cloudflare", "--site-url", SITE, "extra"],
    ["--production", "--cloudflare", "--site-url", "--production"],
  ]) assert.throws(() => parseReleaseArgs(args));
  for (const siteUrl of [undefined, "", "http://focus.glossquote.com/", "https://user@focus.glossquote.com/",
    "https://focus.glossquote.com/?q=1", "https://focus.glossquote.com/#frag", "https://focus.glossquote.com/../x",
    "https://focus.glossquote.com/a//b", "https://focus.glossquote.com.evil.invalid/"]) {
    assert.throws(() => releasePolicy(siteUrl));
  }
  assert.throws(() => cloudflarePolicy("https://focus.example.invalid/"), /focus.glossquote.com/);
});

test("preview and production builds keep source metadata separate and emit exact bilingual SEO", async () => {
  await withFixture(async (projectPath) => {
    const preview = await build(projectPath);
    assert.equal(preview.fileCount, 6);
    const previewHtml = await readFile(resolve(preview.outputPath, "index.html"), "utf8");
    assert.match(previewHtml, /noindex, nofollow/);
    assert.doesNotMatch(previewHtml, /rel="canonical"|focus\.glossquote\.com/);
    await assert.rejects(readFile(resolve(preview.outputPath, "robots.txt")), { code: "ENOENT" });
    await assert.rejects(readFile(resolve(preview.outputPath, "_headers")), { code: "ENOENT" });

    const production = await build(projectPath, { production: true, cloudflare: true, siteUrl: SITE });
    assert.equal(production.fileCount, 10);
    for (const [page, lang] of [["index.html", "zh-Hant"], ["en/index.html", "en"]]) {
      const html = await readFile(resolve(production.outputPath, page), "utf8");
      assert.match(html, new RegExp(`<html lang="${lang}">`));
      assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}${page.replaceAll("/", "\\/")}">`));
      assert.match(html, new RegExp(`<link rel="alternate" hreflang="zh-Hant" href="${SITE}index.html">`));
      assert.match(html, new RegExp(`<link rel="alternate" hreflang="en" href="${SITE}en/index.html">`));
      assert.match(html, /<meta name="robots" content="index, follow">/);
      assert.doesNotMatch(html, /noindex|href="\.\.?\/.*index\.html"/);
      assertProductionHtml(html, page, releasePolicy(SITE));
      assert.match(await readFile(resolve(projectPath, "public", page), "utf8"), /noindex, nofollow/);
    }
    assert.equal(await readFile(resolve(production.outputPath, "robots.txt"), "utf8"),
      `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
    const sitemap = await readFile(resolve(production.outputPath, "sitemap.xml"), "utf8");
    assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((entry) => entry[1]), [
      `${SITE}index.html`, `${SITE}en/index.html`,
    ]);
    const headers = await readFile(resolve(production.outputPath, "_headers"), "utf8");
    assert.match(headers, /connect-src 'none'/);
    assert.match(headers, /frame-ancestors 'none'/);
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    assert.match(headers, /Referrer-Policy: no-referrer/);
    assert.equal(await readFile(resolve(production.outputPath, "_redirects"), "utf8"),
      "/ /index.html 301\n/en /en/index.html 301\n/en/ /en/index.html 301\n");
    assert.equal((await checkReleaseOutput(production.outputPath, {
      projectPath,
      siteUrl: SITE,
      cloudflare: true,
    })).checkedFiles, 10);
  });
});

test("production metadata conversion uses active head offsets when comments contain lookalike text", () => {
  const tags = previewSeoTags("index.html");
  const source = `<!-- template note: <head>${tags.join(" ")}</head> -->\n<!doctype html><html lang="zh-Hant"><head><title>Fixture</title>\n${tags.join("\n")}\n</head><body>Timer</body></html>`;
  const policy = releasePolicy(SITE);
  const result = productionHtml(source, "index.html", policy);
  assert.match(result, /<!-- template note: <head><meta name="robots" content="noindex, nofollow">/);
  assert.match(result, /<head>\s*<meta name="robots" content="index, follow">/);
  assertProductionHtml(result, "index.html", policy);
});

test("invalid production input and preview source metadata preserve the existing dist", async () => {
  await withFixture(async (projectPath) => {
    await mkdir(resolve(projectPath, "dist"));
    const sentinel = resolve(projectPath, "dist/keep.txt");
    await writeFile(sentinel, "preserve before rejected build", "utf8");
    await assert.rejects(buildProject({ projectPath, check: runProjectCheck, production: true, cloudflare: true }), /site-url/);
    await assert.rejects(build(projectPath, { production: true, cloudflare: true, siteUrl: "https://focus.example.invalid/" }), /site-url/);
    assert.equal(await readFile(sentinel, "utf8"), "preserve before rejected build");

    const page = resolve(projectPath, "public/index.html");
    const original = await readFile(page, "utf8");
    await writeFile(page, original.replace('href="./index.html"', 'href="./missing.html"'), "utf8");
    await assert.rejects(build(projectPath, { production: true, cloudflare: true, siteUrl: SITE }), /Unexpected preview SEO/);
    assert.equal(await readFile(sentinel, "utf8"), "preserve before rejected build");

    await writeFile(page, original.replace("</body>", '<script type="module" src="https://evil.invalid/app.mjs"></script></body>'), "utf8");
    await assert.rejects(build(projectPath, { production: true, cloudflare: true, siteUrl: SITE }), /relative local asset path/);
    assert.equal(await readFile(sentinel, "utf8"), "preserve before rejected build");
  });
});

test("production output check catches missing files, wrong bytes, and unexpected files", async () => {
  await withFixture(async (projectPath) => {
    const { outputPath } = await build(projectPath, { production: true, cloudflare: true, siteUrl: SITE });
    const englishPage = resolve(outputPath, "en/index.html");
    const englishBytes = await readFile(englishPage);
    await rm(englishPage);
    await assert.rejects(checkReleaseOutput(outputPath, { projectPath, siteUrl: SITE, cloudflare: true }), /Missing release file: en\/index\.html/);
    await writeFile(englishPage, englishBytes);

    const modulePath = resolve(outputPath, "js/i18n.mjs");
    const moduleBytes = await readFile(modulePath);
    await writeFile(modulePath, Buffer.concat([moduleBytes, Buffer.from("\n// changed\n")]));
    await assert.rejects(checkReleaseOutput(outputPath, { projectPath, siteUrl: SITE, cloudflare: true }), /release bytes differ/);
    await writeFile(modulePath, moduleBytes);

    await writeFile(resolve(outputPath, "unexpected.txt"), "not part of release", "utf8");
    await assert.rejects(checkReleaseOutput(outputPath, { projectPath, siteUrl: SITE, cloudflare: true }), /unexpected release file/);
  });
});
