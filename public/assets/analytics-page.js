/* /analytics page — fetches /api/analytics and renders with window.Charts. */
(function () {
  "use strict";
  const T = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const N = (n) => (window.I18N ? window.I18N.num(n) : String(n));
  const $ = (id) => document.getElementById(id);

  const METRICS = [
    ["comments", "analytics.kComments", "comments", "prevComments"],
    ["matches", "analytics.kMatched", "matches", "prevMatches"],
    ["reached", "analytics.kReached", "dms", "prevDms"],
    ["clicks", "analytics.kClicks", "clicks", "prevClicks"],
    ["conversions", "analytics.kConversions", "conversions", "prevConversions"],
  ];
  const KPI_TILES = [
    ["comments", "analytics.kComments", ""], ["matches", "analytics.kMatched", ""],
    ["reached", "analytics.kReached", ""], ["delivered", "analytics.kDelivered", ""],
    ["clicks", "analytics.kClicks", ""], ["uniqueVisitors", "analytics.kVisitors", ""],
    ["ctrPct", "analytics.kCtr", "pct"], ["conversionPct", "analytics.kConv", "pct"],
  ];
  const FUNNEL_LABELS = {
    comments: "analytics.funnel.comments", matches: "analytics.funnel.matches",
    dms: "analytics.funnel.dms", clicks: "analytics.funnel.clicks", conversions: "analytics.funnel.conversions",
  };
  const STATUS_LABELS = {
    sent: "analytics.status.sent", replied: "analytics.status.replied",
    clicked: "analytics.status.clicked", email_collected: "analytics.status.email",
  };
  const STATUS_COLORS = { sent: "#f59e0b", replied: "#ff6b4a", clicked: "#16a34a", email_collected: "#8b5cf6" };

  let days = 7;
  let lastData = null;

  function fmt(v, kind) { return kind === "pct" ? N(v || 0) + "%" : N(v || 0); }

  function renderKpis(kpis) {
    const wrap = $("anaKpis");
    wrap.innerHTML = "";
    KPI_TILES.forEach(([key, labelKey, kind]) => {
      const m = kpis[key] || {};
      const d = document.createElement("div");
      d.className = "ana-kpi";
      d.id = "metric-" + key;
      const label = document.createElement("div");
      label.className = "ana-kpi-label";
      label.textContent = T(labelKey);
      const value = document.createElement("div");
      value.className = "ana-kpi-value";
      value.textContent = fmt(m.total, kind);
      d.append(label, value);
      const chip = document.createElement("div");
      if (m.deltaPct === null || m.deltaPct === undefined) {
        chip.className = "ana-kpi-delta flat";
        chip.textContent = T("analytics.noPrev");
      } else {
        const up = m.deltaPct > 0, flat = m.deltaPct === 0;
        chip.className = "ana-kpi-delta " + (flat ? "flat" : up ? "up" : "down");
        chip.textContent = (flat ? "→" : up ? "↑" : "↓") + " " + N(Math.abs(m.deltaPct)) + "%";
      }
      d.appendChild(chip);
      wrap.appendChild(d);
    });
  }

  function metricOptions() {
    const sel = $("anaMetric");
    if (sel.options.length) return;
    METRICS.forEach(([key, labelKey]) => {
      const o = document.createElement("option");
      o.value = key;
      o.textContent = T(labelKey);
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => renderTrend());
  }

  function renderTrend() {
    if (!lastData) return;
    const key = $("anaMetric").value || "comments";
    const def = METRICS.find((m) => m[0] === key);
    const label = T(def[1]);
    $("anaTrend").innerHTML = "";
    $("anaTrend").appendChild(Charts.areaLineChart({
      days: lastData.daily.map((d) => d.day),
      values: lastData.daily.map((d) => d[def[2]] || 0),
      prevValues: lastData.daily.map((d) => d[def[3]] || 0),
      label,
      prevLabel: T("analytics.prevPeriod"),
      ariaLabel: label + " — " + T("analytics.trendTitle"),
    }));
    document.querySelector(".ana-legend .lg-cur").textContent = label;
    document.querySelector(".ana-legend .lg-prev").textContent = T("analytics.prevPeriod");
  }

  function renderFunnel(funnel) {
    $("anaFunnel").innerHTML = "";
    $("anaFunnel").appendChild(Charts.funnel(funnel, { labels: FUNNEL_LABELS }));
  }

  function renderHeat(hourly) {
    $("anaHeat").innerHTML = "";
    $("anaHeat").appendChild(Charts.heatmap(hourly, {
      dayLabels: [0, 1, 2, 3, 4, 5, 6].map((i) => T("analytics.weekday." + i)),
      ariaLabel: T("analytics.heatTitle"),
    }));
  }

  function renderDonut(sb) {
    $("anaDonut").innerHTML = "";
    const parts = Object.keys(STATUS_LABELS)
      .filter((k) => sb[k] > 0)
      .map((k) => ({ key: k, label: T(STATUS_LABELS[k]), value: sb[k], color: STATUS_COLORS[k] }));
    $("anaDonut").appendChild(Charts.donut(parts, { centerLabel: T("analytics.kReached"), ariaLabel: T("analytics.statusTitle") }));
  }

  function renderKeywords(rows) {
    const el = $("anaKeywords");
    if (!rows.length) { el.innerHTML = `<div class="chart-empty">${T("analytics.noData")}</div>`; return; }
    const max = Math.max(1, ...rows.map((r) => r.dms));
    el.innerHTML = `<table><thead><tr>
      <th>${T("analytics.cKeyword")}</th><th>${T("analytics.kReached")}</th>
      <th class="ana-bar-cell">${T("analytics.share")}</th>
      <th>${T("analytics.kClicks")}</th><th>${T("analytics.kCtr")}</th></tr></thead><tbody>` +
      rows.map((r) => `<tr>
        <td class="kw">${escapeHtml(r.keyword)}</td>
        <td class="ana-num">${N(r.dms)}</td>
        <td class="ana-bar-cell"><div class="ana-mini-bar"><div style="width:${Math.max(2, Math.round((r.dms / max) * 100))}%"></div></div></td>
        <td class="ana-num">${N(r.clicks)}</td>
        <td class="ana-num">${N(r.ctrPct)}%</td></tr>`).join("") + "</tbody></table>";
  }

  function renderPosts(rows) {
    const el = $("anaPosts");
    if (!rows.length) { el.innerHTML = `<div class="chart-empty">${T("analytics.noData")}</div>`; return; }
    el.innerHTML = `<table><thead><tr>
      <th>${T("analytics.cPost")}</th><th>${T("analytics.cMatched")}</th>
      <th>${T("analytics.cUsed")}</th><th class="ana-bar-cell">${T("analytics.cCap")}</th></tr></thead><tbody>` +
      rows.map((r) => {
        const pct = r.cap ? Math.min(100, Math.round((r.used / r.cap) * 100)) : 0;
        const over = r.cap && r.used >= r.cap;
        return `<tr>
          <td class="dim">${escapeHtml(r.postId)}</td>
          <td class="ana-num">${N(r.matches)}</td>
          <td class="ana-num">${N(r.used)} / ${N(r.cap)}</td>
          <td class="ana-bar-cell"><div class="ana-mini-bar${over ? " over" : ""}"><div style="width:${Math.max(2, pct)}%"></div></div></td></tr>`;
      }).join("") + "</tbody></table>";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function flashTarget() {
    const hash = location.hash || "";
    if (!hash.startsWith("#metric-")) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  }

  async function load() {
    let r;
    try {
      const tz = -new Date().getTimezoneOffset();
      r = await fetch(`/api/analytics?days=${days}&tz=${tz}`, { credentials: "same-origin" });
    } catch { return; }
    if (r.status === 401) { location.href = "/login?next=/analytics"; return; }
    const data = await r.json().catch(() => ({}));
    if (r.status === 402 || data.error === "analytics_pro_only") {
      $("anaLocked").style.display = "";
      $("anaMain").style.display = "none";
      return;
    }
    if (!r.ok || data.error) return;
    lastData = data;
    $("anaLocked").style.display = "none";
    $("anaMain").style.display = "";
    renderKpis(data.kpis || {});
    metricOptions();
    renderTrend();
    renderFunnel(data.funnel || []);
    renderHeat(data.hourly || Array.from({ length: 7 }, () => new Array(24).fill(0)));
    renderDonut(data.statusBreakdown || {});
    renderKeywords(data.topKeywords || []);
    renderPosts(data.topPosts || []);
    $("anaUpdated").textContent = T("analytics.updated", { time: window.I18N ? I18N.time(new Date().toISOString()) : new Date().toLocaleTimeString() });
    flashTarget();
  }

  document.querySelectorAll(".ana-ranges .chip-btn").forEach((b) => {
    b.addEventListener("click", () => {
      days = Number(b.dataset.days);
      document.querySelectorAll(".ana-ranges .chip-btn").forEach((x) => x.classList.toggle("on", x === b));
      const url = new URL(location.href);
      url.searchParams.set("days", String(days));
      history.replaceState(null, "", url);
      load();
    });
  });
  window.addEventListener("hashchange", flashTarget);

  // initial range from ?days= (7/30/90 only)
  const q = Number(new URLSearchParams(location.search).get("days"));
  if ([7, 30, 90].includes(q)) {
    days = q;
    document.querySelectorAll(".ana-ranges .chip-btn").forEach((x) => x.classList.toggle("on", Number(x.dataset.days) === days));
  }
  load();
})();
