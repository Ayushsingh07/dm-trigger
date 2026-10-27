// ReplyFlow — app auth (signup/login/logout/me) + Meta OAuth connect flow.
// App sessions are first-party (cookie + SQLite); Meta OAuth runs behind login.
const express = require("express");
const store = require("../store");
const meta = require("../meta");
const config = require("../config");
const {
  hashPassword, verifyPassword, createSession, destroySession,
  attachUser, requireUser, setSessionCookie, clearSessionCookie, looksLikeEmail,
} = require("../auth");

const router = express.Router();
router.use(attachUser);

// ---------------------------------------------------------------- app auth
const MIN_PASSWORD_LEN = 10;

// Fixed dummy hash so a login for an unknown email still costs one scrypt
// run — the response time doesn't leak whether the account exists.
const DUMMY_HASH = hashPassword("replyflow-timing-pad-0000");

// POST /auth/signup { email, password, name? }
router.post("/signup", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").slice(0, 60);
  if (!looksLikeEmail(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (password.length < MIN_PASSWORD_LEN) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters` });
  if (store.getUserByEmail(email)) return res.status(409).json({ error: "That email is already registered" });

  const user = store.createUser({ email, passwordHash: hashPassword(password), name });
  store.trackEvent("signup", user.id, { name });
  setSessionCookie(res, createSession(user.id));
  res.status(201).json({ id: user.id, email: user.email, role: user.role, plan: user.plan });
});

// POST /auth/login { email, password }
router.post("/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = store.getUserByEmail(email);
  // Always run exactly one scrypt verify, and return one identical message,
  // so failures are constant-time and don't reveal account existence.
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: "Wrong email or password" });
  }
  store.trackEvent("login", user.id);
  setSessionCookie(res, createSession(user.id));
  res.json({ id: user.id, email: user.email, role: user.role, plan: user.plan });
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  destroySession(require("../auth").readCookie(req, require("../auth").COOKIE));
  clearSessionCookie(res);
  res.sendStatus(204);
});

// GET /auth/me — who am I (null when signed out)
router.get("/me", (req, res) => {
  const u = req.user;
  if (!u) return res.json({ user: null });
  res.json({
    user: {
      id: u.id, email: u.email, name: u.name, role: u.role,
      plan: u.plan, status: u.status, trialEndsAt: u.trial_ends_at,
    },
  });
});

// ---------------------------------------------------------------- Meta OAuth
// GET /auth/connect — start Meta OAuth for the signed-in user.
router.get("/connect", requireUser, (req, res) => {
  const state = store.createOAuthState(req.user.id);
  const url = meta.buildOAuthUrl({ state });
  if (!url) {
    return res.status(503).json({
      error: "Meta OAuth is not configured yet",
      missing: Object.entries({
        META_APP_ID: config.metaAppId, META_APP_SECRET: config.metaAppSecret,
        META_REDIRECT_URI: config.metaRedirectUri, GRAPH_API_BASE: config.graphApiBase,
      }).filter(([, v]) => !v).map(([k]) => k),
      note: "Set the env vars (see .env.example), restart, then try again.",
    });
  }
  res.json({ authorize_url: url, state });
});

// GET /auth/callback — Meta redirects back with ?code= and ?state=.
router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const back = (msg, extra = {}) =>
    res.redirect(`/app?connect_error=${encodeURIComponent(msg)}${Object.entries(extra).map(([k, v]) => `&${k}=${v}`).join("")}`);

  if (error) return back(String(error));
  if (!code || !state) return back("Missing code or state");
  const stateEntry = store.consumeOAuthState(state);
  if (!stateEntry) return back("Unknown or expired state");

  const short = await meta.exchangeCode(code);
  if (!short.ok) return back("Token exchange failed");

  if (short.dryRun) {
    store.trackEvent("connect_dry_run", stateEntry.user_id);
    return res.redirect("/app?connect=dryrun");
  }

  let accessToken = short.access_token;
  const long = await meta.exchangeLongLived(short.access_token);
  if (long.ok && long.access_token) accessToken = long.access_token;

  const profile = await meta.fetchIgProfile(accessToken);

  // Plan limit: max connected accounts.
  const limits = store.limitsForPlan(store.effectivePlan(store.getUserById(stateEntry.user_id)));
  if (store.countAccountsForUser(stateEntry.user_id) >= limits.accounts &&
      !store.listAccounts().some((a) => a.ig_user_id === String(profile.user_id || profile.id) && a.user_id === stateEntry.user_id)) {
    return res.redirect(`/app?connect_error=${encodeURIComponent(`Your plan allows ${limits.accounts} connected accounts`)}`);
  }

  const account = store.upsertAccount({
    igUserId: profile.user_id || profile.id || "unknown",
    username: profile.username || "unknown",
    accessToken,
    userId: stateEntry.user_id,
    tokenIssuedAt: new Date().toISOString(),
  });
  store.trackEvent("connect", stateEntry.user_id, { ig: account.username });
  res.redirect("/app?connect=ok");
});

// GET /auth/accounts — accounts connected to the signed-in user (tokens masked).
router.get("/accounts", requireUser, (req, res) => {
  const rows = store.listAccounts().filter((a) => a.user_id === req.user.id);
  res.json({
    count: rows.length,
    accounts: rows.map((a) => ({
      igUserId: a.ig_user_id, username: a.username, connectedAt: a.connected_at,
      token: a.access_token ? `${String(a.access_token).slice(0, 6)}…` : null,
    })),
  });
});

module.exports = router;
