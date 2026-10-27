// ReplyFlow — production server.
// Run: npm start   (or: node server.js)
//
// Persistence: SQLite at $DATABASE_PATH (default data/replyflow.db).
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
const allowedOrigin = (() => {
  try { return new URL(config.publicBaseUrl).origin; } catch { return ""; }
})();
app.use((req, res, next) => {
  if (allowedOrigin && ["POST", "PATCH", "DELETE", "PUT"].includes(req.method)) {
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
  message: { error: "Too many attempts — try again in a few minutes" },
});
const trackLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  trustProxy: 1,
  message: { error: "Too fast" },
});

// ---------------------------------------------------------------- pages
const pub = (f) => path.join(__dirname, "public", f);
app.get("/", (_req, res) => res.sendFile(pub("landing.html")));
app.get("/app", (_req, res) => res.sendFile(pub("index.html")));
app.get("/login", (_req, res) => res.sendFile(pub("auth.html")));
app.get("/signup", (_req, res) => res.sendFile(pub("auth.html")));
app.get("/admin", (_req, res) => res.sendFile(pub("admin.html")));
app.get("/privacy", (_req, res) => res.sendFile(pub("privacy.html")));
app.get("/terms", (_req, res) => res.sendFile(pub("terms.html")));
app.get("/data-deletion", (_req, res) => res.sendFile(pub("data-deletion.html")));

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
  "/data-deletion.html": "/data-deletion",
  "/404.html": "/", // never served by URL — only rendered by the 404 handler
};
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  const target = CANONICAL_REDIRECTS[req.path];
  if (target) return res.redirect(301, target);
  next();
});

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", index: false }));

// ---------------------------------------------------------------- api
app.use("/webhook", require("./src/routes/webhook")); // Meta verification + events (signed)
app.use("/auth", authLimiter, require("./src/routes/auth"));   // signup/login + Meta OAuth
app.use("/meta", require("./src/routes/meta"));                 // data-deletion / deauthorize
app.use("/api/demo", rateLimit({ // public landing demo (no Meta signature possible)
  windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, trustProxy: 1,
  message: { error: "Demo is busy — try again in a minute" },
}), require("./src/routes/demo"));                               // synthetic comment events
app.use("/api/rules", require("./src/routes/rules"));           // keyword rule CRUD
app.use("/api/stats", require("./src/routes/stats"));           // dashboard numbers
app.use("/api/admin", require("./src/routes/admin"));           // admin metrics
app.use("/track", trackLimiter, require("./src/routes/track")); // first-party analytics

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
  if (wantsHtml) return res.status(404).sendFile(pub("404.html"));
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
  logger.info({ port: config.port }, "ReplyFlow listening");
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
