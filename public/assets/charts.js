/* ReplyLo — shared hand-built SVG charts (no chart library, PROJECT.md §8).
 * Used by the dashboard summary card and /analytics. Rules:
 *  - viewBox + width:100% (responsive, no fixed pixel widths)
 *  - colors read from page CSS variables once (getComputedStyle), hex only as fallback
 *  - no inline event handlers (helmet CSP), listeners attached in JS
 *  - numbers/dates formatted ONLY through window.I18N (num/date)
 *  - every chart: role="img" + aria-label; trend/bars also keyboard-navigable
 *  - prefers-reduced-motion: no draw-in animation (we never animate by default)
 * All builders return a DOM node ready to append. */
(function () {
  "use strict";

  // ---------------------------------------------------------------- palette
  var COLORS = null;
  function colors() {
    if (COLORS) return COLORS;
    var cs = getComputedStyle(document.documentElement);
    var v = function (name, fallback) {
      var s = cs.getPropertyValue(name);
      return (s && s.trim()) || fallback;
    };
    COLORS = {
      acc: v("--acc", "#ff6b4a"),
      acc2: v("--acc2", "#ff9a5a"),
      ink: v("--ink", "#3d2c22"),
      soft: v("--soft", "#8a7466"),
      faint: v("--faint", "#b7a495"),
      line: v("--line", "#f2e7da"),
      line2: v("--line2", "#eadbc9"),
      card: v("--card", "#ffffff"),
      ok: v("--ok", "#16a34a"),
      bad: v("--bad", "#dc2626"),
      peach: v("--peach", "#fff1e6"),
    };
    return COLORS;
  }

  // ---------------------------------------------------------------- i18n
  function num(n) { return (window.I18N && window.I18N.num) ? window.I18N.num(n) : String(n); }
  function fmtDate(dayIso) { return (window.I18N && window.I18N.date) ? window.I18N.date(dayIso + "T00:00:00Z") : dayIso; }
  function t(key, vars) { return (window.I18N && window.I18N.t) ? window.I18N.t(key, vars) : key; }

  function el(name, attrs, text) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function div(cls, text) {
    var n = document.createElement("div");
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------------- tooltip
  // One shared floating tooltip per page; positioned near the hovered element.
  var tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = div("chart-tip");
      tipEl.setAttribute("role", "tooltip");
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(target, html) {
    var tp = tip();
    tp.innerHTML = html;
    tp.hidden = false;
    var r = target.getBoundingClientRect();
    var wrap = tp.parentElement.getBoundingClientRect();
    var left = r.left - wrap.left + r.width / 2;
    var top = r.top - wrap.top - tp.offsetHeight - 8;
    tp.style.left = Math.max(4, Math.min(left - tp.offsetWidth / 2, wrap.width - tp.offsetWidth - 4)) + "px";
    tp.style.top = Math.max(4, top) + "px";
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; }

  // ---------------------------------------------------------------- table toggle
  // Adds a "View as table" button that swaps the chart for a real <table>.
  function withTableToggle(chartNode, tableBuilder, labelKey) {
    var wrap = div("chart-wrap");
    wrap.appendChild(chartNode);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chart-table-btn";
    btn.textContent = t(labelKey || "analytics.chart.viewTable");
    btn.setAttribute("aria-expanded", "false");
    var table = null;
    btn.addEventListener("click", function () {
      if (!table) { table = tableBuilder(); table.hidden = true; wrap.appendChild(table); }
      var showTable = table.hidden;
      table.hidden = !showTable;
      chartNode.style.display = showTable ? "none" : "";
      btn.setAttribute("aria-expanded", String(showTable));
      btn.textContent = t(showTable ? "analytics.chart.viewChart" : "analytics.chart.viewTable");
    });
    wrap.appendChild(btn);
    return wrap;
  }

  function tableEl(headers, rows) {
    var tb = document.createElement("table");
    tb.className = "chart-table";
    tb.innerHTML = "<thead><tr>" + headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (r) {
        return "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody>";
    return tb;
  }

  function emptyState(msg) {
    var d = div("chart-empty");
    d.textContent = msg || t("analytics.noData");
    return d;
  }

  // ---------------------------------------------------------------- sparkline
  // Tiny inline trend for dashboard tiles. Non-interactive (the tile itself links).
  function sparkline(values, opts) {
    opts = opts || {};
    var w = 120, h = 34, pad = 2;
    var svg = el("svg", {
      viewBox: "0 0 " + w + " " + h, width: "100%", height: h, preserveAspectRatio: "none",
      role: "img", "aria-label": opts.ariaLabel || t("analytics.chart.sparkAria"),
      class: "chart-spark", focusable: "false",
    });
    var max = Math.max(1, Math.max.apply(null, values.concat([0])));
    var n = values.length;
    if (!n || max <= 0) {
      svg.appendChild(el("line", { x1: pad, y1: h - pad - 1, x2: w - pad, y2: h - pad - 1, stroke: colors().line2, "stroke-width": 2, "stroke-linecap": "round" }));
      return svg;
    }
    var pts = values.map(function (v, i) {
      var x = pad + (i / Math.max(1, n - 1)) * (w - 2 * pad);
      var y = h - pad - (v / max) * (h - 2 * pad);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var area = "M" + pts.join(" L") + " L" + (w - pad) + "," + (h - pad) + " L" + pad + "," + (h - pad) + " Z";
    svg.appendChild(el("path", { d: area, fill: colors().acc, opacity: "0.10" }));
    svg.appendChild(el("polyline", { points: pts.join(" "), fill: "none", stroke: colors().acc, "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
    return svg;
  }

  // ---------------------------------------------------------------- area/line
  // Current period solid + area; previous period dashed. Keyboard: focus the
  // svg, Left/Right move the crosshair, Home/End jump, tooltip follows.
  function areaLineChart(opts) {
    // opts: { days:[iso], values:[n], prevValues:[n], label, prevLabel, ariaLabel }
    var vals = opts.values || [], prev = opts.prevValues || [], days = opts.days || [];
    var hasAny = vals.some(function (v) { return v > 0; }) || prev.some(function (v) { return v > 0; });
    if (!days.length) return emptyState();
    if (!hasAny) return withTableToggle(emptyState(), function () {
      return tableEl([t("analytics.chart.colDay"), opts.label], days.map(function (d, i) { return [fmtDate(d), num(vals[i] || 0)]; }));
    });

    var w = 720, h = 260, padT = 14, padB = 30, padS = 40, padE = 12;
    var max = Math.max(1, Math.max.apply(null, vals.concat(prev).concat([0])));
    var n = days.length;
    var X = function (i) { return padS + (i / Math.max(1, n - 1)) * (w - padS - padE); };
    var Y = function (v) { return h - padB - (v / max) * (h - padT - padB); };

    var svg = el("svg", {
      viewBox: "0 0 " + w + " " + h, width: "100%", role: "img", tabindex: "0",
      class: "chart-area", "aria-label": opts.ariaLabel || opts.label,
    });

    // gridlines + y labels (4 steps)
    for (var g = 0; g <= 4; g++) {
      var gv = (max / 4) * g, gy = Y(gv);
      svg.appendChild(el("line", { x1: padS, y1: gy, x2: w - padE, y2: gy, stroke: colors().line, "stroke-width": 1 }));
      svg.appendChild(el("text", { x: padS - 6, y: gy + 4, "text-anchor": "end", class: "chart-ylab", fill: colors().faint }, num(Math.round(gv))));
    }

    var linePts = vals.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); });
    var areaD = "M" + linePts.join(" L") + " L" + X(n - 1).toFixed(1) + "," + Y(0) + " L" + X(0).toFixed(1) + "," + Y(0) + " Z";
    svg.appendChild(el("path", { d: areaD, fill: colors().acc, opacity: "0.12" }));
    if (prev.length && prev.some(function (v) { return v > 0; })) {
      svg.appendChild(el("polyline", {
        points: prev.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" "),
        fill: "none", stroke: colors().faint, "stroke-width": "2", "stroke-dasharray": "5 5", "stroke-linejoin": "round",
      }));
    }
    svg.appendChild(el("polyline", { points: linePts.join(" "), fill: "none", stroke: colors().acc, "stroke-width": "2.5", "stroke-linejoin": "round", "stroke-linecap": "round" }));

    // x labels: first, middle, last (avoid overlap on any locale)
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i) {
      svg.appendChild(el("text", { x: X(i), y: h - 8, "text-anchor": i === 0 ? "start" : (i === n - 1 ? "end" : "middle"), fill: colors().faint, class: "chart-xlab" }, fmtDate(days[i])));
    });

    // crosshair + focus dot
    var cross = el("line", { y1: padT, y2: h - padB, stroke: colors().line2, "stroke-width": 1.5, visibility: "hidden" });
    var dot = el("circle", { r: 4.5, fill: colors().card, stroke: colors().acc, "stroke-width": 2.5, visibility: "hidden" });
    svg.appendChild(cross); svg.appendChild(dot);

    var idx = -1;
    function paint(i) {
      idx = i;
      if (i < 0) { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); return; }
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(vals[i] || 0)); dot.setAttribute("visibility", "visible");
      var html = "<b>" + esc(fmtDate(days[i])) + "</b><br>" + esc(opts.label) + ": " + esc(num(vals[i] || 0));
      if (prev.length) html += "<br>" + esc(opts.prevLabel || "") + ": " + esc(num(prev[i] || 0));
      showTip(svg, html);
    }
    function fromEvent(ev) {
      var r = svg.getBoundingClientRect();
      var rel = (ev.clientX - r.left) / r.width * w;
      var i = Math.round((rel - padS) / ((w - padS - padE) / Math.max(1, n - 1)));
      return Math.max(0, Math.min(n - 1, i));
    }
    svg.addEventListener("mousemove", function (ev) { paint(fromEvent(ev)); });
    svg.addEventListener("mouseleave", function () { paint(-1); });
    svg.addEventListener("focus", function () { paint(n - 1); });
    svg.addEventListener("blur", function () { paint(-1); });
    svg.addEventListener("keydown", function (ev) {
      var i = idx < 0 ? n - 1 : idx;
      if (ev.key === "ArrowRight") i = Math.min(n - 1, i + 1);
      else if (ev.key === "ArrowLeft") i = Math.max(0, i - 1);
      else if (ev.key === "Home") i = 0;
      else if (ev.key === "End") i = n - 1;
      else return;
      ev.preventDefault();
      paint(i);
    });

    var table = function () {
      var headers = [t("analytics.chart.colDay"), opts.label];
      if (prev.length) headers.push(opts.prevLabel || "");
      return tableEl(headers, days.map(function (d, i) {
        var row = [fmtDate(d), num(vals[i] || 0)];
        if (prev.length) row.push(num(prev[i] || 0));
        return row;
      }));
    };
    return withTableToggle(svg, table);
  }

  // ---------------------------------------------------------------- bars
  // Horizontal bars: [{ label, value, secondary, secondaryLabel, href }]
  function horizontalBars(items, opts) {
    opts = opts || {};
    if (!items || !items.length) return emptyState(opts.emptyMsg);
    var max = Math.max(1, Math.max.apply(null, items.map(function (i) { return i.value || 0; })));
    var wrap = div("chart-bars");
    items.forEach(function (it) {
      var row = div("chart-bar-row");
      var lab = div("chart-bar-label");
      if (it.href) { var a = document.createElement("a"); a.href = it.href; a.textContent = it.label; lab.appendChild(a); }
      else lab.textContent = it.label;
      var track = div("chart-bar-track");
      var fill = div("chart-bar-fill");
      fill.style.width = Math.max(2, Math.round((it.value / max) * 100)) + "%";
      if (it.secondary != null) {
        var sec = div("chart-bar-secondary");
        sec.style.width = Math.max(1, Math.round((it.secondary / max) * 100)) + "%";
        track.appendChild(sec);
      }
      track.appendChild(fill);
      var val = div("chart-bar-value", num(it.value || 0) + (opts.suffix || ""));
      row.appendChild(lab); row.appendChild(track); row.appendChild(val);
      row.setAttribute("role", "img");
      row.setAttribute("aria-label", it.label + ": " + num(it.value || 0) + (it.secondary != null ? ", " + (it.secondaryLabel || "") + ": " + num(it.secondary) : ""));
      row.addEventListener("mouseenter", function () {
        var html = "<b>" + esc(it.label) + "</b><br>" + esc(opts.valueLabel || "") + ": " + esc(num(it.value || 0));
        if (it.secondary != null) html += "<br>" + esc(it.secondaryLabel || "") + ": " + esc(num(it.secondary));
        showTip(row, html);
      });
      row.addEventListener("mouseleave", hideTip);
      wrap.appendChild(row);
    });
    return withTableToggle(wrap, function () {
      var headers = [opts.labelHeader || t("analytics.chart.colItem"), opts.valueLabel || ""];
      var hasSec = items.some(function (i) { return i.secondary != null; });
      if (hasSec) headers.push(items[0].secondaryLabel || "");
      return tableEl(headers, items.map(function (i) {
        var r = [i.label, num(i.value || 0)];
        if (hasSec) r.push(num(i.secondary || 0));
        return r;
      }));
    });
  }

  // ---------------------------------------------------------------- funnel
  // stages: [{ stage, count, dropPct }] — dropPct is loss vs previous stage.
  function funnel(stages, opts) {
    opts = opts || {};
    var labels = opts.labels || {};
    var top = Math.max(1, stages.length ? stages[0].count : 1);
    var wrap = div("chart-funnel");
    stages.forEach(function (s, i) {
      var row = div("chart-funnel-row");
      var lab = div("chart-funnel-label", labels[s.stage] ? t(labels[s.stage]) : s.stage);
      var bar = div("chart-funnel-bar");
      bar.style.width = Math.max(3, Math.round((s.count / top) * 100)) + "%";
      bar.textContent = num(s.count);
      row.appendChild(lab); row.appendChild(bar);
      if (i > 0 && s.dropPct != null) {
        row.appendChild(div("chart-funnel-drop", t("analytics.funnel.drop", { pct: num(s.dropPct) })));
      }
      row.setAttribute("role", "img");
      row.setAttribute("aria-label", (labels[s.stage] ? t(labels[s.stage]) : s.stage) + ": " + num(s.count));
      wrap.appendChild(row);
    });
    return withTableToggle(wrap, function () {
      return tableEl([t("analytics.chart.colStage"), t("analytics.chart.colCount"), t("analytics.chart.colDrop")],
        stages.map(function (s) {
          return [labels[s.stage] ? t(labels[s.stage]) : s.stage, num(s.count), s.dropPct == null ? "—" : num(s.dropPct) + "%"];
        }));
    });
  }

  // ---------------------------------------------------------------- donut
  // parts: [{ key, label, value, color }]
  function donut(parts, opts) {
    opts = opts || {};
    var total = parts.reduce(function (a, p) { return a + p.value; }, 0);
    if (!total) return emptyState();
    var w = 220, h = 220, cx = w / 2, cy = h / 2, r = 80, sw = 30;
    var svg = el("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", role: "img", class: "chart-donut", "aria-label": opts.ariaLabel || t("analytics.chart.donutAria") });
    var C = 2 * Math.PI * r, off = 0;
    parts.forEach(function (p) {
      if (!p.value) return;
      var frac = p.value / total;
      var arc = el("circle", {
        cx: cx, cy: cy, r: r, fill: "none", stroke: p.color, "stroke-width": sw,
        "stroke-dasharray": (frac * C - 2) + " " + (C - frac * C + 2),
        "stroke-dashoffset": -off, transform: "rotate(-90 " + cx + " " + cy + ")",
      });
      arc.addEventListener("mouseenter", function () { showTip(svg, "<b>" + esc(p.label) + "</b><br>" + esc(num(p.value)) + " (" + esc(num(Math.round(frac * 1000) / 10)) + "%)"); });
      arc.addEventListener("mouseleave", hideTip);
      svg.appendChild(arc);
      off += frac * C;
    });
    svg.appendChild(el("text", { x: cx, y: cy - 4, "text-anchor": "middle", class: "chart-donut-total", fill: colors().ink }, num(total)));
    svg.appendChild(el("text", { x: cx, y: cy + 18, "text-anchor": "middle", class: "chart-donut-sub", fill: colors().soft }, opts.centerLabel || ""));

    var legend = div("chart-legend");
    parts.forEach(function (p) {
      var li = div("chart-legend-item");
      var dot = div("chart-legend-dot");
      dot.style.background = p.color;
      li.appendChild(dot);
      li.appendChild(div(null, p.label + " — " + num(p.value)));
      legend.appendChild(li);
    });
    var wrap = div("chart-donut-wrap");
    wrap.appendChild(svg); wrap.appendChild(legend);
    return withTableToggle(wrap, function () {
      return tableEl([t("analytics.chart.colStatus"), t("analytics.chart.colCount")],
        parts.map(function (p) { return [p.label, num(p.value)]; }));
    });
  }

  // ---------------------------------------------------------------- heatmap
  // grid: 7x24 numbers (weekday 0=Sunday x hour). labels: weekday names via opts.
  function heatmap(grid, opts) {
    opts = opts || {};
    var days = opts.dayLabels || [];
    var max = 0, sum = 0, best = { v: -1, d: 0, h: 0 };
    for (var d = 0; d < 7; d++) for (var hh = 0; hh < 24; hh++) {
      var v = grid[d][hh] || 0;
      if (v > max) max = v;
      sum += v;
      if (v > best.v) best = { v: v, d: d, h: hh };
    }
    if (!sum) return emptyState();
    var cell = 30, gap = 3, padL = 40, padT = 22;
    var w = padL + 24 * (cell + gap), h = padT + 7 * (cell + gap);
    var svg = el("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", role: "img", class: "chart-heat", "aria-label": opts.ariaLabel || t("analytics.chart.heatAria") });
    for (var hh2 = 0; hh2 < 24; hh2 += 3) {
      svg.appendChild(el("text", { x: padL + hh2 * (cell + gap) + cell / 2, y: padT - 8, "text-anchor": "middle", fill: colors().faint, class: "chart-xlab" }, num(hh2)));
    }
    for (var d2 = 0; d2 < 7; d2++) {
      svg.appendChild(el("text", { x: padL - 6, y: padT + d2 * (cell + gap) + cell / 2 + 4, "text-anchor": "end", fill: colors().faint, class: "chart-xlab" }, days[d2] || ""));
      for (var h2 = 0; h2 < 24; h2++) {
        var val = grid[d2][h2] || 0;
        var op = max ? 0.08 + 0.92 * (val / max) : 0.05;
        var rect = el("rect", {
          x: padL + h2 * (cell + gap), y: padT + d2 * (cell + gap), width: cell, height: cell, rx: 6,
          fill: colors().acc, opacity: val ? op : 0.05, tabindex: "0", class: "chart-heat-cell",
        });
        (function (dd, hh3, vv) {
          var label = (days[dd] || "") + " " + num(hh3) + ":00 — " + num(vv);
          rect.setAttribute("aria-label", label);
          rect.addEventListener("mouseenter", function () { showTip(rect, "<b>" + esc(label) + "</b>"); });
          rect.addEventListener("focus", function () { showTip(rect, "<b>" + esc(label) + "</b>"); });
          rect.addEventListener("mouseleave", hideTip);
          rect.addEventListener("blur", hideTip);
        })(d2, h2, val);
        svg.appendChild(rect);
      }
    }
    var out = div("chart-heat-wrap");
    out.appendChild(svg);
    if (best.v > 0) out.appendChild(div("chart-heat-best", t("analytics.heat.best", { day: days[best.d] || "", hour: num(best.h) + ":00" })));
    return out;
  }

  window.Charts = {
    sparkline: sparkline,
    areaLineChart: areaLineChart,
    horizontalBars: horizontalBars,
    funnel: funnel,
    donut: donut,
    heatmap: heatmap,
    _colors: colors,
  };
})();