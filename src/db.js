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
  token_issued_at TEXT            -- when the stored long-lived token was minted/refreshed
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
`);

// Tiny forward-migrations for databases created by older versions.
for (const stmt of [
  "ALTER TABLE conversations ADD COLUMN reminder_at TEXT",
  "ALTER TABLE accounts ADD COLUMN token_issued_at TEXT",
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
]) {
  try { db.exec(stmt); } catch { /* column already exists */ }
}

module.exports = { db, dbPath };
