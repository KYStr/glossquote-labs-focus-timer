import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildProject } from "../scripts/build.mjs";
import { runProjectCheck } from "../scripts/check.mjs";
import { createStaticServer } from "../scripts/serve.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_ROOT = resolve(PROJECT_ROOT, "test");
const TEMP_ROOT = resolve(TEST_ROOT, ".tmp");

async function ensureTempRoot() {
  const testInfo = await lstat(TEST_ROOT);
  assert.equal(testInfo.isSymbolicLink(), false, "test directory must not be linked");
  assert.equal(testInfo.isDirectory(), true, "test directory must be a directory");

  try {
    const tempInfo = await lstat(TEMP_ROOT);
    assert.equal(tempInfo.isSymbolicLink(), false, "test/.tmp must not be linked");
    assert.equal(tempInfo.isDirectory(), true, "test/.tmp must be a directory");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(TEMP_ROOT);
  }
  assert.equal(resolve(TEMP_ROOT), TEMP_ROOT);
}

async function withTempWorkspace(callback) {
  await ensureTempRoot();
  const workspace = await mkdtemp(resolve(TEMP_ROOT, "scaffold-"));
  const relativeWorkspace = relative(TEMP_ROOT, workspace);
  assert.equal(relativeWorkspace.startsWith(`..${sep}`), false);
  assert.equal(relativeWorkspace, basename(workspace));
  try {
    return await callback(workspace);
  } finally {
    const tempRootInfo = await lstat(TEMP_ROOT);
    const tempRootCanonical = await realpath(TEMP_ROOT);
    assert.equal(tempRootInfo.isSymbolicLink(), false, "test/.tmp must remain a regular directory");
    assert.equal(resolve(tempRootCanonical), TEMP_ROOT);
    const info = await lstat(workspace);
    assert.equal(info.isSymbolicLink(), false, "test workspace must not be linked before cleanup");
    const canonicalWorkspace = await realpath(workspace);
    assert.equal(relative(TEMP_ROOT, canonicalWorkspace).startsWith(`..${sep}`), false);
    assert.equal(relativeWorkspace, basename(canonicalWorkspace));
    await removeOwnedTree(workspace, TEMP_ROOT);
  }
}

async function removeOwnedTree(directory, allowedRoot) {
  const canonicalAllowedRoot = await realpath(allowedRoot);
  const canonicalDirectory = await realpath(directory);
  const difference = relative(canonicalAllowedRoot, canonicalDirectory);
  assert.notEqual(difference, "..");
  assert.equal(difference.startsWith(`..${sep}`), false);

  for (const entry of await readdir(canonicalDirectory, { withFileTypes: true })) {
    const childPath = resolve(canonicalDirectory, entry.name);
    const info = await lstat(childPath);
    if (info.isSymbolicLink()) {
      await rm(childPath, { force: false });
    } else if (info.isDirectory()) {
      await removeOwnedTree(childPath, canonicalAllowedRoot);
    } else if (info.isFile()) {
      await unlink(childPath);
    } else {
      throw new Error("Unexpected test artifact type; refusing cleanup.");
    }
  }
  await rmdir(canonicalDirectory);
}

async function writeFixtureProject(projectRoot, { appSource = "export {};" } = {}) {
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
  await writeFile(resolve(projectRoot, "public/index.html"), `<!doctype html>
<html lang="zh-Hant"><head><title>Fixture</title>
<meta name="robots" content="noindex, nofollow">
<link rel="alternate" hreflang="en" href="./en/index.html">
<link rel="alternate" hreflang="zh-Hant" href="./index.html">
<link rel="stylesheet" href="./styles/tokens.css">
<link rel="stylesheet" href="./styles/app.css">
<script type="module" src="./js/app.mjs"></script>
</head><body><a href="https://glossquote.com/index.html">Home</a><button type="button" disabled>開始計時</button></body></html>`, "utf8");
  await writeFile(resolve(projectRoot, "public/en/index.html"), `<!doctype html>
<html lang="en"><head><title>Fixture</title>
<meta name="robots" content="noindex, nofollow">
<link rel="alternate" hreflang="zh-Hant" href="../index.html">
<link rel="alternate" hreflang="en" href="./index.html">
<link rel="stylesheet" href="../styles/tokens.css">
<link rel="stylesheet" href="../styles/app.css">
<script type="module" src="../js/app.mjs"></script>
</head><body><button type="button" disabled>Start timer</button></body></html>`, "utf8");
  await writeFile(resolve(projectRoot, "public/styles/tokens.css"), ":root { color-scheme: light; }\n", "utf8");
  await writeFile(resolve(projectRoot, "public/styles/app.css"), "body { margin: 0; }\n", "utf8");
  await writeFile(resolve(projectRoot, "public/js/app.mjs"), appSource, "utf8");
  await writeFile(resolve(projectRoot, "public/js/i18n.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "scripts/serve.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "scripts/check.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "scripts/build.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "scripts/release.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "scripts/cloudflare.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "test/scaffold.test.mjs"), "export {};\n", "utf8");
  await writeFile(resolve(projectRoot, "test/release.test.mjs"), "export {};\n", "utf8");
}

