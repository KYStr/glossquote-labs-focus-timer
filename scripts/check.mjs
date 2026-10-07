import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { builtinModules } from "node:module";
import { promisify } from "node:util";
import { extname, isAbsolute, parse, relative, resolve, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflarePolicy } from "./cloudflare.mjs";
import { PAGE_PATHS, assertPreviewHtml, assertProductionHtml, parseReleaseArgs, previewSeoTags, productionHtml, releasePolicy } from "./release.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUIRED_FILES = Object.freeze([
  "public/index.html",
  "public/en/index.html",
  "public/styles/tokens.css",
  "public/styles/app.css",
  "public/js/app.mjs",
  "public/js/i18n.mjs",
  "scripts/serve.mjs",
  "scripts/check.mjs",
  "scripts/build.mjs",
  "scripts/release.mjs",
  "scripts/cloudflare.mjs",
  "test/scaffold.test.mjs",
  "test/release.test.mjs",
]);
const PUBLIC_REQUIRED_FILES = new Set(REQUIRED_FILES.filter((path) => path.startsWith("public/")).map((path) => path.slice("public/".length)));
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
]);
const REQUIRED_SCRIPTS = Object.freeze({
  dev: "node scripts/serve.mjs",
  test: "node --test",
  check: "node scripts/check.mjs",
  build: "node scripts/build.mjs",
});
const BANNED_IDENTIFIERS = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "CacheStorage",
  "serviceWorker",
  "ServiceWorker",
  "Notification",
  "Audio",
  "AudioContext",
  "webkitAudioContext",
  "vibrate",
  "wakeLock",
  "Worker",
  "SharedWorker",
  "importScripts",
  "BroadcastChannel",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "eval",
  "Function",
  "cookie",
]);

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isPathInside(rootPath, candidatePath) {
  const difference = relative(rootPath, candidatePath);
  return difference === "" || (
    difference !== ".." &&
    !isAbsolute(difference) &&
    difference.split(sep)[0] !== ".."
  );
}

async function resolvePhysicalDirectory(path) {
  const absolutePath = resolve(path);
  const { root } = parse(absolutePath);
  let currentPath = root;

  try {
    const rootInfo = await lstat(currentPath);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return null;

    const segments = absolutePath.slice(root.length).split(sep).filter(Boolean);
    for (const segment of segments) {
      currentPath = resolve(currentPath, segment);
      const info = await lstat(currentPath);
      if (!info.isDirectory() || info.isSymbolicLink()) return null;
    }

    const canonicalPath = await realpath(absolutePath);
    return samePath(canonicalPath, absolutePath) ? canonicalPath : null;
  } catch {
    return null;
  }
}

function isAllowedPublicRelativePath(relativePath) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.startsWith("."))) return false;
  if (relativePath === "index.html" || relativePath === "en/index.html") return true;

  const extension = extname(relativePath).toLowerCase();
  if (segments.length >= 2 && segments[0] === "styles") return extension === ".css";
  if (segments.length >= 2 && segments[0] === "js") {
    return extension === ".js" || extension === ".mjs";
  }
  return false;
}

async function readPlainFile(path, projectRoot, label) {
  const absolutePath = resolve(path);
  if (!isPathInside(projectRoot, absolutePath) || samePath(projectRoot, absolutePath)) {
    throw new Error(`${label} is outside the project.`);
  }
  try {
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error();
    const canonicalPath = await realpath(absolutePath);
    if (!isPathInside(projectRoot, canonicalPath) || samePath(projectRoot, canonicalPath)) throw new Error();
    return await readFile(canonicalPath, "utf8");
  } catch {
    throw new Error(`${label} is missing or linked.`);
  }
}

