// ReplyLo — turn a verified paid event into an entitlement.
// Every grant goes through here (mock-pay, Razorpay/dodo webhooks) so the
// rules are identical: one grant per order, one grant per provider event id,
// amount AND currency must match the stored order, and the DB write + grant
// happen in ONE transaction (inside store).

const store = require("../store");
const logger = require("../logger");

// orderId/paymentId/amountMinor/currency come from the provider's verified
// event. eventId (when the provider supplies one) is claimed in webhook_events
// so a replayed delivery can never grant twice.
// Returns { ok, already?, duplicate?, kind? } or { ok:false, reason }.
function grantPurchase({ orderId, paymentId, amountMinor, currency, provider = "mock", eventId = null }) {
  if (!orderId) return { ok: false, reason: "missing_order" };

  // Webhook replay guard: claiming the (provider, event_id) PK is the lock.
  if (eventId && !store.claimWebhookEvent(provider, eventId)) {
    logger.info({ provider, eventId, orderId }, "[billing] replayed webhook ignored");
    return { ok: true, replay: true };
  }

  const res = store.markPurchasePaid({ orderId, paymentId, amountMinor, currency });

  if (!res.ok && (res.reason === "amount_mismatch" || res.reason === "currency_mismatch")) {
    // Never grant on a mismatch; keep the order 'created' and alert.
    logger.error({ orderId, reason: res.reason, expected: res.expected, got: res.got }, "[billing] REJECTED payment: mismatch");
    return { ok: false, reason: res.reason };
  }
  if (!res.ok) {
    logger.warn({ orderId, reason: res.reason }, "[billing] grant failed");
    return res;
  }
  if (res.already) {
    logger.info({ orderId }, "[billing] duplicate grant ignored (already paid)");
    return { ok: true, already: true };
  }
  if (res.duplicate) {
    // Money arrived for a pass the user already has; recorded as 'duplicate'
    // with a duplicate_payment event. Support/refund decides the rest.
    logger.warn({ orderId, duplicateOf: res.duplicateOf }, "[billing] DUPLICATE payment recorded, entitlement NOT extended");
    return { ok: true, duplicate: true };
  }

  const order = store.getPurchaseByOrderId(orderId);
  logger.info({ orderId, kind: res.kind, user: order?.user_id }, "[billing] purchase granted");
  return { ok: true, kind: res.kind };
}

module.exports = { grantPurchase };
