// ReplyLo — prepaid-pass pricing (single source of truth for limits + prices).
// ALL money values are integers in the currency's MINOR units, scaled by
// CURRENCY_EXPONENT (INR 199 -> 19900 paise; JPY 199 -> 199, exponent 0).
// No provider code here.

// A "pass" grants, for PERIOD_DAYS:
//   repliesPerPost — how many auto-replies one post may send per period
//   postsPerPeriod — how many distinct posts may be activated per period
// The free plan has the same shape (tiny limits, price 0).
// A trial user gets the growth limits until trial_ends_at (see store.getPeriod).

// Decimal exponent per supported billing currency. JPY and IDR have no minor
// unit in practice (exponent 0), so 1 JPY is stored as 1, not 100.
const CURRENCY_EXPONENT = { INR: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, BRL: 2, IDR: 0 };
const CURRENCIES = Object.keys(CURRENCY_EXPONENT);

// Default billing currency for each UI locale (users can override in the UI).
const LOCALE_CURRENCY = {
  en: "INR", es: "EUR", "pt-BR": "BRL", fr: "EUR", de: "EUR",
  ja: "JPY", hi: "INR", id: "IDR",
  bn: "INR", ta: "INR", te: "INR", mr: "INR", ko: "USD", // ko -> USD until KRW is priced
};
const currencyFromLocale = (lang) => LOCALE_CURRENCY[String(lang || "").trim()] || "USD";

// Limits per plan (UNCHANGED by multi-currency work; prices moved below).
const PLANS = {
  free:    { repliesPerPost: 20,  postsPerPeriod: 2,  rank: 0 },
  starter: { repliesPerPost: 50,  postsPerPeriod: 15, rank: 1 },
  growth:  { repliesPerPost: 100, postsPerPeriod: 15, rank: 2 },
  pro:     { repliesPerPost: 250, postsPerPeriod: 15, rank: 3 },
};

// Passes and free "periods" both span this many days.
const PERIOD_DAYS = 30;

// One-off extra replies for a SINGLE post (raises that post's cap only).
const TOPUP = { replies: 100 };

// ---------------------------------------------------------------- prices
// Price of each purchasable plan per currency, in MINOR units.
// null = not sellable in that currency yet (UI shows a dash, orders are 400).
// TODO-PRICE: only INR has real numbers. Fill the rest with real local prices
// (rounded nicely for the market) before enabling each currency.
const PLAN_PRICES_MINOR = {
  starter: { INR: 19900, USD: null /* TODO-PRICE */, EUR: null /* TODO-PRICE */, GBP: null /* TODO-PRICE */, JPY: null /* TODO-PRICE */, BRL: null /* TODO-PRICE */, IDR: null /* TODO-PRICE */ },
  growth:  { INR: 34900, USD: null /* TODO-PRICE */, EUR: null /* TODO-PRICE */, GBP: null /* TODO-PRICE */, JPY: null /* TODO-PRICE */, BRL: null /* TODO-PRICE */, IDR: null /* TODO-PRICE */ },
  pro:     { INR: 69900, USD: null /* TODO-PRICE */, EUR: null /* TODO-PRICE */, GBP: null /* TODO-PRICE */, JPY: null /* TODO-PRICE */, BRL: null /* TODO-PRICE */, IDR: null /* TODO-PRICE */ },
};
// TODO-PRICE: top-up price per currency, minor units (INR ₹49 = 4900 paise).
const TOPUP_PRICE_MINOR = { INR: 4900, USD: null, EUR: null, GBP: null, JPY: null, BRL: null, IDR: null };

const exponentOf = (currency) => CURRENCY_EXPONENT[String(currency || "").toUpperCase()] ?? 2;
const isSupportedCurrency = (c) => Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, String(c || "").toUpperCase());
const toMajor = (minor, currency) => Math.round(Number(minor)) / 10 ** exponentOf(currency);

// null when the plan/currency pair has no price yet (or the plan is free).
function priceMinor(plan, currency) {
  const cur = String(currency || "").toUpperCase();
  if (plan === "free") return 0;
  const table = PLAN_PRICES_MINOR[plan];
  return table && isSupportedCurrency(cur) ? table[cur] : null;
}
function topupPriceMinor(currency) {
  const cur = String(currency || "").toUpperCase();
  return isSupportedCurrency(cur) ? TOPUP_PRICE_MINOR[cur] : null;
}

// Plans a user can actually buy (everything except free).
const PURCHASABLE = Object.keys(PLANS).filter((p) => p !== "free");

// Limits for any plan name; unknown names fall back to free.
// pricePaise is kept as the INR price for older callers/tests (INR is the
// reference currency); new code should use priceMinor(plan, currency).
const limitsFor = (plan) => {
  const p = PLANS[plan] || PLANS.free;
  return { ...p, pricePaise: plan === "free" ? 0 : (PLAN_PRICES_MINOR[plan]?.INR ?? 0) };
};

// Higher rank = bigger plan. Used by the billing UI to hide plans that are
// lower than what the user already pays for (trial counts as growth).
const rankOf = (plan) => (plan === "trial" ? PLANS.growth.rank : (PLANS[plan] || PLANS.free).rank);

module.exports = {
  PLANS, PERIOD_DAYS, TOPUP, PURCHASABLE, limitsFor, rankOf,
  CURRENCY_EXPONENT, CURRENCIES, LOCALE_CURRENCY, currencyFromLocale,
  PLAN_PRICES_MINOR, TOPUP_PRICE_MINOR,
  exponentOf, isSupportedCurrency, toMajor, priceMinor, topupPriceMinor,
};
