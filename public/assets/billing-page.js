/* Replo - billing page logic. Loads usage, renders plan/usage/plans.
 * Only the current plan (renew) and upgrades are offered - never lower plans.
 * Payment opening lives in /assets/billing.js (openCheckout).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const T = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
const TP = (k, c, v) => (window.I18N ? window.I18N.tplural(k, c, v) : k);
// money from MINOR units using the per-currency exponent from /api/billing/config
function fmtMinor(minor, currency) {
  const cur = String(currency || "INR").toUpperCase();
  const c = cfg && cfg.currencies && cfg.currencies.find(x => x.code === cur);
  const exp = c ? c.exponent : 2;
  const major = Number(minor || 0) / Math.pow(10, exp);
  return window.I18N ? window.I18N.money(major, cur) : cur + " " + major.toLocaleString();
}
const priceIn = (prices, cur) => (prices && prices[cur] != null ? fmtMinor(prices[cur], cur) : "\u2014");
const shortPost = (id) => { const s = String(id || "?"); return s.length > 14 ? s.slice(-8) : s; };
const fmtDate = (s) => s ? (window.I18N ? window.I18N.date(s) : new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })) : "";

let cfg = null;

async function load() {
  try {
    if (!cfg) cfg = await fetch("/api/billing/config").then(r => r.json());
    const [usage, me] = await Promise.all([
      fetch("/api/billing/usage").then(r => r.json()),
      fetch("/auth/me").then(r => r.json()),
    ]);
    if (me && !me.user) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
    window.__BILLING_CFG__ = cfg;
    renderCurrencyBar();
    render(usage);
  } catch {
    $("planName").textContent = T("billing.loadError");
  }
}

function render(usage) {
  const plan = usage.plan || "free";
  const curRank = usage.rank ?? 0;
  const cur = usage.currency || cfg.userCurrency || "INR";

  // ---- hero card
  $("planName").textContent = plan === "trial" ? T("billing.trialGrowth") : plan;
  let meta = T("billing.planMeta", { replies: usage.repliesPerPost, posts: usage.postsAllowed });
  if (usage.passExpiresAt) meta += " \u00B7 " + T("billing.expires", { date: fmtDate(usage.passExpiresAt) });
  $("planMeta").textContent = meta;
  $("planDays").innerHTML = usage.daysLeft != null
    ? '<div class="n">' + usage.daysLeft + '</div><div class="l">' + TP("billing.daysLeftUnit", usage.daysLeft) + " " + T("billing.left") + "</div>"
    : '<div class="l">' + (plan === "trial" ? T("billing.trialActive") : T("billing.freePlan")) + "</div>";
  $("periodSt").textContent = T("billing.postsUsed", { used: usage.postsUsed, total: usage.postsAllowed });

  // ---- banners
  const bl = [];
  if (usage.passPlan && usage.daysLeft != null && usage.daysLeft <= 3 && usage.daysLeft > 0)
    bl.push(["warn", TP("billing.bannerDays", usage.daysLeft, { plan: usage.passPlan })]);
  if (usage.passPlan && usage.daysLeft === 0)
    bl.push(["bad", T("billing.bannerExpired")]);
  const capped = (usage.posts || []).filter(p => p.used >= p.cap);
  if (capped.length)
    bl.push(["bad", T("billing.bannerCapped", { post: esc(shortPost(capped[0].postId)), cap: capped[0].cap, extra: cfg.topup.replies })]);
  $("banners").innerHTML = bl.map(([cls, msg]) => '<div class="banner ' + cls + ' show"><span>' + msg + "</span></div>").join("");

  // ---- usage table
  $("usageSub").textContent = usage.posts && usage.posts.length
    ? TP("billing.postsActive", usage.posts.length)
    : "";
  const body = $("usageBody");
  if (!usage.posts || !usage.posts.length) {
    body.innerHTML = '<tr><td colspan="4" class="dim">' + T("billing.noUsage") + "</td></tr>";
  } else {
    body.innerHTML = usage.posts.map((p) => {
      const pct = Math.min(100, Math.round((p.used / Math.max(1, p.cap)) * 100));
      const near = p.used >= p.cap * 0.8;
      const topup = (cfg.enabled && near)
        ? '<button class="pill light" style="padding:6px 12px;font-size:12px" onclick="buyTopup(\'' + esc(p.postId) + '\')">+' + cfg.topup.replies + " replies \u00B7 " + priceIn(cfg.topup.prices, cur) + "</button>" : "";
      return "<tr>"
        + "<td><code class=\"inline\">" + esc(shortPost(p.postId)) + "</code></td>"
        + "<td>" + p.used + " / " + p.cap + (p.extraReplies ? ' <span class="dim">(' + T("billing.extra", { count: p.extraReplies }) + ")</span>" : "") + "</td>"
        + '<td><div class="bar"><i class="' + (p.used >= p.cap ? "full" : "") + '" style="width:' + pct + '%"></i></div></td>'
        + "<td>" + topup + "</td>"
        + "</tr>";
    }).join("");
  }

  // ---- plan chooser: current plan (renew) + upgrades ONLY, never lower plans
  const panel = $("upgradePanel"), pick = $("planPick"), hint = $("billingHint");
  if (!cfg.enabled) {
    panel.style.display = "";
    $("upgradeTitle").textContent = T("billing.plansTitle");
    pick.innerHTML = "";
    hint.textContent = T("billing.paymentsSoon");
  } else {
    const options = (cfg.plans || []).filter(p => p.id !== "free" && (p.rank ?? 0) >= curRank);
    if (!options.length) {
      panel.style.display = "none";   // already on the top plan
    } else {
      panel.style.display = "";
      $("upgradeTitle").textContent = curRank > 0 ? T("billing.renewUpgrade") : T("billing.choosePlan");
      pick.innerHTML = options.map((p) => {
        const cur = usage.passPlan === p.id;
        const label = p.rank > curRank ? T("billing.upgrade") : (cur ? T("billing.renew") : T("billing.choose"));
        return '<div class="planopt' + (cur ? " cur" : "") + '">'
          + '<div class="pname">' + p.id[0].toUpperCase() + p.id.slice(1) + (cur ? " " + T("billing.current") : "") + "</div>"
          + '<div class="pprice">' + priceIn(p.prices, cur) + " <small>" + T("billing.per30") + "</small></div>"
          + '<div class="pdesc">' + T("billing.planDesc", { replies: p.repliesPerPost, posts: p.postsPerPeriod }) + "</div>"
          + '<button class="pill ' + (cur ? "light" : "dark") + '" onclick="buyPass(\'' + p.id + '\')">' + label + "</button>"
          + "</div>";
      }).join("");
      hint.innerHTML = T("billing.hintPre", { currency: cur }) + ' <a href="/terms" style="color:var(--acc-ink)">' + T("billing.refundLink") + "</a>" + T("billing.refundPost");
    }
  }

  loadHistory();
}

function renderCurrencyBar() {
  const row = $("currencyRow");
  if (!row || !cfg || !cfg.currencies) return;
  $("currencyLabel").textContent = T("billing.currencyLabel");
  const sel = $("currencySel");
  sel.innerHTML = cfg.currencies.map(c =>
    '<option value="' + c.code + '"' + (c.code === cfg.userCurrency ? " selected" : "") + ">" + c.code + "</option>").join("");
  row.style.display = "";
  updateCurrencyNote();
}

function updateCurrencyNote() {
  const note = $("currencyNote");
  if (!note || !cfg) return;
  const c = (cfg.currencies || []).find(x => x.code === cfg.userCurrency);
  note.textContent = (c && !c.canBuy) ? T("billing.currencyUnavailable") : "";
}

async function setBillingCurrency(code) {
  const res = await fetch("/api/billing/currency", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency: code }),
  });
  const j = await res.json();
  if (!res.ok) return alert(j.error || T("billing.orderError"));
  cfg = null;
  await load();
}
window.setBillingCurrency = setBillingCurrency;

async function loadHistory() {
  try {
    const h = await fetch("/api/billing/history").then(r => r.json());
    const rows = h.purchases || [];
    if (!rows.length) return;
    $("historyPanel").style.display = "";
    $("historyBody").innerHTML = rows.map((p) => "<tr>"
      + '<td class="dim">' + fmtDate(p.created_at) + "</td>"
      + "<td>" + (p.kind === "pass" ? T("billing.passItem", { plan: p.plan || "" }) : T("billing.topupItem", { post: esc(shortPost(p.post_id)) })) + "</td>"
      + "<td>" + fmtMinor(p.amount_paise, p.currency || "INR") + "</td>"
      + '<td><span class="st ' + p.status + '">' + p.status + "</span></td>"
      + "</tr>").join("");
  } catch { /* history is optional */ }
}

async function buyPass(plan) {
  const res = await fetch("/api/billing/order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "pass", plan }),
  });
  const j = await res.json();
  if (!res.ok) return alert(j.error || T("billing.orderError"));
  window.openCheckout(j);
}
async function buyTopup(postId) {
  const res = await fetch("/api/billing/order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "topup", postId }),
  });
  const j = await res.json();
  if (!res.ok) return alert(j.error || T("billing.orderError"));
  window.openCheckout(j);
}

window.refreshBilling = load;   // called by billing.js after a mock payment
load();
setInterval(load, 30000);