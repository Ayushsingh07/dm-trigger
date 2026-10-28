// ReplyLo — prepaid-pass pricing (single source of truth for limits + prices).
// All money values are integer PAISE (₹1 = 100 paise). No provider code here.

// A "pass" grants, for PERIOD_DAYS:
//   repliesPerPost — how many auto-replies one post may send per period
//   postsPerPeriod — how many distinct posts may be activated per period
// The free plan has the same shape (tiny limits, price 0).
// A trial user gets the growth limits until trial_ends_at (see store.getPeriod).
const PLANS = {
  free:    { repliesPerPost: 20,  postsPerPeriod: 2,  pricePaise: 0,     rank: 0 },
  starter: { repliesPerPost: 50,  postsPerPeriod: 15, pricePaise: 19900, rank: 1 }, // ₹199
  growth:  { repliesPerPost: 100, postsPerPeriod: 15, pricePaise: 34900, rank: 2 }, // ₹349
  pro:     { repliesPerPost: 250, postsPerPeriod: 15, pricePaise: 69900, rank: 3 }, // ₹699
};

// Passes and free "periods" both span this many days.
const PERIOD_DAYS = 30;

// One-off extra replies for a SINGLE post (raises that post's cap only).
const TOPUP = { replies: 100, pricePaise: 4900 }; // ₹49

// Plans a user can actually buy (everything except free).
const PURCHASABLE = Object.keys(PLANS).filter((p) => p !== "free");

// Limits for any plan name; unknown names fall back to free.
const limitsFor = (plan) => PLANS[plan] || PLANS.free;

// Higher rank = bigger plan. Used by the billing UI to hide plans that are
// lower than what the user already pays for (trial counts as growth).
const rankOf = (plan) => (plan === "trial" ? PLANS.growth.rank : (PLANS[plan] || PLANS.free).rank);

module.exports = { PLANS, PERIOD_DAYS, TOPUP, PURCHASABLE, limitsFor, rankOf };
