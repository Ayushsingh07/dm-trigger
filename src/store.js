// ReplyFlow — data store backed by SQLite (src/db.js).
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

// ---------------------------------------------------------------- accounts
// access_token is encrypted at rest (see src/crypto.js). Callers always see
// plaintext; the ciphertext never leaves this module.
function upsertAccount({ igUserId, username, accessToken, userId, tokenIssuedAt }) {
  const existing = db.prepare("SELECT * FROM accounts WHERE ig_user_id = ?").get(String(igUserId));
  db.prepare(`INSERT INTO accounts (ig_user_id, username, access_token, user_id, connected_at, token_issued_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(ig_user_id) DO UPDATE SET
                username = excluded.username,
                access_token = excluded.access_token,
                user_id = COALESCE(excluded.user_id, accounts.user_id),
                token_issued_at = excluded.token_issued_at`)
    .run(String(igUserId), username || null, sealToken(accessToken) ?? null,
      userId || existing?.user_id || null, existing?.connected_at || now(),
      tokenIssuedAt || now());
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
function createRule({
  accountId, userId = null, keyword, scope = "all", postIds = [],
  dmText = "Hey {name}! 👋 Here's the link you asked for.",
  links = [], followersOnly = false, askEmail = false, reminderAfterMin = 0,
}) {
  if (!accountId || !keyword) throw new Error("accountId and keyword are required");
  if (links.length > 3) throw new Error("A DM can have at most 3 links");
  const rule = {
    id: uid("r_"), accountId: String(accountId), userId,
    keyword: String(keyword).trim().toUpperCase(), scope, postIds, dmText,
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
    keyword: patch.keyword !== undefined ? String(patch.keyword).trim().toUpperCase() : cur.keyword,
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
function createConversation({ accountId, userId = null, psid, commentId, ruleId, reminderAt = null }) {
  const id = uid("c_");
  try {
    db.prepare(`INSERT INTO conversations (id, account_id, user_id, psid, comment_id, rule_id, status, reminded, reminder_at, sent_at)
                VALUES (?,?,?,?,?,?,?,0,?,?)`)
      .run(id, String(accountId), userId, psid ?? null, commentId ?? null, ruleId ?? null, "sent", reminderAt, now());
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
  createUser, getUserByEmail, getUserById,
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
  deleteUserCompletely, deleteAccountByIgUserId, purgeExpiredSessions,
};
