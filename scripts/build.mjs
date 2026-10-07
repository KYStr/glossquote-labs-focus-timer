import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleaseOutput, runProjectCheck } from "./check.mjs";
import { cloudflarePolicy } from "./cloudflare.mjs";
import { PAGE_PATHS, parseReleaseArgs, productionHtml, releasePolicy } from "./release.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
    for (const segment of absolutePath.slice(root.length).split(sep).filter(Boolean)) {
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
  if (segments.length >= 2 && segments[0] === "js") return extension === ".js" || extension === ".mjs";
  return false;
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
    throw new Error("The public build must contain index.html.");
  }
  return { publicRoot: canonicalPublicRoot, files };
}

async function inspectExistingDist(projectRoot, distPath) {
  const expectedDist = resolve(projectRoot, "dist");
  if (!samePath(distPath, expectedDist) || relative(projectRoot, distPath) !== "dist") {
    throw new Error("The build output must be exactly the project dist directory.");
  }

  let info;
  try {
    info = await lstat(distPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("The existing build output could not be inspected.");
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("The dist output cannot be a link or a non-directory.");
  }

  const canonicalDist = await resolvePhysicalDirectory(distPath);
  if (!canonicalDist || !isPathInside(projectRoot, canonicalDist) || samePath(projectRoot, canonicalDist)) {
    throw new Error("The dist output or one of its ancestors is linked or outside the project.");
  }

  async function rejectLinkedDescendants(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childPath = resolve(directory, entry.name);
      const childInfo = await lstat(childPath);
      if (childInfo.isSymbolicLink()) throw new Error("The existing dist tree contains a link.");
      if (childInfo.isDirectory()) await rejectLinkedDescendants(childPath);
      else if (!childInfo.isFile()) throw new Error("The existing dist tree contains a non-file asset.");
    }
  }
  await rejectLinkedDescendants(canonicalDist);
}

export async function buildProject({
  projectPath = PROJECT_ROOT,
  check = runProjectCheck,
  production = false,
  cloudflare = false,
  siteUrl,
} = {}) {
  if (typeof production !== "boolean" || typeof cloudflare !== "boolean" || (!production && (cloudflare || siteUrl !== undefined))) {
    throw new Error("Production and Cloudflare options require explicit production mode.");
  }
  if (production && !cloudflare) throw new Error("Production output requires the Cloudflare release policy.");
  const policy = production ? releasePolicy(siteUrl) : null;
  const hostingPolicy = cloudflare ? cloudflarePolicy(siteUrl) : null;
  await check({ projectPath });

  const projectRoot = await resolvePhysicalDirectory(projectPath);
  if (!projectRoot) throw new Error("The project root or one of its ancestors is linked or unavailable.");

  const { files } = await collectPublicFiles(projectRoot);
  const distPath = resolve(projectRoot, "dist");
  const generatedFiles = new Map();
  if (policy) {
    for (const page of PAGE_PATHS) {
      const source = files.find((entry) => entry.relativePath.split(sep).join("/") === page);
      if (!source) throw new Error(`Missing language page: ${page}`);
      generatedFiles.set(page, productionHtml(await readFile(source.sourcePath, "utf8"), page, policy));
    }
    for (const [name, contents] of policy.files) generatedFiles.set(name, contents);
  }
  for (const [name, contents] of hostingPolicy?.files ?? []) generatedFiles.set(name, contents);
  const outputNames = new Set(files.map(({ relativePath }) => relativePath.split(sep).join("/")));
  for (const name of generatedFiles.keys()) outputNames.add(name);
  for (const relativePath of outputNames) {
    const destination = resolve(distPath, ...relativePath.split("/"));
    if (!isPathInside(distPath, destination) || samePath(distPath, destination)) {
      throw new Error("A public asset path escapes dist.");
    }
  }
  await inspectExistingDist(projectRoot, distPath);

  await rm(distPath, { recursive: true, force: true });
  await mkdir(distPath);
  const canonicalDist = await resolvePhysicalDirectory(distPath);
  if (!canonicalDist || !isPathInside(projectRoot, canonicalDist) || samePath(projectRoot, canonicalDist)) {
    throw new Error("The new dist output is not a regular project directory.");
  }

  for (const { sourcePath, relativePath } of files) {
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error("A public source changed during build.");
    }
    const canonicalSource = await realpath(sourcePath);
    if (!isPathInside(resolve(projectRoot, "public"), canonicalSource)) {
      throw new Error("A public source resolves outside public.");
    }

    const normalizedPath = relativePath.split(sep).join("/");
    const destination = resolve(canonicalDist, ...normalizedPath.split("/"));
    if (!isPathInside(canonicalDist, destination) || samePath(canonicalDist, destination)) {
      throw new Error("A build destination escapes dist.");
    }
    await mkdir(dirname(destination), { recursive: true });
    if (generatedFiles.has(normalizedPath)) {
      await writeFile(destination, generatedFiles.get(normalizedPath), "utf8");
    } else {
      await copyFile(canonicalSource, destination);
    }
  }

  for (const [name, contents] of generatedFiles) {
    if (files.some(({ relativePath }) => relativePath.split(sep).join("/") === name)) continue;
    const destination = resolve(canonicalDist, ...name.split("/"));
    if (!isPathInside(canonicalDist, destination) || samePath(canonicalDist, destination)) {
      throw new Error("A generated production path escapes dist.");
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }

  if (production) await checkReleaseOutput(canonicalDist, { projectPath, siteUrl, cloudflare });

  return { outputPath: canonicalDist, fileCount: outputNames.size };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    const result = await buildProject(options);
    process.stdout.write(`Built ${result.fileCount} static files into dist.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Build failed."}\n`);
    process.exitCode = 1;
  }
}
