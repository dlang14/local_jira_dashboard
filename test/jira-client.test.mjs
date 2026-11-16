// Exercises the live Jira client against an injected fake fetch. No network, no real Jira.
import assert from "node:assert/strict";
import test from "node:test";

import { createJiraClient, latestAssignedAt, recentlyAssignedJql } from "../lib/jira-client.mjs";
import { ASSIGNED_WINDOWS, parseAssignedWindow } from "../lib/windows.mjs";

const ME = "mock-demo-user";
const CONFIG = { baseUrl: "https://example.invalid", email: "test@example.invalid", token: "fake-test-token" };

function jiraIssue(key) {
  return {
    id: key.replace(/\D/g, ""),
    key,
    fields: {
      summary: `Summary ${key}`,
      status: { name: "To Do", statusCategory: { key: "new", name: "To Do" } },
      issuetype: { name: "Task" },
      priority: { id: "3", name: "Medium" },
      project: { key: "FAKE", name: "Fake" },
      assignee: { accountId: ME, displayName: "Demo User" },
      reporter: { accountId: ME, displayName: "Demo User" },
      updated: "2026-11-16T10:00:00.000+0000",
      created: "2026-11-01T10:00:00.000+0000",
    },
  };
}

function fakeJira({ changelogs = {}, failRecent = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith("https://example.invalid/"), "only the configured host is contacted");
    const path = url.slice("https://example.invalid".length);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body });
    const reply = (status, payload) => ({ ok: status < 400, status, text: async () => JSON.stringify(payload) });
    if (path === "/rest/api/3/myself") return reply(200, { accountId: ME, displayName: "Demo User" });
    if (path === "/rest/api/3/search/jql") {
      if (body.jql.includes("CHANGED TO")) {
        if (failRecent) return reply(500, { errorMessages: ["boom"] });
        return reply(200, { issues: [jiraIssue("FAKE-1")], isLast: true });
      }
      return reply(200, { issues: [jiraIssue("FAKE-1"), jiraIssue("FAKE-2")], isLast: true });
    }
    const m = path.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/changelog\?startAt=(\d+)&maxResults=100$/);
    if (m) {
      const entry = changelogs[m[1]];
      if (!entry) return reply(404, {});
      return reply(200, entry(Number(m[2])));
    }
    return reply(404, {});
  };
  return { fetchImpl, calls };
}

const assignedTo = (created, to) => ({ created, items: [{ field: "assignee", fieldId: "assignee", to }] });

test("window allowlist only accepts known keys", () => {
  assert.equal(parseAssignedWindow(undefined), "24h");
  assert.equal(parseAssignedWindow(""), "24h");
  assert.equal(parseAssignedWindow("7d"), "7d");
  for (const bad of ["1h", "7D", "__proto__", "toString", "7d OR 1=1", 7, {}, ["7d"]]) {
    assert.equal(parseAssignedWindow(bad), null, String(bad));
  }
  assert.deepEqual(Object.keys(ASSIGNED_WINDOWS), ["24h", "7d", "30d"]);
});

