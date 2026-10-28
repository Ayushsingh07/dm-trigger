// Every inline <script> in public/*.html must parse. The i18n pass once put
// T("key") (double quotes) inside a double-quoted string in index.html, which
// killed the whole script block - the dashboard's Run-the-demo button silently
// stopped working. This test catches that class of bug at commit time.
require("./helpers");
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC = path.join(__dirname, "..", "public");

test("inline scripts in every public HTML file parse without syntax errors", () => {
  const files = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));
  assert.ok(files.length >= 5, "expected several public HTML pages");
  for (const f of files) {
    const html = fs.readFileSync(path.join(PUBLIC, f), "utf8");
    const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
    for (const [i, m] of scripts.entries()) {
      if (!m[1].trim()) continue;
      assert.doesNotThrow(
        () => new vm.Script(m[1], { filename: f + "#script" + i }),
        "inline script #" + i + " in public/" + f + " has a syntax error"
      );
    }
  }
});
