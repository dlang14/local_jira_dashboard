import assert from "node:assert/strict";
import test from "node:test";

import { normalizePrefs, relativeTime, sortIssues } from "../public/logic.js";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("relativeTime formats minutes, hours, days, weeks", () => {
  assert.equal(relativeTime(ago(10 * 1000), NOW), "just now");
  assert.equal(relativeTime(ago(5 * MIN), NOW), "5m ago");
  assert.equal(relativeTime(ago(3 * HOUR + 20 * MIN), NOW), "3h ago");
  assert.equal(relativeTime(ago(2 * DAY + 5 * HOUR), NOW), "2d ago");
  assert.equal(relativeTime(ago(21 * DAY), NOW), "3w ago");
  assert.equal(relativeTime(ago(90 * DAY), NOW), "3mo ago");
  assert.equal(relativeTime(ago(-5 * MIN), NOW), "just now");
  assert.equal(relativeTime("garbage", NOW), "");
  assert.equal(relativeTime(null, NOW), "");
});

const issues = [
  { key: "A-2", updated: ago(5 * HOUR), assignedAt: null, priority: { name: "Low" } },
  { key: "A-10", updated: ago(1 * HOUR), assignedAt: ago(30 * HOUR), priority: { name: "High" } },
  { key: "A-1", updated: ago(9 * HOUR), assignedAt: ago(2 * HOUR), priority: { name: "Highest" } },
  { key: "A-3", updated: ago(3 * HOUR), assignedAt: null, priority: { name: "None" } },
];
const keys = (list) => list.map((i) => i.key);

test("sortIssues orders by updated (default), assigned, priority, key, and jira order", () => {
  assert.deepEqual(keys(sortIssues(issues, "updated")), ["A-10", "A-3", "A-2", "A-1"]);
  assert.deepEqual(keys(sortIssues(issues, "assigned")), ["A-1", "A-10", "A-3", "A-2"]);
  assert.deepEqual(keys(sortIssues(issues, "priority")), ["A-1", "A-10", "A-2", "A-3"]);
  assert.deepEqual(keys(sortIssues(issues, "key")), ["A-1", "A-2", "A-3", "A-10"]);
  assert.deepEqual(keys(sortIssues(issues, "jira")), ["A-2", "A-10", "A-1", "A-3"]);
  assert.deepEqual(keys(sortIssues(issues, "bogus")), keys(sortIssues(issues, "updated")));
  assert.deepEqual(keys(issues), ["A-2", "A-10", "A-1", "A-3"], "input is not mutated");
});

test("normalizePrefs defaults to recently updated and rejects junk", () => {
  assert.deepEqual(normalizePrefs(undefined), { sort: "updated", assignedWindow: "24h", recentOnly: false });
  assert.deepEqual(normalizePrefs({ sort: "priority", assignedWindow: "30d", recentOnly: true }), {
    sort: "priority",
    assignedWindow: "30d",
    recentOnly: true,
  });
  assert.deepEqual(normalizePrefs({ sort: "x", assignedWindow: "1y", recentOnly: "yes" }), {
    sort: "updated",
    assignedWindow: "24h",
    recentOnly: false,
  });
  assert.deepEqual(normalizePrefs("nope"), { sort: "updated", assignedWindow: "24h", recentOnly: false });
});
