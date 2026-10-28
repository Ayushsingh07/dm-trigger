// Billing: grant rules, provider behavior, multi-currency, and the production
// guards. Runs with BILLING_PROVIDER=mock against a temp DB (helpers.js).
process.env.BILLING_PROVIDER = "mock";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { cleanup } = require("./helpers");

const store = require("../src/store");
const auth = require("../src/auth");
const provider = require("../src/billing/provider");
const { grantPurchase } = require("../src/billing/grant");
const {
  PLANS, TOPUP, priceMinor, topupPriceMinor, exponentOf, toMajor,
} = require("../src/pricing");

const DAY = 864e5;
let seq = 0;
const newUserId = () => store.createUser({
  email: `b${seq++}-${Math.random().toString(36).slice(2)}@x.io`, passwordHash: "h", plan: "free", status: "active",
}).id;

function makeOrder({ kind = "pass", plan = "growth", postId = null, amountMinor = priceMinor("growth", "INR"), currency = "INR", userId = null }) {
  const orderId = `mock_order_test_${Math.random().toString(36).slice(2)}`;
  store.createPurchase({
    id: `pur_${orderId}`, userId: userId ?? newUserId(), orderId, kind, plan, postId, amountMinor, currency,
  });
  return orderId;
}

// ---------------------------------------------------------------- grants
test.after(cleanup);

test("grantPurchase twice with the same order grants once", () => {
  const userId = newUserId();
  const orderId = makeOrder({ userId });

  const first = grantPurchase({ orderId, paymentId: "pay_1", amountMinor: priceMinor("growth", "INR"), currency: "INR" });
  assert.equal(first.ok, true);
  const u1 = store.getUserById(userId);
  assert.equal(u1.pass_plan, "growth");

  const second = grantPurchase({ orderId, paymentId: "pay_2", amountMinor: priceMinor("growth", "INR"), currency: "INR" });
  assert.equal(second.ok, true);
  assert.equal(second.already, true);
  const u2 = store.getUserById(userId);
  assert.equal(u2.pass_expires_at, u1.pass_expires_at, "expiry unchanged by duplicate grant");
  assert.equal(store.getPurchaseByOrderId(orderId).razorpay_payment_id, "pay_1", "first payment id kept");
});

test("a mismatched amount is rejected and nothing is granted", () => {
  const userId = newUserId();
  const orderId = makeOrder({ userId });
  const res = grantPurchase({ orderId, paymentId: "pay_x", amountMinor: 1, currency: "INR" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "amount_mismatch");
  const u = store.getUserById(userId);
  assert.equal(u.pass_plan, null, "no pass granted");
  assert.equal(store.getPurchaseByOrderId(orderId).status, "created", "order left unpaid");
});

test("a mismatched currency is rejected even when the amount matches", () => {
  const userId = newUserId();
  // order stored in USD...
  const orderId = makeOrder({ userId, plan: "growth", amountMinor: priceMinor("growth", "INR"), currency: "USD" });
  // ...but the "payment" claims INR with the same number of minor units.
  const res = grantPurchase({ orderId, paymentId: "pay_c", amountMinor: priceMinor("growth", "INR"), currency: "INR" });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "currency_mismatch");
  assert.equal(store.getUserById(userId).pass_plan, null, "no pass granted");
});

test("a pass renewal extends from the current expiry", () => {
  const userId = newUserId();
  const orderId = makeOrder({ userId });
  grantPurchase({ orderId, paymentId: "pay_a", amountMinor: priceMinor("growth", "INR"), currency: "INR" });
  const firstExpiry = new Date(store.getUserById(userId).pass_expires_at).getTime();

  const orderId2 = makeOrder({ userId });
  grantPurchase({ orderId: orderId2, paymentId: "pay_b", amountMinor: priceMinor("growth", "INR"), currency: "INR" });
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

  const orderId = makeOrder({ kind: "topup", plan: null, postId: "postA", amountMinor: topupPriceMinor("INR"), userId });
  const res = grantPurchase({ orderId, paymentId: "pay_t", amountMinor: topupPriceMinor("INR"), currency: "INR" });
  assert.equal(res.ok, true);

  const s = store.getUsageSummary(userId);
  const a = s.posts.find((p) => p.postId === "postA");
  const b = s.posts.find((p) => p.postId === "postB");
  assert.equal(a.extraReplies, TOPUP.replies);
  assert.equal(a.cap, PLANS.growth.repliesPerPost + TOPUP.replies);
  assert.equal(b.extraReplies, 0);
  assert.equal(b.cap, PLANS.growth.repliesPerPost);
});

// ---------------------------------------------------------------- multi-currency
test("INR resolves to razorpay and other currencies to dodo in auto mode", () => {
  const saved = process.env.BILLING_PROVIDER;
  process.env.BILLING_PROVIDER = "auto";
  try {
    assert.equal(provider.nameFor("INR"), "razorpay");
    assert.equal(provider.nameFor("USD"), "dodo");
    assert.equal(provider.nameFor("EUR"), "dodo");
    assert.equal(provider.nameFor("JPY"), "dodo");
  } finally {
    process.env.BILLING_PROVIDER = saved;
  }
});

