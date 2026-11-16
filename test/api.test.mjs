import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createApp } from "../server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listen() {
  const { server, config, store } = createApp({
    forceMock: true,
    MOCK: "1",
    PORT: "0",
    rootDir: ROOT,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  config.port = port;
  const base = `http://127.0.0.1:${port}`;
  return { server, config, store, port, base };
}

function request(base, reqPath, { method = "GET", headers = {}, body, host } = {}) {
  const url = new URL(reqPath, base);
  const payload = body == null || typeof body === "string" ? body : JSON.stringify(body);
  const finalHeaders = { ...headers };
  if (payload != null && !finalHeaders["Content-Type"]) {
    finalHeaders["Content-Type"] = "application/json";
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Host: host || url.host,
          Accept: "application/json",
          ...finalHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = {};
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = { text };
            }
          }
          resolve({ res, data, text, status: res.statusCode });
        });
      },
    );
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

test("health and static page in mock mode", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const health = await request(ctx.base, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.mode, "mock");
  assert.equal(health.data.bind, "127.0.0.1");
  assert.equal(health.data.ok, true);
  assert.ok(!JSON.stringify(health.data).toLowerCase().includes("token"));

  const page = await request(ctx.base, "/");
  assert.equal(page.status, 200);
  assert.match(page.text, /Local Jira Board/);

  const css = await request(ctx.base, "/styles.css");
  assert.equal(css.status, 200);
});

test("lists default issues and hides long-done tickets", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const limited = await request(ctx.base, "/api/issues");
  const all = await request(ctx.base, "/api/issues?includeDone=1");
  assert.equal(limited.status, 200);
  assert.ok(limited.data.count >= 10);
  assert.ok(all.data.count > limited.data.count);
  assert.ok(all.data.issues.some((issue) => issue.key === "SAMPLE-2"));
  assert.ok(!limited.data.issues.some((issue) => issue.key === "SAMPLE-2"));
  assert.ok(limited.data.issues.some((issue) => issue.key === "MOCK-11"));
});

test("rejects non-local Host headers", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const blocked = await request(ctx.base, "/api/health", { host: `evil.example:${ctx.port}` });
  assert.equal(blocked.status, 421);
  assert.equal(blocked.data.error, "blocked_host");
});

test("rejects write requests from a foreign origin", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const blocked = await request(ctx.base, "/api/issues/DEMO-18/comments", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    body: { body: "should not land" },
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, "blocked_origin");

  const issue = await request(ctx.base, "/api/issues/DEMO-18");
  assert.equal((issue.data.issue.comments || []).length, 0);
});

test("transitions, required-field guard, edit, and comments", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const transitions = await request(ctx.base, "/api/issues/SAMPLE-7/transitions");
  assert.equal(transitions.status, 200);
  const doneChoices = transitions.data.transitions.filter((item) => item.to.category === "done");
  assert.ok(doneChoices.length >= 2);
  const required = doneChoices.find((item) => item.requiredFields?.length);
  const simple = doneChoices.find((item) => !item.requiredFields?.length);
  assert.ok(required && simple);

  const rejected = await request(ctx.base, "/api/issues/SAMPLE-7/transitions", {
    method: "POST",
    body: { transitionId: required.id },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.error, "required_fields");

  const moved = await request(ctx.base, "/api/issues/SAMPLE-7/transitions", {
    method: "POST",
    body: { transitionId: simple.id },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.issue.status.category, "done");

  const edited = await request(ctx.base, "/api/issues/DEMO-18", {
    method: "PUT",
    body: { summary: "Updated setup notes", priority: "High", assigneeAccountId: "mock-alex-example" },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.issue.summary, "Updated setup notes");
  assert.equal(edited.data.issue.priority.name, "High");
  assert.equal(edited.data.issue.assignee.displayName, "Alex Example");

  const commented = await request(ctx.base, "/api/issues/DEMO-18/comments", {
    method: "POST",
    body: { body: "Looks good in mock mode." },
  });
  assert.equal(commented.status, 201);
  assert.equal(commented.data.comment.body, "Looks good in mock mode.");

  const detail = await request(ctx.base, "/api/issues/DEMO-18");
  assert.ok(detail.data.issue.comments.some((c) => c.body === "Looks good in mock mode."));
});

test("assignable user search and current user", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const me = await request(ctx.base, "/api/me");
  assert.equal(me.data.user.emailAddress, "demo.user@example.com");

  const users = await request(ctx.base, "/api/users/assignable?query=alex");
  assert.equal(users.data.users.length, 1);
  assert.equal(users.data.users[0].displayName, "Alex Example");
});

test("blocks path traversal and unknown API routes", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const traversal = await request(ctx.base, "/../package.json");
  assert.equal(traversal.status, 404);

  const unknown = await request(ctx.base, "/api/secret");
  assert.equal(unknown.status, 404);
});

