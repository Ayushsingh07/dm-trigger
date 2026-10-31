// ReplyLo — billing API: config, currency choice, order creation, provider
// webhooks, mock pay.
// Prices come ONLY from src/pricing.js; the client never chooses an amount.
// Money is integer MINOR units of the order currency (pricing.CURRENCY_EXPONENT).
const express = require("express");
const crypto = require("crypto");

const store = require("../store");
const provider = require("../billing/provider");
const { grantPurchase } = require("../billing/grant");
const {
  PLANS, TOPUP, PERIOD_DAYS, PURCHASABLE, rankOf,
  ORDER_TTL_MIN, RENEW_WINDOW_DAYS,
  CURRENCIES, CURRENCY_EXPONENT, currencyFromLocale, isSupportedCurrency,
  priceMinor, topupPriceMinor,
} = require("../pricing");
const { requireUser, attachUser } = require("../auth");
const logger = require("../logger");

const router = express.Router();
router.use(attachUser);

const isProduction = () => process.env.NODE_ENV === "production";

// Idempotency keys are opaque client-generated tokens (crypto.randomUUID()).
// Accepted from the Idempotency-Key header or an idempotencyKey body field.
const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;
function readIdempotencyKey(req) {
  const raw = req.headers["idempotency-key"] || (req.body || {}).idempotencyKey || "";
  const key = String(raw).trim();
  if (!key) return null;
  return IDEM_RE.test(key) ? key : undefined; // undefined = invalid
}

// The user's billing currency: explicit choice wins, else derived from their
// language (ja -> JPY, hi -> INR, de/fr -> EUR, ...).
function currencyForUser(user) {
  const saved = user?.currency ? String(user.currency).toUpperCase() : "";
  if (isSupportedCurrency(saved)) return saved;
  return currencyFromLocale(user?.lang || "en");
}

// Payments for a currency are open when its provider is enabled — and the
// mock provider must never grant anything in production.
function paymentsEnabled(currency) {
  return provider.enabledFor(currency);
}

// ---------------------------------------------------------------- config
// GET /api/billing/config — what the UI needs to render plans + checkout,
// per currency: exponent, provider, whether it can be bought, and prices in
// minor units. The UI formats with Intl.NumberFormat.
router.get("/config", (req, res) => {
  const userCurrency = req.user ? currencyForUser(req.user) : "INR";
  res.json({
    provider: provider.nameFor(userCurrency), // provider for the user's currency
    enabled: paymentsEnabled(userCurrency),   // ... and whether it can take money
    userCurrency,
    currencies: CURRENCIES.map((c) => ({
      code: c,
      exponent: CURRENCY_EXPONENT[c],
      provider: provider.nameFor(c),
      canBuy: paymentsEnabled(c),
    })),
    periodDays: PERIOD_DAYS,
    orderTtlMin: ORDER_TTL_MIN,
    renewWindowDays: RENEW_WINDOW_DAYS,
    plans: Object.entries(PLANS).map(([id, p]) => ({
      id,
      ...p,
      prices: Object.fromEntries(CURRENCIES.map((c) => [c, priceMinor(id, c)])),
    })),
    topup: {
      ...TOPUP,
      prices: Object.fromEntries(CURRENCIES.map((c) => [c, topupPriceMinor(c)])),
    },
  });
});

// POST /api/billing/currency { currency } — remember the billing currency.
router.post("/currency", requireUser, (req, res) => {
  const cur = String((req.body || {}).currency || "").toUpperCase();
  if (!isSupportedCurrency(cur)) return res.status(400).json({ error: "Unsupported currency" });
  store.setUserCurrency(req.user.id, cur);
  res.json({ currency: cur });
});

// GET /api/billing/usage — per-post quota table for the billing page.
// `rank` lets the UI offer only the current plan (renew) and upgrades.
router.get("/usage", requireUser, (req, res) => {
  const summary = store.getUsageSummary(req.user.id);
  const period = store.getPeriod(req.user);
  const daysLeft = period.plan !== "free" && period.end
    ? Math.max(0, Math.ceil((new Date(period.end).getTime() - Date.now()) / 864e5))
    : null;
  res.json({
    ...summary,
    daysLeft,
    rank: rankOf(period.plan),
    passPlan: req.user.pass_plan ?? null,
    passExpiresAt: req.user.pass_expires_at ?? null,
    currency: currencyForUser(req.user),
  });
});

