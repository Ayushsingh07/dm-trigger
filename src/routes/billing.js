// ReplyLo — billing API: config, order creation, provider webhook, mock pay.
// Prices come ONLY from src/pricing.js; the client never chooses an amount.
const express = require("express");
const crypto = require("crypto");

const store = require("../store");
const provider = require("../billing/provider");
const { grantPurchase } = require("../billing/grant");
const { PLANS, TOPUP, PERIOD_DAYS, PURCHASABLE } = require("../pricing");
const { requireUser, attachUser } = require("../auth");
const logger = require("../logger");

const router = express.Router();
router.use(attachUser);

const isProduction = () => process.env.NODE_ENV === "production";
// Mock payments must never grant anything in production.
const paymentsEnabled = () => !(isProduction() && provider.name === "mock");

// ---------------------------------------------------------------- config
// GET /api/billing/config — what the UI needs to render plans + checkout.
router.get("/config", (_req, res) => {
  res.json({
    provider: provider.name,
    enabled: paymentsEnabled(),
    periodDays: PERIOD_DAYS,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })),
    topup: TOPUP,
  });
});

// GET /api/billing/usage — per-post quota table for the dashboard.
router.get("/usage", requireUser, (req, res) => {
  const summary = store.getUsageSummary(req.user.id);
  const period = store.getPeriod(req.user);
  const daysLeft = period.plan !== "free" && period.end
    ? Math.max(0, Math.ceil((new Date(period.end).getTime() - Date.now()) / 864e5))
    : null;
  res.json({ ...summary, daysLeft, passPlan: req.user.pass_plan ?? null, passExpiresAt: req.user.pass_expires_at ?? null });
});

// ---------------------------------------------------------------- order
// POST /api/billing/order { kind:'pass', plan } | { kind:'topup', postId }
router.post("/order", requireUser, async (req, res) => {
  if (!paymentsEnabled()) return res.status(503).json({ error: "Payments are not open yet" });

  const { kind } = req.body || {};
  let amountPaise, plan = null, postId = null, receipt;

  if (kind === "pass") {
    plan = String(req.body.plan || "").toLowerCase();
    if (!PURCHASABLE.includes(plan)) return res.status(400).json({ error: "Unknown plan" });
    amountPaise = PLANS[plan].pricePaise;
    receipt = `replo_pass_${req.user.id.slice(-8)}_${plan}_${Date.now()}`;
  } else if (kind === "topup") {
    postId = String(req.body.postId || "").trim();
    if (!postId) return res.status(400).json({ error: "postId is required" });
    const period = store.getPeriod(req.user);
    if (!store.getPostUsage(req.user.id, postId, period.start)) {
      return res.status(400).json({ error: "That post is not active in your current period" });
    }
    amountPaise = TOPUP.pricePaise;
    receipt = `replo_topup_${req.user.id.slice(-8)}_${Date.now()}`;
  } else {
    return res.status(400).json({ error: "kind must be 'pass' or 'topup'" });
  }

  try {
    const order = await provider.createOrder({
      amountPaise,
      receipt,
      notes: { userId: req.user.id, kind, plan: plan || undefined, postId: postId || undefined },
    });
    store.createPurchase({
      id: "pur_" + crypto.randomBytes(8).toString("hex"),
      userId: req.user.id,
      orderId: order.orderId,
      kind, plan, postId, amountPaise,
    });
    res.json(provider.checkoutConfig(order));
  } catch (err) {
    logger.error({ err: err.message, kind }, "[billing] order creation failed");
    res.status(502).json({ error: "Could not create the order. Try again." });
  }
});

// ---------------------------------------------------------------- mock pay
// POST /api/billing/mock-pay { orderId } — the "simulate UPI payment" button.
// Exists only when the mock provider is active AND we are not in production.
router.post("/mock-pay", requireUser, (req, res) => {
  const mockActive = process.env.BILLING_PROVIDER === undefined
    ? true // default provider is mock
    : String(process.env.BILLING_PROVIDER).toLowerCase() === "mock";
  if (!mockActive || isProduction()) return res.status(404).end();

  const orderId = String((req.body || {}).orderId || "");
  const order = store.getPurchaseByOrderId(orderId);
  if (!order || order.user_id !== req.user.id) return res.status(404).json({ error: "Order not found" });
  if (order.status === "paid") return res.status(409).json({ error: "Order already paid" });
  if (order.status === "failed") return res.status(409).json({ error: "Order failed" });

  const result = grantPurchase({
    orderId,
    paymentId: `mock_pay_${crypto.randomBytes(6).toString("hex")}`,
    amountPaise: order.amount_paise,
  });
  if (!result.ok) return res.status(400).json({ error: result.reason || "Grant failed" });
  res.json({ ok: true, already: !!result.already });
});

module.exports = router;

// ---------------------------------------------------------------- webhook
// Mounted at /billing/webhook (outside /api so it is exempt from the app's
// origin check and rate limits, exactly like /webhook). Exported separately
// so server.js can mount it before those middlewares apply.
// The global express.json in server.js already parses the body and captures
// req.rawBody for signature verification.
const webhookRouter = express.Router();
webhookRouter.post("/", (req, res) => {
  let verified;
  try {
    verified = provider.verifyWebhook(req.rawBody || Buffer.alloc(0), req.headers);
  } catch (err) {
    logger.error({ err: err.message }, "[billing] webhook verification threw");
    return res.status(400).json({ error: "Verification failed" });
  }
  if (!verified || !verified.ok) return res.status(400).json({ error: "Invalid webhook" });

  const ev = verified.event || {};
  if (ev.type === "paid") {
    const result = grantPurchase({ orderId: ev.orderId, paymentId: ev.paymentId, amountPaise: ev.amountPaise });
    if (!result.ok) return res.status(400).json({ error: result.reason || "Grant failed" });
  } else if (ev.type === "failed") {
    store.markPurchaseFailed(ev.orderId);
    logger.warn({ orderId: ev.orderId }, "[billing] payment failed");
  } else {
    return res.status(400).json({ error: "Unsupported event" });
  }
  res.json({ ok: true });
});

module.exports.webhookRouter = webhookRouter;
