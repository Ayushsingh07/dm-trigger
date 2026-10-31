// Seeds demo analytics for one user so /analytics has something to show.
// Usage:
//   node scripts/seed-analytics-demo.js <email>            dry run (default)
//   node scripts/seed-analytics-demo.js <email> --apply    write
//   node scripts/seed-analytics-demo.js <email> --remove   delete the seeded rows
// Refuses to run in production. All seeded rows carry a "seed_" marker so
// --remove can clean exactly them up.
"use strict";
// DATABASE_PATH is resolved by src/db.js (default data/replylo.db) — do not
// override it here or the seed lands in the wrong file.
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}
const { db } = require("../src/db");

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const REMOVE = args.includes("--remove");
if (!email) {
  console.error("Usage: node scripts/seed-analytics-demo.js <email> [--apply|--remove]");
  process.exit(1);
}

const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
if (!user) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}

const MARK = "seed_";
const iso = (d) => d.toISOString().replace("T", " ").slice(0, 19);
const day = (d) => d.toISOString().slice(0, 10);

if (REMOVE) {
  const counts = {};
  const del = (sql, ...p) => (counts[sql.split(" ")[1]] = (counts[sql.split(" ")[1]] || 0) + db.prepare(sql).run(...p).changes);
  // clicks first (needs tokens), then go_links, comments, conversations
  db.exec("BEGIN");
  try {
    del(`DELETE FROM link_clicks WHERE token IN (SELECT token FROM go_links WHERE user_id = ? AND token LIKE ?)`, user.id, MARK + "%");
    del(`DELETE FROM go_links WHERE user_id = ? AND token LIKE ?`, user.id, MARK + "%");
    del(`DELETE FROM conversations WHERE user_id = ? AND psid LIKE ?`, user.id, MARK + "%");
    del(`DELETE FROM comment_events WHERE user_id = ? AND commenter_id LIKE ?`, user.id, MARK + "%");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  console.log(`Removed for ${email}:`, counts);
  process.exit(0);
}

// Deterministic pseudo-random so repeated dry runs print the same plan.
let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const now = Date.now();
const rows = { comment_events: 0, conversations: 0, go_links: 0, link_clicks: 0 };
const plan = [];

// one rule to hang conversations on (find any, else plan a note)
const rule = db.prepare("SELECT id, keyword FROM rules WHERE user_id = ? LIMIT 1").get(user.id);
const account = db.prepare("SELECT ig_user_id AS id FROM accounts WHERE user_id = ? LIMIT 1").get(user.id);
if (!account) {
  console.error("This user has no connected Instagram account — comment_events/conversations require account_id. Connect an account (or use a user that has one) first.");
  process.exit(1);
}

for (let d = 89; d >= 0; d--) {
  const date = new Date(now - d * 864e5);
  const dow = date.getUTCDay();
  const base = dow === 0 || dow === 6 ? 26 : 12; // weekends busier
  const comments = Math.round(base * (0.5 + rnd()));
  const matched = Math.round(comments * (0.3 + rnd() * 0.25));
  const dms = Math.round(matched * (0.85 + rnd() * 0.1));
  const clicks = Math.round(dms * (0.25 + rnd() * 0.3));
  const postId = MARK + "post_" + (1 + (d % 4));
  for (let i = 0; i < comments; i++) {
    const hour = Math.min(23, Math.floor(8 + rnd() * 14));
    const ts = new Date(date);
    ts.setUTCHours(hour, Math.floor(rnd() * 60), 0, 0);
    plan.push({
      table: "comment_events",
      sql: `INSERT INTO comment_events (account_id, user_id, post_id, comment_id, commenter_id, matched, created_at)
            VALUES (?,?,?,?,?,?,?)`,
      args: [account ? account.id : null, user.id, postId, `${MARK}c_${d}_${i}`, `${MARK}fan_${i % 9}`, i < matched ? 1 : 0, iso(ts)],
    });
    rows.comment_events++;
  }
  for (let i = 0; i < dms; i++) {
    const ts = new Date(date);
    ts.setUTCHours(Math.floor(9 + rnd() * 12), Math.floor(rnd() * 60), 0, 0);
    const statuses = ["sent", "sent", "replied", "clicked", "email_collected"];
    const status = statuses[Math.floor(rnd() * statuses.length)];
    const convId = `${MARK}conv_${d}_${i}`;
    plan.push({
      table: "conversations",
      sql: `INSERT INTO conversations (id, account_id, user_id, psid, comment_id, rule_id, status, sent_at, delivered, post_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [convId, account ? account.id : null, user.id, `${MARK}psid_${d}_${i}`, `${MARK}c_${d}_${i}`, rule ? rule.id : null,
        status, iso(ts), rnd() < 0.92 ? 1 : 0, postId],
    });
    rows.conversations++;
    if (i < clicks) {
      const token = `${MARK}tok_${d}_${i}`;
      plan.push({
        table: "go_links",
        sql: `INSERT INTO go_links (token, conv_id, user_id, account_id, rule_id, post_id, url, created_at)
              VALUES (?,?,?,?,?,?,?,?)`,
        args: [token, convId, user.id, account ? account.id : null, rule ? rule.id : null, postId, "https://example.com/seed", iso(ts)],
      });
      rows.go_links++;
      const clickTs = new Date(ts.getTime() + Math.floor(rnd() * 6) * 36e5);
      plan.push({
        table: "link_clicks",
        sql: `INSERT INTO link_clicks (token, day, ua_hash, created_at) VALUES (?,?,?,?)`,
        args: [token, day(clickTs), `${MARK}ua_${(i * 7 + d) % 11}`, iso(clickTs)],
      });
      rows.link_clicks++;
    }
  }
}

console.log(`User: ${user.email} (${user.id})`);
console.log(`Rule: ${rule ? rule.keyword : "NONE (conversations get rule_id NULL)"} · Account: ${account ? "found" : "NONE (account_id NULL)"}`);
console.log(`Plan: 90 days of demo activity`, rows);
if (!rule) console.log("NOTE: this user has no rules — top-keywords table will stay empty.");

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to insert, --remove to clean up.");
  process.exit(0);
}

db.exec("BEGIN");
try {
  for (const p of plan) db.prepare(p.sql).run(...p.args);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
console.log("Seeded.", rows);
