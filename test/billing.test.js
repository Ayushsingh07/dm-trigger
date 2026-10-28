// Billing: grant rules, provider behavior, and the production guards.
// Runs with BILLING_PROVIDER=mock against a temp DB (helpers.js).
process.env.BILLING_PROVIDER = "mock";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { cleanup } = require("./helpers");

const store = require("../src/store");
const auth = require("../src/auth");
const { grantPurchase } = require("../src/billing/grant");
const { PLANS, TOPUP } = require("../src/pricing");

const DAY = 864e5;
let seq = 0;
const newUserId = () => store.createUser({
  email: `b${seq++}-${Math.random().toString(36).slice(2)}@x.io`, passwordHash: "h", plan: "free", status: "active",
}).id;

function makeOrder({ kind = "pass", plan = "growth", postId = null, amount = PLANS.growth.pricePaise, userId = null }) {
  const orderId = `mock_order_test_${Math.random().toString(36).slice(2)}`;
  store.createPurchase({
    id: `pur_${orderId}`, userId: userId ?? newUserId(), orderId, kind, plan, postId, amountPaise: amount,
  });
  return orderId;
}

// ---------------------------------------------------------------- grants
test.after(cleanup);

test("grantPurchase twice with the same order grants once", () => {
  const userId = newUserId();
  const orderId = makeOrder({ userId });

  const first = grantPurchase({ orderId, paymentId: "pay_1", amountPaise: PLANS.growth.pricePaise });
  assert.equal(first.ok, true);
  const u1 = store.getUserById(userId);
  assert.equal(u1.pass_plan, "growth");

  const second = grantPurchase({ orderId, paymentId: "pay_2", amountPaise: PLANS.growth.pricePaise });
  assert.equal(second.ok, true);
  assert.equal(second.already, true);
  const u2 = store.getUserById(userId);
  assert.equal(u2.pass_expires_at, u1.pass_expires_at, "expiry unchanged by duplicate grant");
  assert.equal(store.getPurchaseByOrderId(orderId).razorpay_payment_id, "pay_1", "first payment id kept");
});

