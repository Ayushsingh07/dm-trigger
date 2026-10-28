// ReplyLo — turn a verified paid event into an entitlement.
// Every grant goes through here (mock-pay, future Razorpay webhook) so the
// rules are identical: idempotent per order, amount must match the stored
// order, and the DB write + grant happen in ONE transaction (inside store).

const store = require("../store");
const logger = require("../logger");

// orderId/paymentId/amountPaise come from the provider's verified event.
// Returns { ok, already?, kind? } or { ok:false, reason }.
function grantPurchase({ orderId, paymentId, amountPaise }) {
  if (!orderId) return { ok: false, reason: "missing_order" };

  const res = store.markPurchasePaid({ orderId, paymentId, amountPaise });

  if (!res.ok && res.reason === "amount_mismatch") {
    // Never grant on a mismatched amount; keep the order 'created' and alert.
    logger.error({ orderId, expected: res.expected, got: res.got }, "[billing] REJECTED payment: amount mismatch");
    return { ok: false, reason: "amount_mismatch" };
  }
  if (!res.ok) {
    logger.warn({ orderId, reason: res.reason }, "[billing] grant failed");
    return res;
  }
  if (res.already) {
    logger.info({ orderId }, "[billing] duplicate grant ignored (already paid)");
    return { ok: true, already: true };
  }

  const order = store.getPurchaseByOrderId(orderId);
  logger.info({ orderId, kind: res.kind, user: order?.user_id }, "[billing] purchase granted");
  return { ok: true, kind: res.kind };
}

module.exports = { grantPurchase };
