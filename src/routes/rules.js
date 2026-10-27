// ReplyFlow — keyword auto-reply rules CRUD, scoped to the signed-in user.
const express = require("express");
const store = require("../store");
const { attachUser, requireUser } = require("../auth");

const router = express.Router();
router.use(attachUser, requireUser);

// A user may write rules for their own connected accounts (or the demo account).
function ownsAccount(user, accountId) {
  if (accountId === "demo") return true;
  return store.listAccounts().some((a) => a.ig_user_id === String(accountId) && a.user_id === user.id);
}

// GET /api/rules?accountId=... — list rules for one of my accounts.
router.get("/", (req, res) => {
  const { accountId } = req.query;
  if (accountId) {
    if (!ownsAccount(req.user, accountId)) return res.status(403).json({ error: "Not your account" });
    const rules = store.rulesForAccount(accountId);
    return res.json({ count: rules.length, rules });
  }
  const rules = store.listAllRules().filter((r) => r.userId === req.user.id || (!r.userId && r.accountId === "demo"));
  res.json({ count: rules.length, rules });
});

// POST /api/rules — create a rule for one of my accounts.
router.post("/", (req, res) => {
  const b = req.body || {};
  if (!ownsAccount(req.user, String(b.accountId || ""))) {
    return res.status(403).json({ error: "Connect that account first" });
  }
  // Plan limit: max rules the user has created (public demo rules, which have
  // no owner, never count).
  const limits = store.limitsForPlan(store.effectivePlan(req.user));
  if (store.countRulesForUser(req.user.id) >= limits.rules) {
    return res.status(402).json({
      error: `Your ${store.effectivePlan(req.user)} plan allows ${limits.rules} rules. Upgrade to add more.`,
      limit: { kind: "rules", max: limits.rules },
    });
  }
  try {
    const rule = store.createRule({ ...b, userId: req.user.id });
    store.trackEvent("rule_created", req.user.id, { keyword: rule.keyword });
    res.status(201).json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Look up a rule and confirm it belongs to me.
function myRule(req) {
  const rule = store.getRule(req.params.id);
  if (!rule) return null;
  if (rule.userId && rule.userId !== req.user.id && rule.accountId !== "demo") return null;
  return rule;
}

// GET /api/rules/:id
router.get("/:id", (req, res) => {
  const rule = myRule(req);
  if (!rule) return res.status(404).json({ error: "rule not found" });
  res.json(rule);
});

// PATCH /api/rules/:id — partial update.
router.patch("/:id", (req, res) => {
  const rule = myRule(req);
  if (!rule) return res.status(404).json({ error: "rule not found" });
  try {
    res.json(store.updateRule(rule.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/rules/:id
router.delete("/:id", (req, res) => {
  const rule = myRule(req);
  if (!rule) return res.status(404).json({ error: "rule not found" });
  store.deleteRule(rule.id);
  res.sendStatus(204);
});

module.exports = router;
