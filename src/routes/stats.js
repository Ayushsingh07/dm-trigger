// ReplyLo — dashboard stats scoped to the signed-in user (or demo when out).
const express = require("express");
const store = require("../store");
const { attachUser, requireUser, verifyPassword, clearSessionCookie } = require("../auth");

const router = express.Router();
router.use(attachUser);

function statsFor(conversations, emails) {
  const reached = new Set(conversations.map((c) => c.psid)).size;
  const engaged = conversations.filter((c) => c.status !== "sent").length;
  return {
    reached,
    sent: conversations.length,
    clicked: engaged,
    clickRate: conversations.length ? Math.round((engaged / conversations.length) * 100) : 0,
    emails: emails.length,
  };
}

// Which conversations does the caller see?
function visibleConversations(req) {
  if (req.user) {
    const mine = new Set(store.listAccounts().filter((a) => a.user_id === req.user.id).map((a) => a.ig_user_id));
    return store.listAllConversations().filter((c) => c.userId === req.user.id || mine.has(c.accountId) || c.accountId === "demo");
  }
  return store.listAllConversations().filter((c) => c.accountId === "demo");
}

// GET /api/stats — overall + per-rule numbers + plan usage/limits.
router.get("/", (req, res) => {
  const conversations = visibleConversations(req);
  const emails = req.user
    ? store.listAllEmails().filter((e) => e.user_id === req.user.id || e.account_id === "demo")
    : store.listAllEmails().filter((e) => e.account_id === "demo");

  const byRule = {};
  for (const c of conversations) (byRule[c.ruleId] ||= []).push(c);
  const perRule = Object.entries(byRule).map(([ruleId, convs]) => ({
    ruleId,
    keyword: store.getRule(ruleId)?.keyword ?? null,
    ...statsFor(convs, emails.filter((e) => e.rule_id === ruleId)),
  }));

  const plan = req.user ? store.planUsage(req.user) : null;
  res.json({ ...statsFor(conversations, emails), perRule, plan });
});

// POST /api/stats/delete-account — erase everything for the signed-in user.
// Requires their password again as a confirmation.
router.post("/delete-account", requireUser, (req, res) => {
  const password = String(req.body?.password || "");
  if (!verifyPassword(password, req.user.password_hash)) {
    return res.status(401).json({ error: "Wrong password" });
  }
  store.trackEvent("account_deleted", req.user.id, { email: req.user.email });
  store.deleteUserCompletely(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/stats/conversations — raw rows for the dashboard table.
router.get("/conversations", (req, res) => {
  const conversations = visibleConversations(req).slice(-200).reverse();
  res.json({ count: conversations.length, conversations });
});

// GET /api/stats/emails?format=csv — collected emails.
router.get("/emails", (req, res) => {
  const emails = req.user
    ? store.listAllEmails().filter((e) => e.user_id === req.user.id || e.account_id === "demo")
    : store.listAllEmails().filter((e) => e.account_id === "demo");
  if (req.query.format === "csv") {
    return res.type("text/csv")
      .set("Content-Disposition", 'attachment; filename="emails.csv"')
      .send(["email,rule_id,created_at", ...emails.map((e) => `${e.email},${e.rule_id},${e.created_at}`)].join("\n"));
  }
  res.json({ count: emails.length, emails });
});

module.exports = router;
