// ReplyLo — mock payment provider (development and self-hosted testing).
// createOrder hands back a fake order id; nothing talks to a real gateway.
// There is NO webhook for the mock: verifyWebhook always fails, so a payment
// can only be granted through POST /api/billing/mock-pay, which is itself
// hard-disabled when NODE_ENV=production.

const crypto = require("crypto");

const name = "mock";

function createOrder({ amountPaise, receipt }) {
  return {
    orderId: `mock_order_${crypto.randomBytes(8).toString("hex")}`,
    amountPaise,
    receipt,
  };
}

function checkoutConfig(order) {
  return {
    provider: name,
    orderId: order.orderId,
    amountPaise: order.amountPaise,
    currency: "INR",
  };
}

// The mock has no server-to-server callback. A "payment" is simulated by the
// logged-in user through /api/billing/mock-pay (session-authenticated, dev-only).
function verifyWebhook() {
  return { ok: false, error: "mock provider has no webhook" };
}

module.exports = { name, createOrder, checkoutConfig, verifyWebhook };
