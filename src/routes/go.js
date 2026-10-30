// ReplyLo — click-tracking redirect for links sent inside automated DMs.
// Instagram never reports DM link clicks, so rule links are rewritten to
// /go/<token> when the DM is sent (see actions.trackRuleLinks). Every hop
// through here is one measured click; the visitor is then sent on to the
// creator's real URL with UTM tags so they can also see it in their own
// analytics.
const express = require("express");
const store = require("../store");
const logger = require("../logger");

const router = express.Router();

// Only ever redirect to plain http(s) URLs — blocks javascript:/data:/etc.
function safeTarget(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

// GET /go/:token — record the click, then 302 to the creator's URL.
router.get("/:token", (req, res) => {
  const link = store.recordGoClick(req.params.token, req.headers["user-agent"] || "");
  if (!link) return res.status(404).send("This link has expired.");

  const target = safeTarget(link.url);
  if (!target) {
    logger.warn({ token: req.params.token }, "[go] stored link has an unsafe URL");
    return res.status(404).send("This link is no longer valid.");
  }

  // Attribution tags for the creator's own analytics (never overrides their
  // existing params).
  target.searchParams.set("utm_source", "instagram");
  target.searchParams.set("utm_medium", "dm");
  if (link.rule_id) target.searchParams.set("utm_campaign", String(link.rule_id));

  // First click for this conversation upgrades its status to "clicked"
  // (feeds the funnel + CTR). Later clicks just count.
  if (link.conv_id) {
    const conv = store.getConversation(link.conv_id);
    if (conv && conv.status === "sent") store.updateConversation(link.conv_id, { status: "clicked" });
  }

  res.redirect(302, target.toString());
});

module.exports = router;
