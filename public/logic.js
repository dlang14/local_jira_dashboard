// Pure helpers shared by the UI and the tests (no DOM access here).

export const SORTS = ["updated", "assigned", "priority", "key", "jira"];
export const WINDOWS = ["24h", "7d", "30d"];
export const DEFAULT_PREFS = Object.freeze({ sort: "updated", assignedWindow: "24h", recentOnly: false });

const PRIORITY_RANK = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };

function time(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// "just now", "5m ago", "3h ago", "2d ago", "6w ago", "5mo ago"
export function relativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Returns a new array; the input (server order) is never mutated.
export function sortIssues(issues, sort) {
  const indexed = issues.map((issue, index) => ({ issue, index }));
  const byUpdated = (a, b) => time(b.issue.updated) - time(a.issue.updated);
  const comparators = {
    updated: (a, b) => byUpdated(a, b) || a.index - b.index,
    assigned: (a, b) =>
      time(b.issue.assignedAt) - time(a.issue.assignedAt) || byUpdated(a, b) || a.index - b.index,
    priority: (a, b) => {
      const rank = (x) => PRIORITY_RANK[x.issue.priority?.name] ?? 99;
      return rank(a) - rank(b) || byUpdated(a, b) || a.index - b.index;
    },
    key: (a, b) => a.issue.key.localeCompare(b.issue.key, undefined, { numeric: true }),
    jira: (a, b) => a.index - b.index,
  };
  return indexed.sort(comparators[sort] || comparators.updated).map((entry) => entry.issue);
}

export function normalizePrefs(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    sort: SORTS.includes(value.sort) ? value.sort : DEFAULT_PREFS.sort,
    assignedWindow: WINDOWS.includes(value.assignedWindow) ? value.assignedWindow : DEFAULT_PREFS.assignedWindow,
    recentOnly: value.recentOnly === true,
  };
}