test("recently assigned view, windows, badges, and validation", async (t) => {
  const ctx = await listen();
  t.after(() => new Promise((resolve) => ctx.server.close(resolve)));

  const keysFor = async (query) => {
    const r = await request(ctx.base, `/api/issues?${query}`);
    assert.equal(r.status, 200);
    return r;
  };

  // Default window is 24h: badge only, board still lists everything.
  const board = await keysFor("");
  assert.equal(board.data.assignedWithin, "24h");
  assert.equal(board.data.recentlyAssigned, false);
  const flagged = board.data.issues.filter((i) => i.newToMe).map((i) => i.key).sort();
  assert.deepEqual(flagged, ["DEMO-12", "SAMPLE-7"]);
  assert.ok(board.data.count > flagged.length);
  const demo12 = board.data.issues.find((i) => i.key === "DEMO-12");
  assert.ok(demo12.assignedAt);
  assert.ok(Date.now() - Date.parse(demo12.assignedAt) < 24 * 3600 * 1000);
  assert.equal(board.data.issues.find((i) => i.key === "DEMO-21").assignedAt, null);

  // Only-recent view per window.
  const counts = {};
  for (const [window, expected] of [
    ["24h", 2],
    ["7d", 4],
    ["30d", 6],
  ]) {
    const r = await keysFor(`assignedWithin=${window}&recentlyAssigned=1`);
    counts[window] = r.data.count;
    assert.equal(r.data.count, expected, `window ${window}`);
    assert.ok(r.data.issues.every((i) => i.newToMe && i.assignedAt && i.assignee.displayName === "Demo User"));
  }
  assert.ok(counts["24h"] < counts["7d"] && counts["7d"] < counts["30d"]);

  // Window also drives the badge on the full board.
  const wide = await keysFor("assignedWithin=7d");
  assert.equal(wide.data.issues.filter((i) => i.newToMe).length, 4);

  // Server-side allowlist: anything else is rejected, never interpolated.
  for (const bad of ["1h", "90d", "7d%20OR%20project%3DX", "__proto__", "constructor", "-7d"]) {
    const r = await request(ctx.base, `/api/issues?assignedWithin=${bad}`);
    assert.equal(r.status, 400, bad);
    assert.equal(r.data.error, "invalid_window");
  }

  // Reassigning away clears the badge; assigning to me stamps it.
  await request(ctx.base, "/api/issues/DEMO-12", { method: "PUT", body: { assigneeAccountId: "mock-sam-example" } });
  const after = await keysFor("recentlyAssigned=1");
  assert.deepEqual(after.data.issues.map((i) => i.key), ["SAMPLE-7"]);
  await request(ctx.base, "/api/issues/DEMO-21", { method: "PUT", body: { assigneeAccountId: "mock-demo-user" } });
  const mine = await keysFor("recentlyAssigned=1");
  assert.ok(mine.data.issues.some((i) => i.key === "DEMO-21"));
});
