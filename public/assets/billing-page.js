/* Replo - billing page logic. Loads usage, renders plan/usage/plans.
 * Only the current plan (renew) and upgrades are offered - never lower plans.
 * Payment opening lives in /assets/billing.js (openCheckout).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmtPaise = (p) => "\u20B9" + (p / 100).toLocaleString("en-IN");
const shortPost = (id) => { const s = String(id || "?"); return s.length > 14 ? s.slice(-8) : s; };
const fmtDate = (s) => s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

let cfg = null;

async function load() {
  try {
    if (!cfg) cfg = await fetch("/api/billing/config").then(r => r.json());
    const [usage, me] = await Promise.all([
      fetch("/api/billing/usage").then(r => r.json()),
      fetch("/auth/me").then(r => r.json()),
    ]);
    if (me && !me.user) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
    render(usage);
  } catch {
    $("planName").textContent = "Could not load billing.";
  }
}

function render(usage) {
  const plan = usage.plan || "free";
  const curRank = usage.rank ?? 0;

  // ---- hero card
  $("planName").textContent = plan === "trial" ? "Trial \u00B7 Growth limits" : plan;
  let meta = usage.repliesPerPost + " replies per post \u00B7 " + usage.postsAllowed + " posts per period";
  if (usage.passExpiresAt) meta += " \u00B7 expires " + fmtDate(usage.passExpiresAt);
  $("planMeta").textContent = meta;
  $("planDays").innerHTML = usage.daysLeft != null
    ? '<div class="n">' + usage.daysLeft + '</div><div class="l">day' + (usage.daysLeft === 1 ? "" : "s") + " left</div>"
    : '<div class="l">' + (plan === "trial" ? "trial active" : "free plan") + "</div>";
  $("periodSt").textContent = usage.postsUsed + " / " + usage.postsAllowed + " posts used";

  // ---- banners
  const bl = [];
  if (usage.passPlan && usage.daysLeft != null && usage.daysLeft <= 3 && usage.daysLeft > 0)
    bl.push(["warn", "\u23F3 " + usage.daysLeft + " day" + (usage.daysLeft === 1 ? "" : "s") + " left on your " + usage.passPlan + " pass \u2014 renew before it expires."]);
  if (usage.passPlan && usage.daysLeft === 0)
    bl.push(["bad", "\u26D4 Your pass expired \u2014 replies are paused on the free limits until you renew."]);
  const capped = (usage.posts || []).filter(p => p.used >= p.cap);
  if (capped.length)
    bl.push(["bad", "\uD83D\uDEAB Post " + esc(shortPost(capped[0].postId)) + " reached its limit (" + capped[0].cap + " replies). Add 100 replies to keep it replying."]);
  $("banners").innerHTML = bl.map(([cls, msg]) => '<div class="banner ' + cls + ' show"><span>' + msg + "</span></div>").join("");

  // ---- usage table
  $("usageSub").textContent = usage.posts && usage.posts.length
    ? usage.posts.length + " post" + (usage.posts.length === 1 ? "" : "s") + " active this period"
    : "";
  const body = $("usageBody");
  if (!usage.posts || !usage.posts.length) {
    body.innerHTML = '<tr><td colspan="4" class="dim">No posts have used replies this period.</td></tr>';
  } else {
    body.innerHTML = usage.posts.map((p) => {
      const pct = Math.min(100, Math.round((p.used / Math.max(1, p.cap)) * 100));
      const near = p.used >= p.cap * 0.8;
      const topup = (cfg.enabled && near)
        ? '<button class="pill light" style="padding:6px 12px;font-size:12px" onclick="buyTopup(\'' + esc(p.postId) + '\')">+' + cfg.topup.replies + " replies \u00B7 " + fmtPaise(cfg.topup.pricePaise) + "</button>" : "";
      return "<tr>"
        + "<td><code class=\"inline\">" + esc(shortPost(p.postId)) + "</code></td>"
        + "<td>" + p.used + " / " + p.cap + (p.extraReplies ? ' <span class="dim">(+' + p.extraReplies + " extra)</span>" : "") + "</td>"
        + '<td><div class="bar"><i class="' + (p.used >= p.cap ? "full" : "") + '" style="width:' + pct + '%"></i></div></td>'
        + "<td>" + topup + "</td>"
        + "</tr>";
    }).join("");
  }

  // ---- plan chooser: current plan (renew) + upgrades ONLY, never lower plans
  const panel = $("upgradePanel"), pick = $("planPick"), hint = $("billingHint");
  if (!cfg.enabled) {
    panel.style.display = "";
    $("upgradeTitle").textContent = "Plans";
    pick.innerHTML = "";
    hint.textContent = "Payments opening soon.";
  } else {
    const options = (cfg.plans || []).filter(p => p.id !== "free" && (p.rank ?? 0) >= curRank);
    if (!options.length) {
      panel.style.display = "none";   // already on the top plan
    } else {
      panel.style.display = "";
      $("upgradeTitle").textContent = curRank > 0 ? "Renew or upgrade" : "Choose a plan";
      pick.innerHTML = options.map((p) => {
        const cur = usage.passPlan === p.id;
        const label = p.rank > curRank ? "Upgrade" : (cur ? "Renew" : "Choose");
        return '<div class="planopt' + (cur ? " cur" : "") + '">'
          + '<div class="pname">' + p.id[0].toUpperCase() + p.id.slice(1) + (cur ? " \u00B7 current" : "") + "</div>"
          + '<div class="pprice">' + fmtPaise(p.pricePaise) + " <small>/ 30 days</small></div>"
          + '<div class="pdesc">' + p.repliesPerPost + " replies per post \u00B7 " + p.postsPerPeriod + " posts</div>"
          + '<button class="pill ' + (cur ? "light" : "dark") + '" onclick="buyPass(\'' + p.id + '\')">' + label + "</button>"
          + "</div>";
      }).join("");
      hint.innerHTML = 'All prices in INR. Passes never auto-renew. <a href="/terms" style="color:var(--acc-ink)">Refund policy</a>.';
    }
  }

  loadHistory();
}

async function loadHistory() {
  try {
    const h = await fetch("/api/billing/history").then(r => r.json());
    const rows = h.purchases || [];
    if (!rows.length) return;
    $("historyPanel").style.display = "";
    $("historyBody").innerHTML = rows.map((p) => "<tr>"
      + '<td class="dim">' + fmtDate(p.created_at) + "</td>"
      + "<td>" + (p.kind === "pass" ? (p.plan || "") + " pass" : "Top-up \u00B7 " + esc(shortPost(p.post_id))) + "</td>"
      + "<td>" + fmtPaise(p.amount_paise) + "</td>"
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
  if (!res.ok) return alert(j.error || "Could not create the order.");
  window.openCheckout(j);
}
async function buyTopup(postId) {
  const res = await fetch("/api/billing/order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "topup", postId }),
  });
  const j = await res.json();
  if (!res.ok) return alert(j.error || "Could not create the order.");
  window.openCheckout(j);
}

window.refreshBilling = load;   // called by billing.js after a mock payment
load();
setInterval(load, 30000);