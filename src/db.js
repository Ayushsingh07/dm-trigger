// ReplyLo — SQLite persistence (built into Node 22.5+, no deps).
// File: $DATABASE_PATH (default data/replylo.db), auto-created. WAL mode.

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const logger = require("./logger");

// On a persistent-disk host (Fly volume) DATABASE_PATH points at /data/replylo.db.
const dbPath = path.resolve(__dirname, "..", process.env.DATABASE_PATH || path.join("data", "replylo.db"));
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

logger.debug({ dbPath }, "sqlite opened");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user',      -- user | admin
  plan          TEXT NOT NULL DEFAULT 'free',      -- free | trial | pro
  status        TEXT NOT NULL DEFAULT 'trialing',  -- trialing | active | canceled
  trial_ends_at TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  ig_user_id      TEXT PRIMARY KEY,
  username        TEXT,
  access_token    TEXT,
  user_id         TEXT REFERENCES users(id),
  connected_at    TEXT NOT NULL,
  token_issued_at TEXT,           -- when the stored long-lived token was minted/refreshed
  page_id         TEXT            -- Facebook Page the IG business account hangs off (unified login)
);

CREATE TABLE IF NOT EXISTS rules (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL,
  user_id           TEXT,
  keyword           TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'all',
  post_ids          TEXT NOT NULL DEFAULT '[]',
  dm_text           TEXT NOT NULL,
  links             TEXT NOT NULL DEFAULT '[]',
  followers_only    INTEGER NOT NULL DEFAULT 0,
  ask_email         INTEGER NOT NULL DEFAULT 0,
  reminder_after_min INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  user_id      TEXT,
  psid         TEXT,
  comment_id   TEXT,
  rule_id      TEXT,
  status       TEXT NOT NULL DEFAULT 'sent',  -- sent | replied | clicked | email_collected
  reminded     INTEGER NOT NULL DEFAULT 0,
  reminder_at  TEXT,                          -- ISO when the scheduler should nudge
  sent_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id    TEXT,
  psid       TEXT,
  email      TEXT NOT NULL,
  rule_id    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT,
  referrer   TEXT,
  ua_hash    TEXT,
  day        TEXT NOT NULL,           -- YYYY-MM-DD for cheap daily metrics
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,           -- signup | login | connect | rule_created | demo_run | ...
  user_id    TEXT,
  meta       TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  user_id    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visits_day    ON visits(day);
CREATE INDEX IF NOT EXISTS idx_events_name   ON events(name);
CREATE INDEX IF NOT EXISTS idx_conv_account  ON conversations(account_id);
CREATE INDEX IF NOT EXISTS idx_rules_account ON rules(account_id);

-- Meta retries must never produce a second DM for the same comment.
-- (NULL comment_id is allowed multiple times in SQLite, so demo rows are fine.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_comment ON conversations(comment_id) WHERE comment_id IS NOT NULL;

-- Per-post reply quota. One row per (user, post, billing period).
-- 'used' counts replies actually sent; 'extra_replies' is bought top-up.
CREATE TABLE IF NOT EXISTS post_usage (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  period_start  TEXT NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  extra_replies INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE(user_id, post_id, period_start)
);

-- Checkout attempts and their outcome. Money is stored in paise, integer only.
CREATE TABLE IF NOT EXISTS purchases (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  razorpay_order_id   TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  kind                TEXT NOT NULL CHECK (kind IN ('pass','topup')),
  plan                TEXT,
  post_id             TEXT,
  amount_paise        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed')),
  created_at          TEXT NOT NULL,
  paid_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_post_usage_user ON post_usage(user_id, period_start);
CREATE INDEX IF NOT EXISTS idx_purchases_user  ON purchases(user_id, status);

-- Advanced analytics: every comment we receive (matched or not) so per-post
-- comment totals are measurable without extra Meta permissions.
CREATE TABLE IF NOT EXISTS comment_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   TEXT NOT NULL,
  user_id      TEXT,
  post_id      TEXT,
  comment_id   TEXT,
  commenter_id TEXT,
  matched      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_comment ON comment_events(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ce_user_post ON comment_events(user_id, post_id);

-- Click-tracking redirects: DM links are rewritten to /go/<token> so link
-- clicks and unique visitors are measurable (Instagram never reports them).
CREATE TABLE IF NOT EXISTS go_links (
  token      TEXT PRIMARY KEY,
  conv_id    TEXT,
  user_id    TEXT,
  account_id TEXT,
  rule_id    TEXT,
  post_id    TEXT,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_go_conv ON go_links(conv_id);

CREATE TABLE IF NOT EXISTS link_clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL,
  day        TEXT NOT NULL,             -- YYYY-MM-DD for cheap daily metrics
  ua_hash    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lc_token ON link_clicks(token);

-- Flows: multi-step DM automations (step builder with quick-reply branches).
CREATE TABLE IF NOT EXISTS flows (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  account_id    TEXT,                    -- IG business id; NULL = any account
  name          TEXT NOT NULL,
  trigger_type  TEXT NOT NULL DEFAULT 'dm_keyword', -- dm_keyword | comment_keyword
  keyword       TEXT,                    -- trigger keyword (both trigger types)
  status        TEXT NOT NULL DEFAULT 'draft',      -- draft | live | paused
  start_step_id TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flows_user ON flows(user_id);

CREATE TABLE IF NOT EXISTS flow_steps (
  id            TEXT PRIMARY KEY,
  flow_id       TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  buttons       TEXT NOT NULL DEFAULT '[]',  -- [{label,payload,next_step_id}]
  links         TEXT NOT NULL DEFAULT '[]',  -- [{title,url}] web_url buttons
  follow_gate   INTEGER NOT NULL DEFAULT 0,  -- ask "did you follow?" before advancing
  is_end        INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fsteps_flow ON flow_steps(flow_id);

-- One row per (flow, follower): where they are in the flow right now.
CREATE TABLE IF NOT EXISTS flow_sessions (
  id             TEXT PRIMARY KEY,
  flow_id        TEXT NOT NULL,
  user_id        TEXT,
  account_id     TEXT NOT NULL,
  psid           TEXT NOT NULL,
  step_id        TEXT,                    -- step awaiting their reply
  status         TEXT NOT NULL DEFAULT 'active', -- active | completed | gated
  gate_confirmed INTEGER NOT NULL DEFAULT 0,
  last_msg_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fsess_flow_psid ON flow_sessions(flow_id, account_id, psid);

-- Subscribers: people who opted in to broadcasts (via comment/DM flows).
CREATE TABLE IF NOT EXISTS subscribers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  account_id   TEXT NOT NULL,
  psid         TEXT NOT NULL,
  ig_username  TEXT,
  source       TEXT,                     -- comment | dm | flow
  opted_out    INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subs_psid ON subscribers(user_id, account_id, psid);

-- Broadcast campaigns + their per-recipient queue (paced sender).
CREATE TABLE IF NOT EXISTS broadcasts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  account_id   TEXT,
  name         TEXT NOT NULL,
  text         TEXT NOT NULL,
  links        TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | sending | done | cancelled
  scheduled_at TEXT,
  sent_count   INTEGER NOT NULL DEFAULT 0,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bc_user ON broadcasts(user_id);

CREATE TABLE IF NOT EXISTS broadcast_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  psid         TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | sent | skipped | failed
  reason       TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bi_bc ON broadcast_items(broadcast_id, status);

-- Fan Mode: loyalty points, tiers, streaks, reward DMs.
CREATE TABLE IF NOT EXISTS fan_config (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  enabled        INTEGER NOT NULL DEFAULT 0,
  points_comment INTEGER NOT NULL DEFAULT 10,
  points_follow  INTEGER NOT NULL DEFAULT 20,
  points_streak  INTEGER NOT NULL DEFAULT 5,   -- multiplier % per streak day (cap 100)
  tiers          TEXT NOT NULL DEFAULT '[]',   -- [{name,points,reward_text}]
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fan_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id),
  account_id    TEXT NOT NULL,
  psid          TEXT NOT NULL,
  ig_username   TEXT,
  points        INTEGER NOT NULL DEFAULT 0,
  tier_index    INTEGER NOT NULL DEFAULT -1,  -- highest tier reached
  streak_days   INTEGER NOT NULL DEFAULT 0,
  last_active   TEXT,                          -- YYYY-MM-DD (UTC)
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fan_psid ON fan_members(user_id, account_id, psid);

CREATE TABLE IF NOT EXISTS fan_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  account_id TEXT NOT NULL,
  psid       TEXT NOT NULL,
  kind       TEXT NOT NULL,             -- comment | follow | streak | reward
  points     INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fanled_user ON fan_ledger(user_id, psid, created_at);
`);

// Tiny forward-migrations for databases created by older versions.
for (const stmt of [
  "ALTER TABLE conversations ADD COLUMN reminder_at TEXT",
  "ALTER TABLE accounts ADD COLUMN token_issued_at TEXT",
  "ALTER TABLE accounts ADD COLUMN page_id TEXT",
  // prepaid pass + per-post quota
  "ALTER TABLE users ADD COLUMN pass_plan TEXT",
  "ALTER TABLE users ADD COLUMN pass_started_at TEXT",
  "ALTER TABLE users ADD COLUMN pass_expires_at TEXT",
  "ALTER TABLE conversations ADD COLUMN post_id TEXT",
  // i18n preferences
  "ALTER TABLE users ADD COLUMN lang TEXT",
  "ALTER TABLE users ADD COLUMN currency TEXT",
  // multi-currency / multi-provider billing
  "ALTER TABLE purchases ADD COLUMN currency TEXT",   // ISO code; NULL = legacy INR
  "ALTER TABLE purchases ADD COLUMN provider TEXT",   // mock | razorpay | dodo
  // advanced analytics: delivery receipts from message_deliveries webhooks
  "ALTER TABLE conversations ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0",
  // transactional / duplicate-proof purchases
  "ALTER TABLE purchases ADD COLUMN idempotency_key TEXT",  // client Idempotency-Key
  "ALTER TABLE purchases ADD COLUMN order_expires_at TEXT", // 'created' rows TTL
  "ALTER TABLE purchases ADD COLUMN duplicate_of TEXT",     // purchase id this paid twice
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

// ------------------------------------------------- purchases status CHECK rebuild
// Older databases declare status CHECK (status IN ('created','paid','failed')).
// SQLite cannot ALTER a CHECK, so when the constraint is missing the newer
// statuses we rebuild the table inside one transaction: create new -> copy ->
// drop old -> rename, then recreate the indexes. A VACUUM INTO backup is taken
// first. Idempotent: once the rebuilt schema is in place this never runs again.
const PURCHASE_STATUSES = "'created','paid','failed','expired','duplicate'";
function purchasesNeedRebuild() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'purchases'").get();
  const sql = String((row && row.sql) || "");
  if (!sql) return false;
  const m = sql.match(/status\s+TEXT[^,]*CHECK\s*\(([^)]*)\)/i);
  if (!m) return false;                      // no CHECK -> nothing to widen
  const allowed = m[1].toLowerCase();
  return !allowed.includes("expired") || !allowed.includes("duplicate");
}

const BACKUP_DIR = path.resolve(__dirname, "..", process.env.BACKUP_DIR || path.join("data", "backups"));

function rebuildPurchasesTable() {
  const backupDir = BACKUP_DIR;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(backupDir, `pre-migration-${stamp}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    logger.info({ target }, "[db] backup taken before purchases rebuild");
  } catch (err) {
    logger.error({ err: err.message }, "[db] backup before purchases rebuild FAILED - aborting migration");
    return false;
  }

  const cols = ["id", "user_id", "razorpay_order_id", "razorpay_payment_id", "kind", "plan",
    "post_id", "amount_paise", "status", "created_at", "paid_at", "currency", "provider",
    "idempotency_key", "order_expires_at", "duplicate_of"];
  const colList = cols.join(", ");
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(`CREATE TABLE purchases_new (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  razorpay_order_id   TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  kind                TEXT NOT NULL CHECK (kind IN ('pass','topup')),
  plan                TEXT,
  post_id             TEXT,
  amount_paise        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN (${PURCHASE_STATUSES})),
  created_at          TEXT NOT NULL,
  paid_at             TEXT,
  currency            TEXT,
  provider            TEXT,
  idempotency_key     TEXT,
  order_expires_at    TEXT,
  duplicate_of        TEXT
)`);
    db.exec(`INSERT INTO purchases_new (${colList}) SELECT ${colList} FROM purchases`);
    db.exec("DROP TABLE purchases");
    db.exec("ALTER TABLE purchases_new RENAME TO purchases");
    db.exec("COMMIT");
    logger.info({}, "[db] purchases rebuilt with widened status CHECK");
    return true;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    logger.error({ err: err.message }, "[db] purchases rebuild failed (rolled back)");
    return false;
  }
}

if (purchasesNeedRebuild()) rebuildPurchasesTable();

// Purchases for provider callbacks (webhook idempotency) — one row per event id.
db.exec(`
CREATE TABLE IF NOT EXISTS webhook_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);
`);

// Expire abandoned checkout orders before adding the "one open order" index,
// so leftover 'created' rows from old builds cannot block new orders.
try {
  const ttlIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const stale = db.prepare(`UPDATE purchases SET status = 'expired'
    WHERE status = 'created' AND created_at < ?`).run(ttlIso);
  if (stale.changes) logger.info({ expired: stale.changes }, "[db] expired stale 'created' orders");
  // Report (do not silently fix) any remaining open-order duplicates: the
  // unique index below would fail on them.
  const clashes = db.prepare(`SELECT user_id, kind, plan, COALESCE(post_id,'') pid, COUNT(*) c
    FROM purchases WHERE status = 'created'
    GROUP BY user_id, kind, plan, COALESCE(post_id,'') HAVING c > 1`).all();
  for (const c of clashes) {
    logger.warn({ user: c.user_id, kind: c.kind, plan: c.plan, post: c.pid, open: c.c },
      "[db] multiple open orders for one plan - keeping the newest, expiring the rest");
    db.prepare(`UPDATE purchases SET status = 'expired'
      WHERE status = 'created' AND user_id = ? AND kind = ?
        AND (plan = ? OR (plan IS NULL AND ? IS NULL))
        AND COALESCE(post_id,'') = ?
        AND id NOT IN (SELECT id FROM purchases WHERE status = 'created' AND user_id = ? AND kind = ?
          AND (plan = ? OR (plan IS NULL AND ? IS NULL)) AND COALESCE(post_id,'') = ?
          ORDER BY created_at DESC LIMIT 1)`)
      .run(c.user_id, c.kind, c.plan, c.plan, c.pid, c.user_id, c.kind, c.plan, c.plan, c.pid);
  }
} catch (err) {
  logger.error({ err: err.message }, "[db] could not tidy stale orders");
}

// One order per idempotency key per user, and at most ONE open ('created')
// order per (user, kind, plan, post). Partial unique indexes keep paid/failed
// history unlimited.
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchases_idem
  ON purchases(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchases_open
  ON purchases(user_id, kind, plan, COALESCE(post_id,'')) WHERE status = 'created';
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status, order_expires_at);

-- Analytics aggregates (dashboard card + /analytics page): per-user time-range
-- scans of conversations / comment_events and click attribution via go_links.
CREATE INDEX IF NOT EXISTS idx_conv_user_sent  ON conversations(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_ce_user_created ON comment_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_go_user         ON go_links(user_id, post_id);
`);

module.exports = { db, dbPath, BACKUP_DIR };
