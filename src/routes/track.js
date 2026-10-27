// ReplyFlow — lightweight first-party analytics (no cookies, no PII).
// The landing page pings /track on load; we store a hashed UA for uniques.
const express = require("express");
const store = require("../store");
const logger = require("../logger");

const router = express.Router();

// POST /track { path }  — fire-and-forget beacon.
router.post("/", (req, res) => {
  res.sendStatus(204);
  try {
    store.trackVisit({
      path: normalisePath(req.body?.path || req.headers.referer || "/"),
      referrer: req.headers.referer || "",
      ua: req.headers["user-agent"] || "",
    });
  } catch (err) {
    logger.error({ err: err.message }, "[track] failed");
  }
});

// Keep "Top pages" readable: fold .html and legacy aliases onto the canonical
// URL, drop origin/query from referer-based paths.
function normalisePath(raw) {
  let p = String(raw || "/").trim();
  try {
    if (/^https?:/i.test(p)) p = new URL(p).pathname;
  } catch { /* keep as-is */ }
  p = p.split("?")[0].split("#")[0];
  if (p === "/landing" || p === "/landing.html" || p === "/index.html") p = "/";
  else if (/^\/(.+)\.html$/.test(p)) p = "/" + p.slice(1, -5);
  if (!p.startsWith("/")) p = "/" + p;
  return p.slice(0, 200);
}

module.exports = router;
