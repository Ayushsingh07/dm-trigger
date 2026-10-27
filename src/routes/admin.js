// ReplyLo — admin API: launch metrics, users, events. Admin role only.
const express = require("express");
const store = require("../store");
const { attachUser, requireAdmin } = require("../auth");

const router = express.Router();
router.use(attachUser, requireAdmin);

// GET /api/admin/metrics — everything the admin dashboard shows.
router.get("/metrics", (_req, res) => {
  res.json(store.adminMetrics());
});

// GET /api/admin/users?q= — search users.
router.get("/users", (req, res) => {
  const q = `%${String(req.query.q || "").toLowerCase()}%`;
  const users = dbq(`SELECT id, email, name, role, plan, status, created_at, last_seen_at
    FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at DESC LIMIT 100`, q, q);
  res.json({ count: users.length, users });
});

// PATCH /api/admin/users/:id — change plan/status (manual subscription ops).
router.patch("/users/:id", (req, res) => {
  const u = store.getUserById(req.params.id);
  if (!u) return res.status(404).json({ error: "user not found" });
  const plan = ["free", "trial", "pro"].includes(req.body.plan) ? req.body.plan : u.plan;
  const status = ["trialing", "active", "canceled"].includes(req.body.status) ? req.body.status : u.status;
  store.db.prepare("UPDATE users SET plan = ?, status = ? WHERE id = ?").run(plan, status, u.id);
  store.trackEvent("admin_user_update", req.user.id, { target: u.id, plan, status });
  res.json(store.getUserById(u.id));
});

function dbq(sql, ...args) { return store.db.prepare(sql).all(...args); }

module.exports = router;
