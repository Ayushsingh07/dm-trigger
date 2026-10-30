// ReplyLo — internationalization. No external deps.
// Locale resolution order: URL prefix > rf_lang cookie > users.lang > Accept-Language > 'en'.

const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const { PLANS, TOPUP } = require("./pricing");

const log = logger.child({ module: "i18n" });

const SUPPORTED = ["en", "es", "pt-BR", "fr", "de", "ja", "hi", "id", "bn", "ta", "te", "mr", "ko"];
const DEFAULT = "en";
const COOKIE = "rf_lang";

const LOCALE_DIR = path.join(__dirname, "..", "locales");

// ------------------------------------------------------------------ catalog
// Plan numbers live only in pricing.js; locale files carry {placeholders}.
const PLAN_VARS = {
  starter: PLANS.starter.repliesPerPost,
  growth: PLANS.growth.repliesPerPost,
  pro: PLANS.pro.repliesPerPost,
  freeReplies: PLANS.free.repliesPerPost,
  freePosts: PLANS.free.postsPerPeriod,
  growthReplies: PLANS.growth.repliesPerPost,
  topup: TOPUP.replies,
};

const catalogs = {}; // locale -> flat { key: string }
function loadCatalog(locale) {
  if (catalogs[locale]) return catalogs[locale];
  let flat = {};
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, `${locale}.json`), "utf8"));
    flat = flatten(raw);
    for (const [k, v] of Object.entries(flat)) flat[k] = interpolate(v, PLAN_VARS);
  } catch (err) {
    log.warn({ locale, err: err.message }, "locale file missing or invalid");
  }
  catalogs[locale] = flat;
  return flat;
}
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    // untranslated entries (empty string) are skipped so t() falls back to en
    else if (v !== "" && v != null) out[key] = String(v);
  }
  return out;
}
function catalogJson(locale) {
  // English as the base so the client always has a complete string set
  const merged = locale === DEFAULT ? loadCatalog(DEFAULT) : { ...loadCatalog(DEFAULT), ...loadCatalog(locale) };
  return JSON.stringify(merged);
}

// ------------------------------------------------------------------ lookup
function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_m, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

const missingSeen = new Set();

// ICU plural categories we ship: only `one` and `other`. A locale that needs
// more (few/many) can add the extra key later; selection stays Intl-driven.
const pluralRulesCache = {};
function pluralCategory(locale, count) {
  try {
    const pr = pluralRulesCache[locale] || (pluralRulesCache[locale] = new Intl.PluralRules(locale));
    return pr.select(count);
  } catch {
    return count === 1 ? "one" : "other";
  }
}

// tplural(locale, "dashboard.daysLeft", n, { count: n }) -> picks key.one / key.other
// via Intl.PluralRules, falling back to `other`, then English, then the key.
function tplural(locale, key, count, vars) {
  const merged = { count, ...(vars || {}) };
  const cat = pluralCategory(locale, count);
  for (const loc of [locale, DEFAULT]) {
    if (!SUPPORTED.includes(loc)) continue;
    const catalog = loadCatalog(loc);
    const pick = catalog[`${key}.${cat}`] ?? catalog[`${key}.other`];
    if (pick != null) return interpolate(pick, merged);
  }
  if (!missingSeen.add(`${locale}:${key}(${cat})`)) {
    log.debug({ locale, key, cat }, "missing plural key, returned key");
  }
  return key;
}

function t(locale, key, vars) {
  const loc = SUPPORTED.includes(locale) ? locale : DEFAULT;
  const catalog = loadCatalog(loc);
  if (key in catalog) return interpolate(catalog[key], vars);
  const en = loadCatalog(DEFAULT);
  if (key in en) {
    if (!missingSeen.has(`${loc}:${key}`)) {
      missingSeen.add(`${loc}:${key}`);
      log.debug({ locale: loc, key }, "missing translation key, fell back to en");
    }
    return interpolate(en[key], vars);
  }
  if (!missingSeen.has(`${loc}:${key}`)) {
    missingSeen.add(`${loc}:${key}`);
    log.debug({ locale: loc, key }, "missing translation key, returned key");
  }
  return key;
}

