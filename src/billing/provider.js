// ReplyLo — pluggable, multi-currency payment providers.
// The rest of the app only talks to this module. A provider object must expose:
//   name
//   enabled()                   => false until its env vars are configured
//   createOrder({ currency, amountMinor, receipt, notes }) => { orderId, amountMinor, currency }
//   checkoutConfig(order)       => what the frontend needs to open checkout
//   verifyWebhook(rawBody, headers) => { ok, event }
//     event = { type: 'paid' | 'failed', orderId, paymentId, amountMinor, currency }
//
// Provider choice by currency (production default):
//   INR -> razorpay (UPI)          every other currency -> dodo
// BILLING_PROVIDER overrides the choice:
//   mock      -> mock for every currency (local testing; routes still block it in production)
//   razorpay  -> razorpay for every currency
//   dodo      -> dodo for every currency
//   auto      -> explicit currency-based selection
// Unset: mock outside production (so local dev works with zero config),
// currency-based selection inside production.
//
// Resolution is lazy so tests can flip env vars without re-requiring the app,
// and so a misconfigured provider fails loudly at first use.

const isProduction = () => process.env.NODE_ENV === "production";

function byName(name) {
  if (name === "razorpay") return require("./razorpay");
  if (name === "dodo") return require("./dodo");
  return require("./mock");
}

// The provider that would handle a charge in `currency` right now.
function resolveFor(currency) {
  const cur = String(currency || "INR").toUpperCase();
  const forced = String(process.env.BILLING_PROVIDER || (isProduction() ? "auto" : "mock")).trim().toLowerCase();
  if (forced === "auto") return cur === "INR" ? require("./razorpay") : require("./dodo");
  return byName(forced);
}

// Which provider the UI should show for each currency (registry view).
function nameFor(currency) { return resolveFor(currency).name; }
function enabledFor(currency) {
  const p = resolveFor(currency);
  // The mock must never be "enabled" in production, even though mock.enabled()
  // is true (the routes double-guard this).
  if (p.name === "mock" && isProduction()) return false;
  return p.enabled();
}

module.exports = {
  resolveFor,
  nameFor,
  enabledFor,
  isProduction,
  createOrder: (currency, args) => resolveFor(currency).createOrder({ currency: String(currency).toUpperCase(), ...args }),
  checkoutConfig: (currency, order) => resolveFor(currency).checkoutConfig(order),
  // Webhooks arrive on provider-specific paths, so verification names the
  // provider directly (never the currency-based choice).
  verifyWebhook: (name, rawBody, headers) => byName(String(name).toLowerCase()).verifyWebhook(rawBody, headers),
};
