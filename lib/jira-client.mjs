import { ASSIGNED_WINDOWS, DEFAULT_ASSIGNED_WINDOW } from "./windows.mjs";

const ISSUE_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "project",
  "updated",
  "created",
  "resolutiondate",
];

const DETAIL_FIELDS = [...ISSUE_FIELDS, "comment"].join(",");
const MAX_PAGES = 50;
const PAGE_SIZE = 100;
// Bounds for the "assigned Xh ago" lookup (one or two changelog calls per issue).
const ASSIGNED_AT_MAX_ISSUES = 50;
const ASSIGNED_AT_CONCURRENCY = 5;
const CHANGELOG_PAGE = 100;

export class JiraError extends Error {
  constructor(status, payload, message) {
    super(message);
    this.name = "JiraError";
    this.status = status;
    this.payload = payload;
  }
}

function basicAuth(email, token) {
  return "Basic " + Buffer.from(`${email}:${token}`, "utf8").toString("base64");
}

function avatarUrl(user) {
  return user?.avatarUrls?.["48x48"] || user?.avatarUrls?.["32x32"] || user?.avatarUrls?.["24x24"] || null;
}

export function mapUser(user) {
  if (!user) return null;
  return {
    accountId: user.accountId,
    displayName: user.displayName,
    emailAddress: user.emailAddress || null,
    avatarUrl: avatarUrl(user),
  };
}

export function mapIssue(issue, baseUrl) {
  const fields = issue.fields || {};
  const category = fields.status?.statusCategory || {};
  return {
    id: String(issue.id),
    key: issue.key,
    summary: fields.summary || "",
    issueType: {
      name: fields.issuetype?.name || "Task",
      iconUrl: fields.issuetype?.iconUrl || null,
    },
    priority: fields.priority
      ? { id: fields.priority.id, name: fields.priority.name, iconUrl: fields.priority.iconUrl || null }
      : { id: null, name: "None", iconUrl: null },
    status: {
      name: fields.status?.name || "Unknown",
      category: category.key || "new",
      categoryName: category.name || "To Do",
    },
    project: {
      key: fields.project?.key || "",
      name: fields.project?.name || "",
      avatarUrl: fields.project?.avatarUrls?.["48x48"] || fields.project?.avatarUrls?.["24x24"] || null,
    },
    assignee: mapUser(fields.assignee),
    reporter: mapUser(fields.reporter),
    created: fields.created || null,
    updated: fields.updated || null,
    resolved: fields.resolutiondate || null,
    url: `${baseUrl}/browse/${issue.key}`,
  };
}

export function adfToPlainText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToPlainText).join("");
  if (typeof node !== "object") return String(node);
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inner = adfToPlainText(node.content || []);
  if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") {
    return inner + "\n";
  }
  return inner;
}

