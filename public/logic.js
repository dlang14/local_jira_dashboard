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

// ---------------------------------------------------------------------------
// Project colors
// ---------------------------------------------------------------------------

// Colorblind-friendly palette: Okabe-Ito hues (yellow is left out because it has to be darkened
// into olive on light cards), a few Paul Tol "muted" hues, and a neutral slate.
export const PALETTE = Object.freeze([
  Object.freeze({ id: "orange", name: "Orange", hex: "#E69F00" }),
  Object.freeze({ id: "sky", name: "Sky blue", hex: "#56B4E9" }),
  Object.freeze({ id: "green", name: "Bluish green", hex: "#009E73" }),
  Object.freeze({ id: "slate", name: "Slate", hex: "#6C7A89" }),
  Object.freeze({ id: "blue", name: "Blue", hex: "#0072B2" }),
  Object.freeze({ id: "vermillion", name: "Vermillion", hex: "#D55E00" }),
  Object.freeze({ id: "purple", name: "Reddish purple", hex: "#CC79A7" }),
  Object.freeze({ id: "indigo", name: "Indigo", hex: "#332288" }),
  Object.freeze({ id: "olive", name: "Dark olive", hex: "#5F6F14" }),
  Object.freeze({ id: "wine", name: "Wine", hex: "#882255" }),
]);

// Card backgrounds the colors are tuned against. Keep in sync with --bg-card in styles.css.
export const CARD_BG = Object.freeze({ light: "#ffffff", dark: "#1c242e" });
export const MIN_STRIPE_CONTRAST = 3; // WCAG non-text contrast
export const MIN_TEXT_CONTRAST = 4.5; // WCAG AA for normal text

// 32-bit FNV-1a over the UTF-8 bytes of the string.
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(text))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!match) throw new Error(`Invalid hex color: ${hex}`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Pure black or white, whichever reads better on the color (always >= 4.5:1).
export function readableTextOn(hex) {
  return contrastRatio(hex, "#000000") >= contrastRatio(hex, "#ffffff") ? "#000000" : "#ffffff";
}

// Keeps the hue but nudges the color toward black (light bg) or white (dark bg) until it
// reaches `min` contrast against bg. Returns the input unchanged when it already passes.
export function tuneForBackground(hex, bg, min = MIN_STRIPE_CONTRAST) {
  const target = relativeLuminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const from = hexToRgb(hex);
  for (let step = 0; step <= 20; step += 1) {
    const t = step / 20;
    const mixed = rgbToHex(from.map((v, i) => v + (target[i] - v) * t));
    if (contrastRatio(mixed, bg) >= min) return step === 0 ? hex.toLowerCase() : mixed;
  }
  return rgbToHex(target);
}

// { stripe, text } for a palette index in a color scheme ("light" | "dark").
export function resolveColor(index, scheme) {
  const entry = PALETTE[index] ?? PALETTE[0];
  const stripe = tuneForBackground(entry.hex, CARD_BG[scheme] ?? CARD_BG.dark);
  return { stripe, text: readableTextOn(stripe) };
}

// Maps each project key to a palette index.
// - Deterministic: the preferred slot is fnv1a(KEY) % palette size.
// - Collisions: keys are placed in alphabetical order; if the preferred slot is taken the
//   next free slot (wrapping) is used, so up to PALETTE.length projects get distinct colors.
//   With more projects than colors, the least-used slot is chosen so colors are shared evenly.
// - Overrides ({ KEY: index }) win and are placed first so other projects steer around them.
// The result depends only on the set of keys, not their input order.
export function assignProjectColors(keys, overrides = {}, size = PALETTE.length) {
  const unique = [...new Set(keys.map((key) => String(key).toUpperCase()))].sort();
  const used = new Array(size).fill(0);
  const assigned = new Map();
  for (const key of unique) {
    const choice = overrides?.[key];
    if (Number.isInteger(choice) && choice >= 0 && choice < size) {
      assigned.set(key, choice);
      used[choice] += 1;
    }
  }
  for (const key of unique) {
    if (assigned.has(key)) continue;
    const preferred = fnv1a(key) % size;
    let best = preferred;
    for (let step = 1; step < size && used[best] > 0; step += 1) {
      const slot = (preferred + step) % size;
      if (used[slot] < used[best]) best = slot;
    }
    assigned.set(key, best);
    used[best] += 1;
  }
  return assigned;
}

// Accepts only { KEY: paletteIndex } with sane keys and in-range integers.
export function normalizeColorOverrides(raw, size = PALETTE.length) {
  const clean = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return clean;
  for (const [key, value] of Object.entries(raw)) {
    if (/^[A-Z][A-Z0-9_]{0,19}$/.test(key) && Number.isInteger(value) && value >= 0 && value < size) {
      clean[key] = value;
    }
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Theme (System / Light / Dark)
// ---------------------------------------------------------------------------

export const THEMES = Object.freeze(["system", "light", "dark"]);
export const THEME_STORAGE_KEY = "localJiraBoard.theme.v1";

// Anything that is not exactly "light" or "dark" means System.
export function normalizeTheme(value) {
  return value === "light" || value === "dark" ? value : "system";
}

// Reads the saved choice. Tolerates missing storage, throwing storage, and junk values.
export function loadTheme(storage) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

// Stores "light" or "dark"; System clears the key. Returns false if storage is unavailable.
export function saveTheme(storage, theme) {
  try {
    const clean = normalizeTheme(theme);
    if (clean === "system") storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, clean);
    return true;
  } catch {
    return false;
  }
}

// styles.css keys everything off this attribute; "system" falls back to prefers-color-scheme.
export function applyTheme(root, theme) {
  const clean = normalizeTheme(theme);
  root.setAttribute("data-theme", clean);
  return clean;
}

// The theme a visitor actually sees, given the OS preference.
export function effectiveTheme(theme, systemPrefersDark) {
  const clean = normalizeTheme(theme);
  if (clean === "system") return systemPrefersDark ? "dark" : "light";
  return clean;
}

// Radiogroup keyboard handling: returns the theme to select for a key, or null if the key is not ours.
export function themeForKey(current, key) {
  const index = THEMES.indexOf(normalizeTheme(current));
  const last = THEMES.length - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return THEMES[index === last ? 0 : index + 1];
    case "ArrowLeft":
    case "ArrowUp":
      return THEMES[index === 0 ? last : index - 1];
    case "Home":
      return THEMES[0];
    case "End":
      return THEMES[last];
    default:
      return null;
  }
}
