// Allowlist of "recently assigned" windows. Raw user input is never put into JQL:
// the request value is only used as a key into this table, and the JQL fragment
// comes from the table.
export const ASSIGNED_WINDOWS = Object.freeze({
  "24h": Object.freeze({ label: "24 hours", ms: 24 * 60 * 60 * 1000, jql: "-24h" }),
  "7d": Object.freeze({ label: "7 days", ms: 7 * 24 * 60 * 60 * 1000, jql: "-7d" }),
  "30d": Object.freeze({ label: "30 days", ms: 30 * 24 * 60 * 60 * 1000, jql: "-30d" }),
});

export const DEFAULT_ASSIGNED_WINDOW = "24h";

// Returns the window key, the default when the value is absent/empty, or null when invalid.
export function parseAssignedWindow(value) {
  if (value == null || value === "") return DEFAULT_ASSIGNED_WINDOW;
  if (typeof value !== "string") return null;
  return Object.hasOwn(ASSIGNED_WINDOWS, value) ? value : null;
}