async function collectPublicFiles(projectRoot) {
  const publicRoot = resolve(projectRoot, "public");
  const canonicalPublicRoot = await resolvePhysicalDirectory(publicRoot);
  if (
    !canonicalPublicRoot ||
    !isPathInside(projectRoot, canonicalPublicRoot) ||
    samePath(projectRoot, canonicalPublicRoot)
  ) {
    throw new Error("The public source must be a regular directory inside the project.");
  }

  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const sourcePath = resolve(directory, entry.name);
      const info = await lstat(sourcePath);
      if (info.isSymbolicLink()) throw new Error("Linked public sources are not allowed.");
      if (entry.name.startsWith(".")) throw new Error("Dotfiles are not allowed in public.");

      if (info.isDirectory()) {
        await visit(sourcePath);
        continue;
      }
      if (!info.isFile()) throw new Error("Public assets must be regular files.");

      const relativePath = relative(publicRoot, sourcePath).split(sep).join("/");
      if (!isAllowedPublicRelativePath(relativePath)) {
        throw new Error(`Unsupported public asset path: ${relativePath}`);
      }
      const canonicalSource = await realpath(sourcePath);
      if (!isPathInside(canonicalPublicRoot, canonicalSource) || samePath(canonicalPublicRoot, canonicalSource)) {
        throw new Error("A public asset resolves outside public.");
      }
      files.push({ sourcePath: canonicalSource, relativePath });
    }
  }

  await visit(canonicalPublicRoot);
  if (!files.some(({ relativePath }) => relativePath === "index.html")) {
    throw new Error("The public source must contain index.html.");
  }
  return { publicRoot: canonicalPublicRoot, files };
}

async function collectNodeSourceFiles(projectRoot) {
  const files = [];
  for (const directoryName of ["scripts", "test"]) {
    const directoryRoot = resolve(projectRoot, directoryName);
    const canonicalDirectoryRoot = await resolvePhysicalDirectory(directoryRoot);
    if (!canonicalDirectoryRoot || !isPathInside(projectRoot, canonicalDirectoryRoot)) {
      throw new Error(`${directoryName} must be a regular directory inside the project.`);
    }

    async function visit(directory) {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const sourcePath = resolve(directory, entry.name);
        const relativePath = relative(projectRoot, sourcePath).split(sep).join("/");
        if (relativePath === "test/.tmp") continue;

        const info = await lstat(sourcePath);
        if (info.isSymbolicLink()) throw new Error(`Linked Node source path is not allowed: ${relativePath}`);
        if (entry.name.startsWith(".")) throw new Error(`Dotfiles are not allowed in ${directoryName}.`);
        if (info.isDirectory()) {
          await visit(sourcePath);
          continue;
        }
        if (!info.isFile()) throw new Error(`Node source path must be a regular file: ${relativePath}`);
        if ([".mjs", ".js"].includes(extname(entry.name).toLowerCase())) {
          files.push({ sourcePath, relativePath });
        }
      }
    }

    await visit(canonicalDirectoryRoot);
  }
  return files;
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;

  function readString(quote) {
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      index += 1;
      if (character === quote) break;
    }
    tokens.push({ type: "string", raw: source.slice(start + 1, index - 1) });
  }

  function skipRegularExpression() {
    index += 1;
    let inCharacterClass = false;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "[") inCharacterClass = true;
      if (character === "]") inCharacterClass = false;
      index += 1;
      if (character === "/" && !inCharacterClass) break;
    }
    while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
  }

  function readTemplate() {
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "`") {
        index += 1;
        return;
      }
      if (character === "$" && source[index + 1] === "{") {
        index += 2;
        readCode(true);
        continue;
      }
      index += 1;
    }
  }

  function readCode(stopAtBrace = false) {
    let nestedBraces = 0;
    while (index < source.length) {
      const character = source[index];
      if (/\s/.test(character)) {
        index += 1;
        continue;
      }
      if (stopAtBrace && character === "}") {
        if (nestedBraces === 0) {
          index += 1;
          return;
        }
        nestedBraces -= 1;
        tokens.push({ type: "punctuator", value: "}" });
        index += 1;
        continue;
      }
      if (character === "/" && source[index + 1] === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n") index += 1;
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        index += 2;
        const commentEnd = source.indexOf("*/", index);
        index = commentEnd === -1 ? source.length : commentEnd + 2;
        continue;
      }
      if (character === "'" || character === '"') {
        readString(character);
        continue;
      }
      if (character === "`") {
        readTemplate();
        continue;
      }
      if (character === "/") {
        const previous = tokens.at(-1);
        const canStartExpression = !previous || (
          previous.type === "punctuator" && ["(", "{", "[", "=", ":", ",", ";", "!", "?", "=>"].includes(previous.value)
        ) || (
          previous.type === "identifier" && ["return", "throw", "case", "delete", "typeof", "void", "new", "in", "of", "yield", "await"].includes(previous.value)
        );
        if (canStartExpression) {
          skipRegularExpression();
          continue;
        }
      }
      if (/[A-Za-z_$]/.test(character)) {
        const start = index;
        index += 1;
        while (/[A-Za-z0-9_$]/.test(source[index] ?? "")) index += 1;
        tokens.push({ type: "identifier", value: source.slice(start, index) });
        continue;
      }
      if (stopAtBrace && character === "{") nestedBraces += 1;
      tokens.push({ type: "punctuator", value: character });
      index += 1;
    }
  }

  readCode();
  return tokens;
}