// GET /api/billing/history — the user's own orders (payment history table).
router.get("/history", requireUser, (req, res) => {
  res.json({ purchases: store.listPurchases(req.user.id).slice(0, 50) });
});

// ---------------------------------------------------------------- order
// POST /api/billing/order { kind:'pass', plan } | { kind:'topup', postId }
// Currency is the user's stored/derived choice — never taken from the body.
// Duplicate-proof: an Idempotency-Key (header or body) plus "one open order per
// (user, kind, plan, post)" means repeated clicks return the SAME order, and
// re-buying an active plan is refused with 409 + a locale message code.
router.post("/order", requireUser, async (req, res) => {
  const currency = currencyForUser(req.user);
  if (!paymentsEnabled(currency)) return res.status(503).json({ error: "Payments are not open yet" });

  const idemKey = readIdempotencyKey(req);
  if (idemKey === undefined) return res.status(400).json({ error: "Idempotency-Key must be 8-64 chars of letters, digits, - or _" });

  const { kind } = req.body || {};
  let amountMinor, plan = null, postId = null, receipt;

  if (kind === "pass") {
    plan = String(req.body.plan || "").toLowerCase();
    if (!PURCHASABLE.includes(plan)) return res.status(400).json({ error: "Unknown plan" });
    amountMinor = priceMinor(plan, currency);
    if (amountMinor == null) return res.status(400).json({ error: `This plan cannot be bought in ${currency} yet` });
    receipt = `replo_pass_${req.user.id.slice(-8)}_${plan}_${Date.now()}`;
  } else if (kind === "topup") {
    postId = String(req.body.postId || "").trim();
    if (!postId) return res.status(400).json({ error: "postId is required" });
    const period = store.getPeriod(req.user);
    if (!store.getPostUsage(req.user.id, postId, period.start)) {
      return res.status(400).json({ error: "That post is not active in your current period" });
    }
    amountMinor = topupPriceMinor(currency);
    if (amountMinor == null) return res.status(400).json({ error: `Top-ups cannot be bought in ${currency} yet` });
    receipt = `replo_topup_${req.user.id.slice(-8)}_${Date.now()}`;
  } else {
    return res.status(400).json({ error: "kind must be 'pass' or 'topup'" });
  }

  // Cheap pre-check so a repeated click never opens a second provider session.
  // The authoritative guard is createOrderGuarded's transaction below.
  const peek = store.peekOpenOrder(req.user.id, kind, plan, postId);
  if (peek) {
    const row = { orderId: peek.razorpay_order_id, amountMinor: peek.amount_paise, currency: peek.currency || currency, receipt };
    return res.json({ ...provider.checkoutConfig(currency, row), reused: true, orderExpiresAt: peek.order_expires_at });
  }

  try {
    const order = await provider.createOrder(currency, {
      amountMinor,
      receipt,
      notes: { userId: req.user.id, kind, plan: plan || undefined, postId: postId || undefined },
    });
    // One transaction, no awaits inside: expiry, idempotency, eligibility, insert.
    const result = store.createOrderGuarded({
      userId: req.user.id, kind, plan, postId,
      amountMinor, currency, provider: provider.nameFor(currency),
      idempotencyKey: idemKey || null, orderId: order.orderId,
    });
    if (result.error) {
      const msg = result.code; // client translates billing.errors.<code>
      logger.warn({ user: req.user.id, kind, plan, code: result.code }, "[billing] order rejected");
      return res.status(409).json({ error: msg, code: result.code, expiresAt: result.expiresAt, renewableFrom: result.renewableFrom, currentPlan: result.currentPlan });
    }
    const row = result.order;
    const checkout = { orderId: row.razorpay_order_id, amountMinor: row.amount_paise, currency: row.currency || currency, receipt };
    res.json({
      ...provider.checkoutConfig(currency, checkout),
      reused: !!result.reused,
      orderExpiresAt: row.order_expires_at,
    });
  } catch (err) {
    logger.error({ err: err.message, kind, currency }, "[billing] order creation failed");
    res.status(502).json({ error: "Could not create the order. Try again." });
  }
});

