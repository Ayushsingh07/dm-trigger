// ReplyLo — subscribers + broadcast campaigns (audience building).
const express = require("express");
const store = require("../store");
const { attachUser, requireUser } = require("../auth");

const router = express.Router();
router.use(attachUser, requireUser);

// Broadcast limits per plan: free 1/mo, trial 5/mo, pro 30/mo.
const BC_LIMITS = { free: 1, trial: 5, pro: 30 };

function broadcastsThisMonth(userId) {
  const row = store.db.prepare(`SELECT COUNT(*) n FROM broadcasts WHERE user_id = ? AND substr(created_at,1,7) = substr(?,1,7)`)
    .get(userId, new Date().toISOString());
  return (row && row.n) || 0;
}

// GET /api/audience/subscribers — my broadcast list.
router.get("/subscribers", (req, res) => {
  const rows = store.listSubscribers(req.user.id, { includeOptedOut: true })
    .map((s) => ({ psid: s.psid, username: s.ig_username, account: s.account_id,
      source: s.source, optedOut: !!s.opted_out, lastSeen: s.last_seen_at }));
  res.json({ count: rows.filter((r) => !r.optedOut).length, subscribers: rows });
});

// GET /api/audience/subscribers.csv — export for the user's own records.
router.get("/subscribers.csv", (req, res) => {
  const rows = store.listSubscribers(req.user.id, { includeOptedOut: true });
  const header = "psid,username,account_id,source,opted_out,last_seen_at";
  const lines = rows.map((s) => [s.psid, s.ig_username || "", s.account_id, s.source || "", s.opted_out, s.last_seen_at || ""].join(","));
  const csv = [header].concat(lines).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"subscribers.csv\"");
  res.send(csv);
});

// GET /api/audience/broadcasts — campaigns with counts.
router.get("/broadcasts", (req, res) => {
  const plan = store.getPeriod(req.user);
  const rows = store.listBroadcasts(req.user.id).map((b) => ({
    id: b.id, name: b.name, text: b.text, status: b.status, scheduledAt: b.scheduled_at,
    sent: b.sent_count, failed: b.fail_count, createdAt: b.created_at,
  }));
  res.json({ count: rows.length, limit: BC_LIMITS[plan] || 1, broadcasts: rows });
});

// POST /api/audience/broadcasts — create + queue for the paced sender.
router.post("/broadcasts", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const text = String(b.text || "").trim();
  if (!name || !text) return res.status(400).json({ error: "Broadcast needs a name and message text" });
  const plan = store.getPeriod(req.user);
  const max = BC_LIMITS[plan] || 1;
  if (broadcastsThisMonth(req.user.id) >= max) {
    return res.status(402).json({
      error: `Your ${plan} plan allows ${max} broadcasts per month. Upgrade for more.`,
      limit: { kind: "broadcasts", max },
    });
  }
  const subs = store.listSubscribers(req.user.id)
    .filter((s) => !b.accountId || s.account_id === String(b.accountId));
  if (!subs.length) return res.status(400).json({ error: "No subscribers yet — people join automatically when they comment or DM your keyword" });
  const bc = store.createBroadcast({
    userId: req.user.id, accountId: b.accountId ? String(b.accountId) : null,
    name, text, links: Array.isArray(b.links) ? b.links.slice(0, 3) : [],
    scheduledAt: b.scheduledAt ? new Date(b.scheduledAt).toISOString() : null,
  });
  store.queueBroadcastItems(bc.id, subs.map((s) => ({ subscriberId: s.id, psid: s.psid, accountId: s.account_id })));
  store.trackEvent("broadcast_created", req.user.id, { recipients: subs.length });
  res.status(201).json({ id: bc.id, recipients: subs.length });
});

// POST /api/audience/broadcasts/:id/cancel
router.post("/broadcasts/:id/cancel", (req, res) => {
  const bc = store.getBroadcast(req.params.id);
  if (!bc || bc.user_id !== req.user.id) return res.status(404).json({ error: "Not found" });
  store.cancelBroadcast(bc.id);
  res.json({ ok: true });
});

module.exports = router;
