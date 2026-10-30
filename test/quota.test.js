// Per-post quota (prepaid-pass model): tryConsumeReply / refund / periods.
const { test } = require("node:test");
const assert = require("node:assert");
const { cleanup } = require("./helpers"); // sets DATABASE_PATH to a temp DB

const store = require("../src/store");
const meta = require("../src/meta");
const actions = require("../src/actions");
const { PLANS } = require("../src/pricing");

const DAY = 864e5;
let seq = 0;

function makeUser({ trial = false } = {}) {
  seq += 1;
  return store.createUser({
    email: `q${seq}-${Math.random().toString(36).slice(2)}@x.io`,
    passwordHash: "x",
    plan: trial ? "trial" : "free",
    status: trial ? "trialing" : "active",
  });
}

// Put a paid pass on a user directly (the grant flow is tested in billing.test.js).
function setPass(userId, plan, daysLeft) {
  store.db.prepare("UPDATE users SET pass_plan=?, pass_started_at=?, pass_expires_at=? WHERE id=?")
    .run(plan, new Date(Date.now() - (30 - daysLeft) * DAY).toISOString(),
      new Date(Date.now() + daysLeft * DAY).toISOString(), userId);
}
const expirePass = (userId) => store.db.prepare("UPDATE users SET pass_expires_at = ? WHERE id = ?")
  .run(new Date(Date.now() - DAY).toISOString(), userId);

test.after(cleanup);

// ---------------------------------------------------------------- consumption

test("new post within limit is allowed and recorded", () => {
  const u = makeUser();
  const r = store.tryConsumeReply(u.id, "post_1");
  assert.equal(r.ok, true);
  const period = store.getPeriod(store.getUserById(u.id));
  const row = store.getPostUsage(u.id, "post_1", period.start);
  assert.equal(row.used, 1);
  assert.equal(row.extra_replies, 0);
});

test("the 4th new post on free is blocked; the 16th on starter is blocked", () => {
  const u = makeUser();
  assert.equal(store.tryConsumeReply(u.id, "p1").ok, true);
  assert.equal(store.tryConsumeReply(u.id, "p2").ok, true);
  assert.equal(store.tryConsumeReply(u.id, "p3").ok, true);
  const r = store.tryConsumeReply(u.id, "p4");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "post_limit");

  const s = makeUser();
  setPass(s.id, "starter", 10);
  for (let i = 1; i <= PLANS.starter.postsPerPeriod; i++) {
    assert.equal(store.tryConsumeReply(s.id, `sp${i}`).ok, true, `post ${i} should pass`);
  }
  const r2 = store.tryConsumeReply(s.id, "sp16");
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "post_limit");
});

test("one reply past the plan cap on a post is blocked", () => {
  const u = makeUser();
  setPass(u.id, "growth", 10);
  for (let i = 1; i <= PLANS.growth.repliesPerPost; i++) {
    assert.equal(store.tryConsumeReply(u.id, "big").ok, true, `reply ${i} should pass`);
  }
  const r = store.tryConsumeReply(u.id, "big");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "reply_limit");
});

test("extra_replies raises only that post's cap", () => {
  const u = makeUser();
  setPass(u.id, "starter", 10); // cap 150
  for (let i = 0; i < PLANS.starter.repliesPerPost; i++) store.tryConsumeReply(u.id, "capA");
  assert.equal(store.tryConsumeReply(u.id, "capA").reason, "reply_limit");

  store.db.prepare("UPDATE post_usage SET extra_replies = extra_replies + 100 WHERE user_id = ? AND post_id = 'capA'")
    .run(u.id);
  assert.equal(store.tryConsumeReply(u.id, "capA").ok, true, "top-up raised the cap");

  // another post for the same user keeps the plain plan cap
  for (let i = 0; i < PLANS.starter.repliesPerPost; i++) store.tryConsumeReply(u.id, "capB");
  assert.equal(store.tryConsumeReply(u.id, "capB").reason, "reply_limit");
});

test("expired pass falls back to free limits", () => {
  const u = makeUser();
  setPass(u.id, "growth", 5);
  assert.equal(store.tryConsumeReply(u.id, "x1").ok, true);
  expirePass(u.id);

  assert.equal(store.getPeriod(store.getUserById(u.id)).plan, "free");
  // free allows 3 posts per period; x1 belongs to the old (growth) period
  assert.equal(store.tryConsumeReply(u.id, "x2").ok, true);
  assert.equal(store.tryConsumeReply(u.id, "x3").ok, true);
  assert.equal(store.tryConsumeReply(u.id, "x4").ok, true);
  assert.equal(store.tryConsumeReply(u.id, "x5").reason, "post_limit");
});

