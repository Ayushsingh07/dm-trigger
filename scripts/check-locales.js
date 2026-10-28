#!/usr/bin/env node
// check-locales: compare every locales/*.json against locales/en.json.
//
// Errors (exit 1): invalid JSON, missing key, extra key, placeholder set
// differs from English, empty value (unless --allow-empty).
// Warnings (do not fail): translation longer than 1.6x the English text.
//
// Usage: node scripts/check-locales.js [localesDir] [--allow-empty]
// --allow-empty downgrades "empty value" from error to warning (useful while
// translations are still in progress).

const fs = require("fs");
const path = require("path");

const LENGTH_WARN_RATIO = 1.6;

// "{a} {b}" -> ["{a}", "{b}"] sorted, so comparison is order-insensitive
// but duplicates still matter.
function placeholders(str) {
  return (String(str).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
}

// Flatten { a: { b: "x" } } -> { "a.b": "x" }
function flatten(obj, prefix, out) {
  out = out || {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k;
    if (v !== null && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function charLen(str) {
  return [...String(str)].length; // code points, not UTF-16 units
}

// Load + parse one JSON file. Returns { data } or { error }.
function loadJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { error: "cannot read file: " + e.message };
  }
  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { error: "top-level JSON must be an object" };
    }
    return { data };
  } catch (e) {
    return { error: "invalid JSON: " + e.message };
  }
}

// Compare one locale's flattened map against English.
// Returns { errors: string[], warnings: string[] }.
function compareFlat(enFlat, locFlat, opts) {
  const errors = [];
  const warnings = [];

  for (const key of Object.keys(enFlat)) {
    if (!(key in locFlat)) {
      errors.push(`missing key: ${key}`);
      continue;
    }
    const enVal = String(enFlat[key]);
    const val = locFlat[key];
    if (typeof val !== "string") {
      errors.push(`value is not a string: ${key}`);
      continue;
    }
    if (val === "") {
      const msg = `empty value: ${key}`;
      if (opts.allowEmpty) warnings.push(msg);
      else errors.push(msg);
      continue;
    }
    const enPh = placeholders(enVal).join(",");
    const locPh = placeholders(val).join(",");
    if (enPh !== locPh) {
      errors.push(`placeholder mismatch: ${key} (en: {${enPh || "none"}} | locale: {${locPh || "none"}})`);
      continue;
    }
    if (charLen(enVal) > 0 && charLen(val) > LENGTH_WARN_RATIO * charLen(enVal)) {
      warnings.push(
        `translation ${(charLen(val) / charLen(enVal)).toFixed(2)}x longer than English: ${key} (en ${charLen(enVal)} chars -> ${charLen(val)} chars)`
      );
    }
  }

  for (const key of Object.keys(locFlat)) {
    if (!(key in enFlat)) errors.push(`extra key (not in en.json): ${key}`);
  }

  return { errors, warnings };
}

// Check a directory of locale files against its en.json.
// Returns { ok, errorsByLocale: Map<file, string[]>, warningsByLocale: Map<file, string[]> }.
function checkLocales(dir, opts) {
  opts = opts || {};
  const errorsByLocale = new Map();
  const warningsByLocale = new Map();

  const enPath = path.join(dir, "en.json");
  const en = loadJson(enPath);
  if (en.error) {
    errorsByLocale.set("en.json", ["reference en.json: " + en.error]);
    return { ok: false, errorsByLocale, warningsByLocale };
  }
  const enFlat = flatten(en.data, "");

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "en.json")
    .sort();

  for (const file of files) {
    const loc = loadJson(path.join(dir, file));
    if (loc.error) {
      errorsByLocale.set(file, [loc.error]);
      continue;
    }
    const { errors, warnings } = compareFlat(enFlat, flatten(loc.data, ""), opts);
    if (errors.length) errorsByLocale.set(file, errors);
    if (warnings.length) warningsByLocale.set(file, warnings);
  }

  return { ok: errorsByLocale.size === 0, errorsByLocale, warningsByLocale };
}

function formatReport(result) {
  const lines = [];
  for (const [file, errs] of result.errorsByLocale) {
    lines.push(`\n${file}: ${errs.length} error(s)`);
    for (const e of errs) lines.push(`  ERROR  ${e}`);
  }
  for (const [file, warns] of result.warningsByLocale) {
    lines.push(`\n${file}: ${warns.length} warning(s)`);
    for (const w of warns) lines.push(`  WARN   ${w}`);
  }
  return lines.join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const opts = { allowEmpty: args.includes("--allow-empty") };
  const dir = args.find((a) => !a.startsWith("--")) || path.join(__dirname, "..", "locales");

  const result = checkLocales(dir, opts);
  const nErr = [...result.errorsByLocale.values()].reduce((n, e) => n + e.length, 0);
  const nWarn = [...result.warningsByLocale.values()].reduce((n, w) => n + w.length, 0);

  if (result.ok && nWarn === 0) {
    console.log(`check-locales: OK (${path.basename(dir)} dir, no problems)`);
    return 0;
  }
  console.log(formatReport(result));
  console.log(`\ncheck-locales: ${nErr} error(s), ${nWarn} warning(s) in ${path.resolve(dir)}`);
  if (!result.ok && opts.allowEmpty) {
    console.log("note: --allow-empty was set, so empty values counted as warnings only.");
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { checkLocales, compareFlat, flatten, placeholders, formatReport };
