// ReplyFlow — public landing-page demo.
// The demo is NOT a real Meta webhook: it has no app signature. It runs the
// same pipeline (match -> reply -> DM -> conversation) through a dedicated
// endpoint so it keeps working even when META_APP_SECRET is set and the real
// /webhook enforces X-Hub-Signature-256.
const express = require("express");
const actions = require("../actions");
const logger = require("../logger");

const router = express.Router();

// POST /api/demo { keyword | text, username? } — fire one synthetic comment event.
router.post("/", (req, res) => {
  const keyword = String(req.body?.keyword || "GUIDE").slice(0, 40);
  const text = String(req.body?.text || `${keyword} please!`).slice(0, 200);
  const username = String(req.body?.username || "maya.creates").slice(0, 40);
  const accountId = "acct_" + Math.floor(Math.random() * 1e6); // unknown -> demo rules apply
  const value = {
    id: "cmt_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
    text,
    from: { id: "u_" + Math.floor(Math.random() * 1e9), username },
    media: { id: "media_1" },
  };
  res.sendStatus(202); // fire-and-forget, like the webhook
  actions.handleCommentEvent(accountId, value).catch((err) =>
    logger.error({ err: err.message }, "[demo] handler error")
  );
});

module.exports = router;
