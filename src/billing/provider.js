// ReplyLo — pluggable payment providers.
// The rest of the app only talks to this module; swapping mock for razorpay is
// one env var (BILLING_PROVIDER). A provider object must expose:
//   name
//   createOrder({ amountPaise, receipt, notes })  => { orderId, amountPaise }
//   checkoutConfig(order)       => what the frontend needs to open checkout
//   verifyWebhook(rawBody, headers) => { ok, event }
//     event = { type: 'paid' | 'failed', orderId, paymentId, amountPaise }
//
// Resolution is lazy so tests can flip BILLING_PROVIDER without re-requiring
// the app, and so a misconfigured razorpay setup fails loudly at first use.

function resolve() {
  const name = String(process.env.BILLING_PROVIDER || "mock").trim().toLowerCase();
  if (name === "razorpay") return require("./razorpay");
  return require("./mock");
}

module.exports = {
  get name() { return resolve().name; },
  createOrder: (args) => resolve().createOrder(args),
  checkoutConfig: (order) => resolve().checkoutConfig(order),
  verifyWebhook: (rawBody, headers) => resolve().verifyWebhook(rawBody, headers),
  resolve,
};