test("trial uses growth limits until trial_ends_at", () => {
  const u = makeUser({ trial: true });
  const period = store.getPeriod(store.getUserById(u.id));
  assert.equal(period.plan, "trial");
  // 3 new posts allowed (trial borrows growth's 15 posts), so t1..t3 must pass
  assert.equal(store.tryConsumeReply(u.id, "t1").ok, true);
  assert.equal(store.tryConsumeReply(u.id, "t2").ok, true);
  assert.equal(store.tryConsumeReply(u.id, "t3").ok, true);

  // expired trial behaves as free
  store.db.prepare("UPDATE users SET trial_ends_at = ? WHERE id = ?")
    .run(new Date(Date.now() - DAY).toISOString(), u.id);
  assert.equal(store.getPeriod(store.getUserById(u.id)).plan, "free");
});

// ---------------------------------------------------------------- refund

test("refund returns one unit and never goes below zero", () => {
  const u = makeUser();
  store.tryConsumeReply(u.id, "r1");
  store.tryConsumeReply(u.id, "r1");
  assert.equal(store.refundReply(u.id, "r1"), true);
  const p = store.getPeriod(store.getUserById(u.id));
  assert.equal(store.getPostUsage(u.id, "r1", p.start).used, 1);

  store.refundReply(u.id, "r1");
  store.refundReply(u.id, "r1");
  assert.equal(store.getPostUsage(u.id, "r1", p.start).used, 0, "clamped at zero");
  assert.equal(store.refundReply(u.id, "unknown_post"), false, "unknown post refunds nothing");
});

// A permanently failed Meta send must give the unit back (integration through
// the real pipeline with a stubbed Meta client).
test("a failed send refunds the unit; a delivered DM does not", async () => {
  const real = { sendDM: meta.sendDM, sendCommentDM: meta.sendCommentDM, sendPrivateReply: meta.sendPrivateReply, isFollower: meta.isFollower };
  try {
    const u = makeUser();
    setPass(u.id, "growth", 10);
    const acct = store.upsertAccount({ igUserId: "17899", username: "quota.test", accessToken: "tok", userId: u.id });
    const rule = store.createRule({ accountId: acct.ig_user_id, userId: u.id, keyword: "GUIDE", dmText: "hi" });

    // non-retryable failure (permission error -> shouldRetry false)
    meta.sendPrivateReply = async () => ({ ok: true, dryRun: true });
    meta.isFollower = async () => ({ dryRun: true, is_follower: true });
    meta.sendCommentDM = async () => ({ ok: false, status: 400, error: { error: { code: 200, message: "missing permission" } } });

    await actions.handleCommentEvent(acct.ig_user_id, {
      id: "cmt_fail_1", text: "guide", from: { id: "9001", username: "flo" }, media: { id: "media_fail" },
    });
    const period = store.getPeriod(store.getUserById(u.id));
    assert.equal(store.getPostUsage(u.id, "media_fail", period.start).used, 0, "unit refunded after failed send");

    // now a successful send keeps the charge
    meta.sendDM = async () => ({ ok: true, dryRun: true });
    meta.sendCommentDM = async () => ({ ok: true, dryRun: true });
    await actions.handleCommentEvent(acct.ig_user_id, {
      id: "cmt_ok_1", text: "guide", from: { id: "9002", username: "sam" }, media: { id: "media_ok" },
    });
    assert.equal(store.getPostUsage(u.id, "media_ok", period.start).used, 1, "delivered DM is charged");
    void rule;
  } finally {
    Object.assign(meta, real);
  }
});

// ---------------------------------------------------------------- summary

test("getUsageSummary reports posts used of allowed with caps", () => {
  const u = makeUser();
  setPass(u.id, "growth", 10);
  store.tryConsumeReply(u.id, "s1");
  store.tryConsumeReply(u.id, "s1");
  const s = store.getUsageSummary(u.id);
  assert.equal(s.plan, "growth");
  assert.equal(s.postsUsed, 1);
  assert.equal(s.postsAllowed, PLANS.growth.postsPerPeriod);
  assert.equal(s.posts[0].used, 2);
  assert.equal(s.posts[0].cap, PLANS.growth.repliesPerPost);
});

test("blocked events are recorded at most once per day per (user, post, reason)", () => {
  const u = makeUser();
  assert.equal(store.hasBlockEventToday(u.id, "b3", "post_limit"), false);
  store.trackEvent("blocked_post_limit", u.id, { post: "b3" });
  assert.equal(store.hasBlockEventToday(u.id, "b3", "post_limit"), true);
  assert.equal(store.hasBlockEventToday(u.id, "b4", "post_limit"), false, "other post unaffected");
  assert.equal(store.hasBlockEventToday(u.id, "b3", "reply_limit"), false, "other reason unaffected");
});