function findModuleSpecifiers(source) {
  const tokens = tokenizeJavaScript(source);
  const specifiers = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || (token.value !== "import" && token.value !== "export")) continue;
    if (tokens[index - 1]?.value === ".") continue;

    let cursor = index + 1;
    if (token.value === "import" && tokens[cursor]?.value === "(") {
      const specifier = tokens[cursor + 1];
      if (specifier?.type !== "string" || tokens[cursor + 2]?.value !== ")") {
        throw new Error("Dynamic imports must use one literal local path.");
      }
      specifiers.push(specifier.raw);
      index = cursor + 2;
      continue;
    }
    if (token.value === "import" && tokens[cursor]?.type === "string") {
      specifiers.push(tokens[cursor].raw);
      index = cursor;
      continue;
    }
    if (token.value === "export" && !["*", "{"].includes(tokens[cursor]?.value)) continue;

    let foundFrom = false;
    for (; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].type === "identifier" && tokens[cursor].value === "from") {
        foundFrom = true;
        break;
      }
      if (cursor > index + 1 && tokens[cursor].type === "identifier" && ["import", "export"].includes(tokens[cursor].value)) break;
    }
    if (foundFrom) {
      const specifier = tokens[cursor + 1];
      if (specifier?.type !== "string") throw new Error("Module paths must be string literals.");
      specifiers.push(specifier.raw);
      index = cursor + 1;
    }
  }
  return { tokens, specifiers };
}

function resolveLocalReference(fromFile, rawReference, files, description) {
  if (
    typeof rawReference !== "string" ||
    rawReference.length === 0 ||
    rawReference.includes("\\") ||
    rawReference.includes("?") ||
    rawReference.includes("#") ||
    rawReference.includes(":") ||
    rawReference.startsWith("/")
  ) {
    throw new Error(`${description} must be a relative local asset path.`);
  }

  let decodedReference;
  try {
    decodedReference = decodeURIComponent(rawReference);
  } catch {
    throw new Error(`${description} has invalid URL encoding.`);
  }
  const target = posix.normalize(posix.join(posix.dirname(fromFile), decodedReference));
  if (
    target === "." ||
    target === ".." ||
    target.startsWith("../") ||
    !isAllowedPublicRelativePath(target) ||
    !files.has(target)
  ) {
    throw new Error(`${description} does not resolve to an existing allowed public asset.`);
  }
  return target;
}

function assertNodeJavaScriptReferences(source, relativePath, nodeFiles) {
  const { specifiers } = findModuleSpecifiers(source);
  for (const specifier of specifiers) {
    if (NODE_BUILTINS.has(specifier)) continue;
    if (
      !specifier.startsWith("./") &&
      !specifier.startsWith("../")
    ) {
      throw new Error(`Node source imports only built-ins or local files: ${relativePath}`);
    }
    if (
      specifier.includes("\\") ||
      specifier.includes("?") ||
      specifier.includes("#") ||
      specifier.includes(":")
    ) {
      throw new Error(`Node import path is not a plain local file: ${relativePath}`);
    }
    let decodedSpecifier;
    try {
      decodedSpecifier = decodeURIComponent(specifier);
    } catch {
      throw new Error(`Node import path has invalid URL encoding: ${relativePath}`);
    }
    const target = posix.normalize(posix.join(posix.dirname(relativePath), decodedSpecifier));
    if (target === ".." || target.startsWith("../") || !nodeFiles.has(target)) {
      throw new Error(`Node import does not resolve to an existing managed source: ${relativePath}`);
    }
  }
}

function assertSafeJavaScript(source, relativePath, files) {
  const { tokens, specifiers } = findModuleSpecifiers(source);
  for (const identifier of tokens.filter((token) => token.type === "identifier").map((token) => token.value)) {
    if (BANNED_IDENTIFIERS.has(identifier)) {
      throw new Error(`Disallowed browser capability in ${relativePath}: ${identifier}`);
    }
  }
  for (const specifier of specifiers) {
    resolveLocalReference(relativePath, specifier, files, `Import in ${relativePath}`);
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (
      tokens[index].value === "document" &&
      tokens[index + 1].value === "." &&
      tokens[index + 2].value === "write"
    ) {
      throw new Error(`document.write is not allowed in ${relativePath}.`);
    }
  }
}

