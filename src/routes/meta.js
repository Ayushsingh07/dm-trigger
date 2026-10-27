// ReplyFlow — Meta platform callbacks: data deletion + deauthorize.
// Both arrive as POST with an `signed_request` form field; the payload is
// only trusted when its HMAC matches META_APP_SECRET (see meta.parseSignedRequest).
const express = require("express");
const store = require("../store");
const meta = require("../meta");
const logger = require("../logger");

const router = express.Router();

// Meta posts urlencoded bodies here.
router.use(express.urlencoded({ extended: false }));

function readSignedRequest(req) {
  const sr = req.body?.signed_request || req.query?.signed_request;
  const payload = meta.parseSignedRequest(sr);
  if (!payload) {
    logger.warn("[meta-callback] rejected: invalid or missing signed_request");
    return null;
  }
  return payload;
}

// POST /meta/data-deletion — Meta asks us to erase everything we hold for a
// user. Body: signed_request whose algorithm is HMAC-SHA256 and which carries
// the user_id. We delete the account row (token) and any data they own.
router.post("/data-deletion", (req, res) => {
  const payload = readSignedRequest(req);
  if (!payload) return res.status(403).json({ error: "invalid signed_request" });

  const igUserId = String(payload.user_id || payload.ig_user_id || "");
  if (igUserId) store.deleteAccountByIgUserId(igUserId);

  // Also drop anything keyed by the app-scoped user id in conversations/emails.
  if (igUserId) {
    store.db.prepare("DELETE FROM conversations WHERE psid = ?").run(igUserId);
    store.db.prepare("DELETE FROM emails WHERE psid = ?").run(igUserId);
  }
  logger.info({ igUserId }, "[meta-callback] data deletion completed");
  res.json({ ok: true });
});

// POST /meta/deauthorize — the user revoked our permissions; drop the token.
router.post("/deauthorize", (req, res) => {
  const payload = readSignedRequest(req);
  if (!payload) return res.status(403).json({ error: "invalid signed_request" });

  const igUserId = String(payload.user_id || payload.ig_user_id || "");
  if (igUserId) store.deleteAccountByIgUserId(igUserId);
  logger.info({ igUserId }, "[meta-callback] deauthorized, token removed");
  res.json({ ok: true });
});

module.exports = router;
