// ReplyLo — mock payment provider (development and self-hosted testing).
// Works with EVERY currency in development: createOrder just echoes the
// amount/currency back. Nothing talks to a real gateway.
// There is NO webhook for the mock: verifyWebhook always fails, so a payment
// can only be granted through POST /api/billing/mock-pay, which is itself
// hard-disabled when NODE_ENV=production.

const crypto = require("crypto");

const name = "mock";

function createOrder({ currency = "INR", amountMinor, receipt }) {
  return {
    orderId: `mock_order_${crypto.randomBytes(8).toString("hex")}`,
    amountMinor,
    currency: String(currency).toUpperCase(),
    receipt,
  };
}

function checkoutConfig(order) {
  return {
    provider: name,
    orderId: order.orderId,
    amountMinor: order.amountMinor,
    currency: order.currency || "INR",
  };
}

// The mock has no server-to-server callback. A "payment" is simulated by the
// logged-in user through /api/billing/mock-pay (session-authenticated, dev-only).
function verifyWebhook() {
  return { ok: false, error: "mock provider has no webhook" };
}

module.exports = { name, enabled: () => true, createOrder, checkoutConfig, verifyWebhook };