export function textToAdf(text) {
  const paragraphs = String(text).replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

const NOT_LONG_DONE = "(statusCategory != Done OR resolved >= -14d OR resolved is EMPTY)";

export function defaultJql(includeDone) {
  const scope = "(assignee = currentUser() OR reporter = currentUser())";
  if (includeDone) return `${scope} ORDER BY updated DESC`;
  return `${scope} AND ${NOT_LONG_DONE} ORDER BY updated DESC`;
}

// The window comes from the server-side allowlist; unknown keys throw instead of being interpolated.
export function recentlyAssignedJql(windowKey, includeDone) {
  const win = Object.hasOwn(ASSIGNED_WINDOWS, windowKey) ? ASSIGNED_WINDOWS[windowKey] : null;
  if (!win) throw new Error("Unsupported assigned window.");
  const base = `assignee = currentUser() AND assignee CHANGED TO currentUser() AFTER ${win.jql}`;
  if (includeDone) return `${base} ORDER BY updated DESC`;
  return `${base} AND ${NOT_LONG_DONE} ORDER BY updated DESC`;
}

// Latest changelog entry that assigned the issue to accountId, or null.
export function latestAssignedAt(histories, accountId) {
  let best = null;
  let bestTime = -Infinity;
  for (const history of histories || []) {
    const time = Date.parse(history?.created);
    if (Number.isNaN(time)) continue;
    const hit = (history.items || []).some(
      (item) => (item.fieldId === "assignee" || item.field === "assignee") && item.to === accountId,
    );
    if (hit && time > bestTime) {
      best = history.created;
      bestTime = time;
    }
  }
  return best;
}

export function createJiraClient(config, fetchImpl = fetch) {
  const auth = basicAuth(config.email, config.token);

  async function request(method, apiPath, body) {
    const headers = {
      Accept: "application/json",
      Authorization: auth,
    };
    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${apiPath}`, init);
    } catch (err) {
      throw new JiraError(0, null, `Could not reach Jira: ${err.message}`);
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: "non-json response" };
      }
    }
    if (!response.ok) {
      const message = jiraMessage(response.status, payload);
      throw new JiraError(response.status, payload, message);
    }
    return payload;
  }

  async function me() {
    return mapUser(await request("GET", "/rest/api/3/myself"));
  }

  async function searchAll(jql, fields) {
    const issues = [];
    let nextPageToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = { jql, maxResults: PAGE_SIZE, fields };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const result = await request("POST", "/rest/api/3/search/jql", body);
      const batch = Array.isArray(result?.issues) ? result.issues : [];
      issues.push(...batch);
      if (result?.isLast || !result?.nextPageToken || batch.length === 0) break;
      nextPageToken = result.nextPageToken;
    }
    return issues;
  }

  let cachedMe = null;
  async function myAccountId() {
    if (!cachedMe) cachedMe = await me();
    return cachedMe.accountId;
  }

  // At most two changelog calls: the first page, then the last page for long histories.
  async function assignedAtFor(key, accountId) {
    const base = `/rest/api/3/issue/${encodeURIComponent(key)}/changelog`;
    let page = await request("GET", `${base}?startAt=0&maxResults=${CHANGELOG_PAGE}`);
    const seen = (page?.startAt || 0) + (page?.values?.length || 0);
    if (page?.isLast === false && Number.isFinite(page.total) && page.total > seen) {
      const startAt = Math.max(0, page.total - CHANGELOG_PAGE);
      page = await request("GET", `${base}?startAt=${startAt}&maxResults=${CHANGELOG_PAGE}`);
    }
    return latestAssignedAt(page?.values, accountId);
  }

  async function annotateAssignedAt(issues, keys) {
    const accountId = await myAccountId();
    const targets = issues.filter((issue) => keys.has(issue.key));
    const bounded = targets.slice(0, ASSIGNED_AT_MAX_ISSUES);
    let skipped = targets.length - bounded.length;
    let cursor = 0;
    async function worker() {
      while (cursor < bounded.length) {
        const issue = bounded[cursor];
        cursor += 1;
        try {
          issue.assignedAt = await assignedAtFor(issue.key, accountId);
        } catch {
          skipped += 1;
        }
      }
    }
    await Promise.all(Array.from({ length: ASSIGNED_AT_CONCURRENCY }, worker));
    return skipped;
  }

  async function list({
    includeDone = false,
    assignedWithin = DEFAULT_ASSIGNED_WINDOW,
    onlyRecentlyAssigned = false,
  } = {}) {
    let issues;
    let recentKeys;
    let warning = null;
    if (onlyRecentlyAssigned) {
      const raw = await searchAll(recentlyAssignedJql(assignedWithin, includeDone), ISSUE_FIELDS);
      issues = raw.map((issue) => mapIssue(issue, config.baseUrl));
      recentKeys = new Set(issues.map((issue) => issue.key));
    } else {
      const raw = await searchAll(defaultJql(includeDone), ISSUE_FIELDS);
      issues = raw.map((issue) => mapIssue(issue, config.baseUrl));
      recentKeys = new Set();
      try {
        const recent = await searchAll(recentlyAssignedJql(assignedWithin, includeDone), ["updated"]);
        for (const issue of recent) recentKeys.add(issue.key);
      } catch (err) {
        warning = `Could not load recent assignments: ${err.message}`;
      }
    }
    for (const issue of issues) {
      issue.newToMe = recentKeys.has(issue.key);
      issue.assignedAt = null;
    }
    let assignedAtSkipped = 0;
    if (recentKeys.size) {
      try {
        assignedAtSkipped = await annotateAssignedAt(issues, recentKeys);
      } catch (err) {
        warning = warning || `Could not load assignment times: ${err.message}`;
        assignedAtSkipped = recentKeys.size;
      }
    }
    return { issues, assignedAtSkipped, warning };
  }

  async function get(key) {
    const issue = await request("GET", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${DETAIL_FIELDS}`);
    const mapped = mapIssue(issue, config.baseUrl);
    const comments = (issue.fields?.comment?.comments || []).map((comment) => ({
      id: String(comment.id),
      author: mapUser(comment.author),
      created: comment.created,
      body: adfToPlainText(comment.body).trim(),
    }));
    return { ...mapped, comments };
  }

  async function transitions(key) {
    const result = await request("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    return (result.transitions || []).map((transition) => {
      const requiredFields = [];
      const fields = transition.fields || {};
      for (const [name, field] of Object.entries(fields)) {
        if (field?.required) requiredFields.push(field.name || name);
      }
      const hasScreen = Boolean(transition.hasScreen);
      return {
        id: String(transition.id),
        name: transition.name,
        to: {
          name: transition.to?.name || "",
          category: transition.to?.statusCategory?.key || "new",
          categoryName: transition.to?.statusCategory?.name || "",
        },
        requiredFields,
        hasScreen,
      };
    });
  }

  async function applyTransition(key, transitionId) {
    await request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      transition: { id: String(transitionId) },
    });
    return { issue: await get(key).then(({ comments, ...issue }) => issue) };
  }

  async function update(key, fields) {
    const body = { fields: {} };
    if (fields.summary != null) body.fields.summary = String(fields.summary);
    if (fields.priority != null) {
      const value = String(fields.priority);
      body.fields.priority = /^\d+$/.test(value) ? { id: value } : { name: value };
    }
    if (Object.prototype.hasOwnProperty.call(fields, "assigneeAccountId")) {
      body.fields.assignee = fields.assigneeAccountId
        ? { accountId: fields.assigneeAccountId }
        : { accountId: null };
    }
    await request("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, body);
    return { issue: await get(key).then(({ comments, ...issue }) => issue) };
  }

  async function addComment(key, text) {
    const result = await request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      body: textToAdf(text),
    });
    return {
      comment: {
        id: String(result.id),
        author: mapUser(result.author),
        created: result.created,
        body: adfToPlainText(result.body).trim() || String(text).trim(),
      },
    };
  }

  async function searchAssignable({ query = "", project, issueKey } = {}) {
    const params = new URLSearchParams({ query, maxResults: "20" });
    if (project) params.set("project", project);
    if (issueKey) params.set("issueKey", issueKey);
    const users = await request("GET", `/rest/api/3/user/assignable/search?${params}`);
    return (Array.isArray(users) ? users : []).map(mapUser);
  }

  return { me, list, get, transitions, applyTransition, update, addComment, searchAssignable };
}

function jiraMessage(status, payload) {
  if (status === 401) return "Jira rejected the API token. Check JIRA_EMAIL and JIRA_API_TOKEN.";
  if (status === 403) return "Jira denied this action. The token may lack the required permission.";
  if (status === 404) return "Jira could not find that issue or endpoint.";
  if (status === 429) return "Jira rate-limited the request. Wait a moment and refresh.";
  const errors = [];
  if (payload?.errorMessages) errors.push(...payload.errorMessages);
  if (payload?.errors && typeof payload.errors === "object") {
    for (const [field, message] of Object.entries(payload.errors)) {
      errors.push(`${field}: ${message}`);
    }
  }
  if (errors.length) return errors.join(" ");
  return `Jira request failed with status ${status}.`;
}