async function send(server, { method = "GET", path = "/" } = {}) {
  const address = server.address();
  assert.equal(typeof address, "object");
  return await sendToPort(address.port, { method, path });
}

async function sendToPort(port, { method = "GET", path = "/" } = {}) {
  return await new Promise((resolveResponse, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      method,
      path,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveResponse({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function withServer(server, callback) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await callback(server);
  } finally {
    const closed = once(server, "close");
    server.close();
    await closed;
  }
}

test("page keeps noindex and an inactive static fallback until the app initializes", async () => {
  const packageData = JSON.parse(await readFile(resolve(PROJECT_ROOT, "package.json"), "utf8"));
  assert.equal(packageData.private, true);
  assert.equal(packageData.type, "module");
  assert.equal(packageData.engines.node, ">=24");
  assert.deepEqual(packageData.scripts, {
    dev: "node scripts/serve.mjs",
    test: "node --test",
    check: "node scripts/check.mjs",
    build: "node scripts/build.mjs",
  });
  assert.equal(packageData.dependencies, undefined);
  assert.equal(packageData.devDependencies, undefined);

  const html = await readFile(resolve(PROJECT_ROOT, "public/index.html"), "utf8");
  assert.match(html, /<title>專注計時器｜設定分鐘、暫停與繼續 — GlossQuote-Labs<\/title>/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /<link rel="alternate" hreflang="en" href="\.\/en\/index\.html">/);
  assert.match(html, /<link rel="alternate" hreflang="zh-Hant" href="\.\/index\.html">/);
  assert.match(html, /id="start-button"[^>]*disabled/);
  assert.match(html, /id="remaining-time"[^>]*>25:00<\/p>/);
  assert.match(html, /id="availability"[^>]*>[^<]*開始按鈕會保持停用/);
  assert.match(html, /id="minutes-input"[^>]*type="text"[^>]*inputmode="numeric"/);
  assert.doesNotMatch(html.match(/<input\b[^>]*id="minutes-input"[^>]*>/)?.[0] ?? "", /\bmaxlength\s*=/i);
  assert.doesNotMatch(html.match(/<p\b[^>]*id="remaining-time"[^>]*>/)?.[0] ?? "", /\baria-live\s*=/i);
  const english = await readFile(resolve(PROJECT_ROOT, "public/en/index.html"), "utf8");
  assert.match(english, /<html lang="en">/);
  assert.match(english, /<link rel="alternate" hreflang="zh-Hant" href="\.\.\/index\.html">/);
  assert.match(english, /<link rel="alternate" hreflang="en" href="\.\/index\.html">/);
  assert.match(await readFile(resolve(PROJECT_ROOT, "public/js/i18n.mjs"), "utf8"), /export/);
});

test("project check validates actual syntax, local imports, and forbidden APIs", async () => {
  await withTempWorkspace(async (workspace) => {
    const projectRoot = resolve(workspace, "valid-project");
    await mkdir(projectRoot);
    await writeFixtureProject(projectRoot);
    const result = await runProjectCheck({ projectPath: projectRoot });
    assert.equal(result.fileCount, 6);
    assert.equal(result.nodeSourceCount, 7);

    await writeFile(resolve(projectRoot, "test/scaffold.test.mjs"), 'import "../public/js/app.mjs";\n', "utf8");
    assert.equal((await runProjectCheck({ projectPath: projectRoot })).nodeSourceCount, 7);
    await writeFile(resolve(projectRoot, "test/scaffold.test.mjs"), "export {};\n", "utf8");

    await writeFile(
      resolve(projectRoot, "public/index.html"),
      (await readFile(resolve(projectRoot, "public/index.html"), "utf8"))
        .replace("</body>", '<a id="help" href="#help">Help</a><a href="./index.html#help">Page</a></body>'),
      "utf8",
    );
    assert.equal((await runProjectCheck({ projectPath: projectRoot })).fileCount, 6);
    const originalHtml = await readFile(resolve(projectRoot, "public/index.html"), "utf8");

    await writeFile(resolve(projectRoot, "public/js/app.mjs"), "export const = 1;", "utf8");
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /JavaScript syntax check failed/);

    await writeFile(resolve(projectRoot, "public/js/app.mjs"), 'import "./missing.mjs";\n', "utf8");
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /existing allowed public asset/);

    await writeFile(resolve(projectRoot, "public/js/app.mjs"), "window.localStorage;\n", "utf8");
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /Disallowed browser capability/);

    await writeFile(resolve(projectRoot, "public/js/app.mjs"), "document.body.innerHTML = 'x';\n", "utf8");
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /Disallowed browser capability/);

    await writeFile(resolve(projectRoot, "public/js/app.mjs"), "export {};\n", "utf8");
    await writeFile(
      resolve(projectRoot, "public/index.html"),
      originalHtml.replace("</body>", '<a href="https://example.invalid/">External</a></body>'),
      "utf8",
    );
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /relative local asset path/);

    for (const href of [
      "https://glossquote.com.evil.invalid/index.html",
      "https://glossquote.com/index.html?next=https://glossquote.com/",
      "https://date.glossquote.com/en/index.html#fragment",
    ]) {
      await writeFile(
        resolve(projectRoot, "public/index.html"),
        originalHtml.replace("</body>", `<a href="${href}">External</a></body>`),
        "utf8",
      );
      await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /relative local asset path/);
    }
    await writeFile(
      resolve(projectRoot, "public/index.html"),
      originalHtml.replace("</body>", '<a href="https://units.glossquote.com/en/index.html">Units</a></body>'),
      "utf8",
    );
    assert.equal((await runProjectCheck({ projectPath: projectRoot })).fileCount, 6);

    await writeFile(
      resolve(projectRoot, "public/index.html"),
      originalHtml.replace("</body>", '<a href="./missing.html">Missing</a></body>'),
      "utf8",
    );
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /existing allowed public asset/);

    await writeFile(
      resolve(projectRoot, "public/index.html"),
      originalHtml.replace("</body>", '<a href="#missing">Missing section</a></body>'),
      "utf8",
    );
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /missing local fragment/);

    await writeFile(
      resolve(projectRoot, "public/index.html"),
      originalHtml.replace("</body>", '<a href="./index.html" ping="https://example.invalid/">Ping</a></body>'),
      "utf8",
    );
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /ping/);

    await writeFile(
      resolve(projectRoot, "public/index.html"),
      originalHtml.replace("</body>", '<button formaction="https://example.invalid/">Submit</button></body>'),
      "utf8",
    );
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /submit, ping, or post/);

    await writeFile(
      resolve(projectRoot, "public/index.html"),
      originalHtml.replace("</body>", '<form action="https://example.invalid/"></form></body>'),
      "utf8",
    );
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /unsupported active or media element/);

    await writeFile(resolve(projectRoot, "public/index.html"), originalHtml, "utf8");
    await writeFile(resolve(projectRoot, "test/scaffold.test.mjs"), 'import "./missing.mjs";\n', "utf8");
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /Node import does not resolve/);

    await writeFile(resolve(projectRoot, "test/scaffold.test.mjs"), 'import "unlisted-package";\n', "utf8");
    await assert.rejects(runProjectCheck({ projectPath: projectRoot }), /built-ins or local files/);
  });
});

