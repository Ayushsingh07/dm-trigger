// ReplyLo — dashboard stats scoped to the signed-in user (or demo when out).
const express = require("express");
const store = require("../store");
const { attachUser, requireUser, verifyPassword, clearSessionCookie } = require("../auth");

const router = express.Router();
router.use(attachUser);

// ---------------------------------------------------------------- ranges
const RANGES = { today: 1, "7d": 7, "30d": 30, all: null };

// Returns { from, to } as YYYY-MM-DD strings (inclusive), or null for "all".
function rangeWindow(range) {
  const days = RANGES[range] ?? RANGES["7d"];
  if (days === null) return null;
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to), days };
}
const isoDay = (d) => d.toISOString().slice(0, 10);
const sentDay = (c) => String(c.sentAt || c.sent_at || "").slice(0, 10);

function inWindow(c, win) {
  if (!win) return true;
  const d = sentDay(c);
  return d >= win.from && d <= win.to;
}

// Same-length window immediately before the current one, for growth %.
function prevWindow(win) {
  if (!win) return null;
  const to = new Date(win.from + "T00:00:00Z");
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (win.days - 1));
  return { from: isoDay(from), to: isoDay(to), days: win.days };
}

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

// GET /api/stats/overview?range=today|7d|30d|all — everything the dashboard renders.
router.get("/overview", (req, res) => {
  const range = String(req.query.range || "7d");
  const win = rangeWindow(range);
  const prev = prevWindow(win);

  const all = visibleConversations(req);
  const convs = all.filter((c) => inWindow(c, win));
  const prevConvs = prev ? all.filter((c) => inWindow(c, prev)) : [];

  const emailsAll = req.user
    ? store.listAllEmails().filter((e) => e.user_id === req.user.id || e.account_id === "demo")
    : store.listAllEmails().filter((e) => e.account_id === "demo");
  const dayOf = (v) => String(v.created_at || v.createdAt || "").slice(0, 10);
  const inWin = (v) => !win || (dayOf(v) >= win.from && dayOf(v) <= win.to);
  const emails = emailsAll.filter(inWin);

  // --- daily series across the whole window (zero-filled) ---
  const series = [];
  if (win) {
    for (let d = new Date(win.from + "T00:00:00Z"); isoDay(d) <= win.to; d.setUTCDate(d.getUTCDate() + 1)) {
      series.push({ day: isoDay(d), sent: 0, engaged: 0, emails: 0 });
    }
  }
  const byDay = Object.fromEntries(series.map((s) => [s.day, s]));
  for (const c of convs) {
    const s = byDay[sentDay(c)];
    if (!s) continue;
    s.sent++;
    if (c.status !== "sent") s.engaged++;
  }
  for (const e of emails) { const s = byDay[dayOf(e)]; if (s) s.emails++; }

  const growth = (cur, before) => {
    if (!before) return cur > 0 ? 100 : 0;
    return Math.round(((cur - before) / before) * 100);
  };
  const engagedCount = convs.filter((c) => c.status !== "sent").length;
  const prevEngaged = prevConvs.filter((c) => c.status !== "sent").length;

  const totals = {
    sent: convs.length,
    reached: new Set(convs.map((c) => c.psid)).size,
    engaged: engagedCount,
    emails: emails.length,
    sentGrowth: growth(convs.length, prevConvs.length),
    reachedGrowth: growth(new Set(convs.map((c) => c.psid)).size, new Set(prevConvs.map((c) => c.psid)).size),
    engagedGrowth: growth(engagedCount, prevEngaged),
  };

  // --- funnel ---
  const funnel = [
    { key: "sent", n: convs.length },
    { key: "engaged", n: engagedCount },
    { key: "email", n: emails.length },
  ];

  // --- top keywords (via rule_id) and top posts (via post_id) ---
  const kwCount = {}; const postCount = {};
  for (const c of convs) {
    if (c.ruleId) kwCount[c.ruleId] = (kwCount[c.ruleId] || 0) + 1;
    const pid = c.postId || c.post_id;
    if (pid) postCount[pid] = (postCount[pid] || 0) + 1;
  }
  const topKeywords = Object.entries(kwCount)
    .map(([ruleId, n]) => ({ keyword: store.getRule(ruleId)?.keyword || ruleId, n }))
    .sort((a, b) => b.n - a.n).slice(0, 5);
  const topPosts = Object.entries(postCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([postId, n]) => ({ postId, n }));

  // --- account card + setup checklist ---
  const accounts = req.user
    ? store.listAccounts().filter((a) => a.user_id === req.user.id)
    : [];
  const account = accounts[0] || null;
  const rules = req.user ? store.listAllRules().filter((r) => r.user_id === req.user.id) : [];
  const setup = {
    connected: !!account,
    hasRule: rules.length > 0,
    hasConversation: all.length > 0,
  };

  // --- usage vs plan ---
  const usage = req.user ? store.getUsageSummary(req.user.id) : null;

  res.json({
    range,
    window: win,
    series,
    totals,
    funnel,
    topKeywords,
    topPosts,
    account: account ? { username: account.username, igUserId: account.ig_user_id, connectedAt: account.connected_at } : null,
    setup,
    usage,
  });
});