function readAttribute(attributes, name) {
  const expression = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = expression.exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function assertFragmentExists(fragment, html, description) {
  if (!fragment) return;
  let decodedFragment;
  try {
    decodedFragment = decodeURIComponent(fragment);
  } catch {
    throw new Error(`${description} has invalid fragment encoding.`);
  }
  const ids = new Set([...html.matchAll(/(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? ""));
  if (!ids.has(decodedFragment)) throw new Error(`${description} points to a missing local fragment.`);
}

const FAMILY_NAVIGATION_LINKS = new Set([
  "https://glossquote.com/index.html",
  "https://glossquote.com/en/index.html",
  "https://units.glossquote.com/index.html",
  "https://units.glossquote.com/en/index.html",
  "https://date.glossquote.com/index.html",
  "https://date.glossquote.com/en/index.html",
]);

function assertAnchorHref(href, relativePath, files, sourceByPath, allowFamilyNavigation) {
  if (href === "#") return;
  if (allowFamilyNavigation && FAMILY_NAVIGATION_LINKS.has(href)) return;
  if (href.startsWith("#")) {
    assertFragmentExists(href.slice(1), sourceByPath.get(relativePath) ?? "", `Anchor in ${relativePath}`);
    return;
  }

  const hashPosition = href.indexOf("#");
  const localPath = hashPosition === -1 ? href : href.slice(0, hashPosition);
  const fragment = hashPosition === -1 ? "" : href.slice(hashPosition + 1);
  const targetPath = resolveLocalReference(relativePath, localPath, files, `Anchor in ${relativePath}`);
  if (!targetPath.endsWith(".html")) throw new Error(`Anchor in ${relativePath} must target a local HTML page.`);
  assertFragmentExists(fragment, sourceByPath.get(targetPath) ?? "", `Anchor in ${relativePath}`);
}

function assertHtmlIsSafe(source, relativePath, files, sourceByPath) {
  const html = source.replace(/<!--[\s\S]*?-->/g, "");
  if (!/<title\b[^>]*>[^<]+<\/title\s*>/i.test(html)) {
    throw new Error(`${relativePath} must contain a page title.`);
  }
  assertPreviewHtml(source, relativePath);
  if (/<\s*(?:base|form|iframe|object|embed|audio|video|source|track)\b/i.test(html)) {
    throw new Error(`${relativePath} contains an unsupported active or media element.`);
  }
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/i.test(html)) {
    throw new Error(`${relativePath} cannot redirect through a meta refresh.`);
  }

  for (const tagMatch of html.matchAll(/<([A-Za-z][\w:-]*)\b([^>]*)>/g)) {
    const tagName = tagMatch[1].toLowerCase();
    const attributes = tagMatch[2];
    if (/(?:^|\s)(?:ping|action|formaction)(?:\s|=|$)/i.test(attributes)) {
      throw new Error(`${relativePath} cannot submit, ping, or post data through HTML attributes.`);
    }
    if (/\s+on[a-z]+\s*=/i.test(attributes) || /\s+style\s*=/i.test(attributes)) {
      throw new Error(`${relativePath} cannot use inline handlers or inline styles.`);
    }
    const href = readAttribute(attributes, "href");
    if (href?.trim().toLowerCase().startsWith("javascript:")) {
      throw new Error(`${relativePath} cannot use javascript URLs.`);
    }

    if (tagName === "script") {
      const src = readAttribute(attributes, "src");
      const type = readAttribute(attributes, "type")?.toLowerCase();
      if (!src || type !== "module") throw new Error(`${relativePath} may load only local JavaScript modules.`);
      resolveLocalReference(relativePath, src, files, `Script in ${relativePath}`);
    } else if (tagName === "link") {
      const relationship = readAttribute(attributes, "rel")?.toLowerCase();
      const isPreviewLanguageLink = previewSeoTags(relativePath).includes(tagMatch[0]);
      if (relationship === "alternate" && isPreviewLanguageLink) continue;
      if (relationship !== "stylesheet" || !href) {
        throw new Error(`${relativePath} may link only local stylesheets.`);
      }
      resolveLocalReference(relativePath, href, files, `Stylesheet in ${relativePath}`);
    } else if (tagName === "a" || tagName === "area") {
      if (href !== null) assertAnchorHref(href, relativePath, files, sourceByPath, tagName === "a");
    } else if (href !== null) {
      throw new Error(`${relativePath} uses href on an unsupported element.`);
    } else if (readAttribute(attributes, "src") !== null || readAttribute(attributes, "srcset") !== null) {
      throw new Error(`${relativePath} contains an unsupported external-capable asset element.`);
    }
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  for (const match of scripts) {
    if (match[2].trim() !== "") throw new Error(`${relativePath} cannot contain inline scripts.`);
  }
}

function assertCssIsSafe(source, relativePath, files) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(css)) throw new Error(`${relativePath} cannot import remote or chained stylesheets.`);
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi)) {
    const reference = match[1] ?? match[2] ?? match[3] ?? "";
    resolveLocalReference(relativePath, reference, files, `CSS asset in ${relativePath}`);
  }
}