test("a mismatched amount is rejected and nothing is granted", () => {
  const userId = newUserId();
  const orderId = makeOrder({ userId });
  const res = grantPurchase({ orderId, paymentId: "pay_x", amountPaise: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "amount_mismatch");
  const u = store.getUserById(userId);
  assert.equal(u.pass_plan, null, "no pass granted");
  assert.equal(store.getPurchaseByOrderId(orderId).status, "created", "order left unpaid");
});

test("a pass renewal extends from the current expiry", () => {
  const userId = newUserId();
  const orderId = makeOrder({ userId });
  grantPurchase({ orderId, paymentId: "pay_a", amountPaise: PLANS.growth.pricePaise });
  const firstExpiry = new Date(store.getUserById(userId).pass_expires_at).getTime();

  const orderId2 = makeOrder({ userId });
  grantPurchase({ orderId: orderId2, paymentId: "pay_b", amountPaise: PLANS.growth.pricePaise });
  const secondExpiry = new Date(store.getUserById(userId).pass_expires_at).getTime();

  const days = (secondExpiry - firstExpiry) / DAY;
  assert.ok(days >= 29 && days <= 30.1, `renewal added ~30 days (got ${days.toFixed(1)})`);
});

test("a topup raises only that post's cap", () => {
  const userId = newUserId();
  store.db.prepare("UPDATE users SET pass_plan='growth', pass_started_at=?, pass_expires_at=? WHERE id=?")
    .run(new Date().toISOString(), new Date(Date.now() + 10 * DAY).toISOString(), userId);
  store.tryConsumeReply(userId, "postA");
  store.tryConsumeReply(userId, "postB");

  const orderId = makeOrder({ kind: "topup", plan: null, postId: "postA", amount: TOPUP.pricePaise, userId });
  const res = grantPurchase({ orderId, paymentId: "pay_t", amountPaise: TOPUP.pricePaise });
  assert.equal(res.ok, true);

  const s = store.getUsageSummary(userId);
  const a = s.posts.find((p) => p.postId === "postA");
  const b = s.posts.find((p) => p.postId === "postB");
  assert.equal(a.extraReplies, TOPUP.replies);
  assert.equal(a.cap, PLANS.growth.repliesPerPost + TOPUP.replies);
  assert.equal(b.extraReplies, 0);
  assert.equal(b.cap, PLANS.growth.repliesPerPost);
});

// ---------------------------------------------------------------- HTTP guards
let app, server, base;
before(async () => {
  app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  const billing = require("../src/routes/billing");
  app.use("/api/billing", billing);
  app.use("/billing/webhook", billing.webhookRouter);
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

function cookieFor(userId) {
  return `${auth.COOKIE}=${auth.createSession(userId)}`;
}

test("GET /api/billing/config lists plans and the mock provider", async () => {
  const res = await fetch(`${base}/api/billing/config`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.provider, "mock");
  assert.equal(j.enabled, true, "mock enabled outside production");
  assert.equal(j.plans.length, 4);
  assert.equal(j.topup.pricePaise, TOPUP.pricePaise);
});

test("POST /api/billing/order rejects unknown plans and creates valid ones", async () => {
  const userId = newUserId();
  const headers = { "Content-Type": "application/json", cookie: cookieFor(userId) };

  const bad = await fetch(`${base}/api/billing/order`, { method: "POST", headers, body: JSON.stringify({ kind: "pass", plan: "mega" }) });
  assert.equal(bad.status, 400);

  const ok = await fetch(`${base}/api/billing/order`, { method: "POST", headers, body: JSON.stringify({ kind: "pass", plan: "starter" }) });
  assert.equal(ok.status, 200);
  const cfg = await ok.json();
  assert.equal(cfg.provider, "mock");
  assert.equal(cfg.amountPaise, PLANS.starter.pricePaise, "price comes from pricing.js");
  const order = store.getPurchaseByOrderId(cfg.orderId);
  assert.equal(order.user_id, userId);
  assert.equal(order.status, "created");
});

test("topup order requires an active post this period", async () => {
  const userId = newUserId();
  const headers = { "Content-Type": "application/json", cookie: cookieFor(userId) };
  const res = await fetch(`${base}/api/billing/order`, { method: "POST", headers, body: JSON.stringify({ kind: "topup", postId: "ghost" }) });
  assert.equal(res.status, 400);
});

test("mock-pay grants, is single-use, and 404s in production", async () => {
  const userId = newUserId();
  const headers = { "Content-Type": "application/json", cookie: cookieFor(userId) };
  const cfg = await (await fetch(`${base}/api/billing/order`, { method: "POST", headers, body: JSON.stringify({ kind: "pass", plan: "pro" }) })).json();

  const pay = await fetch(`${base}/api/billing/mock-pay`, { method: "POST", headers, body: JSON.stringify({ orderId: cfg.orderId }) });
  assert.equal(pay.status, 200);
  assert.equal(store.getUserById(userId).pass_plan, "pro");

  const again = await fetch(`${base}/api/billing/mock-pay`, { method: "POST", headers, body: JSON.stringify({ orderId: cfg.orderId }) });
  assert.equal(again.status, 409, "already paid");

  // someone else's order is invisible
  const other = newUserId();
  const steal = await fetch(`${base}/api/billing/mock-pay`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: cookieFor(other) },
    body: JSON.stringify({ orderId: cfg.orderId }),
  });
  assert.equal(steal.status, 404);

  // production: mock-pay disappears entirely
  process.env.NODE_ENV = "production";
  try {
    const prod = await fetch(`${base}/api/billing/mock-pay`, { method: "POST", headers, body: JSON.stringify({ orderId: "whatever" }) });
    assert.equal(prod.status, 404);

    const order = await fetch(`${base}/api/billing/order`, { method: "POST", headers, body: JSON.stringify({ kind: "pass", plan: "pro" }) });
    assert.equal(order.status, 503, "orders closed in production with mock provider");
  } finally {
    delete process.env.NODE_ENV;
  }
});

test("POST /billing/webhook returns 400 under the mock provider", async () => {
  const res = await fetch(`${base}/billing/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "order.paid" }),
  });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------- expiry job
test("pass expiry job downgrades expired passes and warns 3 days ahead", async () => {
  const { runPassExpiry } = require("../src/jobs");

  const expiring = newUserId();
  store.db.prepare("UPDATE users SET pass_plan='growth', pass_started_at=?, pass_expires_at=? WHERE id=?")
    .run(new Date(Date.now() - 27 * DAY).toISOString(), new Date(Date.now() + 2 * DAY).toISOString(), expiring);
  const dead = newUserId();
  store.db.prepare("UPDATE users SET pass_plan='starter', pass_started_at=?, pass_expires_at=? WHERE id=?")
    .run(new Date(Date.now() - 40 * DAY).toISOString(), new Date(Date.now() - DAY).toISOString(), dead);

  const res = runPassExpiry();
  assert.equal(res.downgraded, 1);
  assert.equal(store.getUserById(dead).pass_plan, null, "expired pass cleared");
  assert.equal(store.getUserById(expiring).pass_plan, "growth", "still-active pass kept");

  const warn = store.db.prepare("SELECT * FROM events WHERE name='pass_expiring' AND user_id=?").all(expiring);
  assert.equal(warn.length, 1, "one warning event");
  runPassExpiry();
  assert.equal(store.db.prepare("SELECT * FROM events WHERE name='pass_expiring' AND user_id=?").all(expiring).length, 1, "not duplicated same day");
  assert.ok(store.db.prepare("SELECT * FROM events WHERE name='pass_expired' AND user_id=?").all(dead).length >= 1);
});
