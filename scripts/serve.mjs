import { createServer } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4175;

export const STATIC_MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});

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

function isAllowedPublicPath(segments) {
  if (segments.length === 1 && segments[0] === "index.html") return ".html";
  if (segments.length === 2 && segments[0] === "en" && segments[1] === "index.html") return ".html";

  const extension = extname(segments.at(-1) ?? "").toLowerCase();
  if (segments.length >= 2 && segments[0] === "styles" && extension === ".css") {
    return extension;
  }
  if (
    segments.length >= 2 &&
    segments[0] === "js" &&
    (extension === ".js" || extension === ".mjs")
  ) {
    return extension;
  }
  return null;
}

function parseRequestPath(requestTarget) {
  if (
    typeof requestTarget !== "string" ||
    requestTarget.length === 0 ||
    requestTarget.length > 8192 ||
    requestTarget[0] !== "/" ||
    requestTarget[1] === "/" ||
    requestTarget.includes("\\") ||
    requestTarget.includes("\0") ||
    requestTarget.includes("#")
  ) {
    return { statusCode: 400 };
  }

  const queryPosition = requestTarget.indexOf("?");
  const rawPath = queryPosition === -1 ? requestTarget : requestTarget.slice(0, queryPosition);
  if (rawPath === "/en" || rawPath === "/en/") {
    return { statusCode: 301, location: "/en/index.html" };
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return { statusCode: 400 };
  }

  if (
    decodedPath[0] !== "/" ||
    decodedPath.startsWith("//") ||
    decodedPath.includes("\\") ||
    decodedPath.includes("\0")
  ) {
    return { statusCode: 400 };
  }

  if (decodedPath === "/") return { segments: ["index.html"] };

  const segments = decodedPath.slice(1).split("/");
  if (segments.some((segment) => (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.startsWith(".") ||
    segment.includes(":")
  ))) {
    return { statusCode: 403 };
  }

  if (!isAllowedPublicPath(segments)) return { statusCode: 404 };
  return { segments };
}

function sendText(response, statusCode, text, extraHeaders = {}, method = "GET") {
  const body = Buffer.from(text, "utf8");
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.byteLength,
    ...extraHeaders,
  });
  response.end(method === "HEAD" ? undefined : body);
}

async function resolveRequestFile(projectRoot, publicRoot, requestTarget) {
  const parsed = parseRequestPath(requestTarget);
  if (parsed.statusCode) return parsed;

  const expectedPublicRoot = resolve(projectRoot, "public");
  if (!samePath(publicRoot, expectedPublicRoot)) return { statusCode: 403 };

  const canonicalProjectRoot = await resolvePhysicalDirectory(projectRoot);
  if (!canonicalProjectRoot) return { statusCode: 403 };
  const canonicalPublicRoot = await resolvePhysicalDirectory(publicRoot);
  if (
    !canonicalPublicRoot ||
    !isPathInside(canonicalProjectRoot, canonicalPublicRoot) ||
    samePath(canonicalProjectRoot, canonicalPublicRoot)
  ) {
    return { statusCode: 403 };
  }

  const extension = isAllowedPublicPath(parsed.segments);
  if (!extension) return { statusCode: 404 };

  const absoluteTarget = resolve(canonicalPublicRoot, ...parsed.segments);
  if (!isPathInside(canonicalPublicRoot, absoluteTarget) || samePath(canonicalPublicRoot, absoluteTarget)) {
    return { statusCode: 403 };
  }

  let currentPath = canonicalPublicRoot;
  try {
    for (let index = 0; index < parsed.segments.length; index += 1) {
      currentPath = resolve(currentPath, parsed.segments[index]);
      const info = await lstat(currentPath);
      const isLastSegment = index === parsed.segments.length - 1;
      if (info.isSymbolicLink()) return { statusCode: 403 };
      if (isLastSegment ? !info.isFile() : !info.isDirectory()) return { statusCode: 404 };
    }

    const canonicalTarget = await realpath(absoluteTarget);
    if (!isPathInside(canonicalPublicRoot, canonicalTarget) || samePath(canonicalPublicRoot, canonicalTarget)) {
      return { statusCode: 403 };
    }
    return { filePath: canonicalTarget, extension };
  } catch (error) {
    if (error?.code === "EACCES" || error?.code === "EPERM") return { statusCode: 403 };
    return { statusCode: 404 };
  }
}

export function createStaticServer({ projectRoot = PROJECT_ROOT, publicRoot = resolve(projectRoot, "public") } = {}) {
  const projectRootPath = resolve(projectRoot);
  const publicRootPath = resolve(publicRoot);

  return createServer(async (request, response) => {
    const method = request.method ?? "";
    if (method !== "GET" && method !== "HEAD") {
      request.resume();
      sendText(response, 405, "Method not allowed.", { Allow: "GET, HEAD" }, method);
      return;
    }

    try {
      const resolved = await resolveRequestFile(projectRootPath, publicRootPath, request.url);
      if (resolved.statusCode) {
        if (resolved.statusCode === 301) {
          sendText(response, 301, "Moved permanently.", { Location: resolved.location }, method);
          return;
        }
        const messages = new Map([
          [400, "Bad request."],
          [403, "Forbidden."],
          [404, "Not found."],
        ]);
        sendText(response, resolved.statusCode, messages.get(resolved.statusCode), {}, method);
        return;
      }

      const body = await readFile(resolved.filePath);
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": STATIC_MIME_TYPES.get(resolved.extension),
        "Content-Length": body.byteLength,
      });
      response.end(method === "HEAD" ? undefined : body);
    } catch {
      sendText(response, 404, "Not found.", {}, method);
    }
  });
}

function readPort(rawPort = process.env.PORT) {
  if (rawPort === undefined) return DEFAULT_PORT;
  if (!/^(?:0|[1-9]\d{0,4})$/.test(rawPort)) {
    throw new Error("PORT must be an integer from 0 to 65535.");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("PORT must be an integer from 0 to 65535.");
  }
  return port;
}

export function startDevelopmentServer({ port = readPort() } = {}) {
  const server = createStaticServer();
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      process.stderr.write(`Could not start local preview at 127.0.0.1:${port}; the port may be in use.\n`);
    } else {
      process.stderr.write("Could not start the local preview server.\n");
    }
    process.exitCode = 1;
  });
  server.listen(port, HOST, () => {
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : port;
    process.stdout.write(`Local preview available at http://${HOST}:${activePort}/index.html\n`);
  });
  return server;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    startDevelopmentServer();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Could not start the local preview server."}\n`);
    process.exitCode = 1;
  }
}