test("loopback server handles safe methods and rejects unknown, private, and traversing paths", async () => {
  await withServer(createStaticServer(), async (server) => {
    const home = await send(server, { path: "/" });
    assert.equal(home.statusCode, 200);
    assert.match(home.headers["content-type"], /^text\/html/);
    assert.match(home.body, /專注計時/);

    const english = await send(server, { path: "/en/index.html" });
    assert.equal(english.statusCode, 200);
    assert.match(english.body, /<html lang="en">/);
    for (const path of ["/en", "/en/"]) {
      const alias = await send(server, { path });
      assert.equal(alias.statusCode, 301);
      assert.equal(alias.headers.location, "/en/index.html");
    }

    const head = await send(server, { method: "HEAD", path: "/styles/app.css" });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
    assert.ok(Number(head.headers["content-length"]) > 0);

    const query = await send(server, { path: "/index.html?canary=must-not-be-logged" });
    assert.equal(query.statusCode, 200);

    const method = await send(server, { method: "POST", path: "/index.html" });
    assert.equal(method.statusCode, 405);
    assert.equal(method.headers.allow, "GET, HEAD");

    for (const path of ["/missing.css", "/package.json", "/js/missing.mjs", "/en/missing.html", "/en/other/index.html"]) {
      assert.equal((await send(server, { path })).statusCode, 404);
    }
    for (const path of ["/%2e%2e/package.json", "/%2e%2e%2fpackage.json", "/.env"]) {
      assert.equal((await send(server, { path })).statusCode, 403);
    }
    assert.equal((await send(server, { path: "/..%5cpackage.json" })).statusCode, 400);
  });
});