async function checkJavaScriptSyntax(path, relativePath) {
  try {
    await execFileAsync(process.execPath, ["--check", path], {
      shell: false,
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error(`JavaScript syntax check failed: ${relativePath}`);
  }
}

export async function runProjectCheck({ projectPath = PROJECT_ROOT } = {}) {
  const canonicalProjectRoot = await resolvePhysicalDirectory(projectPath);
  if (!canonicalProjectRoot) throw new Error("The project root or one of its ancestors is linked or unavailable.");

  const packageSource = await readPlainFile(resolve(canonicalProjectRoot, "package.json"), canonicalProjectRoot, "package.json");
  let packageData;
  try {
    packageData = JSON.parse(packageSource);
  } catch {
    throw new Error("package.json must be valid JSON.");
  }
  if (
    packageData.private !== true ||
    packageData.type !== "module" ||
    packageData.engines?.node !== ">=24" ||
    Object.entries(REQUIRED_SCRIPTS).some(([name, command]) => packageData.scripts?.[name] !== command) ||
    packageData.dependencies !== undefined ||
    packageData.devDependencies !== undefined ||
    packageData.optionalDependencies !== undefined ||
    packageData.peerDependencies !== undefined
  ) {
    throw new Error("package.json does not match the private Node 24+ dependency-free command contract.");
  }

  const { publicRoot, files: publicFiles } = await collectPublicFiles(canonicalProjectRoot);
  const filesByPath = new Map(publicFiles.map(({ relativePath }) => [relativePath, relativePath]));
  const nodeSourceFiles = await collectNodeSourceFiles(canonicalProjectRoot);
  const nodeFilesByPath = new Set(nodeSourceFiles.map(({ relativePath }) => relativePath));
  const resolvableNodeFiles = new Set([
    ...nodeFilesByPath,
    ...publicFiles
      .filter(({ relativePath }) => [".mjs", ".js"].includes(extname(relativePath).toLowerCase()))
      .map(({ relativePath }) => `public/${relativePath}`),
  ]);
  for (const relativePath of REQUIRED_FILES) {
    const isPublicFile = relativePath.startsWith("public/");
    const available = isPublicFile ? filesByPath.has(relativePath.slice("public/".length)) : nodeFilesByPath.has(relativePath);
    if (!available) {
      throw new Error(`Required scaffold file is missing: ${relativePath}`);
    }
  }

  const sourceByPath = new Map();
  for (const { sourcePath, relativePath } of publicFiles) {
    sourceByPath.set(relativePath, await readFile(sourcePath, "utf8"));
  }
  for (const [relativePath, source] of sourceByPath) {
    if (relativePath.endsWith(".mjs") || relativePath.endsWith(".js")) {
      const sourcePath = publicFiles.find((file) => file.relativePath === relativePath).sourcePath;
      await checkJavaScriptSyntax(sourcePath, relativePath);
      assertSafeJavaScript(source, relativePath, filesByPath);
    } else if (relativePath.endsWith(".css")) {
      assertCssIsSafe(source, relativePath, filesByPath);
    } else if (relativePath.endsWith(".html")) {
      assertHtmlIsSafe(source, relativePath, filesByPath, sourceByPath);
    }
  }

  for (const { sourcePath, relativePath } of nodeSourceFiles) {
    const source = await readFile(sourcePath, "utf8");
    await checkJavaScriptSyntax(sourcePath, relativePath);
    assertNodeJavaScriptReferences(source, relativePath, resolvableNodeFiles);
  }

  return {
    projectRoot: canonicalProjectRoot,
    publicRoot,
    fileCount: publicFiles.length,
    nodeSourceCount: nodeSourceFiles.length,
  };
}

async function collectReleaseFiles(root) {
  const files = new Map();
  const directories = new Set();
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(path);
      if (info.isSymbolicLink() || entry.name.startsWith(".")) {
        throw new Error("Release paths must be regular, visible, and inside the output root.");
      }
      const canonicalPath = await realpath(path);
      if (!isPathInside(root, canonicalPath) || samePath(root, canonicalPath)) {
        throw new Error("Release paths must be regular, visible, and inside the output root.");
      }
      if (info.isDirectory()) {
        directories.add(relativePath);
        await visit(canonicalPath, relativePath);
      } else if (info.isFile()) {
        files.set(relativePath, path);
      } else {
        throw new Error("Unsupported release path.");
      }
    }
  }
  await visit(root);
  return { files, directories };
}

