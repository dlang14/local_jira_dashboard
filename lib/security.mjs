import { resolve as pathResolve } from "node:path";

export function parseHostHeader(hostHeader) {
  if (!hostHeader) return null;
  const raw = String(hostHeader).trim();
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end === -1) return null;
    const hostname = raw.slice(1, end).toLowerCase();
    const rest = raw.slice(end + 1);
    const port = rest.startsWith(":") ? rest.slice(1) : "";
    return { hostname, port };
  }
  const colon = raw.lastIndexOf(":");
  if (colon === -1) return { hostname: raw.toLowerCase(), port: "" };
  return { hostname: raw.slice(0, colon).toLowerCase(), port: raw.slice(colon + 1) };
}

export function isLocalHostname(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function isAllowedHost(hostHeader, listenPort) {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed || !isLocalHostname(parsed.hostname)) return false;
  if (!parsed.port) return Number(listenPort) === 80;
  return Number(parsed.port) === Number(listenPort);
}

export function originOrRefererIsLocal(req, listenPort) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin) return isAllowedOrigin(origin, listenPort);
  if (referer) return isAllowedOrigin(referer, listenPort);
  return true;
}

export function isAllowedOrigin(value, listenPort) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!isLocalHostname(url.hostname)) return false;
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return port === Number(listenPort);
  } catch {
    return false;
  }
}

export function isWriteMethod(method) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export function rejectIfUnsafe(req, res, listenPort) {
  if (!isAllowedHost(req.headers.host, listenPort)) {
    sendJson(res, 421, {
      error: "blocked_host",
      message: "This server only accepts requests to 127.0.0.1 or localhost.",
    });
    return true;
  }
  if (isWriteMethod(req.method) && !originOrRefererIsLocal(req, listenPort)) {
    sendJson(res, 403, {
      error: "blocked_origin",
      message: "Write requests must come from the local dashboard origin.",
    });
    return true;
  }
  return false;
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  const buf = Buffer.from(text);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": status === 200 && contentType.startsWith("text/html") ? "no-store" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": buf.length,
  });
  res.end(buf);
}

export function safeFilePath(publicDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "/index.html" : decoded;
  if (relative.includes("\0") || relative.includes("\\")) return null;
  const resolved = pathResolve(publicDir, "." + relative);
  const root = pathResolve(publicDir);
  if (resolved !== root && !resolved.startsWith(root + "/")) return null;
  return resolved;
}
