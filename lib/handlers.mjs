import { sendJson } from "./security.mjs";
import { parseAssignedWindow } from "./windows.mjs";

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

export async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function isFlag(value) {
  return value === "1" || value === "true";
}

export function matchRoute(method, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (method === "GET" && pathname === "/api/health") return { name: "health" };
  if (method === "GET" && pathname === "/api/me") return { name: "me" };
  if (method === "GET" && pathname === "/api/issues") return { name: "list" };
  if (method === "GET" && pathname === "/api/users/assignable") return { name: "assignable" };
  if (parts[0] === "api" && parts[1] === "issues" && parts[2] && ISSUE_KEY.test(parts[2])) {
    const key = parts[2].toUpperCase();
    if (parts.length === 3 && method === "GET") return { name: "get", key };
    if (parts.length === 3 && method === "PUT") return { name: "update", key };
    if (parts.length === 4 && parts[3] === "transitions" && method === "GET") {
      return { name: "transitions", key };
    }
    if (parts.length === 4 && parts[3] === "transitions" && method === "POST") {
      return { name: "transition", key };
    }
    if (parts.length === 4 && parts[3] === "comments" && method === "POST") {
      return { name: "comment", key };
    }
  }
  return null;
}

export async function handleApi(req, res, context) {
  const { config, store, url } = context;
  const route = matchRoute(req.method, url.pathname);
  if (!route) {
    sendJson(res, 404, { error: "not_found", message: "Unknown API route." });
    return;
  }

  try {
    if (route.name === "health") {
      sendJson(res, 200, {
        ok: true,
        mode: config.mode,
        setupNeeded: Boolean(config.setupNeeded),
        setupMissing: config.setupMissing || [],
        baseUrl: config.baseUrl,
        email: config.email || null,
        bind: config.host,
        port: config.port,
        autoRefreshMs: config.autoRefreshMs,
      });
      return;
    }

    if (route.name === "me") {
      sendJson(res, 200, { user: await store.me() });
      return;
    }

    if (route.name === "list") {
      const includeDone = isFlag(url.searchParams.get("includeDone"));
      const onlyRecentlyAssigned = isFlag(url.searchParams.get("recentlyAssigned"));
      const assignedWithin = parseAssignedWindow(url.searchParams.get("assignedWithin"));
      if (!assignedWithin) {
        sendJson(res, 400, {
          error: "invalid_window",
          message: "assignedWithin must be one of: 24h, 7d, 30d.",
        });
        return;
      }
      const result = await store.list({ includeDone, assignedWithin, onlyRecentlyAssigned });
      sendJson(res, 200, {
        issues: result.issues,
        includeDone,
        assignedWithin,
        recentlyAssigned: onlyRecentlyAssigned,
        assignedAtSkipped: result.assignedAtSkipped || 0,
        warning: result.warning || null,
        count: result.issues.length,
      });
      return;
    }

    if (route.name === "get") {
      const issue = await store.get(route.key);
      if (!issue) {
        sendJson(res, 404, { error: "not_found", message: `Issue ${route.key} was not found.` });
        return;
      }
      sendJson(res, 200, { issue });
      return;
    }

    if (route.name === "transitions") {
      const transitions = await store.transitions(route.key);
      if (!transitions) {
        sendJson(res, 404, { error: "not_found", message: `Issue ${route.key} was not found.` });
        return;
      }
      sendJson(res, 200, { transitions });
      return;
    }

    if (route.name === "transition") {
      const body = await readJsonBody(req);
      const transitionId = body.transitionId ?? body.id;
      if (!transitionId) {
        sendJson(res, 400, { error: "invalid", message: "transitionId is required." });
        return;
      }
      const result = await store.applyTransition(route.key, transitionId);
      if (result.error) {
        const status = result.error === "not_found" ? 404 : 400;
        sendJson(res, status, result);
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (route.name === "update") {
      const body = await readJsonBody(req);
      const fields = {};
      if (body.summary != null) fields.summary = body.summary;
      if (body.priority != null) fields.priority = body.priority;
      if (Object.prototype.hasOwnProperty.call(body, "assigneeAccountId")) {
        fields.assigneeAccountId = body.assigneeAccountId;
      }
      if (Object.keys(fields).length === 0) {
        sendJson(res, 400, { error: "invalid", message: "No supported fields were provided." });
        return;
      }
      const result = await store.update(route.key, fields);
      if (result.error) {
        const status = result.error === "not_found" ? 404 : 400;
        sendJson(res, status, result);
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (route.name === "comment") {
      const body = await readJsonBody(req);
      const result = await store.addComment(route.key, body.body ?? body.text ?? "");
      if (result.error) {
        const status = result.error === "not_found" ? 404 : 400;
        sendJson(res, status, result);
        return;
      }
      sendJson(res, 201, result);
      return;
    }

    if (route.name === "assignable") {
      const users = await store.searchAssignable({
        query: url.searchParams.get("query") || url.searchParams.get("q") || "",
        project: url.searchParams.get("project") || "",
        issueKey: url.searchParams.get("issueKey") || "",
      });
      sendJson(res, 200, { users });
    }
  } catch (err) {
    const status = err.status || 502;
    const message = err.message || "Unexpected error.";
    // Never include headers, tokens, or raw env in the response.
    sendJson(res, status >= 400 && status < 600 ? status : 502, {
      error: err.name === "JiraError" ? "jira_error" : "server_error",
      message,
    });
  }
}