// GET /api/stats/conversations/export.csv?range=... — CSV of visible conversations.
router.get("/conversations/export.csv", (req, res) => {
  const win = rangeWindow(String(req.query.range || "all"));
  const rows = visibleConversations(req).filter((c) => inWindow(c, win));
  const rules = {};
  for (const r of store.listAllRules()) rules[r.id] = r.keyword;
  const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["when,keyword,commenter,post,status"];
  for (const c of rows) {
    lines.push([c.sentAt, escCsv(rules[c.ruleId] || c.ruleId || ""), escCsv(c.psid), escCsv(c.postId || c.post_id || ""), c.status].join(","));
  }
  res.type("text/csv")
    .set("Content-Disposition", `attachment; filename="replylo-conversations-${isoDay(new Date())}.csv"`)
    .send(lines.join("\n"));
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

// GET /api/stats/health — account health: delivery rate, token age, safety.
router.get("/health", (req, res) => {
  const accounts = req.user ? store.listAccounts().filter((a) => a.user_id === req.user.id) : [];
  const nowMs = Date.now();
  const acctRows = store.listAccountRows().filter((r) => r.user_id === req.user.id);
  const perAccount = accounts.map((a) => {
    const row = acctRows.find((r) => r.ig_user_id === a.ig_user_id);
    const issued = row && (row.token_issued_at || row.connected_at);
    const tokenAgeDays = issued ? Math.round((nowMs - new Date(issued).getTime()) / 864e5) : null;
    return { account: a.username || a.ig_user_id, igUserId: a.ig_user_id, tokenAgeDays,
      tokenWarning: tokenAgeDays !== null && tokenAgeDays > 55 };
  });
  // Delivery rate over the last 7 days for my conversations.
  const since = new Date(nowMs - 7 * 864e5).toISOString();
  const total = store.db.prepare("SELECT COUNT(*) n FROM conversations WHERE user_id=? AND sent_at>=?").get(req.user.id, since).n;
  const delivered = store.deliveredCountForUser(req.user.id, since);
  const failed = store.db.prepare("SELECT COUNT(*) n FROM conversations WHERE user_id=? AND sent_at>=? AND status='failed'").get(req.user.id, since).n;
  const deliveryRate = total ? Math.round((delivered / total) * 100) : null;
  // Safety score: 100 minus penalties for low delivery and stale tokens.
  let safety = 100;
  if (deliveryRate !== null && deliveryRate < 80) safety -= Math.min(40, (80 - deliveryRate) * 2);
  if (perAccount.some((a) => a.tokenWarning)) safety -= 20;
  res.json({
    windowDays: 7, sent: total, delivered, failed, deliveryRate,
    accounts: perAccount, safetyScore: Math.max(0, safety),
    tips: [
      deliveryRate !== null && deliveryRate < 80 ? "Delivery is below 80% — check blocked/failed DMs and slow your pacing." : null,
      perAccount.some((a) => a.tokenWarning) ? "A connection token is older than 55 days — reconnect the account." : null,
    ].filter(Boolean),
  });
});

module.exports = router;
