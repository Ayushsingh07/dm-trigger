// ReplyLo — background jobs. All timers are .unref()'d so they never keep
// the process alive on their own (graceful shutdown still works).
//
//  - reminders   every 30s : due reminder_at rows (status "sent", <24h window)
//  - token refresh daily   : long-lived IG tokens older than 40 days
//  - backup      nightly   : VACUUM INTO /data/backups, keep 7 files
//  - sessions    on boot + daily : delete expired sessions

const fs = require("fs");
const path = require("path");
const store = require("./store");
const meta = require("./meta");
const actions = require("./actions");
const logger = require("./logger");
const { db, dbPath } = require("./db");

const REMINDER_INTERVAL_MS = 30 * 1000;
const TOKEN_MAX_AGE_DAYS = 40;          // refresh long-lived tokens older than this
const BACKUP_KEEP = 7;
const backupDir = path.resolve(__dirname, "..", process.env.BACKUP_DIR || path.join("data", "backups"));

// ---------------------------------------------------------------- reminders
let reminderBusy = false;
async function runDueReminders() {
  if (reminderBusy) return;
  reminderBusy = true;
  try {
    const due = store.dueReminders(20);
    for (const conv of due) {
      // Meta's 24h window: skip (and mark) anything too old to message.
      const age = Date.now() - new Date(conv.sentAt).getTime();
      if (age > 24 * 60 * 60 * 1000) {
        store.updateConversation(conv.id, { reminded: true });
        logger.debug({ conv: conv.id }, "[reminder] outside 24h window, skipped");
        continue;
      }
      try {
        await actions.sendReminder(conv);
      } catch (err) {
        logger.error({ err: err.message, conv: conv.id }, "[reminder] failed");
      }
    }
  } finally {
    reminderBusy = false;
  }
}

// ---------------------------------------------------------------- token refresh
// Under unified login the stored token is a *Page* access token, which Meta
// documents as non-expiring; the exchange below is then a harmless no-op that
// simply re-validates it. TODO(meta-docs): confirm Page-token lifetime and skip
// the call entirely if Meta starts rejecting it.
async function refreshStaleTokens() {
  const rows = store.listAccountRows();
  const nowMs = Date.now();
  for (const row of rows) {
    const issued = row.token_issued_at || row.connected_at;
    const ageDays = issued ? (nowMs - new Date(issued).getTime()) / 864e5 : 0;
    if (ageDays < TOKEN_MAX_AGE_DAYS) continue;
    const token = store.getAccount(row.ig_user_id)?.accessToken;
    if (!token || token === "DRY_RUN_TOKEN") continue;
    const res = await meta.refreshLongLived(token);
    if (res.ok && res.access_token) {
      store.updateAccountToken(row.ig_user_id, res.access_token);
      logger.info({ account: row.ig_user_id, ageDays: Math.round(ageDays) }, "[token-refresh] refreshed");
    } else if (res.dryRun) {
      logger.debug({ account: row.ig_user_id }, "[token-refresh] dry-run");
    } else {
      logger.warn({ account: row.ig_user_id, status: res.status }, "[token-refresh] failed");
    }
  }
}

// ---------------------------------------------------------------- nightly backup
function runBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = path.join(backupDir, `replylo-${stamp}.db`);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    logger.info({ target }, "[backup] written");
    // prune to the newest BACKUP_KEEP files
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith("replylo-") && f.endsWith(".db"))
      .map((f) => path.join(backupDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const old of files.slice(BACKUP_KEEP)) {
      fs.rmSync(old, { force: true });
      logger.info({ file: old }, "[backup] pruned");
    }
  } catch (err) {
    logger.error({ err: err.message, dbPath }, "[backup] failed");
  }
}

// ---------------------------------------------------------------- pass expiry
// Daily: downgrade expired passes to free, and record a "pass_expiring" event
// three days before expiry (once per user per day) for the dashboard banner.
const PASS_WARN_DAYS = 3;
function runPassExpiry() {
  const downgraded = store.downgradeExpiredPasses();
  for (const u of downgraded) {
    store.trackEvent("pass_expired", u.id, { plan: u.pass_plan, expires_at: u.pass_expires_at });
    logger.info({ user: u.id, plan: u.pass_plan }, "[pass-expiry] downgraded to free");
  }
  for (const u of store.passesExpiringWithin(PASS_WARN_DAYS)) {
    if (store.hasEventToday("pass_expiring", u.id)) continue;
    const daysLeft = Math.max(0, Math.ceil((new Date(u.pass_expires_at).getTime() - Date.now()) / 864e5));
    store.trackEvent("pass_expiring", u.id, { plan: u.pass_plan, days_left: daysLeft });
    logger.info({ user: u.id, daysLeft }, "[pass-expiry] expiring soon");
  }
  return { downgraded: downgraded.length };
}

// ---------------------------------------------------------------- scheduling
// "Run every N ms, and also fire once shortly after boot if the time-of-day
// target was already passed" — simple daily cadence without cron deps.
function scheduleDaily(hourUtc, fn, label) {
  const run = async () => {
    logger.info(`[jobs] daily job starting: ${label}`);
    try { await fn(); } catch (err) { logger.error({ err: err.message }, `[jobs] ${label} failed`); }
  };
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const first = next - now;
  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000).unref();
  }, first).unref();
  logger.info({ label, firstRunInMin: Math.round(first / 1000 / 60) }, "[jobs] scheduled daily");
}

const timers = [];
function startJobs() {
  // expired sessions: on boot, then daily
  const purged = store.purgeExpiredSessions();
  if (purged) logger.info({ purged }, "[sessions] purged expired sessions on boot");

  const reminderTimer = setInterval(() => {
    runDueReminders().catch((err) => logger.error({ err: err.message }, "[jobs] reminder tick failed"));
  }, REMINDER_INTERVAL_MS);
  reminderTimer.unref();
  timers.push(reminderTimer);
  runDueReminders().catch(() => {});

  scheduleDaily(3, refreshStaleTokens, "token-refresh");
  scheduleDaily(4, runBackup, "sqlite-backup");
  scheduleDaily(5, () => store.purgeExpiredSessions(), "session-purge");
  scheduleDaily(6, runPassExpiry, "pass-expiry");

  logger.info("[jobs] reminder scheduler every 30s; daily: token-refresh 03:00Z, backup 04:00Z, purge 05:00Z, pass-expiry 06:00Z");
}

function stopJobs() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}

module.exports = { startJobs, stopJobs, runDueReminders, refreshStaleTokens, runBackup, runPassExpiry };
