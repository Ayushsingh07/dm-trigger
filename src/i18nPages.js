// ReplyLo — localized rendering of the public HTML pages.
// Reads each HTML file once per locale, replaces {{t:key}} / {{t:key|var=value}}
// tokens, sets <html lang>/dir, injects hreflang + canonical links and the
// locale's JSON (<script id="i18n">), then caches the result in memory.

const fs = require("fs");
const path = require("path");
const {
  SUPPORTED, DEFAULT, t, catalogJson,
  resolveLocale, rootRedirect, localeCookieHeader, formatCurrency,
} = require("./i18n");
const config = require("./config");

const PUB = path.join(__dirname, "..", "public");

/* Scripts that need a webfont beyond Inter. Linked only on pages rendered in
   those locales, so nobody else downloads them. The helmet CSP already allows
   fonts.googleapis.com (styleSrc) and fonts.gstatic.com (fontSrc). */
const LOCALE_FONT_LINK = {
  ja: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700;800&display=swap">',
  hi: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700;800&display=swap">',
  mr: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700;800&display=swap">',
  bn: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap">',
  ta: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;500;600;700;800&display=swap">',
  te: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;500;600;700;800&display=swap">',
  ko: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap">',
};

let baseOrigin = "https://replylo.fly.dev";
try { baseOrigin = new URL(config.publicBaseUrl).origin; } catch { /* default */ }

// page name -> { file, pathFor(locale) }
const PAGES = {
  landing: { file: "landing.html", path: (l) => (l === DEFAULT ? "/" : `/${l}`) },
  pricing: { file: "pricing.html", path: (l) => (l === DEFAULT ? "/pricing" : `/${l}/pricing`) },
  privacy: { file: "privacy.html", path: (l) => (l === DEFAULT ? "/privacy" : `/${l}/privacy`) },
  terms: { file: "terms.html", path: (l) => (l === DEFAULT ? "/terms" : `/${l}/terms`) },
  "data-deletion": { file: "data-deletion.html", path: (l) => (l === DEFAULT ? "/data-deletion" : `/${l}/data-deletion`) },
};

// raw HTML per page (read once)
const rawCache = new Map();
function rawHtml(page) {
  if (rawCache.has(page)) return rawCache.get(page);
  const html = fs.readFileSync(path.join(PUB, PAGES[page].file), "utf8");
  rawCache.set(page, html);
  return html;
}

// rendered HTML per "page:locale"
const renderCache = new Map();

