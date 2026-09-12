// The Chinese catalogue covers every string the overlays render, and has no
// stale entries; the runtime substitutes placeholders and switches language.
//
// Keys are found by scanning the page files for t("...") calls (double-quoted
// literal keys, including the two halves of a `cond ? "a" : "b"` first
// argument). A key used only through a variable would not be found here, so
// keep t() calls literal.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { SO_ZH, createI18n } = require("../lib/i18n.js");

const PAGE_FILES = ["page-core.js", "page-galaxy.js", "page-pets.js", "page-lab.js", "page-more.js"];

function usedKeys() {
  const keys = new Set();
  const re = /\bt\(\s*("(?:[^"\\]|\\.)*")(?:\s*\?\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*"))?/g;
  const ternary = /\bt\(\s*[^"()]*\?\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/g;
  const plural = /\bplural\(\s*[^,]+,\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")/g;
  for (const f of PAGE_FILES) {
    const src = fs.readFileSync(path.join(__dirname, "..", "lib", f), "utf8");
    let m;
    while ((m = re.exec(src))) { keys.add(JSON.parse(m[1])); if (m[2]) keys.add(JSON.parse(m[2])); if (m[3]) keys.add(JSON.parse(m[3])); }
    while ((m = ternary.exec(src))) { keys.add(JSON.parse(m[1])); keys.add(JSON.parse(m[2])); }
    while ((m = plural.exec(src))) { keys.add(JSON.parse(m[1])); keys.add(JSON.parse(m[2])); }
  }
  return keys;
}

// Keys the code passes through t() from data rather than literals: POI
// labels, slot and skill names on the player panel.
const DYNAMIC_KEYS = ["habitable", "portal", "dungeon", "starter", "weapon", "shield", "engine", "sensors", "laser", "probes", "battling", "gathering", "exploring",
  "normal", "uncommon", "rare", "unique", "epic", "legendary"];

test("every string the overlays render has a Chinese translation", () => {
  const used = usedKeys();
  assert.ok(used.size > 100, "found " + used.size + " keys; the scan looks broken");
  const missing = [...used].filter(k => !Object.prototype.hasOwnProperty.call(SO_ZH, k));
  assert.deepEqual(missing, [], "untranslated keys");
});

test("no stale entries in the Chinese catalogue", () => {
  const used = usedKeys();
  for (const k of DYNAMIC_KEYS) used.add(k);
  const stale = Object.keys(SO_ZH).filter(k => !used.has(k));
  assert.deepEqual(stale, [], "catalogue entries nothing uses");
});

test("placeholders survive translation", () => {
  for (const [en, zh] of Object.entries(SO_ZH)) {
    const a = (en.match(/\{\w+\}/g) || []).sort(), b = (zh.match(/\{\w+\}/g) || []).sort();
    assert.deepEqual(b, a, "placeholder mismatch in: " + en);
    assert.ok(zh.trim().length > 0, "empty translation for: " + en);
  }
});

test("runtime: substitution, fallback, language switch and persistence", () => {
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  // Node has a built-in read-only `navigator`; replace it for the test.
  let navLang = "en-GB";
  Object.defineProperty(global, "navigator", { configurable: true, get: () => ({ language: navLang }) });
  const i = createI18n("x.lang");
  assert.equal(i.lang(), "en");
  assert.equal(i.t("ready in {t}", { t: "1:05" }), "ready in 1:05");
  assert.equal(i.t("no such key {n}", { n: 3 }), "no such key 3");
  assert.equal(i.toggle(), "zh");
  assert.equal(store["x.lang"], "zh");
  assert.equal(i.t("ready in {t}", { t: "1:05" }), "1:05 后就绪");
  assert.equal(i.t("Engine alert ON"), "引擎提醒 开");
  assert.equal(i.t("no such key"), "no such key");
  const j = createI18n("x.lang");
  assert.equal(j.lang(), "zh", "remembered");
  delete store["x.lang"];
  navLang = "zh-CN";
  assert.equal(createI18n("x.lang").lang(), "zh", "browser language default");
});
