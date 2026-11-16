import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_BG,
  MIN_STRIPE_CONTRAST,
  MIN_TEXT_CONTRAST,
  PALETTE,
  assignProjectColors,
  contrastRatio,
  fnv1a,
  normalizeColorOverrides,
  readableTextOn,
  relativeLuminance,
  resolveColor,
  tuneForBackground,
} from "../public/logic.js";

test("fnv1a matches the published test vectors and is stable", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  assert.equal(fnv1a("foobar"), 0xbf9cf968);
  assert.equal(fnv1a("DEMO"), fnv1a("DEMO"));
  assert.notEqual(fnv1a("DEMO"), fnv1a("DEMP"));
});

test("contrast math follows WCAG", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.ok(Math.abs(contrastRatio("#777777", "#ffffff") - 4.48) < 0.02);
  assert.throws(() => relativeLuminance("nope"));
});

test("palette is fixed, valid, and has distinct colors", () => {
  assert.equal(PALETTE.length, 10);
  assert.equal(new Set(PALETTE.map((c) => c.hex.toLowerCase())).size, PALETTE.length);
  assert.equal(new Set(PALETTE.map((c) => c.id)).size, PALETTE.length);
  for (const color of PALETTE) assert.match(color.hex, /^#[0-9A-F]{6}$/);
});

test("every palette color is readable as a stripe and as a badge in light and dark", () => {
  for (const scheme of ["light", "dark"]) {
    PALETTE.forEach((entry, index) => {
      const { stripe, text } = resolveColor(index, scheme);
      assert.ok(
        contrastRatio(stripe, CARD_BG[scheme]) >= MIN_STRIPE_CONTRAST,
        `${entry.id} stripe on ${scheme} card`,
      );
      assert.ok(contrastRatio(text, stripe) >= MIN_TEXT_CONTRAST, `${entry.id} badge text on ${scheme}`);
      assert.ok(text === "#000000" || text === "#ffffff");
    });
  }
});

test("tuneForBackground keeps passing colors and only shifts failing ones", () => {
  assert.equal(tuneForBackground("#0072B2", "#ffffff"), "#0072b2");
  const darkened = tuneForBackground("#F0E442", "#ffffff");
  assert.notEqual(darkened, "#f0e442");
  assert.ok(contrastRatio(darkened, "#ffffff") >= MIN_STRIPE_CONTRAST);
  const lightened = tuneForBackground("#332288", CARD_BG.dark);
  assert.ok(contrastRatio(lightened, CARD_BG.dark) >= MIN_STRIPE_CONTRAST);
  assert.ok(relativeLuminance(lightened) > relativeLuminance("#332288"));
});

test("readableTextOn picks black on light colors and white on dark ones", () => {
  assert.equal(readableTextOn("#F0E442"), "#000000");
  assert.equal(readableTextOn("#332288"), "#ffffff");
  for (const entry of PALETTE) {
    assert.ok(contrastRatio(readableTextOn(entry.hex), entry.hex) >= MIN_TEXT_CONTRAST, entry.id);
  }
});

test("assignment is deterministic and independent of input order and case", () => {
  const a = assignProjectColors(["DEMO", "SAMPLE", "MOCK", "FAKE"]);
  const b = assignProjectColors(["fake", "mock", "sample", "demo", "DEMO"]);
  assert.deepEqual([...a], [...b]);
  assert.deepEqual([...a.keys()], ["DEMO", "FAKE", "MOCK", "SAMPLE"]);
});

test("a lone project always gets its hashed color", () => {
  for (const key of ["DEMO", "ABC", "X1", "SAMPLE"]) {
    assert.equal(assignProjectColors([key]).get(key), fnv1a(key) % PALETTE.length);
  }
});

test("up to palette-size projects always get distinct colors, even when hashes collide", () => {
  // Find a set of keys whose preferred slots collide heavily.
  const keys = [];
  for (let i = 0; keys.length < PALETTE.length; i += 1) {
    const key = `K${i}`;
    if (fnv1a(key) % PALETTE.length === 3) keys.push(key);
  }
  const colors = assignProjectColors(keys);
  assert.equal(new Set(colors.values()).size, PALETTE.length);

  for (let n = 1; n <= PALETTE.length; n += 1) {
    const sample = Array.from({ length: n }, (_, i) => `P${i * 7}`);
    assert.equal(new Set(assignProjectColors(sample).values()).size, n, `${n} projects`);
  }
});

test("more projects than colors share colors evenly", () => {
  const keys = Array.from({ length: 25 }, (_, i) => `PROJ${i}`);
  const counts = new Array(PALETTE.length).fill(0);
  for (const index of assignProjectColors(keys).values()) counts[index] += 1;
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, counts.join(","));
  assert.equal(counts.reduce((x, y) => x + y, 0), 25);
});

test("overrides win and other projects steer around them", () => {
  const base = assignProjectColors(["DEMO", "FAKE", "MOCK"]);
  const taken = base.get("FAKE");
  const result = assignProjectColors(["DEMO", "FAKE", "MOCK"], { DEMO: taken });
  assert.equal(result.get("DEMO"), taken);
  assert.notEqual(result.get("FAKE"), taken);
  assert.notEqual(result.get("MOCK"), taken);
  assert.equal(new Set([result.get("FAKE"), result.get("MOCK")]).size, 2);
  // Out-of-range or junk overrides are ignored.
  const ignored = assignProjectColors(["DEMO"], { DEMO: 99 });
  assert.equal(ignored.get("DEMO"), fnv1a("DEMO") % PALETTE.length);
});

test("normalizeColorOverrides keeps only valid entries", () => {
  assert.deepEqual(normalizeColorOverrides({ DEMO: 2, bad: 1, MOCK: 99, FAKE: "3", SAMPLE: 1.5, A_1: 0 }), {
    DEMO: 2,
    A_1: 0,
  });
  assert.deepEqual(normalizeColorOverrides(null), {});
  assert.deepEqual(normalizeColorOverrides([1, 2]), {});
  assert.deepEqual(normalizeColorOverrides("x"), {});
});

// ---- Distinguishability (CIE76 delta E between the colors actually shown) ----
function lab(hex) {
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const shown = (id, scheme) => resolveColor(PALETTE.findIndex((c) => c.id === id), scheme).stripe;

test("orange and dark olive stay clearly apart in both themes (hue and lightness)", () => {
  assert.ok(PALETTE.some((c) => c.id === "olive"));
  for (const [scheme, min] of [["light", 40], ["dark", 45]]) {
    const gap = deltaE(shown("orange", scheme), shown("olive", scheme));
    assert.ok(gap >= min, `${scheme}: orange vs olive delta E ${gap.toFixed(1)}`);
  }
  // Lightness differs too, which helps people with red-green color blindness.
  assert.ok(lab(shown("orange", "light"))[0] - lab(shown("olive", "light"))[0] >= 12);
});

test("no two palette colors collapse together in either theme", () => {
  for (const scheme of ["light", "dark"]) {
    let min = Infinity;
    for (let i = 0; i < PALETTE.length; i += 1) {
      for (let j = i + 1; j < PALETTE.length; j += 1) {
        min = Math.min(min, deltaE(shown(PALETTE[i].id, scheme), shown(PALETTE[j].id, scheme)));
      }
    }
    assert.ok(min >= 12, `${scheme}: closest pair delta E ${min.toFixed(1)}`);
  }
});
