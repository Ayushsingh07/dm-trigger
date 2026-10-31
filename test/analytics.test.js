// Advanced analytics: Pro gate, shape of /api/analytics, summary parity,
// user isolation, zero-fill/prev alignment, tz binning, validation.
require("./helpers");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { cleanup } = require("./helpers");

const { db } = require("../src/db");
const store = require("../src/store");
const auth = require("../src/auth");

let server;
let base;
const DAY = 864e5;

let seq = 0;
function newUserId() {
  return store.createUser({
    email: `a${seq++}-${Math.random().toString(36).slice(2)}@x.io`, passwordHash: "h", plan: "free", status: "active",
  }).id;
}
function cookieFor(userId) {
  return `${auth.COOKIE}=${auth.createSession(userId)}`;
}
// Fixed pass start so getPeriod().start is stable and post_usage rows can match it.
const PASS_START = new Date(Date.now() - 10 * DAY).toISOString();
function makePro(userId) {
  const exp = new Date(Date.now() + 30 * DAY).toISOString();
  db.prepare("UPDATE users SET pass_plan='pro', pass_expires_at=?, pass_started_at=? WHERE id=?")
    .run(exp, PASS_START, userId);
}
function ensureAccount(userId) {
  const ig = `ig_${userId}`;
  db.prepare(`INSERT INTO accounts (ig_user_id, username, access_token, user_id, connected_at)
              VALUES (?,?,?,?,?)`).run(ig, "acct", "tok", userId, new Date().toISOString());
  return ig;
}
// Fixture rows at explicit times (tests write fixtures directly).
function addComment(userId, accountId, { at, postId = "p1", matched = true, commentId }) {
  db.prepare(`INSERT INTO comment_events (account_id, user_id, post_id, comment_id, commenter_id, matched, created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(accountId, userId, postId, commentId, "fan_" + commentId, matched ? 1 : 0, at);
}
function addConv(userId, accountId, { at, postId = "p1", status = "sent", delivered = 0, convId }) {
  db.prepare(`INSERT INTO conversations (id, account_id, user_id, psid, comment_id, rule_id, status, reminded, sent_at, post_id, delivered)
              VALUES (?,?,?,?,?,?,?,0,?,?,?)`)
    .run(convId, accountId, userId, "ps_" + convId, "cm_" + convId, "r1", status, at, postId, delivered);
  return convId;
}
function addClick(userId, accountId, { at, postId = "p1", convId, url = "https://ex.com/x", ua = "hash_A" }) {
  const token = store.createGoLink({ convId, userId, accountId, postId, url });
  db.prepare("INSERT INTO link_clicks (token, day, ua_hash, created_at) VALUES (?,?,?,?)")
    .run(token, at.slice(0, 10), ua, at);
}
const iso = (ms) => new Date(ms).toISOString();

async function get(path, cookie, days) {
  const r = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}days=${days}`, {
    headers: { cookie },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/analytics", require("../src/routes/analytics"));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  cleanup();
});

test("summary endpoint: Pro-gated like the page, totals match seeded data", async () => {
  const user = newUserId();
  const acct = ensureAccount(user);
  const now = Date.now();
  // current 7-day window: 2 comments (1 matched), 1 DM, 1 delivered, 2 clicks (2 uniques)
  addComment(user, acct, { at: iso(now - 2 * DAY), commentId: "cA", matched: false });
  addComment(user, acct, { at: iso(now - 1 * DAY), commentId: "cB", matched: true });
  addConv(user, acct, { at: iso(now - 1 * DAY), convId: "vS1", delivered: 1 });
  addClick(user, acct, { at: iso(now - 1 * DAY), convId: "vS1", ua: "hash_A" });
  addClick(user, acct, { at: iso(now - 1 * DAY), convId: "vS1", ua: "hash_B" });

  // same Pro gate as the full endpoint (the dashboard shows a teaser on 402)
  const gated = await fetch(`${base}/api/analytics/summary?days=7`, { headers: { cookie: cookieFor(user) } });
  assert.equal(gated.status, 402);
  makePro(user);

  const r = await fetch(`${base}/api/analytics/summary?days=7`, { headers: { cookie: cookieFor(user) } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.days, 7);
  assert.equal(body.metrics.comments.total, 2);
  assert.equal(body.metrics.matches.total, 1);
  assert.equal(body.metrics.reached.total, 1);
  assert.equal(body.metrics.delivered.total, 1);
  assert.equal(body.metrics.clicks.total, 2);
  assert.equal(body.metrics.uniqueVisitors.total, 2);
  assert.equal(body.metrics.comments.series.length, 7);
  assert.equal(body.metrics.reached.series.reduce((a, b) => a + b, 0), 1);
});

test("full analytics: 402 for free users, 200 for pro", async () => {
  const free = newUserId();
  const r1 = await fetch(`${base}/api/analytics?days=7`, { headers: { cookie: cookieFor(free) } });
  assert.equal(r1.status, 402);
  assert.equal((await r1.json()).error, "analytics_pro_only");

  const pro = newUserId();
  makePro(pro);
  const r2 = await fetch(`${base}/api/analytics?days=7`, { headers: { cookie: cookieFor(pro) } });
  assert.equal(r2.status, 200);
});

test("full analytics: 401 when logged out", async () => {
  const r = await fetch(`${base}/api/analytics?days=7`);
  assert.equal(r.status, 401);
});

test("validation: bad days and tz rejected with 400", async () => {
  const pro = newUserId();
  makePro(pro);
  const cookie = cookieFor(pro);
  assert.deepEqual((await get("/api/analytics", cookie, 15)).body.error, "invalid_days");
  assert.deepEqual((await get("/api/analytics?tz=9999", cookie, 7)).body.error, "invalid_tz");
  assert.deepEqual((await get("/api/analytics?tz=abc", cookie, 7)).body.error, "invalid_tz");
  const ok = await get("/api/analytics", cookie, 30);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.days, 30);
});

test("shape: daily zero-filled to length days, totals = column sums, funnel ordered", async () => {
  const pro = newUserId();
  makePro(pro);
  const acct = ensureAccount(pro);
  const now = Date.now();
  for (let i = 1; i <= 5; i++) {
    addComment(pro, acct, { at: iso(now - i * DAY), commentId: `s${i}` });
    addConv(pro, acct, { at: iso(now - i * DAY), convId: `sp${i}` });
  }
  const { status, body } = await get("/api/analytics", cookieFor(pro), 30);
  assert.equal(status, 200);
  assert.equal(body.daily.length, 30);
  assert.ok(body.daily.every((d) => typeof d.comments === "number" && /^\d{4}-\d{2}-\d{2}$/.test(d.day)));
  const sum = (k) => body.daily.reduce((a, d) => a + d[k], 0);
  assert.equal(sum("comments"), body.kpis.comments.total);
  assert.equal(sum("dms"), body.kpis.reached.total);
  assert.equal(body.daily.filter((d) => d.comments === 0).length, 25);
  // funnel: ordered stages, comments >= matches >= dms
  const stages = body.funnel.map((f) => f.stage);
  assert.deepEqual(stages, ["comments", "matches", "dms", "clicks", "conversions"]);
  const f = Object.fromEntries(body.funnel.map((x) => [x.stage, x.count]));
  assert.ok(f.comments >= f.matches);
  assert.equal(f.dms, body.kpis.reached.total);
  assert.equal(f.clicks, body.kpis.clicks.total);
  // hourly: 7 days x 24 hours
  assert.equal(body.hourly.length, 7);
  assert.ok(body.hourly.every((row) => row.length === 24));
});

test("previous-period alignment and delta rules", async () => {
  const pro = newUserId();
  makePro(pro);
  const acct = ensureAccount(pro);
  const now = Date.now();
  // current window (last 7 days): 4 matched comments; previous window (8-14 days ago):
  // 2 unmatched comments -> comments delta +100%, matches delta null (no previous matches)
  for (let i = 1; i <= 4; i++) addComment(pro, acct, { at: iso(now - i * DAY), commentId: `w${i}` });
  for (let i = 8; i <= 9; i++) addComment(pro, acct, { at: iso(now - i * DAY), commentId: `q${i}`, matched: false });
  const { body } = await get("/api/analytics", cookieFor(pro), 7);
  assert.equal(body.kpis.comments.total, 4);
  assert.equal(body.kpis.comments.previousTotal, 2);
  assert.equal(body.kpis.comments.deltaPct, 100);
  // no matches in the previous window -> delta null (UI shows "no previous data")
  assert.equal(body.kpis.matches.total, 4);
  assert.equal(body.kpis.matches.previousTotal, 0);
  assert.equal(body.kpis.matches.deltaPct, null);
  // prev columns align by index: prevStart = today-13, so day (today-8) is prev index 5
  const idx = 5;
  assert.equal(body.daily[idx].prevComments, 1);
  assert.equal(body.daily[6].prevComments, 0); // nothing at today-7 in the prev window
  assert.equal(body.daily.reduce((a, d) => a + d.prevComments, 0), 2);
  // ratio KPIs are 0 when denominator is 0 (no DMs -> CTR 0, not NaN/null)
  assert.equal(body.kpis.ctrPct.total, 0);
  assert.equal(body.kpis.conversionPct.total, 0);
});

test("timezone binning shifts hourly buckets and daily day", async () => {
  const pro = newUserId();
  makePro(pro);
  const acct = ensureAccount(pro);
  // A recent day at 23:30 UTC = 05:00 next day at UTC+5:30 (hour 23 -> 5, day +1)
  const d = new Date(Date.now() - 3 * DAY);
  d.setUTCHours(23, 30, 0, 0);
  const at = d.toISOString();
  addComment(pro, acct, { at, commentId: "tz1" });
  const cookie = cookieFor(pro);

  const utc = (await get("/api/analytics?tz=0", cookie, 7)).body;
  const ist = (await get("/api/analytics?tz=330", cookie, 7)).body;
  const total = (h) => h.flat().reduce((a, b) => a + b, 0);
  assert.equal(total(utc.hourly), 1);
  assert.equal(total(ist.hourly), 1);
  const utcDay = d.getUTCDay();
  const istNext = new Date(d.getTime() + 330 * 60000); // local "day" in IST
  assert.equal(utc.hourly[utcDay][23], 1);
  // buckets are truncated to the UTC hour before shifting: 23:00 + 5:30 -> 04:xx
  assert.equal(ist.hourly[istNext.getUTCDay()][4], 1);
  assert.equal(ist.hourly[utcDay][23], 0);
  // daily rows are UTC-day based (only the heatmap is tz-shifted)
  const utcDays = Object.fromEntries(utc.daily.map((x) => [x.day, x.comments]));
  assert.equal(utcDays[at.slice(0, 10)], 1);
});

test("user isolation: B sees none of A's activity", async () => {
  const a = newUserId();
  const b = newUserId();
  makePro(b);
  const acctA = ensureAccount(a);
  const now = Date.now();
  addComment(a, acctA, { at: iso(now - DAY), commentId: "isoA" });
  addConv(a, acctA, { at: iso(now - DAY), convId: "isoC1" });
  const { body } = await get("/api/analytics", cookieFor(b), 7);
  assert.equal(body.kpis.comments.total, 0);
  assert.equal(body.kpis.reached.total, 0);
  assert.deepEqual(body.topKeywords, []);
  assert.deepEqual(body.topPosts, []);
});

test("top posts: per-post comments/used/cap from pricing", async () => {
  const pro = newUserId();
  makePro(pro);
  const acct = ensureAccount(pro);
  const now = Date.now();
  addComment(pro, acct, { at: iso(now - DAY), postId: "postX", commentId: "tp1" });
  addComment(pro, acct, { at: iso(now - DAY), postId: "postX", commentId: "tp2" });
  addConv(pro, acct, { at: iso(now - DAY), postId: "postX", convId: "tpC" });
  // one reply unit consumed on postX in the current pass period
  db.prepare(`INSERT INTO post_usage (id, user_id, post_id, period_start, used, extra_replies, created_at)
              VALUES (?,?,?,?,1,0,?)`).run("pu_test1", pro, "postX", PASS_START, iso(now - DAY));
  const { body } = await get("/api/analytics", cookieFor(pro), 7);
  assert.equal(body.topPosts.length, 1);
  const row = body.topPosts[0];
  assert.equal(row.postId, "postX");
  assert.equal(row.matches, 2);
  assert.equal(row.used, 1);
  const { repliesPerPost } = require("../src/pricing").limitsFor("pro");
  assert.equal(row.cap, repliesPerPost);
});

test("summary totals match the full endpoint for the same window", async () => {
  const pro = newUserId();
  makePro(pro);
  const acct = ensureAccount(pro);
  const now = Date.now();
  addComment(pro, acct, { at: iso(now - 2 * DAY), commentId: "m1" });
  addConv(pro, acct, { at: iso(now - 2 * DAY), convId: "mC1", delivered: 1 });
  addClick(pro, acct, { at: iso(now - 2 * DAY), convId: "mC1" });
  const cookie = cookieFor(pro);
  const full = (await get("/api/analytics", cookie, 7)).body;
  const sum = await (await fetch(`${base}/api/analytics/summary?days=7`, { headers: { cookie } })).json();
  for (const k of ["comments", "matches", "reached", "delivered", "clicks", "uniqueVisitors"]) {
    assert.equal(sum.metrics[k].total, full.kpis[k].total, k);
  }
});
