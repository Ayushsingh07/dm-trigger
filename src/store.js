// ReplyLo — data store backed by SQLite (src/db.js).
// Same helper API the rest of the app already used, now persistent.

const crypto = require("crypto");
const { db } = require("./db");
const { sealToken, openToken } = require("./crypto");

const uid = (p = "") => p + crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();
const J = (v) => JSON.stringify(v ?? null);
const P = (s, f) => { try { return JSON.parse(s) ?? f; } catch { return f; } };

// map a rules row -> app shape
const ruleRow = (r) => r && ({
  id: r.id, accountId: r.account_id, userId: r.user_id, keyword: r.keyword,
  scope: r.scope, postIds: P(r.post_ids, []), dmText: r.dm_text,
  links: P(r.links, []), followersOnly: !!r.followers_only, askEmail: !!r.ask_email,
  reminderAfterMin: r.reminder_after_min, active: !!r.active, createdAt: r.created_at,
});
const convRow = (c) => c && ({
  id: c.id, accountId: c.account_id, userId: c.user_id, psid: c.psid,
  commentId: c.comment_id, ruleId: c.rule_id, status: c.status,
  reminded: !!c.reminded, reminderAt: c.reminder_at, sentAt: c.sent_at,
  postId: c.post_id ?? null,
});

// True for SQLite UNIQUE-constraint violations (used for quiet dedupe handling).
const isUniqueViolation = (err) =>
  /UNIQUE constraint failed/i.test(String(err && err.message || ""));

// ---------------------------------------------------------------- users
function createUser({ email, passwordHash, name = "", role = "user", plan = "free", status = "trialing" }) {
  const id = uid("u_");
  const trialEnds = new Date(Date.now() + 7 * 864e5).toISOString();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, plan, status, trial_ends_at, created_at, last_seen_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, String(email).trim().toLowerCase(), passwordHash, name, role, plan, status, trialEnds, now(), now());
  return getUserByEmail(email) ;
}
// `|| null` (not ??): node:sqlite returns undefined for no-row .get(), and the
// rest of the app (and the API responses) rely on a null, not undefined.
const getUserByEmail = (email) =>
  db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").trim().toLowerCase()) || null;
const getUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;

// i18n preferences (validated by the caller against SUPPORTED locales)
function setUserLang(userId, lang) {
  db.prepare("UPDATE users SET lang = ? WHERE id = ?").run(lang, userId);
}
function setUserCurrency(userId, currency) {
  db.prepare("UPDATE users SET currency = ? WHERE id = ?").run(currency, userId);
}

// ---------------------------------------------------------------- accounts
// access_token is encrypted at rest (see src/crypto.js). Callers always see
// plaintext; the ciphertext never leaves this module.
function upsertAccount({ igUserId, username, accessToken, userId, tokenIssuedAt, pageId }) {
  const existing = db.prepare("SELECT * FROM accounts WHERE ig_user_id = ?").get(String(igUserId));
  db.prepare(`INSERT INTO accounts (ig_user_id, username, access_token, user_id, connected_at, token_issued_at, page_id)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(ig_user_id) DO UPDATE SET
                username = excluded.username,
                access_token = excluded.access_token,
                user_id = COALESCE(excluded.user_id, accounts.user_id),
                token_issued_at = excluded.token_issued_at,
                page_id = COALESCE(excluded.page_id, accounts.page_id)`)
    .run(String(igUserId), username || null, sealToken(accessToken) ?? null,
      userId || existing?.user_id || null, existing?.connected_at || now(),
      tokenIssuedAt || now(), pageId || existing?.page_id || null);
  return getAccount(igUserId);
}

// Row with the token decrypted, plus a camelCase alias for convenience.
const openAccount = (row) => {
  if (!row) return null;
  const token = openToken(row.access_token);
  return { ...row, access_token: token, accessToken: token };
};

const getAccount = (igUserId) =>
  openAccount(db.prepare("SELECT * FROM accounts WHERE ig_user_id = ?").get(String(igUserId)));
const listAccounts = () =>
  db.prepare("SELECT * FROM accounts ORDER BY connected_at").all().map(openAccount);

// Raw rows (still encrypted) — used only by the token-refresh job, which
// needs to know age without decrypting every row.
const listAccountRows = () =>
  db.prepare("SELECT * FROM accounts ORDER BY connected_at").all();

function updateAccountToken(igUserId, accessToken, tokenIssuedAt = now()) {
  db.prepare("UPDATE accounts SET access_token = ?, token_issued_at = ? WHERE ig_user_id = ?")
    .run(sealToken(accessToken), tokenIssuedAt, String(igUserId));
}

// ---------------------------------------------------------------- rules
// Keywords are stored NFKC-normalized and trimmed, keeping the user's case
// (matching is case-insensitive in actions.commentMatchesKeyword). The old
// .toUpperCase() mangled non-Latin scripts (ß -> SS) and was pointless.
const normalizeKeyword = (kw) => String(kw).normalize("NFKC").trim();

