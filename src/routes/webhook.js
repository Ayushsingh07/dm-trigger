// ReplyLo — Meta webhook routes (verification + inbound events).
// Every POST is authenticated with X-Hub-Signature-256 (HMAC-SHA256 of the
// raw body keyed with META_APP_SECRET) before anything is processed.
const crypto = require("crypto");
const express = require("express");
const config = require("../config");
const actions = require("../actions");
const logger = require("../logger");

const router = express.Router();

// GET /webhook — Meta subscription verification.
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.verifyToken) {
    logger.info("[webhook] verification OK");
    return res.status(200).send(challenge);
  }
  logger.warn("[webhook] verification FAILED (bad token or mode)");
  return res.sendStatus(403);
});

// Constant-time compare of "sha256=<hex>" against the raw body.
function signatureValid(rawBody, header) {
  if (!config.metaAppSecret) return false;
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", config.metaAppSecret)
    .update(rawBody || Buffer.alloc(0))
    .digest();
  let given;
  try {
    given = Buffer.from(header.slice("sha256=".length), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// POST /webhook — inbound comment / messaging events.
router.post("/", (req, res) => {
  // In live mode (META_APP_SECRET set) an unverified body is rejected outright.
  // With no app secret configured the server is in dry-run/dev mode, where the
  // public landing-page demo posts unsigned events; that is logged loudly.
  if (config.metaAppSecret) {
    if (!signatureValid(req.rawBody, req.headers["x-hub-signature-256"])) {
      logger.warn("[webhook] rejected: bad or missing X-Hub-Signature-256");
      return res.sendStatus(403);
    }
  } else {
    logger.warn("[webhook] META_APP_SECRET not set — signature verification skipped (dry-run only)");
  }

  res.sendStatus(200); // ack fast; Meta disables slow webhooks
  const body = req.body || {};
  if (body.object !== "instagram" && body.object !== "page") {
    logger.debug({ object: body.object }, "[event] unknown object type");
    return;
  }
  for (const entry of body.entry || []) {
    (entry.changes || []).forEach((change) => {
      if (change.field === "comments") {
        actions.handleCommentEvent(entry.id, change.value).catch((err) =>
          logger.error({ err: err.message }, "[webhook] comment handler error")
        );
      } else {
        logger.debug({ field: change.field }, "[event] ignored change field");
      }
    });
    (entry.messaging || []).forEach((msg) => {
      try {
        actions.handleDMEvent(msg);
      } catch (err) {
        logger.error({ err: err.message }, "[webhook] messaging handler error");
      }
    });
  }
});

module.exports = router;
