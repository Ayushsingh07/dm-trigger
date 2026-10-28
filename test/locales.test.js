// check-locales: the comparator must catch missing/extra keys, placeholder
// drift, empty values and invalid JSON, and warn (not fail) on long
// translations. Runs against fixture dirs in a temp folder, plus one
// integration check against the real locales/ directory.
require("./helpers");
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { checkLocales, compareFlat, flatten } = require("../scripts/check-locales");

const EN = {
  greeting: "Hello {name}!",
  nested: { days_one: "{count} day left", days_other: "{count} days left" },
  short: "Start free",
};

// Build a temp locales dir with en.json + the given locale files.
function fixtureDir(localeFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "locales-test-"));
  fs.writeFileSync(path.join(dir, "en.json"), JSON.stringify(EN, null, 2));
  for (const [name, content] of Object.entries(localeFiles)) {
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

const ALL_FLAT = {
  greeting: "Hola {name}!",
  nested: { days_one: "{count} día restante", days_other: "{count} días restantes" },
  short: "Empieza gratis",
};

test("clean locale passes with no errors or warnings", () => {
  const r = checkLocales(fixtureDir({ "es.json": ALL_FLAT }));
  assert.ok(r.ok);
  assert.strictEqual(r.errorsByLocale.size, 0);
  assert.strictEqual(r.warningsByLocale.size, 0);
});

test("missing key is reported", () => {
  const bad = { ...ALL_FLAT };
  delete bad.short;
  const r = checkLocales(fixtureDir({ "es.json": bad }));
  assert.ok(!r.ok);
  assert.ok(r.errorsByLocale.get("es.json").some((e) => e.includes("missing key") && e.includes("short")));
});

test("extra key is reported", () => {
  const r = checkLocales(fixtureDir({ "es.json": { ...ALL_FLAT, invented: "hola" } }));
  assert.ok(!r.ok);
  assert.ok(r.errorsByLocale.get("es.json").some((e) => e.includes("extra key") && e.includes("invented")));
});

test("placeholder mismatch is reported; reordered placeholders pass", () => {
  const bad = { ...ALL_FLAT, greeting: "Hola {nombre}!" }; // wrong placeholder name
  const r = checkLocales(fixtureDir({ "es.json": bad }));
  assert.ok(!r.ok);
  assert.ok(r.errorsByLocale.get("es.json").some((e) => e.includes("placeholder mismatch") && e.includes("greeting")));

  const two = { "a.b": "{x} and {y}" };
  const enFlat = flatten(two, "");
  const reordered = compareFlat(enFlat, { "a.b": "{y} y {x}" }, {});
  assert.strictEqual(reordered.errors.length, 0);
  const dropped = compareFlat(enFlat, { "a.b": "{y} y" }, {});
  assert.strictEqual(dropped.errors.length, 1);
});

test("empty value fails by default, warns with allowEmpty", () => {
  const dir = fixtureDir({ "es.json": { ...ALL_FLAT, short: "" } });
  const strict = checkLocales(dir);
  assert.ok(!strict.ok);
  assert.ok(strict.errorsByLocale.get("es.json").some((e) => e.includes("empty value") && e.includes("short")));

  const lenient = checkLocales(dir, { allowEmpty: true });
  assert.ok(lenient.ok, "allowEmpty must not fail the run");
  assert.ok(lenient.warningsByLocale.get("es.json").some((w) => w.includes("empty value")));
});

test("invalid JSON is reported as an error for that file", () => {
  const r = checkLocales(fixtureDir({ "es.json": "{ \"greeting\": \"hola\", }" }));
  assert.ok(!r.ok);
  assert.ok(r.errorsByLocale.get("es.json")[0].includes("invalid JSON"));
});

test("translation >1.6x English warns but does not fail", () => {
  const long = { ...ALL_FLAT, short: "Comienza completamente gratis ahora mismo" }; // 37 chars vs 10
  const r = checkLocales(fixtureDir({ "es.json": long }));
  assert.ok(r.ok, "length is only a warning");
  assert.ok(r.warningsByLocale.get("es.json").some((w) => w.includes("longer than English") && w.includes("short")));
});

test("en.json itself broken fails the whole run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "locales-test-"));
  fs.writeFileSync(path.join(dir, "en.json"), "not json at all");
  fs.writeFileSync(path.join(dir, "es.json"), "{}");
  const r = checkLocales(dir);
  assert.ok(!r.ok);
  assert.ok(r.errorsByLocale.get("en.json")[0].includes("reference en.json"));
});

// ------------------------------------------------------------- integration
test("real locales/: structure and placeholders match en.json (empties allowed)", () => {
  const dir = path.join(__dirname, "..", "locales");
  const r = checkLocales(dir, { allowEmpty: true });
  const problems = [...r.errorsByLocale.entries()].map(([f, e]) => f + ": " + e.join("; "));
  assert.deepStrictEqual(problems, [], "locale files must match en.json structure and placeholders");
});
