// One-time: list plural keys + all keys with placeholders in en.json.
const o = require("../locales/en.json");
const plurals = [], placeholders = [];
(function f(x, p) {
  for (const [k, v] of Object.entries(x)) {
    const key = p ? p + "." + k : k;
    if (typeof v === "string") {
      if (/\.(one|other)$/.test(k)) plurals.push(key);
      const ph = v.match(/\{\w+\}/g);
      if (ph) placeholders.push(key + " :: " + v);
    } else f(v, key);
  }
})(o, "");
console.log("PLURAL KEYS (" + plurals.length + "):");
plurals.forEach((k) => console.log("  " + k));
console.log("PLACEHOLDER KEYS (" + placeholders.length + "):");
placeholders.forEach((k) => console.log("  " + k));
