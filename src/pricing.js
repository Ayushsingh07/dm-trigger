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
// Only INR and USD are priced today, so every locale whose local currency is
// still unpriced (EUR/BRL/JPY/IDR/...) defaults to USD until that currency
// gets real prices in PLAN_PRICES_MINOR. Indian-language locales keep INR.
const LOCALE_CURRENCY = {
  en: "INR", es: "USD", "pt-BR": "USD", fr: "USD", de: "USD",
  ja: "USD", hi: "INR", id: "USD",
  bn: "INR", ta: "INR", te: "INR", mr: "INR", ko: "USD", // ko -> USD until KRW is priced
};
const currencyFromLocale = (lang) => LOCALE_CURRENCY[String(lang || "").trim()] || "USD";

// Limits per plan (per 30-day pass; prices moved below).
const PLANS = {
  free:    { repliesPerPost: 50,   postsPerPeriod: 3,  rank: 0 },
  starter: { repliesPerPost: 150,  postsPerPeriod: 15, rank: 1 },
  growth:  { repliesPerPost: 400,  postsPerPeriod: 15, rank: 2 },
  pro:     { repliesPerPost: 1000, postsPerPeriod: 15, rank: 3 },
};

// Passes and free "periods" both span this many days.
const PERIOD_DAYS = 30;

// One-off extra replies for a SINGLE post (raises that post's cap only).
const TOPUP = { replies: 300 };

// ---------------------------------------------------------------- prices
// Price of each purchasable plan per currency, in MINOR units.
// null = not sellable in that currency yet (UI shows a dash, orders are 400).
// INR and USD have real numbers (owner-approved price list). Fill the rest
// with real local prices (rounded nicely for the market) before enabling.
const PLAN_PRICES_MINOR = {
  starter: { INR: 19900, USD: 600, EUR: null /* TODO-PRICE */, GBP: null /* TODO-PRICE */, JPY: null /* TODO-PRICE */, BRL: null /* TODO-PRICE */, IDR: null /* TODO-PRICE */ },
  growth:  { INR: 24900, USD: 900, EUR: null /* TODO-PRICE */, GBP: null /* TODO-PRICE */, JPY: null /* TODO-PRICE */, BRL: null /* TODO-PRICE */, IDR: null /* TODO-PRICE */ },
  pro:     { INR: 44900, USD: 1500, EUR: null /* TODO-PRICE */, GBP: null /* TODO-PRICE */, JPY: null /* TODO-PRICE */, BRL: null /* TODO-PRICE */, IDR: null /* TODO-PRICE */ },
};
// Top-up price per currency, minor units (INR ₹79 = 7900 paise; USD $4).
const TOPUP_PRICE_MINOR = { INR: 7900, USD: 400, EUR: null /* TODO-PRICE */, GBP: null /* TODO-PRICE */, JPY: null /* TODO-PRICE */, BRL: null /* TODO-PRICE */, IDR: null /* TODO-PRICE */ };

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
