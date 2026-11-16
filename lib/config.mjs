import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Only used for demo-mode links when no site is configured.
export const PLACEHOLDER_BASE_URL = "https://your-site.atlassian.net";

const TOKEN_ENV_KEYS = new Set(["JIRA_API_TOKEN"]);

export function loadDotEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function readKeychainToken(service, account) {
  if (process.platform !== "darwin" || !service || !account) return "";
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", service, "-a", account, "-w"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return "";
  return (result.stdout || "").trim();
}

export function loadConfig(rootDir, overrides = {}) {
  const fileEnv = loadDotEnv(path.join(rootDir, ".env"));
  const get = (key, fallback = "") => {
    if (overrides[key] != null && overrides[key] !== "") return String(overrides[key]);
    if (process.env[key] != null && process.env[key] !== "") return process.env[key];
    if (fileEnv[key] != null && fileEnv[key] !== "") return fileEnv[key];
    return fallback;
  };

  const forceMock =
    get("MOCK") === "1" || get("MOCK") === "true" || overrides.forceMock === true;
  const baseUrl = get("JIRA_BASE_URL").replace(/\/+$/, "");
  const email = get("JIRA_EMAIL");
  let token = get("JIRA_API_TOKEN");
  const keychainService = get("JIRA_KEYCHAIN_SERVICE", "jira-api-token");
  let tokenSource = token ? "env" : null;

  if (!token && !forceMock && email && !overrides.skipKeychain) {
    token = readKeychainToken(keychainService, email);
    if (token) tokenSource = "keychain";
  }

  // No built-in site or account: anything missing means demo mode plus a setup message.
  const missing = [];
  if (!baseUrl) missing.push("JIRA_BASE_URL");
  if (!email) missing.push("JIRA_EMAIL");
  if (!token) missing.push("JIRA_API_TOKEN");
  const setupNeeded = !forceMock && missing.length > 0;
  const mode = forceMock || setupNeeded ? "mock" : "live";
  const port = readPort(get("PORT", "8787"));

  return {
    rootDir,
    mode,
    setupNeeded,
    setupMissing: setupNeeded ? missing : [],
    forceMock,
    baseUrl: baseUrl || PLACEHOLDER_BASE_URL,
    email,
    token,
    tokenSource,
    keychainService,
    port,
    host: "127.0.0.1",
    autoRefreshMs: Number(get("AUTO_REFRESH_MS", "180000")) || 180000,
  };
}

export function redactEnvKey(key) {
  return TOKEN_ENV_KEYS.has(key);
}

function readPort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return 8787;
  return parsed;
}
