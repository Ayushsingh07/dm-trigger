// ReplyLo — Dodo Payments provider (STUB — not implemented yet).
// Intended for every non-INR currency (USD, EUR, GBP, JPY, BRL, IDR).
//
// ============================================================================
// TODO: implement against Dodo's official docs (do not guess APIs).
//
// Required env vars (all must be set before this provider can be enabled):
//   DODO_API_KEY          — server-side secret key; NEVER sent to a client
//                           and NEVER logged
//   DODO_WEBHOOK_SECRET   — secret used to verify the webhook signature
//   DODO_ENV              — "test" | "live" (selects the API base URL)
//
// 1. createOrder({ currency, amountMinor, receipt, notes })
//    POST <base>/checkouts with the API key. Body: { currency,
//    amount: <amountMinor — exponent 0 for JPY/IDR, see pricing.js>,
//    reference: receipt, metadata: notes }. Return
//    { orderId, amountMinor, currency } plus whatever checkoutConfig needs
//    (e.g. a hosted checkout URL or session id).
//    Use fetch with an AbortController timeout; on non-2xx throw with the
//    Dodo error code only (no secrets, no full payloads in logs).
//
// 2. checkoutConfig(order)
//    Return what public/assets/billing.js openCheckout() needs to redirect
//    the browser to Dodo's hosted checkout, e.g.
//    { provider: "dodo", checkoutUrl, orderId, amountMinor, currency }.
//
// 3. verifyWebhook(rawBody, headers)
//    Verify the webhook signature header over the RAW body bytes using
//    DODO_WEBHOOK_SECRET with crypto.timingSafeEqual (guard length mismatch
//    first). On mismatch return { ok:false }. On match, parse the JSON and
//    map payment succeeded / payment failed events to
//    { ok:true, event: { type, orderId, paymentId, amountMinor, currency } }.
//    The grant check (store.markPurchasePaid) compares BOTH amount and
//    currency against the stored order, so include the currency.
//
// 4. server.js CSP: allow the Dodo checkout host in scriptSrc (or use a
//    plain redirect and no CSP change).
// ============================================================================

const NOT_READY = "Dodo not configured yet";

function notReady() {
  throw new Error(NOT_READY);
}

const name = "dodo";

module.exports = {
  name,
  enabled: () => false, // TODO: return true when DODO_API_KEY + DODO_WEBHOOK_SECRET + DODO_ENV are set
  createOrder: notReady,
  checkoutConfig: notReady,
  verifyWebhook: notReady,
};