function createRule({
  accountId, userId = null, keyword, scope = "all", postIds = [],
  dmText = "Hey {name}! 👋 Here's the link you asked for.",
  links = [], followersOnly = false, askEmail = false, reminderAfterMin = 0,
}) {
  if (!accountId || !keyword) throw new Error("accountId and keyword are required");
  if (links.length > 3) throw new Error("A DM can have at most 3 links");
  const rule = {
    id: uid("r_"), accountId: String(accountId), userId,
    keyword: normalizeKeyword(keyword), scope, postIds, dmText,
    links: links.slice(0, 3), followersOnly, askEmail, reminderAfterMin,
    active: true, createdAt: now(),
  };
  db.prepare(`INSERT INTO rules (id, account_id, user_id, keyword, scope, post_ids, dm_text, links,
              followers_only, ask_email, reminder_after_min, active, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rule.id, rule.accountId, rule.userId, rule.keyword, rule.scope, J(rule.postIds), rule.dmText,
      J(rule.links), rule.followersOnly ? 1 : 0, rule.askEmail ? 1 : 0, rule.reminderAfterMin, 1, rule.createdAt);
  return rule;
}

function updateRule(id, patch) {
  const cur = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!cur) return null;
  const next = {
    keyword: patch.keyword !== undefined ? normalizeKeyword(patch.keyword) : cur.keyword,
    scope: patch.scope ?? cur.scope,
    post_ids: patch.postIds !== undefined ? J(patch.postIds) : cur.post_ids,
    dm_text: patch.dmText ?? cur.dm_text,
    links: patch.links !== undefined ? J(patch.links.slice(0, 3)) : cur.links,
    followers_only: patch.followersOnly !== undefined ? (patch.followersOnly ? 1 : 0) : cur.followers_only,
    ask_email: patch.askEmail !== undefined ? (patch.askEmail ? 1 : 0) : cur.ask_email,
    reminder_after_min: patch.reminderAfterMin ?? cur.reminder_after_min,
    active: patch.active !== undefined ? (patch.active ? 1 : 0) : cur.active,
  };
  db.prepare(`UPDATE rules SET keyword=?, scope=?, post_ids=?, dm_text=?, links=?,
              followers_only=?, ask_email=?, reminder_after_min=?, active=? WHERE id=?`)
    .run(next.keyword, next.scope, next.post_ids, next.dm_text, next.links,
      next.followers_only, next.ask_email, next.reminder_after_min, next.active, id);
  return ruleRow(db.prepare("SELECT * FROM rules WHERE id = ?").get(id));
}

const deleteRule = (id) => db.prepare("DELETE FROM rules WHERE id = ?").run(id).changes > 0;
// `|| null`: node:sqlite .get() yields undefined for no row; the app returns null.
const getRule = (id) => ruleRow(db.prepare("SELECT * FROM rules WHERE id = ?").get(id)) || null;
const rulesForAccount = (accountId) =>
  db.prepare("SELECT * FROM rules WHERE account_id = ? ORDER BY created_at").all(String(accountId)).map(ruleRow);

// ---------------------------------------------------------------- conversations
// Returns the new conversation row, or null when a conversation for this
// comment_id already exists (Meta webhook retry) — UNIQUE index enforces it.
function createConversation({ accountId, userId = null, psid, commentId, ruleId, reminderAt = null, postId = null }) {
  const id = uid("c_");
  try {
    db.prepare(`INSERT INTO conversations (id, account_id, user_id, psid, comment_id, rule_id, status, reminded, reminder_at, sent_at, post_id)
                VALUES (?,?,?,?,?,?,?,0,?,?,?)`)
      .run(id, String(accountId), userId, psid ?? null, commentId ?? null, ruleId ?? null, "sent", reminderAt, now(), postId ?? null);
  } catch (err) {
    if (isUniqueViolation(err)) return null; // duplicate comment_id — Meta retry, ignore quietly
    throw err;
  }
  return convRow(db.prepare("SELECT * FROM conversations WHERE id = ?").get(id));
}

function updateConversation(id, patch) {
  const cur = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!cur) return null;
  db.prepare("UPDATE conversations SET status = ?, reminded = ?, reminder_at = ? WHERE id = ?")
    .run(
      patch.status ?? cur.status,
      patch.reminded !== undefined ? (patch.reminded ? 1 : 0) : cur.reminded,
      patch.reminderAt !== undefined ? patch.reminderAt : cur.reminder_at,
      id,
    );
  return convRow(db.prepare("SELECT * FROM conversations WHERE id = ?").get(id));
}

// Used when a DM send ultimately fails after the row was created, so the
// "reached" count only ever reflects DMs that were actually sent.
const deleteConversation = (id) => db.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;

// Rows the reminder scheduler should process: due, still "sent", not reminded.
function dueReminders(limit = 50) {
  return db.prepare(`SELECT * FROM conversations
    WHERE reminder_at IS NOT NULL AND reminded = 0 AND status = 'sent' AND reminder_at <= ?
    ORDER BY reminder_at LIMIT ?`).all(now(), limit).map(convRow);
}

const getConversation = (id) => convRow(db.prepare("SELECT * FROM conversations WHERE id = ?").get(id)) || null;
const conversationsForAccount = (accountId) =>
  db.prepare("SELECT * FROM conversations WHERE account_id = ? ORDER BY sent_at").all(String(accountId)).map(convRow);
// most recent conversation for a psid (optionally still awaiting a reply)
const lastConversationForPsid = (psid, status = null) =>
  convRow(db.prepare(`SELECT * FROM conversations WHERE psid = ? ${status ? "AND status = ?" : ""}
    ORDER BY sent_at DESC LIMIT 1`).get(...(status ? [psid, status] : [psid]))) || null;

// ---------------------------------------------------------------- emails
function collectEmail({ accountId, userId = null, psid, email, ruleId }) {
  const id = uid("e_");
  db.prepare(`INSERT INTO emails (id, account_id, user_id, psid, email, rule_id, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, String(accountId), userId, psid ?? null, String(email).trim().toLowerCase(), ruleId ?? null, now());
  return id;
}
const emailsForAccount = (accountId) =>
  db.prepare("SELECT * FROM emails WHERE account_id = ? ORDER BY created_at").all(String(accountId));

// ---------------------------------------------------------------- analytics
function trackVisit({ path, referrer, ua }) {
  const uaHash = crypto.createHash("sha256").update(String(ua || "")).digest("hex").slice(0, 16);
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  db.prepare("INSERT INTO visits (path, referrer, ua_hash, day, created_at) VALUES (?,?,?,?,?)")
    .run(String(path || "/").slice(0, 200), String(referrer || "").slice(0, 200), uaHash, day, now());
}

function trackEvent(name, userId = null, meta = {}) {
  db.prepare("INSERT INTO events (name, user_id, meta, created_at) VALUES (?,?,?,?)")
    .run(String(name).slice(0, 60), userId, J(meta), now());
}

// ---------------------------------------------------------------- oauth states
function createOAuthState(userId) {
  const state = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO oauth_states (state, user_id, created_at) VALUES (?,?,?)").run(state, userId ?? null, now());
  return state;
}
function consumeOAuthState(state) {
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
  if (row) db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  return row || null;
}

// ---------------------------------------------------------------- admin metrics
function adminMetrics() {
  const day = (offset = 0) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
  const scalar = (sql, ...a) => Object.values(db.prepare(sql).get(...a) || {})[0] ?? 0;

  const signupsToday = scalar("SELECT COUNT(*) FROM users WHERE substr(created_at,1,10)=?", day());
  const visitsToday = scalar("SELECT COUNT(*) FROM visits WHERE day=?", day());
  const uniqueToday = scalar("SELECT COUNT(DISTINCT ua_hash) FROM visits WHERE day=?", day());

  const signups7 = db.prepare(`SELECT substr(created_at,1,10) d, COUNT(*) c FROM users
    WHERE created_at >= datetime('now','-7 days') GROUP BY d ORDER BY d`).all();
  const visits7 = db.prepare(`SELECT day d, COUNT(*) c, COUNT(DISTINCT ua_hash) u FROM visits
    WHERE day >= date('now','-7 days') GROUP BY day ORDER BY day`).all();

  const byPlan = db.prepare("SELECT plan, COUNT(*) c FROM users GROUP BY plan").all();
  const byStatus = db.prepare("SELECT status, COUNT(*) c FROM users GROUP BY status").all();

  const funnel = {
    visited: scalar("SELECT COUNT(DISTINCT ua_hash) FROM visits"),
    signedUp: scalar("SELECT COUNT(*) FROM users"),
    connected: scalar("SELECT COUNT(DISTINCT user_id) FROM accounts WHERE user_id IS NOT NULL"),
    createdRule: scalar("SELECT COUNT(DISTINCT user_id) FROM rules WHERE user_id IS NOT NULL"),
    sentDm: scalar("SELECT COUNT(DISTINCT user_id) FROM conversations WHERE user_id IS NOT NULL"),
    collectedEmail: scalar("SELECT COUNT(DISTINCT user_id) FROM emails WHERE user_id IS NOT NULL"),
  };

  return {
    totals: {
      users: scalar("SELECT COUNT(*) FROM users"),
      adminUsers: scalar("SELECT COUNT(*) FROM users WHERE role='admin'"),
      accounts: scalar("SELECT COUNT(*) FROM accounts"),
      rules: scalar("SELECT COUNT(*) FROM rules"),
      conversations: scalar("SELECT COUNT(*) FROM conversations"),
      replied: scalar("SELECT COUNT(*) FROM conversations WHERE status IN ('replied','clicked','email_collected')"),
      emails: scalar("SELECT COUNT(*) FROM emails"),
      visits: scalar("SELECT COUNT(*) FROM visits"),
      uniqueVisitors: scalar("SELECT COUNT(DISTINCT ua_hash) FROM visits"),
    },
    today: { signups: signupsToday, visits: visitsToday, unique: uniqueToday },
    series: { signups: signups7, visits: visits7 },
    byPlan, byStatus, funnel,
    recentUsers: db.prepare(`SELECT id, email, name, role, plan, status, created_at, last_seen_at
      FROM users ORDER BY created_at DESC LIMIT 25`).all(),
    recentEvents: db.prepare(`SELECT e.id, e.name, e.meta, e.created_at, u.email
      FROM events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 40`).all(),
    topPaths: db.prepare(`SELECT path, COUNT(*) c FROM visits GROUP BY path ORDER BY c DESC LIMIT 10`).all(),
  };
}

// list-all helpers (admin / unscoped dashboard)
const listAllRules = () => db.prepare("SELECT * FROM rules ORDER BY created_at").all().map(ruleRow);
const listAllConversations = () => db.prepare("SELECT * FROM conversations ORDER BY sent_at").all().map(convRow);
const listAllEmails = () => db.prepare("SELECT * FROM emails ORDER BY created_at").all();

// ---------------------------------------------------------------- plans / limits
// Quota per plan. `conversationsPerMonth` counts conversations created in the
// current calendar month for that user.
const PLAN_LIMITS = {
  free:  { accounts: 1,  rules: 3,   conversationsPerMonth: 100 },
  trial: { accounts: 3,  rules: 15,  conversationsPerMonth: 2000 },
  pro:   { accounts: 10, rules: 100, conversationsPerMonth: 50000 },
};
const limitsForPlan = (plan) => PLAN_LIMITS[plan] || PLAN_LIMITS.free;

const countAccountsForUser = (userId) =>
  Object.values(db.prepare("SELECT COUNT(*) c FROM accounts WHERE user_id = ?").get(userId) || {})[0] ?? 0;
const countRulesForUser = (userId) =>
  Object.values(db.prepare("SELECT COUNT(*) c FROM rules WHERE user_id = ?").get(userId) || {})[0] ?? 0;
const countConversationsThisMonth = (userId) =>
  Object.values(db.prepare(`SELECT COUNT(*) c FROM conversations
    WHERE user_id = ? AND substr(sent_at,1,7) = substr(?,1,7)`).get(userId, now()) || {})[0] ?? 0;

// Usage vs. quota for the dashboard.
function planUsage(user) {
  const limits = limitsForPlan(user.plan);
  return {
    plan: user.plan,
    limits,
    usage: {
      accounts: countAccountsForUser(user.id),
      rules: countRulesForUser(user.id),
      conversationsThisMonth: countConversationsThisMonth(user.id),
    },
    trialEndsAt: user.trial_ends_at,
    trialExpired: isTrialExpired(user),
  };
}

// A trial user whose trial_ends_at has passed behaves as "free".
function isTrialExpired(user) {
  if (!user) return false;
  if (user.plan !== "trial") return false;
  if (!user.trial_ends_at) return false;
  return new Date(user.trial_ends_at).getTime() < Date.now();
}

// Effective plan after trial expiry (trial -> free).
function effectivePlan(user) {
  if (!user) return "free";
  if (user.status === "canceled") return "free";
  return isTrialExpired(user) ? "free" : (user.plan || "free");
}

// ------------------------------------------------- prepaid pass / per-post quota
// All quota logic lives here; actions.js and the routes only call these.
const { PLANS, PERIOD_DAYS, TOPUP, limitsFor: pricingLimits } = require("./pricing");

const DAY_MS = 864e5;
const addDays = (ms, days) => new Date(ms + days * DAY_MS).toISOString();

// Which plan governs the user right now, and the period it counts against.
//  - an active paid pass  -> that plan, period runs from pass_started_at
//  - an unexpired trial   -> growth limits, period from trial start (created_at)
//  - otherwise            -> free, rolling 30-day window ending today
// `start` is the period_start written into post_usage rows, so it must be
// STABLE for a given user+day: the free window is floored to UTC midnight,
// otherwise every call would open a brand-new period.
function getPeriod(user) {
  const nowMs = Date.now();
  const toMs = (s) => (s ? new Date(s).getTime() : 0);

  if (user?.pass_plan && user.pass_plan !== "free" && toMs(user.pass_expires_at) > nowMs) {
    const start = toMs(user.pass_started_at) || nowMs;
    return { start: new Date(start).toISOString(), end: user.pass_expires_at, plan: user.pass_plan };
  }
  if (!isTrialExpired(user) && user?.plan === "trial") {
    const created = toMs(user.created_at) || nowMs;
    return { start: new Date(created).toISOString(), end: user.trial_ends_at, plan: "trial" };
  }
  const startOfDay = (ms) => new Date(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
  return {
    start: new Date(startOfDay(nowMs - PERIOD_DAYS * DAY_MS)).toISOString(),
    end: new Date(nowMs).toISOString(),
    plan: "free",
  };
}

// Effective quota for a period's plan: trial borrows the growth limits.
const limitsForPeriod = (plan) => pricingLimits(plan === "trial" ? "growth" : plan);

// Posts already activated by the user inside one period.
const countPeriodPosts = (userId, periodStart) =>
  Object.values(db.prepare(`SELECT COUNT(*) c FROM post_usage WHERE user_id = ? AND period_start = ?`)
    .get(userId, periodStart) || {})[0] ?? 0;

// Replies already used on one post this period.
const getPostUsage = (userId, postId, periodStart) =>
  db.prepare(`SELECT * FROM post_usage WHERE user_id = ? AND post_id = ? AND period_start = ?`)
    .get(userId, String(postId), periodStart) || null;

// Spend one reply unit for one post. Everything happens in a single
// transaction so two concurrent webhooks can never both pass the cap check.
// Returns { ok:true } or { ok:false, reason:'no_access'|'post_limit'|'reply_limit' }.
function tryConsumeReply(userId, postId) {
  const user = getUserById(userId);
  if (!user) return { ok: false, reason: "no_access" };
  const period = getPeriod(user);
  const limits = limitsForPeriod(period.plan);
  const post = String(postId ?? "");
  if (!post) return { ok: false, reason: "no_access" };

  db.exec("BEGIN IMMEDIATE");
  try {
    let row = db.prepare(`SELECT * FROM post_usage WHERE user_id = ? AND post_id = ? AND period_start = ?`)
      .get(userId, post, period.start);
    if (!row) {
      // A brand-new post also consumes one of the period's post slots.
      const posts = countPeriodPosts(userId, period.start);
      if (posts >= limits.postsPerPeriod) {
        db.exec("COMMIT");
        return { ok: false, reason: "post_limit" };
      }
      db.prepare(`INSERT INTO post_usage (id, user_id, post_id, period_start, used, extra_replies, created_at)
                  VALUES (?,?,?,?,1,0,?)`)
        .run(uid("pu_"), userId, post, period.start, now());
      db.exec("COMMIT");
      return { ok: true, plan: period.plan, cap: limits.repliesPerPost, used: 1, newPost: true };
    }

    const cap = limits.repliesPerPost + (row.extra_replies || 0);
    if ((row.used || 0) >= cap) {
      db.exec("COMMIT");
      return { ok: false, reason: "reply_limit" };
    }
    db.prepare("UPDATE post_usage SET used = used + 1 WHERE id = ?").run(row.id);
    db.exec("COMMIT");
    return { ok: true, plan: period.plan, cap, used: row.used + 1, newPost: false };
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
}

// Give one unit back when a Meta send failed for a non-retryable reason, so a
// delivery that never happened is never billed to the user.
function refundReply(userId, postId) {
  const user = getUserById(userId);
  if (!user) return false;
  const period = getPeriod(user);
  const res = db.prepare(`UPDATE post_usage SET used = MAX(used - 1, 0)
    WHERE user_id = ? AND post_id = ? AND period_start = ? AND used > 0`)
    .run(userId, String(postId), period.start);
  return res.changes > 0;
}

// Per-post usage table + "posts used X of Y" for the dashboard.
function getUsageSummary(userId) {
  const user = getUserById(userId);
  if (!user) return { plan: "free", postsUsed: 0, postsAllowed: 0, extraReplies: 0, posts: [] };
  const period = getPeriod(user);
  const limits = limitsForPeriod(period.plan);
  const rows = db.prepare(`SELECT * FROM post_usage WHERE user_id = ? AND period_start = ? ORDER BY created_at`)
    .all(userId, period.start);
  const posts = rows.map((r) => ({
    postId: r.post_id,
    used: r.used || 0,
    extraReplies: r.extra_replies || 0,
    cap: limits.repliesPerPost + (r.extra_replies || 0),
    periodStart: r.period_start,
  }));
  return {
    plan: period.plan,
    periodStart: period.start,
    periodEnd: period.end,
    postsUsed: posts.length,
    postsAllowed: limits.postsPerPeriod,
    repliesPerPost: limits.repliesPerPost,
    extraReplies: posts.reduce((s, p) => s + p.extraReplies, 0),
    posts,
  };
}

// True when an event with this name for this user was already recorded today.
function hasEventToday(name, userId) {
  return Object.values(db.prepare(`SELECT COUNT(*) c FROM events
    WHERE name = ? AND user_id = ? AND substr(created_at,1,10) = ?`)
    .get(name, userId, new Date().toISOString().slice(0, 10)) || {})[0] > 0;
}

// True when a blocked_<reason> event was already logged today for this post,
// so a capped post doesn't flood the event log with every comment.
function hasBlockEventToday(userId, postId, reason) {
  const rows = db.prepare(`SELECT meta FROM events
    WHERE name = ? AND user_id = ? AND substr(created_at,1,10) = ?`)
    .all(`blocked_${reason}`, userId, new Date().toISOString().slice(0, 10));
  return rows.some((r) => String(P(r.meta, {}).post ?? "") === String(postId ?? ""));
}

// ---------------------------------------------------------------- purchases
// One row per checkout attempt. Amounts are always server-side (from pricing.js)
// and stored in the order currency's MINOR units (see pricing.CURRENCY_EXPONENT).
function createPurchase({ id, userId, orderId, kind, plan = null, postId = null, amountMinor, currency = "INR", provider = "mock" }) {
  db.prepare(`INSERT INTO purchases (id, user_id, razorpay_order_id, kind, plan, post_id, amount_paise, status, created_at, currency, provider)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, orderId, kind, plan, postId, amountMinor, "created", now(), String(currency).toUpperCase(), provider);
  return getPurchaseByOrderId(orderId);
}
const getPurchaseByOrderId = (orderId) =>
  db.prepare("SELECT * FROM purchases WHERE razorpay_order_id = ?").get(String(orderId)) || null;

// Marks a purchase paid and applies its effect in the SAME transaction.
// Idempotent: a second call for an already-paid order changes nothing.
// BOTH amount and currency must match the stored order; a mismatch is refused
// (never granted) and reported to the caller. Legacy rows without a currency
// are treated as INR.
function markPurchasePaid({ orderId, paymentId, amountMinor, currency }) {
  const order = getPurchaseByOrderId(orderId);
  if (!order) return { ok: false, reason: "not_found" };
  if (order.status === "paid") return { ok: true, already: true };
  if (Number(amountMinor) !== Number(order.amount_paise)) {
    return { ok: false, reason: "amount_mismatch", expected: order.amount_paise, got: amountMinor };
  }
  const orderCur = String(order.currency || "INR").toUpperCase();
  const eventCur = currency ? String(currency).toUpperCase() : orderCur;
  if (eventCur !== orderCur) {
    return { ok: false, reason: "currency_mismatch", expected: orderCur, got: eventCur };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const paid = db.prepare(`UPDATE purchases SET status = 'paid', razorpay_payment_id = ?, paid_at = ?
      WHERE razorpay_order_id = ? AND status != 'paid'`)
      .run(paymentId ?? null, now(), String(orderId));
    if (paid.changes === 0) { // raced with another webhook
      db.exec("COMMIT");
      return { ok: true, already: true };
    }

    if (order.kind === "pass") {
      // Renew while active extends from the current expiry; otherwise start now.
      const cur = getUserById(order.user_id);
      const expiryMs = cur?.pass_expires_at ? new Date(cur.pass_expires_at).getTime() : 0;
      const from = expiryMs > Date.now() ? expiryMs : Date.now();
      db.prepare("UPDATE users SET pass_plan = ?, pass_started_at = ?, pass_expires_at = ? WHERE id = ?")
        .run(order.plan, new Date(from).toISOString(), addDays(from, PERIOD_DAYS), order.user_id);
    } else if (order.kind === "topup") {
      // A top-up raises only that one post's cap (its most recent usage row).
      const row = db.prepare(`SELECT id FROM post_usage WHERE user_id = ? AND post_id = ?
        ORDER BY period_start DESC LIMIT 1`).get(order.user_id, String(order.post_id));
      if (!row) {
        db.exec("ROLLBACK");
        return { ok: false, reason: "post_not_found" };
      }
      db.prepare("UPDATE post_usage SET extra_replies = extra_replies + ? WHERE id = ?")
        .run(TOPUP.replies, row.id);
    }
    db.exec("COMMIT");
    return { ok: true, kind: order.kind };
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
}

function markPurchaseFailed(orderId) {
  return db.prepare("UPDATE purchases SET status = 'failed' WHERE razorpay_order_id = ? AND status = 'created'")
    .run(String(orderId)).changes > 0;
}

// Purchases for the dashboard / support.
const listPurchases = (userId) =>
  db.prepare("SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC").all(userId);

// ---------------------------------------------------------------- pass expiry
// Users whose paid pass expired: clear pass_plan so they fall back to free.
// Returns the affected users so the job can log / notify.
function downgradeExpiredPasses() {
  const rows = db.prepare(`SELECT id, email, pass_plan, pass_expires_at FROM users
    WHERE pass_plan IS NOT NULL AND pass_plan != 'free'
      AND pass_expires_at IS NOT NULL AND pass_expires_at <= ?`).all(now());
  if (rows.length) {
    db.prepare(`UPDATE users SET pass_plan = NULL WHERE pass_plan IS NOT NULL AND pass_plan != 'free'
      AND pass_expires_at IS NOT NULL AND pass_expires_at <= ?`).run(now());
  }
  return rows;
}

// Users whose pass expires within `days` days (for the "N days left" banner).
function passesExpiringWithin(days) {
  const horizon = new Date(Date.now() + days * 864e5).toISOString();
  return db.prepare(`SELECT id, email, pass_plan, pass_expires_at FROM users
    WHERE pass_plan IS NOT NULL AND pass_plan != 'free'
      AND pass_expires_at > ? AND pass_expires_at <= ?`).all(now(), horizon);
}

// ---------------------------------------------------------------- account deletion
// GDPR-style erasure: everything the user owns, plus their sessions.
function deleteUserCompletely(userId) {
  const stmts = [
    "DELETE FROM link_clicks WHERE token IN (SELECT token FROM go_links WHERE user_id = ?)",
    "DELETE FROM go_links WHERE user_id = ?",
    "DELETE FROM comment_events WHERE user_id = ?",
    "DELETE FROM conversations WHERE user_id = ?",
    "DELETE FROM rules WHERE user_id = ?",
    "DELETE FROM emails WHERE user_id = ?",
    "DELETE FROM accounts WHERE user_id = ?",
    "DELETE FROM events WHERE user_id = ?",
    "DELETE FROM oauth_states WHERE user_id = ?",
    "DELETE FROM post_usage WHERE user_id = ?",
    "DELETE FROM purchases WHERE user_id = ?",
    "DELETE FROM sessions WHERE user_id = ?",
    "DELETE FROM users WHERE id = ?",
  ];
  db.exec("BEGIN");
  try {
    for (const sql of stmts) db.prepare(sql).run(userId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Meta data-deletion / deauthorize: drop tokens + data tied to one IG user.
function deleteAccountByIgUserId(igUserId) {
  const row = db.prepare("SELECT * FROM accounts WHERE ig_user_id = ?").get(String(igUserId));
  if (!row) return false;
  db.prepare("DELETE FROM accounts WHERE ig_user_id = ?").run(String(igUserId));
  db.prepare("UPDATE rules SET account_id = 'demo' WHERE account_id = ?").run(String(igUserId));
  db.prepare("DELETE FROM comment_events WHERE account_id = ?").run(String(igUserId));
  return true;
}

// ---------------------------------------------------------------- session hygiene
function purgeExpiredSessions() {
  const res = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  return res.changes;
}

// ---------------------------------------------------------------- analytics: comment events
// Record every inbound comment (matched or not) so per-post comment totals are
// measurable. Duplicate comment_id (Meta retry) is ignored quietly.
function recordCommentEvent({ accountId, userId = null, postId = null, commentId = null, commenterId = null, matched = false }) {
  try {
    db.prepare(`INSERT INTO comment_events (account_id, user_id, post_id, comment_id, commenter_id, matched, created_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(String(accountId), userId, postId ? String(postId) : null, commentId ? String(commentId) : null,
        commenterId ? String(commenterId) : null, matched ? 1 : 0, now());
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // Meta retry of the same comment — fine
  }
}

// Upgrade a previously recorded comment to "matched" (a rule fired for it).
function markCommentMatched(commentId) {
  if (!commentId) return;
  db.prepare("UPDATE comment_events SET matched = 1 WHERE comment_id = ?").run(String(commentId));
}

// Per-post comment aggregates for one user (comments seen, unique commenters,
// matched comments). `since` is an ISO cutoff or null for all time.
function commentStatsForUser(userId, since = null) {
  const where = `user_id = ?${since ? " AND created_at >= ?" : ""}`;
  const args = since ? [userId, since] : [userId];
  return db.prepare(`SELECT post_id,
      COUNT(*) AS comments,
      COUNT(DISTINCT commenter_id) AS commenters,
      SUM(matched) AS matched
    FROM comment_events WHERE ${where} GROUP BY post_id`).all(...args);
}

// Daily comment counts for one post (drill-down trend).
function commentStatsForPost(userId, postId, since = null) {
  const where = `user_id = ? AND post_id = ?${since ? " AND created_at >= ?" : ""}`;
  const args = since ? [userId, String(postId), since] : [userId, String(postId)];
  return db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS comments,
      COUNT(DISTINCT commenter_id) AS commenters, SUM(matched) AS matched
    FROM comment_events WHERE ${where} GROUP BY day ORDER BY day`).all(...args);
}

// ---------------------------------------------------------------- analytics: go links + clicks
// One token per (conversation, link index) so clicks attribute to conv/post.
function createGoLink({ convId = null, userId = null, accountId = null, ruleId = null, postId = null, url }) {
  const token = crypto.randomBytes(9).toString("base64url"); // 12 chars, URL-safe
  db.prepare(`INSERT INTO go_links (token, conv_id, user_id, account_id, rule_id, post_id, url, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(token, convId, userId, accountId ? String(accountId) : null, ruleId ?? null,
      postId ? String(postId) : null, String(url).slice(0, 2000), now());
  return token;
}

const getGoLink = (token) => db.prepare("SELECT * FROM go_links WHERE token = ?").get(token) || null;

// Record a click and return the link row (or null for unknown tokens).
function recordGoClick(token, ua = "") {
  const link = getGoLink(token);
  if (!link) return null;
  const uaHash = crypto.createHash("sha256").update(String(ua || "")).digest("hex").slice(0, 16);
  db.prepare("INSERT INTO link_clicks (token, day, ua_hash, created_at) VALUES (?,?,?,?)")
    .run(token, now().slice(0, 10), uaHash, now());
  return link;
}

// Click aggregates for one user, joined to their links. Unique visitors =
// distinct (post, ua_hash) pairs — one person clicking twice counts once.
function clickStatsForUser(userId, since = null) {
  const where = `l.user_id = ?${since ? " AND c.created_at >= ?" : ""}`;
  const args = since ? [userId, since] : [userId];
  return db.prepare(`SELECT l.post_id, COUNT(*) AS clicks, COUNT(DISTINCT c.ua_hash) AS uniques
    FROM link_clicks c JOIN go_links l ON l.token = c.token WHERE ${where} GROUP BY l.post_id`).all(...args);
}

function clickStatsForPost(userId, postId, since = null) {
  const where = `l.user_id = ? AND l.post_id = ?${since ? " AND c.created_at >= ?" : ""}`;
  const args = since ? [userId, String(postId), since] : [userId, String(postId)];
  return db.prepare(`SELECT COUNT(*) AS clicks, COUNT(DISTINCT c.ua_hash) AS uniques
    FROM link_clicks c JOIN go_links l ON l.token = c.token WHERE ${where}`).get(...args)
    || { clicks: 0, uniques: 0 };
}

// Daily clicks for one post.
function clickSeriesForPost(userId, postId, since = null) {
  const where = `l.user_id = ? AND l.post_id = ?${since ? " AND c.created_at >= ?" : ""}`;
  const args = since ? [userId, String(postId), since] : [userId, String(postId)];
  return db.prepare(`SELECT c.day, COUNT(*) AS clicks, COUNT(DISTINCT c.ua_hash) AS uniques
    FROM link_clicks c JOIN go_links l ON l.token = c.token WHERE ${where} GROUP BY c.day ORDER BY c.day`).all(...args);
}

// Daily clicks for one user, optionally scoped to one post.
function clickSeriesForUser(userId, postId = null, since = null) {
  const where = `l.user_id = ?${postId ? " AND l.post_id = ?" : ""}${since ? " AND c.created_at >= ?" : ""}`;
  const args = [userId, ...(postId ? [String(postId)] : []), ...(since ? [since] : [])];
  return db.prepare(`SELECT c.day, COUNT(*) AS clicks, COUNT(DISTINCT c.ua_hash) AS uniques
    FROM link_clicks c JOIN go_links l ON l.token = c.token WHERE ${where} GROUP BY c.day ORDER BY c.day`).all(...args);
}

// Total unique visitors for a user (distinct ua_hash across all their links).
function uniqueVisitorsForUser(userId, since = null) {
  const where = `l.user_id = ?${since ? " AND c.created_at >= ?" : ""}`;
  const args = since ? [userId, since] : [userId];
  return (db.prepare(`SELECT COUNT(DISTINCT c.ua_hash) n
    FROM link_clicks c JOIN go_links l ON l.token = c.token WHERE ${where}`).get(...args) || { n: 0 }).n;
}

// Distinct conversations that produced at least one click (for CTR).
function clickedConversationsForUser(userId, since = null) {
  const where = `l.user_id = ? AND l.conv_id IS NOT NULL${since ? " AND c.created_at >= ?" : ""}`;
  const args = since ? [userId, since] : [userId];
  const row = db.prepare(`SELECT COUNT(DISTINCT l.conv_id) AS n
    FROM link_clicks c JOIN go_links l ON l.token = c.token WHERE ${where}`).get(...args);
  return row ? row.n : 0;
}

// ---------------------------------------------------------------- analytics: delivery receipts
// message_deliveries webhook: mark how many DMs Meta confirmed delivering.
function markDelivered(convId) {
  db.prepare("UPDATE conversations SET delivered = 1 WHERE id = ? AND delivered = 0").run(convId);
}

function deliveredCountForUser(userId, since = null) {
  const where = `user_id = ? AND delivered = 1${since ? " AND sent_at >= ?" : ""}`;
  const args = since ? [userId, since] : [userId];
  return (db.prepare(`SELECT COUNT(*) n FROM conversations WHERE ${where}`).get(...args) || { n: 0 }).n;
}

function deliveredCountForPost(userId, postId, since = null) {
  const where = `user_id = ? AND post_id = ? AND delivered = 1${since ? " AND sent_at >= ?" : ""}`;
  const args = since ? [userId, String(postId), since] : [userId, String(postId)];
  return (db.prepare(`SELECT COUNT(*) n FROM conversations WHERE ${where}`).get(...args) || { n: 0 }).n;
}

// ---------------------------------------------------------------- flows
function flowRow(r) {
  if (!r) return null;
  return { id: r.id, userId: r.user_id, accountId: r.account_id, name: r.name,
    triggerType: r.trigger_type, keyword: r.keyword, status: r.status,
    startStepId: r.start_step_id, createdAt: r.created_at, updatedAt: r.updated_at };
}
function stepRow(r) {
  if (!r) return null;
  return { id: r.id, flowId: r.flow_id, text: r.text, buttons: P(r.buttons, []),
    links: P(r.links, []), followGate: !!r.follow_gate, isEnd: !!r.is_end, position: r.position };
}

function createFlow({ userId, accountId = null, name, triggerType = "dm_keyword", keyword = null }) {
  const id = uid("fl_");
  db.prepare(`INSERT INTO flows (id, user_id, account_id, name, trigger_type, keyword, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?, 'draft', ?, ?)`)
    .run(id, userId, accountId ? String(accountId) : null, String(name).slice(0, 120),
      triggerType, keyword ? String(keyword).slice(0, 80) : null, now(), now());
  return getFlow(id);
}
const getFlow = (id) => flowRow(db.prepare("SELECT * FROM flows WHERE id = ?").get(id));
function listFlows(userId) {
  return db.prepare("SELECT * FROM flows WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(flowRow);
}
function updateFlow(id, patch) {
  const sets = [], args = [];
  if (patch.name !== undefined) { sets.push("name = ?"); args.push(String(patch.name).slice(0, 120)); }
  if (patch.status !== undefined) { sets.push("status = ?"); args.push(patch.status); }
  if (patch.keyword !== undefined) { sets.push("keyword = ?"); args.push(patch.keyword ? String(patch.keyword).slice(0, 80) : null); }
  if (patch.triggerType !== undefined) { sets.push("trigger_type = ?"); args.push(patch.triggerType === "comment_keyword" ? "comment_keyword" : "dm_keyword"); }
  if (patch.accountId !== undefined) { sets.push("account_id = ?"); args.push(patch.accountId ? String(patch.accountId) : null); }
  if (patch.startStepId !== undefined) { sets.push("start_step_id = ?"); args.push(patch.startStepId); }
  if (!sets.length) return getFlow(id);
  sets.push("updated_at = ?"); args.push(now(), id);
  db.prepare(`UPDATE flows SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return getFlow(id);
}
function deleteFlow(id) {
  db.prepare("DELETE FROM flow_steps WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM flow_sessions WHERE flow_id = ?").run(id);
  db.prepare("DELETE FROM flows WHERE id = ?").run(id);
}

// Replace all steps of a flow in one transaction (builder always sends the full list).
function saveFlowSteps(flowId, steps) {
  const list = Array.isArray(steps) ? steps.slice(0, 25) : [];
  const ids = list.map((s, i) => (s.id && String(s.id).startsWith("st_")) ? s.id : uid("st_"));
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM flow_steps WHERE flow_id = ?").run(flowId);
    const ins = db.prepare(`INSERT INTO flow_steps (id, flow_id, text, buttons, links, follow_gate, is_end, position, created_at)
                            VALUES (?,?,?,?,?,?,?,?,?)`);
    list.forEach((s, i) => {
      const buttons = (Array.isArray(s.buttons) ? s.buttons.slice(0, 13) : []).map((b) => ({
        label: String(b.label || "").slice(0, 20),
        payload: String(b.payload || "").slice(0, 20) || String(b.label || "").slice(0, 20),
        nextStepId: b.nextStepId ? String(b.nextStepId) : null,
        end: !!b.end }));
      const links = (Array.isArray(s.links) ? s.links.slice(0, 3) : []).map((l) => ({
        title: String(l.title || "").slice(0, 20), url: String(l.url || "").slice(0, 2000) }));
      ins.run(ids[i], flowId, String(s.text || "").slice(0, 2000), J(buttons), J(links),
        s.followGate ? 1 : 0, s.isEnd ? 1 : 0, i, now());
    });
    // Remap button targets that referenced old ids we replaced.
    db.prepare("UPDATE flows SET updated_at = ? WHERE id = ?").run(now(), flowId);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  // Fix dangling next_step references -> end of flow.
  const valid = new Set(listFlowSteps(flowId).map((s) => s.id));
  for (const s of listFlowSteps(flowId)) {
    let dirty = false;
    const buttons = s.buttons.map((b) => {
      if (b.nextStepId && !valid.has(b.nextStepId)) { dirty = true; return { ...b, nextStepId: null, end: true }; }
      return b;
    });
    if (dirty) db.prepare("UPDATE flow_steps SET buttons = ? WHERE id = ?").run(J(buttons), s.id);
  }
  return listFlowSteps(flowId);
}
function listFlowSteps(flowId) {
  return db.prepare("SELECT * FROM flow_steps WHERE flow_id = ? ORDER BY position").all(flowId).map(stepRow);
}
const getFlowStep = (id) => stepRow(db.prepare("SELECT * FROM flow_steps WHERE id = ?").get(id));
// Live flows with a dm_keyword trigger (engine scans these on inbound DMs).
function listLiveDmFlows() {
  return db.prepare("SELECT * FROM flows WHERE status = 'live' AND trigger_type = 'dm_keyword' AND keyword IS NOT NULL")
    .all().map(flowRow);
}
function countFlowsForUser(userId) {
  return (db.prepare("SELECT COUNT(*) n FROM flows WHERE user_id = ?").get(userId) || { n: 0 }).n;
}

// ---------------------------------------------------------------- flow sessions
// Start (or restart) a follower's position in a flow.
function startFlowSession({ flowId, userId, accountId, psid, stepId }) {
  const existing = db.prepare("SELECT * FROM flow_sessions WHERE flow_id = ? AND account_id = ? AND psid = ?")
    .get(flowId, String(accountId), String(psid));
  if (existing) {
    db.prepare(`UPDATE flow_sessions SET status='active', step_id=?, gate_confirmed=0, last_msg_at=?, updated_at=? WHERE id=?`)
      .run(stepId ?? null, now(), now(), existing.id);
    return existing.id;
  }
  const id = uid("fs_");
  db.prepare(`INSERT INTO flow_sessions (id, flow_id, user_id, account_id, psid, step_id, status, last_msg_at, created_at, updated_at)
              VALUES (?,?,?,?,?,?, 'active', ?, ?, ?)`)
    .run(id, flowId, userId ?? null, String(accountId), String(psid), stepId ?? null, now(), now(), now());
  return id;
}
// Active session for a follower on an account (engine routing point).
function activeFlowSession(accountId, psid) {
  const r = db.prepare(`SELECT fs.*, f.user_id AS flow_owner FROM flow_sessions fs
    JOIN flows f ON f.id = fs.flow_id
    WHERE fs.account_id = ? AND fs.psid = ? AND fs.status IN ('active','gated')
    ORDER BY fs.updated_at DESC LIMIT 1`).get(String(accountId), String(psid));
  return r || null;
}
function updateFlowSession(id, patch) {
  const sets = [], args = [];
  if (patch.stepId !== undefined) { sets.push("step_id = ?"); args.push(patch.stepId); }
  if (patch.status !== undefined) { sets.push("status = ?"); args.push(patch.status); }
  if (patch.gateConfirmed !== undefined) { sets.push("gate_confirmed = ?"); args.push(patch.gateConfirmed ? 1 : 0); }
  if (patch.lastMsg !== undefined) { sets.push("last_msg_at = ?"); args.push(patch.lastMsg); }
  if (!sets.length) return;
  sets.push("updated_at = ?"); args.push(now(), id);
  db.prepare(`UPDATE flow_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...args);
}
// Expire active sessions idle for more than the messaging window (24h + slack).
function expireStaleFlowSessions(hours = 26) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  db.prepare(`UPDATE flow_sessions SET status='completed', updated_at=? WHERE status IN ('active','gated') AND COALESCE(last_msg_at, updated_at) < ?`)
    .run(now(), cutoff);
}
function flowStatsForUser(userId) {
  return db.prepare(`SELECT f.id, f.name, f.status,
      COUNT(DISTINCT fs.id) AS sessions,
      SUM(CASE WHEN fs.status='completed' THEN 1 ELSE 0 END) AS completed
    FROM flows f LEFT JOIN flow_sessions fs ON fs.flow_id = f.id
    WHERE f.user_id = ? GROUP BY f.id`).all(userId);
}

// ---------------------------------------------------------------- subscribers
function upsertSubscriber({ userId, accountId, psid, igUsername = null, source = null }) {
  const existing = db.prepare("SELECT * FROM subscribers WHERE user_id = ? AND account_id = ? AND psid = ?")
    .get(userId, String(accountId), String(psid));
  if (existing) {
    db.prepare("UPDATE subscribers SET opted_out = 0, last_seen_at = ?, ig_username = COALESCE(?, ig_username) WHERE id = ?")
      .run(now(), igUsername, existing.id);
    return existing.id;
  }
  const id = uid("sub_");
  db.prepare(`INSERT INTO subscribers (id, user_id, account_id, psid, ig_username, source, last_seen_at, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, userId, String(accountId), String(psid), igUsername, source, now(), now());
  return id;
}
function listSubscribers(userId, { includeOptedOut = false } = {}) {
  return db.prepare(`SELECT * FROM subscribers WHERE user_id = ?${includeOptedOut ? "" : " AND opted_out = 0"} ORDER BY last_seen_at DESC`)
    .all(userId);
}
function subscriberCount(userId) {
  return (db.prepare("SELECT COUNT(*) n FROM subscribers WHERE user_id = ? AND opted_out = 0").get(userId) || { n: 0 }).n;
}
function optOutSubscriber(userId, accountId, psid) {
  db.prepare("UPDATE subscribers SET opted_out = 1, last_seen_at = ? WHERE user_id = ? AND account_id = ? AND psid = ?")
    .run(now(), userId, String(accountId), String(psid));
}

// ---------------------------------------------------------------- broadcasts
function createBroadcast({ userId, accountId = null, name, text, links = [], scheduledAt = null }) {
  const id = uid("bc_");
  db.prepare(`INSERT INTO broadcasts (id, user_id, account_id, name, text, links, status, scheduled_at, created_at)
              VALUES (?,?,?,?,?,?, 'scheduled', ?, ?)`)
    .run(id, userId, accountId ? String(accountId) : null, String(name).slice(0, 120),
      String(text).slice(0, 2000), J(links), scheduledAt, now());
  return db.prepare("SELECT * FROM broadcasts WHERE id = ?").get(id);
}
function queueBroadcastItems(broadcastId, recipients) {
  const ins = db.prepare(`INSERT INTO broadcast_items (broadcast_id, subscriber_id, psid, account_id, status, created_at)
                          VALUES (?,?,?,?, 'pending', ?)`);
  db.exec("BEGIN");
  try {
    for (const r of recipients) ins.run(broadcastId, r.subscriberId, r.psid, String(r.accountId), now());
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
function claimBroadcast(broadcastId) {
  db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'").run(broadcastId);
  const r = db.prepare("SELECT * FROM broadcasts WHERE id = ?").get(broadcastId);
  return r;
}
function nextBroadcastItems(broadcastId, limit = 10) {
  return db.prepare(`SELECT * FROM broadcast_items WHERE broadcast_id = ? AND status = 'pending' ORDER BY id LIMIT ?`)
    .all(broadcastId, limit);
}
function markBroadcastItem(id, status, reason = null) {
  db.prepare("UPDATE broadcast_items SET status = ?, reason = ?, attempts = attempts + 1, sent_at = ? WHERE id = ?")
    .run(status, reason, status === "sent" ? now() : null, id);
}
function bumpBroadcastCounts(broadcastId, sent, failed) {
  db.prepare("UPDATE broadcasts SET sent_count = sent_count + ?, fail_count = fail_count + ? WHERE id = ?")
    .run(sent, failed, broadcastId);
}
function finishBroadcast(broadcastId) {
  db.prepare("UPDATE broadcasts SET status = 'done' WHERE id = ? AND status = 'sending'").run(broadcastId);
}
function dueBroadcasts(nowIso) {
  return db.prepare(`SELECT * FROM broadcasts WHERE (status = 'scheduled' AND (scheduled_at IS NULL OR scheduled_at <= ?)) OR status = 'sending' ORDER BY created_at`)
    .all(nowIso);
}
function listBroadcasts(userId) {
  return db.prepare("SELECT * FROM broadcasts WHERE user_id = ? ORDER BY created_at DESC").all(userId);
}
const getBroadcast = (id) => db.prepare("SELECT * FROM broadcasts WHERE id = ?").get(id) || null;
function cancelBroadcast(id) {
  db.prepare("UPDATE broadcasts SET status = 'cancelled' WHERE id = ? AND status IN ('scheduled','sending')").run(id);
  db.prepare("UPDATE broadcast_items SET status = 'skipped', reason = 'cancelled' WHERE broadcast_id = ? AND status = 'pending'").run(id);
}

// ---------------------------------------------------------------- fan mode
const FAN_TIERS_DEFAULT = `[{"name":"Bronze","points":100},{"name":"Silver","points":300},{"name":"Gold","points":700}]`;
function getFanConfig(userId) {
  const r = db.prepare("SELECT * FROM fan_config WHERE user_id = ?").get(userId);
  if (!r) return { enabled: false, pointsComment: 10, pointsFollow: 20, pointsStreak: 5, tiers: JSON.parse(FAN_TIERS_DEFAULT) };
  return { enabled: !!r.enabled, pointsComment: r.points_comment, pointsFollow: r.points_follow,
    pointsStreak: r.points_streak, tiers: P(r.tiers, []) };
}
function setFanConfig(userId, patch) {
  const cur = db.prepare("SELECT * FROM fan_config WHERE user_id = ?").get(userId);
  const base = cur || { enabled: 0, points_comment: 10, points_follow: 20, points_streak: 5, tiers: FAN_TIERS_DEFAULT };
  const next = {
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : base.enabled,
    points_comment: patch.pointsComment ?? base.points_comment,
    points_follow: patch.pointsFollow ?? base.points_follow,
    points_streak: patch.pointsStreak ?? base.points_streak,
    tiers: patch.tiers !== undefined ? J(patch.tiers.slice(0, 8)) : base.tiers
  };
  db.prepare(`INSERT INTO fan_config (user_id, enabled, points_comment, points_follow, points_streak, tiers, updated_at)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, points_comment=excluded.points_comment,
                points_follow=excluded.points_follow, points_streak=excluded.points_streak, tiers=excluded.tiers, updated_at=excluded.updated_at`)
    .run(userId, next.enabled, next.points_comment, next.points_follow, next.points_streak, next.tiers, now());
  return getFanConfig(userId);
}
// Award points once per (psid, day, kind) for comment/streak actions; 'follow' is one-time.
function awardFanPoints({ userId, accountId, psid, igUsername = null, kind, points, oncePerDay = true }) {
  const today = now().slice(0, 10);
  if (oncePerDay) {
    const dup = db.prepare(`SELECT id FROM fan_ledger WHERE user_id=? AND psid=? AND kind=? AND substr(created_at,1,10)=? LIMIT 1`)
      .get(userId, String(psid), kind, today);
    if (dup) return null;
  }
  const member = db.prepare("SELECT * FROM fan_members WHERE user_id=? AND account_id=? AND psid=?")
    .get(userId, String(accountId), String(psid));
  let streak = member ? member.streak_days : 0;
  if (member && member.last_active !== today) streak = (member.last_active === new Date(Date.now() - 86400000).toISOString().slice(0, 10)) ? streak + 1 : 1;
  else if (!member) streak = 1;
  // Streak bonus: points_streak % per consecutive day, capped at 20 days.
  const cfg = db.prepare("SELECT points_streak FROM fan_config WHERE user_id = ?").get(userId);
  const perDay = kind === "comment" ? Math.max(0, Math.min(20, (cfg && cfg.points_streak) || 0)) : 0;
  const total = points + Math.round(points * Math.min(streak, 20) * perDay / 100);
  db.prepare(`INSERT INTO fan_ledger (user_id, account_id, psid, kind, points, note, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(userId, String(accountId), String(psid), kind, total, null, now());
  if (member) {
    db.prepare(`UPDATE fan_members SET points = points + ?, streak_days = ?, last_active = ?, ig_username = COALESCE(?, ig_username) WHERE id = ?`)
      .run(total, streak, today, igUsername, member.id);
  } else {
    db.prepare(`INSERT INTO fan_members (user_id, account_id, psid, ig_username, points, tier_index, streak_days, last_active, created_at)
                VALUES (?,?,?,?,?, -1, ?, ?, ?)`)
      .run(userId, String(accountId), String(psid), igUsername, total, streak, today, now());
  }
  return { points: total, streak };
}
function fanMember(userId, accountId, psid) {
  return db.prepare("SELECT * FROM fan_members WHERE user_id=? AND account_id=? AND psid=?").get(userId, String(accountId), String(psid)) || null;
}
function fanLeaderboard(userId, limit = 10) {
  return db.prepare(`SELECT psid, ig_username, points, streak_days, tier_index FROM fan_members
    WHERE user_id = ? ORDER BY points DESC LIMIT ?`).all(userId, limit);
}
function fanLedgerFor(userId, psid, limit = 20) {
  return db.prepare("SELECT kind, points, created_at FROM fan_ledger WHERE user_id=? AND psid=? ORDER BY created_at DESC LIMIT ?")
    .all(userId, String(psid), limit);
}
// Members who just crossed a tier boundary and haven't been rewarded yet.
function fanPendingRewards(userId) {
  const cfg = getFanConfig(userId);
  if (!cfg.enabled || !cfg.tiers.length) return [];
  const members = db.prepare("SELECT * FROM fan_members WHERE user_id = ? AND tier_index < ?").all(userId, cfg.tiers.length - 1);
  return members.filter((m) => {
    const idx = cfg.tiers.reduce((acc, t, i) => (Number(t.points) <= m.points ? i : acc), -1);
    return idx > m.tier_index;
  });
}
function setFanTier(userId, accountId, psid, tierIndex) {
  db.prepare("UPDATE fan_members SET tier_index = ? WHERE user_id=? AND account_id=? AND psid=?")
    .run(tierIndex, userId, String(accountId), String(psid));
}

// expose a light db handle for actions that used store.db.*
module.exports = {
  db,
  listAllRules, listAllConversations, listAllEmails,
  createUser, getUserByEmail, getUserById, setUserLang, setUserCurrency,
  upsertAccount, getAccount, listAccounts, listAccountRows, updateAccountToken,
  createRule, updateRule, deleteRule, getRule, rulesForAccount,
  createConversation, updateConversation, deleteConversation, getConversation, conversationsForAccount, lastConversationForPsid,
  dueReminders,
  collectEmail, emailsForAccount,
  trackVisit, trackEvent,
  createOAuthState, consumeOAuthState,
  adminMetrics,
  PLAN_LIMITS, limitsForPlan, planUsage, isTrialExpired, effectivePlan,
  countAccountsForUser, countRulesForUser, countConversationsThisMonth,
  // prepaid pass / per-post quota
  getPeriod, tryConsumeReply, refundReply, getUsageSummary, hasBlockEventToday,
  getPostUsage, countPeriodPosts, hasEventToday,
  downgradeExpiredPasses, passesExpiringWithin,
  // purchases
  createPurchase, getPurchaseByOrderId, markPurchasePaid, markPurchaseFailed, listPurchases,
  deleteUserCompletely, deleteAccountByIgUserId, purgeExpiredSessions,
  // advanced analytics
  recordCommentEvent, markCommentMatched, commentStatsForUser, commentStatsForPost,
  createGoLink, getGoLink, recordGoClick,
  clickStatsForUser, clickStatsForPost, clickSeriesForPost, clickSeriesForUser,
  clickedConversationsForUser, uniqueVisitorsForUser,
  markDelivered, deliveredCountForUser, deliveredCountForPost,
  // flows / dm automation
  createFlow, getFlow, listFlows, updateFlow, deleteFlow,
  saveFlowSteps, listFlowSteps, getFlowStep, listLiveDmFlows, countFlowsForUser,
  startFlowSession, activeFlowSession, updateFlowSession, expireStaleFlowSessions, flowStatsForUser,
  // subscribers + broadcasts
  upsertSubscriber, listSubscribers, subscriberCount, optOutSubscriber,
  createBroadcast, queueBroadcastItems, claimBroadcast, nextBroadcastItems,
  markBroadcastItem, bumpBroadcastCounts, finishBroadcast, dueBroadcasts,
  listBroadcasts, getBroadcast, cancelBroadcast,
  // fan mode
  getFanConfig, setFanConfig, awardFanPoints, fanMember, fanLeaderboard,
  fanLedgerFor, fanPendingRewards, setFanTier,
};
