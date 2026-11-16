import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  CARD_BG,
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  contrastRatio,
  effectiveTheme,
  loadTheme,
  normalizeTheme,
  saveTheme,
  themeForKey,
} from "../public/logic.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  };
}
const brokenStorage = {
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
  removeItem() { throw new Error("denied"); },
};

test("normalizeTheme only accepts light and dark", () => {
  assert.deepEqual([...THEMES], ["system", "light", "dark"]);
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("system"), "system");
  for (const junk of [undefined, null, "", "Dark", "LIGHT", " dark", "auto", "javascript:alert(1)", 1, {}, [], '"dark"', "dark\n"]) {
    assert.equal(normalizeTheme(junk), "system", String(junk));
  }
});

test("loadTheme defaults to system for missing, invalid, or unreadable storage", () => {
  assert.equal(loadTheme(fakeStorage()), "system");
  assert.equal(loadTheme(fakeStorage({ [THEME_STORAGE_KEY]: "light" })), "light");
  assert.equal(loadTheme(fakeStorage({ [THEME_STORAGE_KEY]: "dark" })), "dark");
  assert.equal(loadTheme(fakeStorage({ [THEME_STORAGE_KEY]: "purple" })), "system");
  assert.equal(loadTheme(fakeStorage({ [THEME_STORAGE_KEY]: "" })), "system");
  assert.equal(loadTheme(fakeStorage({ [THEME_STORAGE_KEY]: "{\"theme\":\"dark\"}" })), "system");
  assert.equal(loadTheme(brokenStorage), "system");
  assert.equal(loadTheme(null), "system");
  assert.equal(loadTheme(undefined), "system");
});

test("saveTheme persists light/dark, clears for system, and survives broken storage", () => {
  const storage = fakeStorage();
  assert.equal(saveTheme(storage, "dark"), true);
  assert.equal(storage.data.get(THEME_STORAGE_KEY), "dark");
  assert.equal(loadTheme(storage), "dark");
  assert.equal(saveTheme(storage, "light"), true);
  assert.equal(loadTheme(storage), "light");
  assert.equal(saveTheme(storage, "system"), true);
  assert.equal(storage.data.has(THEME_STORAGE_KEY), false);
  assert.equal(loadTheme(storage), "system");
  // An invalid choice never gets stored; it behaves as System.
  saveTheme(storage, "dark");
  assert.equal(saveTheme(storage, "neon"), true);
  assert.equal(storage.data.has(THEME_STORAGE_KEY), false);
  assert.equal(saveTheme(brokenStorage, "dark"), false);
  assert.equal(saveTheme(null, "dark"), false);
});

test("applyTheme sets data-theme and falls back to system", () => {
  const attrs = {};
  const root = { setAttribute: (name, value) => void (attrs[name] = value) };
  assert.equal(applyTheme(root, "dark"), "dark");
  assert.equal(attrs["data-theme"], "dark");
  assert.equal(applyTheme(root, "bogus"), "system");
  assert.equal(attrs["data-theme"], "system");
});

test("effectiveTheme resolves System from the OS preference", () => {
  assert.equal(effectiveTheme("system", true), "dark");
  assert.equal(effectiveTheme("system", false), "light");
  assert.equal(effectiveTheme("light", true), "light");
  assert.equal(effectiveTheme("dark", false), "dark");
  assert.equal(effectiveTheme("nonsense", true), "dark");
});

test("themeForKey implements radiogroup arrow, Home and End keys", () => {
  assert.equal(themeForKey("system", "ArrowRight"), "light");
  assert.equal(themeForKey("light", "ArrowRight"), "dark");
  assert.equal(themeForKey("dark", "ArrowRight"), "system");
  assert.equal(themeForKey("system", "ArrowLeft"), "dark");
  assert.equal(themeForKey("light", "ArrowUp"), "system");
  assert.equal(themeForKey("light", "ArrowDown"), "dark");
  assert.equal(themeForKey("light", "Home"), "system");
  assert.equal(themeForKey("light", "End"), "dark");
  assert.equal(themeForKey("bogus", "ArrowRight"), "light");
  for (const key of ["Tab", "Enter", " ", "a", "Escape", "Shift"]) assert.equal(themeForKey("light", key), null);
});

// ---- The real inline script from index.html, run before first paint ----
const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
const inline = /<script>([\s\S]*?)<\/script>/.exec(head);

function runHeadScript(localStorage) {
  const attrs = {};
  const sandbox = {
    document: { documentElement: { setAttribute: (name, value) => void (attrs[name] = value) } },
  };
  if (localStorage === "throws") {
    Object.defineProperty(sandbox, "localStorage", { get() { throw new Error("SecurityError"); } });
  } else {
    sandbox.localStorage = localStorage;
  }
  vm.runInNewContext(inline[1], sandbox);
  return attrs["data-theme"];
}