// ---------------------------------------------------------------- mock pay
// POST /api/billing/mock-pay { orderId } — the "simulate UPI payment" button.
// Exists only when the mock provider is active AND we are not in production.
// Works for every currency (the order carries its own currency).
// Replaying it on a paid order is a no-op success, exactly like a duplicate
// provider webhook; an expired order is refused.
router.post("/mock-pay", requireUser, (req, res) => {
  const mockActive = provider.resolveFor(currencyForUser(req.user)).name === "mock";
  if (!mockActive || isProduction()) return res.status(404).end();

  const orderId = String((req.body || {}).orderId || "");
  const order = store.getPurchaseByOrderId(orderId);
  if (!order || order.user_id !== req.user.id) return res.status(404).json({ error: "Order not found" });
  if (order.status === "expired") return res.status(409).json({ error: "billing.errors.order_expired", code: "order_expired" });
  if (order.status === "failed") return res.status(409).json({ error: "billing.errors.order_failed", code: "order_failed" });
  if (order.status === "duplicate") return res.status(409).json({ error: "billing.errors.duplicate", code: "duplicate" });

  const result = grantPurchase({
    orderId,
    paymentId: `mock_pay_${crypto.randomBytes(6).toString("hex")}`,
    amountMinor: order.amount_paise,
    currency: order.currency || "INR",
  });
  if (!result.ok) return res.status(400).json({ error: result.reason || "Grant failed" });
  if (result.duplicate) return res.status(409).json({ error: "billing.errors.duplicate", code: "duplicate" });
  res.json({ ok: true, alreadyPaid: !!result.already });
});

module.exports = router;

// ---------------------------------------------------------------- webhook
// Mounted at /billing/webhook (outside /api so it is exempt from the app's
// origin check and rate limits, exactly like /webhook). Exported separately
// so server.js can mount it before those middlewares apply.
// One path per provider: /billing/webhook/razorpay, /billing/webhook/dodo —
// each verifies with ITS OWN secret, so a dodo secret can never forge a
// razorpay event and vice versa.
// The global express.json in server.js already parses the body and captures
// req.rawBody for signature verification.
const webhookRouter = express.Router();

function webhookHandler(providerName) {
  return (req, res) => {
    let verified;
    try {
      verified = provider.verifyWebhook(providerName, req.rawBody || Buffer.alloc(0), req.headers);
    } catch (err) {
      logger.error({ err: err.message, provider: providerName }, "[billing] webhook verification threw");
      return res.status(400).json({ error: "Verification failed" });
    }
    if (!verified || !verified.ok) return res.status(400).json({ error: "Invalid webhook" });

    const ev = verified.event || {};
    if (ev.type === "paid") {
      // grantPurchase checks BOTH amount and currency against the stored order,
      // and claims ev.eventId in webhook_events so a redelivery grants once.
      const result = grantPurchase({
        orderId: ev.orderId, paymentId: ev.paymentId,
        amountMinor: ev.amountMinor, currency: ev.currency,
        provider: providerName, eventId: ev.eventId || null,
      });
      if (!result.ok) return res.status(400).json({ error: result.reason || "Grant failed" });
      return res.json({ ok: true, replay: !!result.replay, duplicate: !!result.duplicate });
    } else if (ev.type === "failed") {
      if (ev.eventId && !store.claimWebhookEvent(providerName, ev.eventId)) {
        return res.json({ ok: true, replay: true });
      }
      store.markPurchaseFailed(ev.orderId);
      logger.warn({ orderId: ev.orderId, provider: providerName }, "[billing] payment failed");
    } else {
      return res.status(400).json({ error: "Unsupported event" });
    }
    res.json({ ok: true });
  };
}

webhookRouter.post("/razorpay", webhookHandler("razorpay"));
webhookRouter.post("/dodo", webhookHandler("dodo"));

module.exports.webhookRouter = webhookRouter;
