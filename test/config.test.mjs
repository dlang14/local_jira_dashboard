import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig, PLACEHOLDER_BASE_URL } from "../lib/config.mjs";

const KEYS = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_KEYCHAIN_SERVICE", "MOCK", "PORT"];

// Run with a clean JIRA_*/MOCK environment and an empty project dir, then restore.
function withCleanEnv(fn) {
  const saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ljb-config-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("no built-in site or account: falls back to demo mode without crashing", () => {
  withCleanEnv((dir) => {
    const config = loadConfig(dir, { skipKeychain: true });
    assert.equal(config.mode, "mock");
    assert.equal(config.setupNeeded, true);
    assert.deepEqual(config.setupMissing, ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"]);
    assert.equal(config.email, "");
    assert.equal(config.baseUrl, PLACEHOLDER_BASE_URL);
    assert.equal(config.token, "");
    assert.equal(config.host, "127.0.0.1");
  });
});

test("each missing setting is reported and keeps demo mode", () => {
  withCleanEnv((dir) => {
    const noEmail = loadConfig(dir, { JIRA_BASE_URL: "https://x.example.invalid", JIRA_API_TOKEN: "t", skipKeychain: true });
    assert.equal(noEmail.mode, "mock");
    assert.deepEqual(noEmail.setupMissing, ["JIRA_EMAIL"]);
    const noToken = loadConfig(dir, { JIRA_BASE_URL: "https://x.example.invalid", JIRA_EMAIL: "a@example.com", skipKeychain: true });
    assert.deepEqual(noToken.setupMissing, ["JIRA_API_TOKEN"]);
  });
});

test("live mode only when site, email and token are all provided (env or .env)", () => {
  withCleanEnv((dir) => {
    const fromOverrides = loadConfig(dir, {
      JIRA_BASE_URL: "https://x.example.invalid/",
      JIRA_EMAIL: "a@example.com",
      JIRA_API_TOKEN: "fake-token",
    });
    assert.equal(fromOverrides.mode, "live");
    assert.equal(fromOverrides.setupNeeded, false);
    assert.equal(fromOverrides.baseUrl, "https://x.example.invalid");

    fs.writeFileSync(
      path.join(dir, ".env"),
      "JIRA_BASE_URL=https://y.example.invalid\nJIRA_EMAIL=b@example.com\nJIRA_API_TOKEN=fake-token\n",
    );
    const fromFile = loadConfig(dir, { skipKeychain: true });
    assert.equal(fromFile.mode, "live");
    assert.equal(fromFile.email, "b@example.com");
  });
});

test("MOCK=1 forces demo mode even with full settings and does not flag setup", () => {
  withCleanEnv((dir) => {
    const config = loadConfig(dir, {
      MOCK: "1",
      JIRA_BASE_URL: "https://x.example.invalid",
      JIRA_EMAIL: "a@example.com",
      JIRA_API_TOKEN: "fake-token",
    });
    assert.equal(config.mode, "mock");
    assert.equal(config.setupNeeded, false);
  });
});
