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
  return true;
}

// ---------------------------------------------------------------- session hygiene
function purgeExpiredSessions() {
  const res = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  return res.changes;
}

// expose a light db handle for actions that used store.db.*
module.exports = {
  db,
  listAllRules, listAllConversations, listAllEmails,
  createUser, getUserByEmail, getUserById, setUserLang, setUserCurrency,
  upsertAccount, getAccount, listAccounts, listAccountRows, updateAccountToken,
  createRule, updateRule, deleteRule, getRule, rulesForAccount,
  createConversation, updateConversation, getConversation, conversationsForAccount, lastConversationForPsid,
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
};