function applyTokens(html, locale) {
  // {{money:199}} -> price formatted for this locale (₹ stays, grouping changes)
  html = html.replace(/\{\{money:(\d+(?:\.\d+)?)\}\}/g, (_m, v) =>
    escapeHtml(formatCurrency(Number(v), locale, "INR")));

  // {{t:some.key}} or {{t:some.key|var=value|var2=value2}}
  return html.replace(/\{\{t:([^}|]+)(?:\|([^}]*))?\}\}/g, (_m, key, paramStr) => {
    const vars = {};
    if (paramStr) {
      for (const pair of paramStr.split("|")) {
        const eq = pair.indexOf("=");
        if (eq > 0) vars[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
      }
    }
    // escape HTML-unsafe chars for values that land in attributes/text
    return escapeHtml(t(locale, key.trim(), vars));
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function headExtras(page, locale) {
  const lines = [];
  for (const loc of SUPPORTED) {
    const href = baseOrigin + PAGES[page].path(loc);
    lines.push(`<link rel="alternate" hreflang="${loc}" href="${href}" />`);
  }
  lines.push(`<link rel="alternate" hreflang="x-default" href="${baseOrigin + PAGES[page].path(DEFAULT)}" />`);
  lines.push(`<link rel="canonical" href="${baseOrigin + PAGES[page].path(locale)}" />`);
  return lines.join("\n");
}

function renderPage(page, locale) {
  const cacheKey = `${page}:${locale}`;
  const hit = renderCache.get(cacheKey);
  if (hit) return hit;

  let html = rawHtml(page);
  html = applyTokens(html, locale);

  // <html lang=".."> — all our locales are LTR, dir stays explicit
  html = html.replace(/<html([^>]*?)lang="[a-zA-Z-]*"/, `<html$1lang="${locale}" dir="ltr"`);

  // drop any existing canonical (we inject the localized one)
  html = html.replace(/<link rel="canonical"[^>]*\/?>\n?/g, "");

  const i18nJson = `<script type="application/json" id="i18n">${JSON.stringify({
    locale,
    strings: JSON.parse(catalogJson(locale)),
  })}</script>`;
  const fontLink = LOCALE_FONT_LINK[locale] ? `\n${LOCALE_FONT_LINK[locale]}` : "";
  const switcher = /data-lang-switcher/.test(html)
    ? '\n<script src="/assets/i18n.js"></script>\n<script src="/assets/lang-switcher.js" defer></script>' : "";

  html = html.replace("</head>", `${headExtras(page, locale)}${fontLink}\n${i18nJson}${switcher}\n</head>`);

  renderCache.set(cacheKey, html);
  return html;
}

// express handler factory: serves `page` in the request's resolved locale
function serve(page) {
  return (req, res) => {
    // logged-in user's saved lang is the 3rd priority, so attach the user here
    if (!req.user) {
      const { sessionUser, readCookie, COOKIE } = require("./auth");
      req.user = sessionUser(readCookie(req, COOKIE));
    }
    const locale = resolveLocale(req);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Vary", "Accept-Language, Cookie");
    res.send(renderPage(page, locale));
  };
}

/* App pages (dashboard, auth, admin, billing, 404) keep ONE canonical URL —
   they are behind a session and not indexable, so they get the same token
   replacement + #i18n injection but no hreflang/canonical alternates. */
const appRenderCache = new Map();

function renderAppPage(file, locale) {
  const cacheKey = `${file}:${locale}`;
  const hit = appRenderCache.get(cacheKey);
  if (hit) return hit;

  let html = fs.readFileSync(path.join(PUB, file), "utf8");
  html = applyTokens(html, locale);
  html = html.replace(/<html([^>]*?)lang="[a-zA-Z-]*"/, `<html$1lang="${locale}" dir="ltr"`);
  const i18nJson = `<script type="application/json" id="i18n">${JSON.stringify({
    locale,
    strings: JSON.parse(catalogJson(locale)),
  })}</script>`;
  // Pages whose own scripts call I18N.t() (or that host a language switcher)
  // get the helper loaded (blocking) in <head>, so window.I18N exists before
  // their inline body scripts run.
  const wantsI18N = /\bI18N\b/.test(html) || /data-lang-switcher/.test(html);
  const helper = wantsI18N ? '\n<script src="/assets/i18n.js"></script>' : "";
  // Pages with a [data-lang-switcher] placeholder get the shared dropdown.
  const switcher = /data-lang-switcher/.test(html) ? '\n<script src="/assets/lang-switcher.js" defer></script>' : "";
  const fontLink = LOCALE_FONT_LINK[locale] ? `\n${LOCALE_FONT_LINK[locale]}` : "";
  html = html.replace("</head>", `${fontLink}${i18nJson}${helper}${switcher}\n</head>`);

  appRenderCache.set(cacheKey, html);
  return html;
}

// express handler factory for an app page file, e.g. serveApp("index.html")
function serveApp(file, status) {
  return (req, res) => {
    if (!req.user) {
      const { sessionUser, readCookie, COOKIE } = require("./auth");
      req.user = sessionUser(readCookie(req, COOKIE));
    }
    const locale = resolveLocale(req);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Vary", "Accept-Language, Cookie");
    if (status) res.status(status);
    res.send(renderAppPage(file, locale));
  };
}

// Express middleware handling all localized public-page routes:
//  - "/" serves the landing page, or 302s to /<lang>/ for non-English visitors
//  - "/en/..." 301s to the canonical unprefixed URL
//  - "/<lang>" and "/<lang>/<page>" render the localized page
// Anything else calls next(). Never touches /health, /webhook, /billing/*,
// /meta/* or /api/* — those paths don't match and fall through.
const PAGE_BY_PATH = {
  "/": "landing",
  "/pricing": "pricing",
  "/privacy": "privacy",
  "/terms": "terms",
  "/data-deletion": "data-deletion",
};
const LOCALIZED_RE = new RegExp(
  "^/(" + SUPPORTED.filter((l) => l !== "en").join("|") + ")(/(?:pricing|privacy|terms|data-deletion))?/?$");

function localeRouting(req, res, next) {
  if (req.method !== "GET") return next();
  const path = (req.path.replace(/\/+$/, "") || "/");
  if (path === "/") {
    const target = rootRedirect(req);
    if (target) {
      res.append("Set-Cookie", localeCookieHeader(target, 365 * 86400));
      return res.redirect(302, `/${target}`);
    }
    return serve("landing")(req, res);
  }
  if (path === "/en" || path.startsWith("/en/")) {
    return res.redirect(301, path.slice(3) || "/");
  }
  const m = LOCALIZED_RE.exec(path);
  if (m) {
    // make the URL prefix the top priority for resolveLocale
    req.params = { ...req.params, lang: m[1] };
    return serve(PAGE_BY_PATH[m[2] || "/"])(req, res);
  }
  next();
}

module.exports = { PAGES, renderPage, serve, serveApp, renderAppPage, baseOrigin, localeRouting };
