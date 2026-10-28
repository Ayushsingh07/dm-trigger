/* Replo - billing UI.
 * All payment-opening code lives in ONE function: openCheckout(config).
 * The page never activates anything itself; after a payment it polls
 * /auth/me until the server-side entitlement (pass or extra replies) changes.
 */
(function () {
  "use strict";

  const T = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  // money from MINOR units: cfg.currencies carries the exponent per currency.
  function fmtMinor(minor, currency) {
    const cur = String(currency || "INR").toUpperCase();
    let exp = 2;
    if (window.I18N && window.__BILLING_CFG__ && window.__BILLING_CFG__.currencies) {
      const c = window.__BILLING_CFG__.currencies.find(function (x) { return x.code === cur; });
      if (c) exp = c.exponent;
    }
    const major = Number(minor || 0) / Math.pow(10, exp);
    return window.I18N ? window.I18N.money(major, cur) : cur + " " + major.toLocaleString();
  }

  // -------------------------------------------------------------- checkout
  // config comes from POST /api/billing/order -> provider.checkoutConfig(order)
  window.openCheckout = async function openCheckout(config) {
    if (!config || !config.provider) return;

    if (config.provider === "mock") {
      const go = confirm(T("billing.testPayConfirm"));
      if (!go) return;
      const res = await fetch("/api/billing/mock-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: config.orderId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || T("billing.testPayFail"));
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
       *        amount: config.amountMinor,   // paise; currency is always INR
       *        currency: config.currency || "INR",
       *        method: { upi: true, card: false, netbanking: false,
       *                  wallet: false, emi: false },
       *        handler: () => waitForEntitlement().then(() =>
       *                    window.refreshBilling && window.refreshBilling()),
       *      }).open();
       * 3. Never mark anything paid here - the /billing/webhook + grant.js
       *    decide entitlement; this page only polls /auth/me.
       * ---------------------------------------------------------------- */
      alert(T("billing.razorpayUnwired"));
      return;
    }

    alert(T("billing.unknownProvider") + " " + config.provider);
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
  window.formatMoneyMinor = fmtMinor;
})();