test("development command binds a process-local ephemeral port and serves only its own preview", async () => {
  const child = spawn(process.execPath, [resolve(PROJECT_ROOT, "scripts/serve.mjs")], {
    cwd: PROJECT_ROOT,
    env: { PORT: "0", SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  let port;
  try {
    port = await new Promise((resolvePort, reject) => {
      const timeout = setTimeout(() => reject(new Error("Development server did not report readiness.")), 5000);
      child.stdout.on("data", () => {
        const match = /http:\/\/127\.0\.0\.1:(\d+)\/index\.html/.exec(stdout);
        if (!match) return;
        clearTimeout(timeout);
        resolvePort(Number(match[1]));
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Development server exited before readiness (${code}): ${stderr}`));
      });
    });

    assert.ok(port > 0 && port <= 65535);
    assert.equal((await sendToPort(port, { path: "/index.html" })).statusCode, 200);
    assert.equal((await sendToPort(port, { path: "/en/index.html" })).statusCode, 200);
    assert.equal((await sendToPort(port, { path: "/en" })).statusCode, 301);
    assert.equal((await sendToPort(port, { method: "HEAD", path: "/styles/app.css" })).statusCode, 200);
    assert.equal((await sendToPort(port, { method: "DELETE", path: "/index.html" })).statusCode, 405);
    assert.equal((await sendToPort(port, { path: "/missing.css" })).statusCode, 404);
    assert.equal((await sendToPort(port, { path: "/%2e%2e/package.json" })).statusCode, 403);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
});

test("server rejects linked public ancestors and linked module directories", async () => {
  await withTempWorkspace(async (workspace) => {
    const physicalProject = resolve(workspace, "physical-project");
    const publicOutsideProject = resolve(workspace, "outside-public");
    const outsideProject = resolve(workspace, "outside-project");
    await mkdir(resolve(physicalProject, "public/js"), { recursive: true });
    await mkdir(publicOutsideProject, { recursive: true });
    await mkdir(resolve(outsideProject, "public"), { recursive: true });
    await writeFile(resolve(physicalProject, "public/index.html"), "safe", "utf8");
    await writeFile(resolve(publicOutsideProject, "index.html"), "outside", "utf8");
    await writeFile(resolve(outsideProject, "public/index.html"), "outside", "utf8");
    await writeFile(resolve(workspace, "future.mjs"), "export {};", "utf8");

    const publicLinkProject = resolve(workspace, "public-link-project");
    await mkdir(publicLinkProject);
    await symlink(publicOutsideProject, resolve(publicLinkProject, "public"), "junction");
    await withServer(createStaticServer({ projectRoot: publicLinkProject }), async (server) => {
      assert.equal((await send(server, { path: "/index.html" })).statusCode, 403);
    });

    const projectAlias = resolve(workspace, "project-alias");
    await symlink(outsideProject, projectAlias, "junction");
    await withServer(createStaticServer({ projectRoot: projectAlias }), async (server) => {
      assert.equal((await send(server, { path: "/index.html" })).statusCode, 403);
    });

    await symlink(workspace, resolve(physicalProject, "public/js/linked"), "junction");
    await withServer(createStaticServer({ projectRoot: physicalProject }), async (server) => {
      assert.equal((await send(server, { path: "/js/linked/future.mjs" })).statusCode, 403);
    });
  });
});

test("build preflights source links before changing dist and copies only approved assets", async () => {
  await withTempWorkspace(async (workspace) => {
    const projectRoot = resolve(workspace, "build-project");
    const outsideDirectory = resolve(workspace, "outside-assets");
    await mkdir(projectRoot);
    await writeFixtureProject(projectRoot);
    await mkdir(outsideDirectory);
    await writeFile(resolve(outsideDirectory, "linked.mjs"), "export {};", "utf8");
    await mkdir(resolve(projectRoot, "dist"));
    await writeFile(resolve(projectRoot, "dist/sentinel.txt"), "preserve before rejected build", "utf8");
    await symlink(outsideDirectory, resolve(projectRoot, "public/js/linked"), "junction");

    await assert.rejects(buildProject({ projectPath: projectRoot, check: async () => undefined }), /Linked public sources/);
    assert.equal(
      await readFile(resolve(projectRoot, "dist/sentinel.txt"), "utf8"),
      "preserve before rejected build",
    );

    const linkedDescendantProject = resolve(workspace, "linked-descendant-project");
    const outputTarget = resolve(workspace, "output-target");
    await mkdir(linkedDescendantProject);
    await writeFixtureProject(linkedDescendantProject);
    await mkdir(resolve(linkedDescendantProject, "dist"));
    await mkdir(outputTarget);
    await writeFile(resolve(linkedDescendantProject, "dist/sentinel.txt"), "preserve linked output", "utf8");
    await writeFile(resolve(outputTarget, "sentinel.txt"), "external target", "utf8");
    await symlink(outputTarget, resolve(linkedDescendantProject, "dist/linked"), "junction");
    await assert.rejects(
      buildProject({ projectPath: linkedDescendantProject, check: async () => undefined }),
      /existing dist tree contains a link/,
    );
    assert.equal(await readFile(resolve(linkedDescendantProject, "dist/sentinel.txt"), "utf8"), "preserve linked output");
    assert.equal(await readFile(resolve(outputTarget, "sentinel.txt"), "utf8"), "external target");

    const linkedRootProject = resolve(workspace, "linked-root-project");
    const linkedRootTarget = resolve(workspace, "linked-root-target");
    await mkdir(linkedRootTarget);
    await writeFixtureProject(linkedRootTarget);
    await mkdir(resolve(linkedRootTarget, "dist"));
    await writeFile(resolve(linkedRootTarget, "dist/sentinel.txt"), "preserve linked root output", "utf8");
    await symlink(linkedRootTarget, linkedRootProject, "junction");
    await assert.rejects(
      buildProject({ projectPath: linkedRootProject, check: async () => undefined }),
      /project root or one of its ancestors is linked/,
    );
    assert.equal(await readFile(resolve(linkedRootTarget, "dist/sentinel.txt"), "utf8"), "preserve linked root output");

    const cleanProject = resolve(workspace, "clean-project");
    await mkdir(cleanProject);
    await writeFixtureProject(cleanProject);
    const result = await buildProject({ projectPath: cleanProject, check: async () => undefined });
    assert.equal(result.fileCount, 6);
    const builtPaths = [];
    async function collect(directory, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await collect(resolve(directory, entry.name), relativePath);
        else builtPaths.push(relativePath);
      }
    }
    await collect(result.outputPath);
    assert.deepEqual(builtPaths.sort(), [
      "en/index.html",
      "index.html",
      "js/app.mjs",
      "js/i18n.mjs",
      "styles/app.css",
      "styles/tokens.css",
    ]);
  });
});
