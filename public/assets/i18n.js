/* ReplyLo — client i18n helper (no deps).
 * Reads the JSON injected by the server: <script type="application/json" id="i18n">
 * Exposes window.I18N = { locale, t(key, vars), pathFor(locale), switchTo(locale) }.
 * Loaded with `defer` BEFORE landing.js so React can use it. */
(function () {
  "use strict";

  var SUPPORTED = ["en", "es", "pt-BR", "fr", "de", "ja", "hi", "id", "bn", "ta", "te", "mr", "ko"];
  var NATIVE = {
    "en": "English", "es": "Español", "pt-BR": "Português", "fr": "Français",
    "de": "Deutsch", "ja": "日本語", "hi": "हिन्दী", "id": "Bahasa Indonesia",
    "bn": "বাংলা", "ta": "தமிழ்", "te": "తెలుగు", "mr": "मराठी", "ko": "한국어",
  };

  var data = { locale: "en", strings: {} };
  try {
    var el = document.getElementById("i18n");
    if (el) data = JSON.parse(el.textContent);
  } catch (e) { /* keep defaults */ }

  function lookup(key) {
    // The server injects a FLAT map whose keys contain dots ("landing.nav.how"),
    // so try the exact key first; nested traversal is only a fallback.
    var flat = data.strings ? data.strings[key] : null;
    if (typeof flat === "string" && flat !== "") return flat;
    var parts = key.split(".");
    var cur = data.strings;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return null;
      cur = cur[parts[i]];
    }
    return typeof cur === "string" && cur !== "" ? cur : null;
  }

  function t(key, vars) {
    var s = lookup(key);
    if (s == null) return key;
    return interpolate(s, vars);
  }

  /* Plural pick driven by Intl.PluralRules, never by hand-written "s".
   * tplural('dashboard.daysLeft', n, { count: n }) -> key.one | key.other.
   * Falls back to `other`, then to the plain key. */
  var pluralRules = {};
  function pluralCategory(count) {
    try {
      var loc = data.locale || "en";
      if (!pluralRules[loc]) pluralRules[loc] = new Intl.PluralRules(loc);
      return pluralRules[loc].select(count);
    } catch (e) {
      return count === 1 ? "one" : "other";
    }
  }
  function tplural(key, count, vars) {
    var merged = { count: count };
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) merged[k] = vars[k];
    var cat = pluralCategory(count);
    var s = lookup(key + "." + cat);
    if (s == null) s = lookup(key + ".other");
    if (s == null) s = lookup(key);
    if (s == null) return key;
    return interpolate(s, merged);
  }

  function interpolate(s, vars) {
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (_m, name) {
        return name in vars ? String(vars[name]) : "{" + name + "}";
      });
    }
    return s;
  }

  /* Number / currency / date formatting lives here so strings never embed
   * digits: t('x.left', { days: I18N.num(3) }) instead of "3 days". */
  function num(value) {
    try { return new Intl.NumberFormat(data.locale || "en").format(value); }
    catch (e) { return String(value); }
  }
  function money(value, currency) {
    try {
      // user's locale picks the digit grouping; INR still renders the ₹
      // symbol in every locale (Intl shows "₹1,999" / "1.999 ₹" etc.).
      return new Intl.NumberFormat(data.locale || "en-IN", {
        style: "currency", currency: currency || "INR", maximumFractionDigits: 0,
      }).format(value);
    } catch (e) { return String(value); }
  }
  function date(value) {
    try { return new Intl.DateTimeFormat(data.locale || "en", { dateStyle: "medium" }).format(new Date(value)); }
    catch (e) { return String(value); }
  }
  function time(value) {
    try { return new Intl.DateTimeFormat(data.locale || "en", { timeStyle: "medium" }).format(new Date(value)); }
    catch (e) { return String(value); }
  }

  // current path without a locale prefix
  function basePath() {
    var p = location.pathname;
    var m = p.match(/^\/(en|es|pt-BR|fr|de|ja|hi|id|bn|ta|te|mr|ko)(\/|$)/);
    if (!m) return p || "/";
    var rest = p.slice(("/" + m[1]).length);
    return rest === "" ? "/" : rest;
  }

  function pathFor(locale) {
    var base = basePath();
    if (locale === "en") return base;
    return ("/" + locale + (base === "/" ? "" : base)) || "/";
  }

  function switchTo(locale) {
    if (SUPPORTED.indexOf(locale) === -1) return;
    document.cookie = "rf_lang=" + encodeURIComponent(locale) +
      "; path=/; samesite=lax; max-age=" + 365 * 86400;
    // logged-in users also persist the choice on their profile (fire-and-forget)
    fetch("/api/me/lang", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: locale }),
      credentials: "same-origin",
    }).catch(function () {});
    location.href = pathFor(locale) + location.search + location.hash;
  }

  window.I18N = {
    locale: data.locale || "en",
    supported: SUPPORTED,
    nativeNames: NATIVE,
    t: t,
    tplural: tplural,
    num: num,
    money: money,
    date: date,
    time: time,
    pathFor: pathFor,
    switchTo: switchTo,
  };
})();
