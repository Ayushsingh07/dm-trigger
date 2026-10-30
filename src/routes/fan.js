// ReplyLo — Fan Mode: loyalty points, tiers, leaderboard.
const express = require("express");
const store = require("../store");
const { attachUser, requireUser } = require("../auth");

const router = express.Router();
router.use(attachUser, requireUser);

// Fan Mode is a Pro feature (mirrors the analytics gate).
function isPro(user) {
  return store.getPeriod(user) === "pro";
}

// GET /api/fan/config — current config + member count.
router.get("/config", (req, res) => {
  const cfg = store.getFanConfig(req.user.id);
  res.json({ ...cfg, pro: isPro(req.user), members: store.fanLeaderboard(req.user.id, 1).length ? store.db.prepare("SELECT COUNT(*) n FROM fan_members WHERE user_id=?").get(req.user.id).n : 0 });
});

// PUT /api/fan/config — enable/disable, point values, tiers.
router.put("/config", (req, res) => {
  if (!isPro(req.user)) {
    return res.status(403).json({ error: "Fan Mode is a Pro feature", upgrade: "/billing" });
  }
  const b = req.body || {};
  const cfg = store.setFanConfig(req.user.id, {
    enabled: !!b.enabled,
    pointsComment: Number(b.pointsComment) || undefined,
    pointsFollow: Number(b.pointsFollow) || undefined,
    pointsStreak: Number(b.pointsStreak) || undefined,
    tiers: Array.isArray(b.tiers) ? b.tiers.map((t) => ({
      name: String(t.name || "").slice(0, 30),
      points: Math.max(1, Number(t.points) || 0),
      reward_text: String(t.reward_text || "").slice(0, 1000),
    })) : undefined,
  });
  store.trackEvent("fan_config", req.user.id, { enabled: cfg.enabled });
  res.json(cfg);
});

// GET /api/fan/leaderboard — top members.
router.get("/leaderboard", (req, res) => {
  if (!isPro(req.user)) return res.status(403).json({ error: "Fan Mode is a Pro feature", upgrade: "/billing" });
  const rows = store.fanLeaderboard(req.user.id, 20).map((m, i) => ({
    rank: i + 1, username: m.ig_username || m.psid.slice(-6),
    points: m.points, streak: m.streak_days, tier: m.tier_index,
  }));
  res.json({ leaderboard: rows });
});

// GET /api/fan/member/:psid — one fan's points ledger (support view).
router.get("/member/:psid", (req, res) => {
  const ledger = store.fanLedgerFor(req.user.id, req.params.psid);
  res.json({ ledger });
});

module.exports = router;
