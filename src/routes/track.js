// ReplyFlow — lightweight first-party analytics (no cookies, no PII).
// The landing page pings /track on load; we store a hashed UA for uniques.
const express = require("express");
const store = require("../store");

const router = express.Router();

// POST /track { path }  — fire-and-forget beacon.
router.post("/", (req, res) => {
  res.sendStatus(204);
  try {
    store.trackVisit({
      path: req.body?.path || req.headers.referer || "/",
      referrer: req.headers.referer || "",
      ua: req.headers["user-agent"] || "",
    });
  } catch (err) {
    console.error("[track]", err.message);
  }
});

module.exports = router;
