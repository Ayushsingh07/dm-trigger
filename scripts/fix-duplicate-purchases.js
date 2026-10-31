#!/usr/bin/env node
// One-off cleanup for duplicate PAID pass purchases created before the
// duplicate-proof order/grant rules landed (2026-10-31).
//
//   node scripts/fix-duplicate-purchases.js            # DRY RUN (default)
//   node scripts/fix-duplicate-purchases.js --apply    # actually fix
//
// Rule: for one user, two or more purchases with kind='pass', status='paid',
// the SAME plan, created within 10 minutes of each other -> the later ones are
// duplicates. With --apply: the later rows get status='duplicate' (rows are
// never deleted), users.pass_expires_at is pulled back by PERIOD_DAYS per
// duplicate, and an events row "duplicate_payment_cleanup" records the change.
// A VACUUM INTO backup is taken before any write.
'use strict';
const fs = require('fs');
const path = require('path');
const { db, BACKUP_DIR } = require('../src/db');
const { PERIOD_DAYS } = require('../src/pricing');

const APPLY = process.argv.includes('--apply');
const WINDOW_MS = 10 * 60 * 1000;
const now = () => new Date().toISOString();

// Rows ordered per user/plan; a row is a duplicate when its created_at is
// within WINDOW_MS of an EARLIER paid row of the same user+plan.
const rows = db.prepare(`
  SELECT id, user_id, plan, amount_paise, currency, created_at, paid_at
  FROM purchases
  WHERE kind = 'pass' AND status = 'paid' AND plan IS NOT NULL
  ORDER BY user_id, plan, created_at`).all();

const groups = new Map();
for (const r of rows) {
  const k = `${r.user_id}|${r.plan}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const dupes = [];
for (const [key, list] of groups) {
  if (list.length < 2) continue;
  const [userId, plan] = key.split('|');
  for (let i = 1; i < list.length; i++) {
    const prev = new Date(list[i - 1].created_at).getTime();
    const cur = new Date(list[i].created_at).getTime();
    if (cur - prev <= WINDOW_MS) dupes.push({ userId, plan, row: list[i] });
  }
}

console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to change anything)'}`);
console.log(`duplicate paid pass purchases found: ${dupes.length}\n`);
for (const d of dupes) {
  console.log(`user=${d.userId} plan=${d.plan} purchase=${d.row.id} created=${d.row.created_at} ` +
    `paid=${d.row.paid_at ?? '-'} amount=${d.row.amount_paise} ${d.row.currency ?? '?'} ` +
    `-> would mark 'duplicate' and pull the pass back ${PERIOD_DAYS}d`);
}
if (!dupes.length) { console.log('Nothing to do.'); process.exit(0); }

if (!APPLY) {
  console.log(`\nDry run only. ${dupes.length} purchase(s) would be marked duplicate and ` +
    `users' pass_expires_at reduced by ${PERIOD_DAYS} days each.`);
  process.exit(0);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const dest = path.join(BACKUP_DIR, `pre-dupfix-${now().replace(/[:.]/g, '-')}.db`).replace(/\\/g, '/');
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
console.log(`\nbackup written: ${dest}`);

const byUser = new Map();
for (const d of dupes) {
  if (!byUser.has(d.userId)) byUser.set(d.userId, []);
  byUser.get(d.userId).push(d);
}

db.exec('BEGIN IMMEDIATE');
try {
  for (const [userId, list] of byUser) {
    const user = db.prepare('SELECT id, pass_plan, pass_expires_at FROM users WHERE id = ?').get(userId);
    for (const d of list) {
      db.prepare(`UPDATE purchases
        SET status='duplicate', duplicate_of =
          (SELECT p2.id FROM purchases p2
            WHERE p2.user_id = ? AND p2.kind='pass' AND p2.plan = ? AND p2.status='paid' AND p2.id != ?
            ORDER BY p2.created_at LIMIT 1)
        WHERE id = ?`).run(userId, d.plan, d.row.id, d.row.id);
      db.prepare('INSERT INTO events (name, user_id, meta, created_at) VALUES (?,?,?,?)')
        .run('duplicate_payment_cleanup', userId,
          JSON.stringify({ orderId: d.row.id, plan: d.plan, amount: d.row.amount_paise, currency: d.row.currency, source: 'fix-duplicate-purchases' }),
          now());
    }
    // Pull the pass back only while the user still holds the plan that was double-paid.
    if (user && user.pass_plan === list[0].plan && user.pass_expires_at) {
      const back = new Date(new Date(user.pass_expires_at).getTime() - list.length * PERIOD_DAYS * 86400000).toISOString();
      db.prepare('UPDATE users SET pass_expires_at = ? WHERE id = ?').run(back, userId);
      console.log(`user=${userId}: pass_expires_at ${user.pass_expires_at} -> ${back} (${list.length} duplicate(s) reversed)`);
    } else {
      console.log(`user=${userId}: rows marked duplicate but pass NOT pulled back (plan changed since); review manually`);
    }
  }
  db.exec('COMMIT');
  console.log('\nDone. Rows were marked duplicate, never deleted.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('failed, rolled back:', err.message);
  process.exit(1);
}
