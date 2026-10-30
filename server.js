// ReplyLo — production server.
// Run: npm start   (or: node server.js)
//
// Persistence: SQLite at $DATABASE_PATH (default data/replylo.db).
// Meta Graph calls run in DRY-RUN until .env is filled (see .env.example).

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("./src/config");
const store = require("./src/store");
const logger = require("./src/logger");
const { hashPassword } = require("./src/auth");
const { db } = require("./src/db");
const { migrateTokensAtRest, encryptionAvailable } = require("./src/crypto");
const jobs = require("./src/jobs");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind Fly's proxy: req.ip + protocol come from headers

// ---------------------------------------------------------------- security
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // Only remaining CDN after the asset build: Google Fonts (link + @import).
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Capture the raw body for webhook signature verification.
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Same-origin check: reject state-changing requests whose Origin header is
// present and does not match PUBLIC_BASE_URL (classic CSRF guard for a
// cookie-authenticated app). Requests without an Origin (curl, Meta servers)
// pass — they cannot be forged by a browser anyway.
// /webhook and /auth/* are exempt: they are driven by Meta's servers, whose
// Origin (if any) can never match ours.
const allowedOrigin = (() => {
  try { return new URL(config.publicBaseUrl).origin; } catch { return ""; }
})();
const isMetaDriven = (path) => path === "/webhook" || path === "/auth" || path.startsWith("/auth/");
app.use((req, res, next) => {
  if (allowedOrigin && !isMetaDriven(req.path) && ["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== allowedOrigin) {
      logger.warn({ origin, path: req.path }, "[csrf] rejected cross-origin write");
      return res.status(403).json({ error: "Cross-origin request rejected" });
    }
  }
  next();
});

// Rate limits (per IP). /webhook is deliberately NOT limited — Meta retries
// and bursts are normal there.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  trustProxy: 1,
  // GET /auth/me is a harmless "who am I" read that the billing UI polls after
  // a payment (2s x 15); it must not eat the login/signup brute-force budget.
  skip: (req) => req.method === "GET" && req.path === "/me",
  message: { error: "Too many attempts — try again in a few minutes" },
});
const trackLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  trustProxy: 1,
  message: { error: "Too fast" },
});

// ---------------------------------------------------------------- pages
const pub = (f) => path.join(__dirname, "public", f);
const i18n = require("./src/i18n");
const i18nPages = require("./src/i18nPages");

// Localized public pages. English is unprefixed (canonical); the other
// supported locales live under /<lang>/... . Redirect /en/... to the
// canonical unprefixed URL, and "/" to /<lang>/ when the visitor's
// Accept-Language prefers a non-English locale and no rf_lang cookie exists.
// (localeRouting never matches /health, /webhook, /billing/*, /meta/*, /api/*.)
app.use(i18nPages.localeRouting);

/* App pages: one canonical URL each (session-gated, not indexable), but still
   rendered through the i18n pipeline so their strings localize. */
app.get("/app", i18nPages.serveApp("index.html"));
app.get("/login", i18nPages.serveApp("auth.html"));
app.get("/signup", i18nPages.serveApp("auth.html"));
app.get("/admin", i18nPages.serveApp("admin.html"));
app.get("/billing", i18nPages.serveApp("billing.html"));
// English canonical pages, rendered through the same i18n pipeline
app.get("/pricing", i18nPages.serve("pricing"));
app.get("/privacy", i18nPages.serve("privacy"));
app.get("/terms", i18nPages.serve("terms"));
app.get("/data-deletion", i18nPages.serve("data-deletion"));

// Clean URLs. The .html files are an implementation detail; every page has a
// canonical extensionless route. Redirect direct .html hits (and the old
// /landing alias) so analytics and search engines only ever see one URL.
const CANONICAL_REDIRECTS = {
  "/landing": "/",
  "/landing.html": "/",
  "/index.html": "/app",
  "/auth.html": "/login",
  "/admin.html": "/admin",
  "/privacy.html": "/privacy",
  "/terms.html": "/terms",
  "/pricing.html": "/pricing",
  "/billing.html": "/billing",
  "/data-deletion.html": "/data-deletion",
  "/404.html": "/", // never served by URL — only rendered by the 404 handler
};
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  const target = CANONICAL_REDIRECTS[req.path];
  if (target) return res.redirect(301, target);
  next();
});

/* Localized sitemap: every public page x every locale, with xhtml:link
   alternates. Served dynamically so it can never drift from the locale list;
   the old static file is removed. */
