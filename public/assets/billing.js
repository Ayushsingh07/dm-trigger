/* Replo - billing UI.
 * All payment-opening code lives in ONE function: openCheckout(config).
 * The page never activates anything itself; after a payment it polls
 * /auth/me until the server-side entitlement (pass or extra replies) changes.
 *
 * Duplicate-proofing (mirrors the server rules, which stay authoritative):
 *  - one module-level in-flight lock: checkout buttons are disabled while an
 *    order is being created, checkout is open, or entitlement polling runs.
 *    The lock is always released in a finally block.
 *  - one idempotency key per user attempt (crypto.randomUUID()); a retry after
 *    a network error reuses the SAME key, a new attempt gets a new one.
 *  - a 409 with a `code` is translated from billing.errors.<code>.
 */
(function () {
  "use strict";

  const T = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);

  // ---------------------------------------------------------------- lock
  let inFlight = false;
  function setBusy(on) {
    inFlight = !!on;
    document.dispatchEvent(new CustomEvent("billing-busy", { detail: { busy: inFlight } }));
  }
  window.billingIsBusy = function () { return inFlight; };

  // Runs `fn` with checkout disabled. Always releases the lock. Not re-entrant:
  // a second call while busy is ignored, which is exactly what stops a double
  // click from opening two checkouts.
  window.withBillingLock = async function withBillingLock(fn) {
    if (inFlight) return undefined;
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  };

  // ------------------------------------------------------- idempotency keys
  // One key per user attempt: newIdempotencyKey() for a fresh click,
  // retryIdempotencyKey() when the same click is retried after a network error.
  let currentKey = null;
  window.newIdempotencyKey = function newIdempotencyKey() {
    const raw = crypto.randomUUID ? crypto.randomUUID() : "idem" + Date.now() + Math.random().toString(36).slice(2);
    currentKey = raw.replace(/-/g, "").slice(0, 32);
    return currentKey;
  };
  window.retryIdempotencyKey = function retryIdempotencyKey() {
    return currentKey || window.newIdempotencyKey();
  };
  window.clearIdempotencyKey = function clearIdempotencyKey() { currentKey = null; };
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

  // A 409 from /api/billing/order carries { code, plan, expiresAt, ... }.
  // Translate it; never show a raw code to the user.
  function messageFor(j) {
    const code = j.code || (typeof j.error === "string" && /^[a-z_]+$/.test(j.error) ? j.error : "");
    if (!code) return j.error || "";
    const key = "billing.errors." + code;
    const plan = String(j.currentPlan || j.plan || "").toUpperCase();
    const fmt = (s) => (window.I18N && s ? window.I18N.date(s) : (s || ""));
    const text = T(key, {
      plan: plan,
      currentPlan: plan,
      date: fmt(j.expiresAt),
      renewFrom: fmt(j.renewableFrom),
    });
    return text === key ? (j.error || T("billing.orderError")) : text;
  }
  window.billingErrorMessage = messageFor;

  // -------------------------------------------------------------- checkout
  // config comes from POST /api/billing/order -> provider.checkoutConfig(order)
  window.openCheckout = async function openCheckout(config) {
    if (!config || !config.provider) return;
    if (inFlight) return;                        // a click while busy is ignored

    if (config.provider === "mock") {
      const go = confirm(T("billing.testPayConfirm"));
      if (!go) return;
      await window.withBillingLock(async function () {
        try {
          const res = await fetch("/api/billing/mock-pay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: config.orderId }),
          });
          const j = await res.json().catch(function () { return {}; });
          if (!res.ok) { alert(messageFor(j)); return; }
          await waitForEntitlement();
        } catch (err) {
          // Network hiccup: the server may already have granted it, so re-check
          // state instead of re-submitting the payment.
        }
        if (window.refreshBilling) window.refreshBilling();
      });
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
       * 2. Open checkout with the values from `config` INSIDE
       *    window.withBillingLock(...) so exactly ONE checkout session is open
       *    at a time. The server creates one session per order, stores its URL
       *    on the order row, and passes our order id as provider metadata.
       *      new Razorpay({
       *        key: config.keyId,
       *        order_id: config.orderId,
       *        amount: config.amountMinor,   // minor units; see config.currency
       *        currency: config.currency || "INR",
       *        method: { upi: true, card: false, netbanking: false,
       *                  wallet: false, emi: false },
       *        handler: () => waitForEntitlement(config.__baseline).then(() =>
       *                    window.refreshBilling && window.refreshBilling()),
       *      }).open();
       * 3. Never mark anything paid here - the /billing/webhook + grant.js
       *    decide entitlement; this page only polls /auth/me. The webhook must
       *    hand grant.js the provider's event id so webhook_events can dedupe
       *    a redelivery.
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