export async function checkReleaseOutput(outputPath, { projectPath = PROJECT_ROOT, siteUrl, cloudflare = false } = {}) {
  if (cloudflare !== true) throw new Error("Production output checks require the Cloudflare release policy.");
  const policy = releasePolicy(siteUrl);
  const hostingPolicy = cloudflarePolicy(siteUrl);
  const projectRoot = await resolvePhysicalDirectory(projectPath);
  if (!projectRoot) throw new Error("The project root or one of its ancestors is linked or unavailable.");
  const expectedDist = resolve(projectRoot, "dist");
  const resolvedOutput = resolve(outputPath);
  if (!samePath(resolvedOutput, expectedDist) || relative(projectRoot, resolvedOutput) !== "dist") {
    throw new Error("Release output must be exactly the project dist directory.");
  }
  const canonicalRoot = await resolvePhysicalDirectory(resolvedOutput);
  if (!canonicalRoot || !isPathInside(projectRoot, canonicalRoot) || samePath(projectRoot, canonicalRoot)) {
    throw new Error("Release root must be a regular project directory.");
  }

  const { files: publicFiles } = await collectPublicFiles(projectRoot);
  const expectedFiles = new Map();
  for (const { sourcePath, relativePath } of publicFiles) {
    const source = await readFile(sourcePath);
    if (PAGE_PATHS.includes(relativePath)) {
      const html = productionHtml(source.toString("utf8"), relativePath, policy);
      assertProductionHtml(html, relativePath, policy);
      expectedFiles.set(relativePath, Buffer.from(html, "utf8"));
    } else {
      expectedFiles.set(relativePath, source);
    }
  }
  for (const [name, contents] of policy.files) expectedFiles.set(name, Buffer.from(contents, "utf8"));
  for (const [name, contents] of hostingPolicy.files) expectedFiles.set(name, Buffer.from(contents, "utf8"));

  const { files: actualFiles, directories: actualDirectories } = await collectReleaseFiles(canonicalRoot);
  const expectedDirectories = new Set();
  for (const name of expectedFiles.keys()) {
    const segments = name.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
    if (!actualFiles.has(name)) throw new Error(`Missing release file: ${name}`);
  }
  const failures = [];
  for (const [name, outputFile] of actualFiles) {
    if (!expectedFiles.has(name)) {
      failures.push(`${name}: unexpected release file`);
      continue;
    }
    const actual = await readFile(outputFile);
    if (!actual.equals(expectedFiles.get(name))) failures.push(`${name}: release bytes differ from the approved source or policy`);
  }
  for (const directory of actualDirectories) {
    if (!expectedDirectories.has(directory)) failures.push(`${directory}: unexpected release directory`);
  }
  if (failures.length > 0) throw new Error(`Release check failed:\n- ${failures.join("\n- ")}`);
  return { ok: true, checkedFiles: actualFiles.size };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    if (options.production) {
      const sourceResult = await runProjectCheck();
      const releaseResult = await checkReleaseOutput(resolve(PROJECT_ROOT, "dist"), options);
      process.stdout.write(`Checked ${sourceResult.fileCount} public assets, ${sourceResult.nodeSourceCount} Node source files, and ${releaseResult.checkedFiles} production files.\n`);
    } else {
      const result = await runProjectCheck();
      process.stdout.write(`Checked ${result.fileCount} public assets and ${result.nodeSourceCount} Node source files.\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Project check failed."}\n`);
    process.exitCode = 1;
  }
}
