// ReplyLo — Razorpay provider (STUB — not implemented yet).
//
// ============================================================================
// TODO: implement against Razorpay's official docs (do not guess APIs).
//
// Required env vars (all three must be set before BILLING_PROVIDER=razorpay
// is allowed; provider.js must refuse to boot otherwise):
//   RAZORPAY_KEY_ID          — public key id (sent to the browser checkout)
//   RAZORPAY_KEY_SECRET      — server-side secret; NEVER sent to a client
//                              and NEVER logged
//   RAZORPAY_WEBHOOK_SECRET  — secret used to verify X-Razorpay-Signature
//
// 1. createOrder({ amountPaise, receipt, notes })
//    POST https://api.razorpay.com/v1/orders with HTTP Basic auth
//    (key id + key secret). Body: { amount: <paise>, currency: "INR",
//    receipt, notes }. Return { orderId: res.id, amountPaise }.
//    Use fetch with an AbortController timeout; on non-2xx throw with the
//    Razorpay error code only (no secrets, no full payloads in logs).
//
// 2. checkoutConfig(order)
//    Return { provider: "razorpay", keyId: RAZORPAY_KEY_ID, orderId,
//    amountPaise, currency: "INR" } — exactly what public/assets/billing.js
//    openCheckout() needs to load checkout.js and open UPI-only checkout.
//
// 3. verifyWebhook(rawBody, headers)
//    Compute HMAC SHA256 over the RAW body bytes using
//    RAZORPAY_WEBHOOK_SECRET and compare against the X-Razorpay-Signature
//    header with crypto.timingSafeEqual (guard length mismatch first).
//    On mismatch return { ok:false }. On match, parse the JSON and map:
//      event.event === "order.paid"     -> type 'paid'
//        orderId  = payload.order.entity.id
//        paymentId = payload.payment.entity.id (may be absent)
//        amountMinor = payload.order.entity.amount, currency: "INR"
//      event.event === "payment.failed" -> type 'failed'
//        orderId = payload.payment.entity.order_id
//      anything else -> { ok:false } (ignore unknown events)
//    Return { ok:true, event }.
//
// 4. server.js CSP: allow https://checkout.razorpay.com in scriptSrc once
//    the frontend actually loads checkout.js.
// ============================================================================

const NOT_READY = "Razorpay not configured yet";

function notReady() {
  throw new Error(NOT_READY);
}

const name = "razorpay";

module.exports = {
  name,
  // Always false while this is a stub — createOrder/verifyWebhook throw.
  // When implemented, switch to:
  //   () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET &&
  //            process.env.RAZORPAY_WEBHOOK_SECRET)
  enabled: () => false,
  createOrder: notReady,
  checkoutConfig: notReady,
  verifyWebhook: notReady,
};
