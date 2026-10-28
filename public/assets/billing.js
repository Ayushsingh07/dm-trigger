/* Replo - billing UI.
 * All payment-opening code lives in ONE function: openCheckout(config).
 * The page never activates anything itself; after a payment it polls
 * /auth/me until the server-side entitlement (pass or extra replies) changes.
 */
(function () {
  "use strict";

  const fmt = (paise) => "\u20B9" + (paise / 100).toLocaleString("en-IN");

  // -------------------------------------------------------------- checkout
  // config comes from POST /api/billing/order -> provider.checkoutConfig(order)
  window.openCheckout = async function openCheckout(config) {
    if (!config || !config.provider) return;

    if (config.provider === "mock") {
      const go = confirm("Test payment: simulate a successful UPI payment?");
      if (!go) return;
      const res = await fetch("/api/billing/mock-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: config.orderId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Test payment failed.");
        return;
      }
      await waitForEntitlement();
      if (window.refreshBilling) window.refreshBilling();
      return;
    }

    if (config.provider === "razorpay") {
      /* ------------------------------------------------------------------
       * TODO: Razorpay Checkout (UPI only). Wire this when the Razorpay
       * provider is implemented in src/billing/razorpay.js.
       *
       * 1. Load the script once:
       *      <script src="https://checkout.razorpay.com/v1/checkout.js">
       *    (also allow checkout.razorpay.com in the CSP scriptSrc in server.js)
       * 2. Open checkout with the values from `config`:
       *      new Razorpay({
       *        key: config.keyId,
       *        order_id: config.orderId,
       *        amount: config.amountPaise,
       *        currency: "INR",
       *        method: { upi: true, card: false, netbanking: false,
       *                  wallet: false, emi: false },
       *        handler: () => waitForEntitlement().then(() =>
       *                    window.refreshBilling && window.refreshBilling()),
       *      }).open();
       * 3. Never mark anything paid here - the /billing/webhook + grant.js
       *    decide entitlement; this page only polls /auth/me.
       * ---------------------------------------------------------------- */
      alert("Razorpay not wired yet.");
      return;
    }

    alert("Unknown payment provider: " + config.provider);
  };

  // --------------------------------------------------------------- polling
  // After a payment, poll /auth/me every 2s for up to 30s until the plan or
  // extra replies change. The server is the single source of truth.
  async function waitForEntitlement() {
    const before = await fetch("/auth/me").then(function (r) { return r.json(); }).catch(function () { return null; });
    const key = function (j) {
      const u = j && j.user;
      return u ? (u.passPlan + "|" + u.passExpiresAt + "|" + u.extraReplies) : "";
    };
    const start = key(before);
    for (let i = 0; i < 15; i++) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      const now = await fetch("/auth/me").then(function (r) { return r.json(); }).catch(function () { return null; });
      if (key(now) !== start) return true;
    }
    return false;
  }
  window.waitForEntitlement = waitForEntitlement;
  window.formatPaise = fmt;
})();