test("head script exists, runs before the stylesheet, and defaults to system without JS", () => {
  assert.ok(inline, "inline <script> in <head>");
  assert.ok(head.indexOf(inline[0]) < head.indexOf('rel="stylesheet"'), "script precedes the stylesheet");
  assert.match(html, /<html lang="en" data-theme="system">/);
  assert.ok(inline[1].includes(THEME_STORAGE_KEY), "uses the same storage key as logic.js");
  assert.ok(!/\bsrc=/.test(inline[0]), "no external script, so it blocks nothing");
});

test("head script applies the saved theme and rejects invalid values", () => {
  assert.equal(runHeadScript(fakeStorage({ [THEME_STORAGE_KEY]: "dark" })), "dark");
  assert.equal(runHeadScript(fakeStorage({ [THEME_STORAGE_KEY]: "light" })), "light");
  assert.equal(runHeadScript(fakeStorage()), "system");
  for (const junk of ["", "Dark", "auto", "<script>", "system", "dark ", "null"]) {
    assert.equal(runHeadScript(fakeStorage({ [THEME_STORAGE_KEY]: junk })), "system", JSON.stringify(junk));
  }
  assert.equal(runHeadScript(brokenStorage), "system");
  assert.equal(runHeadScript("throws"), "system");
});

test("head script and loadTheme always agree", () => {
  for (const value of ["light", "dark", "system", "x", "", undefined]) {
    const storage = fakeStorage(value === undefined ? {} : { [THEME_STORAGE_KEY]: value });
    assert.equal(runHeadScript(storage), loadTheme(storage), String(value));
  }
});

// ---- Toggle markup: accessible radiogroup ----
test("toggle is a labelled radiogroup with one tab stop and a label on every option", () => {
  const group = /<div class="theme-toggle" id="theme-toggle" role="radiogroup" aria-label="([^"]+)">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(group, "radiogroup with aria-label");
  const radios = [...group[2].matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1], text: m[2].trim() }));
  assert.deepEqual(radios.map((r) => /data-theme-choice="(\w+)"/.exec(r.attrs)[1]), [...THEMES]);
  assert.equal(radios.filter((r) => r.attrs.includes('aria-checked="true"')).length, 1);
  assert.equal(radios.filter((r) => r.attrs.includes('tabindex="0"')).length, 1);
  for (const radio of radios) {
    assert.match(radio.attrs, /type="button"/);
    assert.match(radio.attrs, /role="radio"/);
    assert.match(radio.attrs, /aria-label="[^"]+"/);
    assert.ok(radio.text.length > 0, "visible text label");
  }
});

// ---- CSS structure ----
test("CSS keys themes off data-theme with System following the OS", () => {
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*light dark;/);
  assert.match(css, /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;\s*\}/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;\s*\}/);
  assert.ok(!/@media\s*\(prefers-color-scheme/.test(css), "no duplicated media-query theme blocks");
  assert.match(css, /--pc:\s*light-dark\(/);
  assert.match(css, /:focus-visible\s*\{/);
  // The selected radio is filled with the accent color, so its focus ring must not be the accent color.
  assert.match(css, /\.theme-toggle button\[aria-checked="true"\]:focus-visible\s*\{\s*outline-color:\s*var\(--primary-text\)/);
});

// Parses `--token: light-dark(a, b)` from :root into { token: { light, dark } }.
function themeTokens() {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css)[1];
  const tokens = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)/g)) {
    tokens[m[1]] = { light: m[2], dark: m[3] };
  }
  return tokens;
}

test("CSS card background tokens match the contrast constants", () => {
  const tokens = themeTokens();
  assert.equal(tokens["--bg-card"].light.toLowerCase(), CARD_BG.light);
  assert.equal(tokens["--bg-card"].dark.toLowerCase(), CARD_BG.dark);
});

test("theme text tokens are readable in both themes", () => {
  const t = themeTokens();
  const pairs = [
    ["--text", "--bg-card"], ["--text", "--bg"], ["--muted", "--bg-card"], ["--muted", "--bg"],
    ["--accent-strong", "--bg-card"], ["--prio-high", "--bg-card"], ["--prio-med", "--bg-card"],
    ["--prio-low", "--bg-card"], ["--primary-text", "--primary-bg"], ["--new-text", "--done"],
    ["--todo", "--bg-column"], ["--progress", "--bg-column"], ["--done", "--bg-column"],
    ["--muted", "--bg-column"], ["--avatar-text", "--avatar-bg"],
  ];
  for (const scheme of ["light", "dark"]) {
    for (const [fg, bg] of pairs) {
      assert.ok(t[fg] && t[bg], `${fg}/${bg} defined`);
      const ratio = contrastRatio(t[fg][scheme], t[bg][scheme]);
      assert.ok(ratio >= 4.5, `${scheme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
});