// ------------------------------------------------------------------ resolve
function normalizeLocale(tag) {
  if (!tag) return null;
  const s = String(tag).trim().replace(/_/g, "-");
  const lower = s.toLowerCase();
  for (const sup of SUPPORTED) {
    const sl = sup.toLowerCase();
    if (lower === sl) return sup; // exact (case-insensitive) match, e.g. pt-br -> pt-BR
  }
  for (const sup of SUPPORTED) {
    const base = sup.toLowerCase().split("-")[0];
    if (lower === base) {
      // bare base language -> the full supported variant (es -> es, pt -> pt-BR)
      return SUPPORTED.find((s2) => s2.toLowerCase() === sup.toLowerCase());
    }
  }
  return null;
}

// parse "en;q=0.9,pt-BR;q=0.8,hi" into [{tag, q}] sorted by q desc, then original order
function parseAcceptLanguage(header) {
  if (!header) return [];
  const parts = String(header).split(",").map((p) => p.trim()).filter(Boolean);
  const out = [];
  parts.forEach((part, i) => {
    const [tag, ...params] = part.split(";");
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = parseFloat(m[1]);
    }
    if (!Number.isFinite(q)) q = 0;
    out.push({ tag: tag.trim(), q, order: i });
  });
  return out.sort((a, b) => b.q - a.q || a.order - b.order);
}

function fromAcceptLanguage(header) {
  for (const { tag, q } of parseAcceptLanguage(header)) {
    if (q <= 0 || tag === "*") continue;
    const exact = normalizeLocale(tag);
    if (exact) return exact;
    const base = String(tag).split("-")[0].toLowerCase();
    const byBase = SUPPORTED.find((s) => s.toLowerCase().split("-")[0] === base);
    if (byBase) return byBase; // pt-PT -> pt-BR, en-GB -> en
  }
  return null;
}

function readCookie(req, name) {
  const raw = req.headers && req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// req may carry: params.lang (URL prefix), user (attached by auth middleware)
function resolveLocale(req) {
  const fromUrl = normalizeLocale(req.params && req.params.lang);
  if (fromUrl) return fromUrl;
  const fromCookie = normalizeLocale(readCookie(req, COOKIE));
  if (fromCookie) return fromCookie;
  if (req.user && req.user.lang) {
    const fromUser = normalizeLocale(req.user.lang);
    if (fromUser) return fromUser;
  }
  const fromHeader = fromAcceptLanguage(req.headers && req.headers["accept-language"]);
  if (fromHeader) return fromHeader;
  return DEFAULT;
}

// For "/" with no lang cookie: 302 to /<lang>/ when the Accept-Language best
// match is a supported non-English locale. No header / no match -> English.
function rootRedirect(req) {
  if (readCookie(req, COOKIE)) return null;
  const best = fromAcceptLanguage(req.headers && req.headers["accept-language"]);
  return best && best !== DEFAULT ? best : null;
}

// ------------------------------------------------------------------ cookies
function localeCookieHeader(value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secure}; Max-Age=${maxAgeSeconds}`;
}

// ------------------------------------------------------------------ formatters
function formatCurrency(value, locale, currency = "INR", opts) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0, ...opts }).format(value);
  } catch {
    return new Intl.NumberFormat(DEFAULT, { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
  }
}
function formatDate(date, locale, opts) {
  try {
    return new Intl.DateTimeFormat(locale, opts || { dateStyle: "medium" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT, { dateStyle: "medium" }).format(date);
  }
}
function formatNumber(value, locale) {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return new Intl.NumberFormat(DEFAULT).format(value);
  }
}

module.exports = {
  SUPPORTED, DEFAULT, COOKIE,
  normalizeLocale, parseAcceptLanguage, fromAcceptLanguage,
  resolveLocale, rootRedirect, t, tplural, pluralCategory, catalogJson, localeCookieHeader,
  formatCurrency, formatDate, formatNumber,
};