test("JPY and IDR use exponent 0; USD/EUR/GBP/BRL use 2", () => {
  assert.equal(exponentOf("JPY"), 0);
  assert.equal(exponentOf("IDR"), 0);
  assert.equal(exponentOf("USD"), 2);
  assert.equal(exponentOf("INR"), 2);
  // JPY minor units ARE major units: 34900 minor -> 34900 yen, not 349.00
  assert.equal(toMajor(34900, "JPY"), 34900);
  assert.equal(toMajor(34900, "USD"), 349);
});

test("mock provider is disabled in production even when forced", () => {
  const saved = process.env.BILLING_PROVIDER;
  process.env.BILLING_PROVIDER = "mock";
  process.env.NODE_ENV = "production";
  try {
    assert.equal(provider.enabledFor("INR"), false);
    assert.equal(provider.enabledFor("USD"), false);
  } finally {
    delete process.env.NODE_ENV;
    process.env.BILLING_PROVIDER = saved;
  }
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

test("GET /api/billing/config lists plans, currencies and the mock provider", async () => {
  const res = await fetch(`${base}/api/billing/config`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.provider, "mock");
  assert.equal(j.enabled, true, "mock enabled outside production");
  assert.equal(j.plans.length, 4);
  assert.equal(j.topup.prices.INR, topupPriceMinor("INR"));
  assert.equal(j.currencies.length, 7);
  const jpy = j.currencies.find((c) => c.code === "JPY");
  assert.equal(jpy.exponent, 0);
  const growth = j.plans.find((p) => p.id === "growth");
  assert.equal(growth.prices.INR, priceMinor("growth", "INR"));
});

test("POST /api/billing/currency saves the user's billing currency", async () => {
  const userId = newUserId();
  const headers = { "Content-Type": "application/json", cookie: cookieFor(userId) };

  const bad = await fetch(`${base}/api/billing/currency`, { method: "POST", headers, body: JSON.stringify({ currency: "XXX" }) });
  assert.equal(bad.status, 400);

  const ok = await fetch(`${base}/api/billing/currency`, { method: "POST", headers, body: JSON.stringify({ currency: "usd" }) });
  assert.equal(ok.status, 200);
  assert.equal(store.getUserById(userId).currency, "USD", "stored upper-cased");

  const usage = await (await fetch(`${base}/api/billing/usage`, { headers })).json();
  assert.equal(usage.currency, "USD");
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
  assert.equal(cfg.amountMinor, priceMinor("starter", "INR"), "price comes from pricing.js");
  assert.equal(cfg.currency, "INR");
  const order = store.getPurchaseByOrderId(cfg.orderId);
  assert.equal(order.user_id, userId);
  assert.equal(order.status, "created");
  assert.equal(order.currency, "INR");
  assert.equal(order.provider, "mock");
});

test("an order in a currency with no price yet is rejected with 400", async () => {
  const userId = newUserId();
  const headers = { "Content-Type": "application/json", cookie: cookieFor(userId) };
  await fetch(`${base}/api/billing/currency`, { method: "POST", headers, body: JSON.stringify({ currency: "JPY" }) });
  // JPY prices are TODO-PRICE (null) until real numbers are filled in.
  assert.equal(priceMinor("growth", "JPY"), null);
  const res = await fetch(`${base}/api/billing/order`, { method: "POST", headers, body: JSON.stringify({ kind: "pass", plan: "growth" }) });
  assert.equal(res.status, 400);
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

test("POST /billing/webhook/razorpay returns 400 under the mock provider", async () => {
  const res = await fetch(`${base}/billing/webhook/razorpay`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "order.paid" }),
  });
  assert.equal(res.status, 400);
});

test("POST /billing/webhook/dodo is rejected while dodo is a stub", async () => {
  const res = await fetch(`${base}/billing/webhook/dodo`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "order.paid" }),
  });
  assert.equal(res.status, 400, "stub throws -> verification failure -> 400");
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

// ---------------------------------------------------------------- billing page APIs
test("GET /api/billing/usage reports the plan rank used to hide lower plans", async () => {
  const userId = newUserId();
  const headers = { "Content-Type": "application/json", cookie: cookieFor(userId) };

  let usage = await (await fetch(`${base}/api/billing/usage`, { headers })).json();
  assert.equal(usage.rank, 0, "free ranks 0");

  const orderId = makeOrder({ userId, plan: "starter", amountMinor: priceMinor("starter", "INR") });
  grantPurchase({ orderId, paymentId: "pay_st", amountMinor: priceMinor("starter", "INR"), currency: "INR" });
  usage = await (await fetch(`${base}/api/billing/usage`, { headers })).json();
  assert.equal(usage.plan, "starter");
  assert.equal(usage.rank, 1, "starter ranks 1 -> chooser shows starter+ only");
});

test("GET /api/billing/history lists only this user's purchases", async () => {
  const userId = newUserId();
  const headers = { "Content-Type": "application/json", cookie: cookieFor(userId) };
  const mine = makeOrder({ userId });
  grantPurchase({ orderId: mine, paymentId: "pay_h", amountMinor: priceMinor("growth", "INR"), currency: "INR" });
  makeOrder({ userId: newUserId() }); // someone else's purchase

  const res = await fetch(`${base}/api/billing/history`, { headers });
  assert.equal(res.status, 200);
  const { purchases } = await res.json();
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].razorpay_order_id, mine);
  assert.equal(purchases[0].status, "paid");
});
