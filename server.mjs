import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "./lib/config.mjs";
import { handleApi } from "./lib/handlers.mjs";
import { createJiraClient } from "./lib/jira-client.mjs";
import { createMockStore } from "./lib/mock-store.mjs";
import { rejectIfUnsafe, safeFilePath, sendJson, sendText } from "./lib/security.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export function createApp(overrides = {}) {
  const config = loadConfig(overrides.rootDir || ROOT, overrides);
  const store = config.mode === "mock" ? createMockStore(config.baseUrl) : createJiraClient(config);

  const server = http.createServer(async (req, res) => {
    const hostHeader = req.headers.host || `${config.host}:${config.port}`;
    let url;
    try {
      url = new URL(req.url || "/", `http://${hostHeader}`);
    } catch {
      sendJson(res, 400, { error: "invalid_url", message: "Malformed request URL." });
      return;
    }

    if (rejectIfUnsafe(req, res, config.port)) return;

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, { config, store, url });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { error: "method_not_allowed", message: "Use GET for static files." });
        return;
      }
      await serveStatic(req, res, url.pathname);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "server_error", message: err.message || "Unexpected error." });
      } else {
        res.end();
      }
    }
  });

  return { server, config, store };
}

async function serveStatic(req, res, pathname) {
  const filePath = safeFilePath(PUBLIC_DIR, pathname);
  if (!filePath) {
    sendText(res, 404, "Not found");
    return;
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

export function start(overrides = {}) {
  const { server, config } = createApp(overrides);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      const modeLabel = config.mode === "mock" ? "mock/demo mode" : "live Jira mode";
      const setup = config.setupNeeded
        ? ` Missing ${config.setupMissing.join(", ")}; using demo data. See the README to connect your Jira site.`
        : "";
      console.log(`Local Jira dashboard listening on http://${config.host}:${config.port} (${modeLabel}).${setup}`);
      resolve({ server, config });
    });
  });
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMain()) {
  start().catch((err) => {
    console.error("Failed to start the dashboard:", err.message);
    process.exit(1);
  });
}
