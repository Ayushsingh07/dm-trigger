// ReplyLo — Advanced Analytics (Pro plan only).
// Overall + per-post performance of the comment→DM automation:
// comments seen (from our webhook), DMs sent/delivered, link clicks and
// unique visitors (from /go/ redirects), CTR and conversion rate.
const express = require("express");
const store = require("../store");
const { attachUser, requireUser } = require("../auth");

const router = express.Router();
router.use(attachUser, requireUser);

// Pro gate: the plan governing the user right now (pass or trial-adjusted)
// must be "pro". Everything else gets a 402-style 403 with an upsell hint.
function requirePro(req, res, next) {
  const plan = store.getPeriod(req.user).plan;
  if (plan === "pro") return next();
  return res.status(403).json({ error: "Advanced Analytics is available on the Pro plan", upgrade: "/billing", plan });
}
router.use(requirePro);

const RANGES = { today: 1, "7d": 7, "30d": 30, all: null };

// ISO cutoff for a range name, or null for all-time.
function sinceFor(range) {
  const days = RANGES[range];
  if (days === undefined || days === null) return null;
  return new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10) + "T00:00:00.000Z";
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// Conversations visible to this user (their own rows only for analytics).
// "failed" rows are excluded: reached must reflect DMs actually sent.
function userConversations(userId, since) {
  return store
    .listAllConversations()
    .filter((c) => c.userId === userId && c.status !== "failed" && (!since || String(c.sentAt) >= since));
}

// Merge per-post rows from the three sources into one sorted list.
function buildPostRows(userId, since) {
  const convs = userConversations(userId, since);
  const commentStats = new Map(store.commentStatsForUser(userId, since).map((r) => [r.post_id, r]));
  const clickStats = new Map(store.clickStatsForUser(userId, since).map((r) => [r.post_id, r]));

  const byPost = new Map(); // postId -> {sent, delivered, clickedConvs}
  for (const c of convs) {
    const key = c.postId ? String(c.postId) : "";
    if (!byPost.has(key)) byPost.set(key, { sent: 0, delivered: 0, clicked: 0 });
    const row = byPost.get(key);
    row.sent += 1;
  }
  // Posts with comments but no DMs yet still deserve a row.
  for (const key of commentStats.keys()) {
    const k = key ? String(key) : "";
    if (!byPost.has(k)) byPost.set(k, { sent: 0, delivered: 0, clicked: 0 });
  }
  // delivered + clicked need per-post SQL counts; small data set, keep it simple
  for (const key of byPost.keys()) {
    if (key) {
      byPost.get(key).delivered = store.deliveredCountForPost(userId, key, since);
    }
  }
  // clicked conversations per post: conversations with status clicked+
  for (const c of convs) {
    if (c.status === "clicked" || c.status === "email_collected") {
      const row = byPost.get(c.postId ? String(c.postId) : "");
      if (row) row.clicked += 1;
    }
  }

  const posts = [];
  for (const [postId, s] of byPost) {
    const cs = commentStats.get(postId) || { comments: 0, commenters: 0, matched: 0 };
    const cl = clickStats.get(postId) || { clicks: 0, uniques: 0 };
    posts.push({
      postId: postId || null,
      comments: cs.comments,
      commenters: cs.commenters,
      matched: cs.matched,
      sent: s.sent,
      delivered: s.delivered,
      clickedConversations: s.clicked,
      clicks: cl.clicks,
      uniqueVisitors: cl.uniques,
      ctrPct: pct(cl.clicks, s.sent),
      conversionPct: pct(cl.uniques, s.sent),
    });
  }
  posts.sort((a, b) => b.sent - a.sent || b.comments - a.comments);
  return { posts, convs };
}

// GET /api/analytics/overview?range=today|7d|30d|all
router.get("/overview", (req, res) => {
  const range = RANGES[req.query.range] !== undefined ? req.query.range : "30d";
  const since = sinceFor(range);
  const { posts, convs } = buildPostRows(req.user.id, since);

  const sum = (f) => posts.reduce((a, p) => a + f(p), 0);
  // Unique visitors / clicked conversations use DISTINCT across the whole
  // user (summing per-post uniques would double-count the same person).
  const uniques = store.uniqueVisitorsForUser(req.user.id, since);
  const clickedConvs = store.clickedConversationsForUser(req.user.id, since);
  const totals = {
    comments: sum((p) => p.comments),
    matched: sum((p) => p.matched),
    reached: convs.length, // users who received an automated reply
    delivered: sum((p) => p.delivered),
    clickedConversations: clickedConvs,
    clicks: sum((p) => p.clicks),
    uniqueVisitors: uniques,
    ctrPct: pct(sum((p) => p.clicks), convs.length),
    conversionPct: pct(uniques, convs.length),
  };

  // Daily series: DMs sent per day + clicks per day (all posts combined).
  const days = new Map();
  const dayOf = (s) => String(s || "").slice(0, 10);
  for (const c of convs) {
    const d = dayOf(c.sentAt);
    if (!days.has(d)) days.set(d, { day: d, sent: 0, clicks: 0 });
    days.get(d).sent += 1;
  }
  for (const row of store.clickSeriesForUser(req.user.id, null, since)) {
    if (!days.has(row.day)) days.set(row.day, { day: row.day, sent: 0, clicks: 0 });
    days.get(row.day).clicks += row.clicks;
  }
  const series = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));

  res.json({ range, totals, posts, series });
});

// GET /api/analytics/post/:postId?range= — drill-down for one post.
router.get("/post/:postId", (req, res) => {
  const postId = String(req.params.postId).slice(0, 64);
  const range = RANGES[req.query.range] !== undefined ? req.query.range : "30d";
  const since = sinceFor(range);

  const convs = userConversations(req.user.id, since).filter((c) => String(c.postId || "") === postId);
  const cs = store.commentStatsForPost(req.user.id, postId, since);
  const cl = store.clickStatsForPost(req.user.id, postId, since);
  const clickSeries = store.clickSeriesForPost(req.user.id, postId, since);

  const comments = cs.reduce((a, r) => a + r.comments, 0);
  const matched = cs.reduce((a, r) => a + r.matched, 0);
  const sent = convs.length;
  const delivered = store.deliveredCountForPost(req.user.id, postId, since);
  const clickedConvs = convs.filter((c) => c.status === "clicked" || c.status === "email_collected").length;

  // Merge daily comment + click + send counts into one trend.
  const days = new Map();
  const touch = (d) => { if (!days.has(d)) days.set(d, { day: d, comments: 0, sent: 0, clicks: 0 }); return days.get(d); };
  for (const r of cs) Object.assign(touch(r.day), { comments: r.comments });
  for (const c of convs) touch(String(c.sentAt || "").slice(0, 10)).sent += 1;
  for (const r of clickSeries) touch(r.day).clicks = r.clicks;

  res.json({
    postId,
    range,
    totals: {
      comments,
      matched,
      sent,
      delivered,
      clickedConversations: clickedConvs,
      clicks: cl.clicks,
      uniqueVisitors: cl.uniques,
      ctrPct: pct(cl.clicks, sent),
      conversionPct: pct(cl.uniques, sent),
    },
    series: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
  });
});

module.exports = router;