test("recentlyAssignedJql substitutes only allowlisted windows", () => {
  assert.equal(
    recentlyAssignedJql("7d", true),
    "assignee = currentUser() AND assignee CHANGED TO currentUser() AFTER -7d ORDER BY updated DESC",
  );
  assert.match(recentlyAssignedJql("24h", false), /AFTER -24h AND \(statusCategory != Done/);
  assert.match(recentlyAssignedJql("30d", true), /AFTER -30d /);
  for (const bad of ["7d OR project = X", "-7d", "__proto__", undefined]) {
    assert.throws(() => recentlyAssignedJql(bad, true), /Unsupported/);
  }
});

test("latestAssignedAt picks the newest assignment to me", () => {
  const histories = [
    assignedTo("2026-11-01T09:00:00.000+0000", ME),
    assignedTo("2026-11-10T09:00:00.000+0000", "someone-else"),
    assignedTo("2026-11-12T09:00:00.000+0000", ME),
    { created: "2026-11-15T09:00:00.000+0000", items: [{ field: "status", to: "3" }] },
  ];
  assert.equal(latestAssignedAt(histories, ME), "2026-11-12T09:00:00.000+0000");
  assert.equal(latestAssignedAt([], ME), null);
  assert.equal(latestAssignedAt(undefined, ME), null);
});

test("list marks new-to-me issues and fetches assignedAt for them only", async () => {
  const { fetchImpl, calls } = fakeJira({
    changelogs: {
      "FAKE-1": () => ({ isLast: true, startAt: 0, total: 1, values: [assignedTo("2026-11-16T08:00:00.000+0000", ME)] }),
    },
  });
  const client = createJiraClient(CONFIG, fetchImpl);
  const { issues, assignedAtSkipped, warning } = await client.list({ assignedWithin: "7d" });
  assert.equal(warning, null);
  assert.equal(assignedAtSkipped, 0);
  assert.deepEqual(issues.map((i) => [i.key, i.newToMe, i.assignedAt]), [
    ["FAKE-1", true, "2026-11-16T08:00:00.000+0000"],
    ["FAKE-2", false, null],
  ]);
  const searches = calls.filter((c) => c.path === "/rest/api/3/search/jql");
  assert.equal(searches.length, 2);
  assert.ok(searches[1].body.jql.includes("CHANGED TO currentUser() AFTER -7d"));
  const changelogCalls = calls.filter((c) => c.path.includes("/changelog"));
  assert.equal(changelogCalls.length, 1);
  assert.ok(changelogCalls[0].path.includes("FAKE-1"));
});

test("only-recent mode uses the recent JQL as the main query", async () => {
  const { fetchImpl, calls } = fakeJira({
    changelogs: { "FAKE-1": () => ({ isLast: true, startAt: 0, total: 1, values: [assignedTo("2026-11-16T08:00:00.000+0000", ME)] }) },
  });
  const client = createJiraClient(CONFIG, fetchImpl);
  const { issues } = await client.list({ assignedWithin: "30d", onlyRecentlyAssigned: true, includeDone: true });
  assert.deepEqual(issues.map((i) => i.key), ["FAKE-1"]);
  const searches = calls.filter((c) => c.path === "/rest/api/3/search/jql");
  assert.equal(searches.length, 1);
  assert.equal(
    searches[0].body.jql,
    "assignee = currentUser() AND assignee CHANGED TO currentUser() AFTER -30d ORDER BY updated DESC",
  );
});

test("long changelogs jump to the last page (bounded to two calls)", async () => {
  const { fetchImpl, calls } = fakeJira({
    changelogs: {
      "FAKE-1": (startAt) =>
        startAt === 0
          ? { isLast: false, startAt: 0, total: 450, values: [assignedTo("2026-10-01T00:00:00.000+0000", ME)] }
          : { isLast: true, startAt, total: 450, values: [assignedTo("2026-11-16T07:00:00.000+0000", ME)] },
    },
  });
  const client = createJiraClient(CONFIG, fetchImpl);
  const { issues } = await client.list({ assignedWithin: "24h" });
  assert.equal(issues[0].assignedAt, "2026-11-16T07:00:00.000+0000");
  const changelogCalls = calls.filter((c) => c.path.includes("/changelog"));
  assert.equal(changelogCalls.length, 2);
  assert.ok(changelogCalls[1].path.includes("startAt=350"));
});

test("a failing recent query or changelog degrades gracefully", async () => {
  const broken = fakeJira({ failRecent: true });
  const a = await createJiraClient(CONFIG, broken.fetchImpl).list({ assignedWithin: "24h" });
  assert.equal(a.issues.length, 2);
  assert.ok(a.issues.every((i) => i.newToMe === false));
  assert.match(a.warning, /recent assignments/);

  const noChangelog = fakeJira();
  const b = await createJiraClient(CONFIG, noChangelog.fetchImpl).list({ assignedWithin: "24h" });
  assert.equal(b.issues[0].newToMe, true);
  assert.equal(b.issues[0].assignedAt, null);
  assert.equal(b.assignedAtSkipped, 1);
});