app.get("/sitemap.xml", (_req, res) => {
  const pages = Object.keys(i18nPages.PAGES);
  const urls = [];
  for (const page of pages) {
    for (const loc of i18n.SUPPORTED) {
      const alts = [];
      for (const alt of i18n.SUPPORTED) {
        alts.push(`    <xhtml:link rel="alternate" hreflang="${alt}" href="${i18nPages.baseOrigin}${i18nPages.PAGES[page].path(alt)}" />`);
      }
      alts.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${i18nPages.baseOrigin}${i18nPages.PAGES[page].path(i18n.DEFAULT)}" />`);
      urls.push(`  <url>\n    <loc>${i18nPages.baseOrigin}${i18nPages.PAGES[page].path(loc)}</loc>\n${alts.join("\n")}\n  </url>`);
    }
  }
  res.type("application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`);
});

/* Landing photos: cached a full day (no immutable — files get replaced under
   the same name). Everything else under /public stays at 1h. */
app.use("/assets/img", express.static(path.join(__dirname, "public", "assets", "img"), { maxAge: "1d" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", index: false }));

// ---------------------------------------------------------------- api
const billingRoutes = require("./src/routes/billing");
app.use("/webhook", require("./src/routes/webhook")); // Meta verification + events (signed)
app.use("/billing/webhook", billingRoutes.webhookRouter); // payment provider callbacks (signed)
app.use("/auth", authLimiter, require("./src/routes/auth"));   // signup/login + Meta OAuth
app.use("/meta", require("./src/routes/meta"));                 // data-deletion / deauthorize
app.use("/api/billing", billingRoutes);                         // plans, orders, mock-pay
app.use("/api/demo", rateLimit({ // public landing demo (no Meta signature possible)
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, trustProxy: 1,
  message: { error: "Demo is busy — try again in a minute" },
}), require("./src/routes/demo"));                               // synthetic comment events
app.use("/api/rules", require("./src/routes/rules"));           // keyword rule CRUD
app.use("/api/flows", require("./src/routes/flows"));           // step-builder DM automations
app.use("/api/audience", require("./src/routes/audience"));     // subscribers + broadcasts
app.use("/api/fan", require("./src/routes/fan"));               // fan mode (loyalty)
app.use("/api/stats", require("./src/routes/stats"));           // dashboard numbers
app.use("/api/analytics", require("./src/routes/analytics"));   // advanced analytics (Pro)
app.use("/go", require("./src/routes/go"));                     // DM link click-tracking redirects
app.use("/api/admin", require("./src/routes/admin"));           // admin metrics
app.use("/track", trackLimiter, require("./src/routes/track")); // first-party analytics

// Language preference. Works logged-in (saves users.lang) and anonymous
// (cookie only). Always refreshes the cookie so the switcher sticks.
app.post("/api/me/lang", (req, res) => {
  const { attachUser } = require("./src/auth");
  attachUser(req, res, () => {
    const lang = i18n.normalizeLocale(req.body && req.body.lang);
    if (!lang) return res.status(400).json({ error: "Unsupported language" });
    if (req.user) store.setUserLang(req.user.id, lang);
    res.append("Set-Cookie", i18n.localeCookieHeader(lang, 365 * 86400));
    res.json({ ok: true, lang });
  });
});

// Health check for the platform (Fly) — cheap DB round-trip.
app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1 AS ok").get();
    res.json({ ok: true, mode: config.metaConfigured ? "live" : "dry-run" });
  } catch (_err) {
    res.status(503).json({ ok: false, error: "database unavailable" });
  }
});

// Health / status.
app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    metaConfigured: config.metaConfigured,
    mode: config.metaConfigured ? "live" : "dry-run",
    graphApiBase: config.graphApiBase || "(empty)",
    redirectUri: config.metaRedirectUri || "(empty)",
    accountsConnected: store.listAccounts().length,
  });
});

// Anything not matched above: a real 404. Browsers get the branded page,
// API/JSON clients get JSON. Never fall through to a bare "Cannot GET".
app.use((req, res) => {
  const wantsHtml = String(req.headers.accept || "").includes("text/html");
  if (wantsHtml) return i18nPages.serveApp("404.html", 404)(req, res);
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------- bootstrap
// 1) Seed the admin account from env (ADMIN_EMAIL / ADMIN_PASSWORD).
//    ADMIN_PASSWORD is only needed the first time — once the admin exists,
//    the env vars may be removed.
function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email) return;
  if (store.getUserByEmail(email)) return; // already exists — env is optional now
  if (!password) {
    logger.warn("ADMIN_EMAIL set but ADMIN_PASSWORD missing — no admin account created.");
    return;
  }
  store.createUser({ email, passwordHash: hashPassword(password), name: "Admin", role: "admin", plan: "pro", status: "active" });
  logger.info({ email }, "[bootstrap] admin account created");
}

// 2) Seed demo rules under account "demo" so the public demo works on first launch.
function seedDemo() {
  if (store.rulesForAccount("demo").length > 0) return;
  store.createRule({
    accountId: "demo", keyword: "GUIDE",
    dmText: "Hey {name}! 👋 Here's the free editing guide you asked for.",
    links: [{ title: "Get the guide", url: "https://example.com/guide" }],
  });
  store.createRule({
    accountId: "demo", keyword: "PRICE",
    dmText: "Hi {name}! Our full price list is here 👇",
  });
}

bootstrapAdmin();
seedDemo();

// 3) One-time migration: encrypt any plaintext tokens stored before at-rest
//    encryption existed. Idempotent — safe on every boot.
const mig = migrateTokensAtRest(db);
if (mig.skipped) {
  logger.warn("TOKEN_ENC_KEY not configured — stored tokens remain unencrypted");
} else if (mig.migrated > 0) {
  logger.info({ migrated: mig.migrated }, "[migration] encrypted stored access tokens");
}

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "ReplyLo listening");
  logger.info({ mode: config.metaConfigured ? "live" : "dry-run", encryptedTokens: encryptionAvailable() }, "startup");
  jobs.startJobs();
});

// ---------------------------------------------------------------- graceful shutdown
// SIGTERM/SIGINT: stop accepting new connections, let in-flight requests
// finish (10s cap), stop background jobs, close the DB.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  jobs.stopJobs();
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    logger.info("shutdown complete");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("forced shutdown after 10s drain");
    try { db.close(); } catch { /* ignore */ }
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
