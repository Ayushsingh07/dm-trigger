# PROJECT.md — ReplyFlow (workspace: dm-trigger)

> Memory file for AI sessions with no chat history. Read this FIRST.
> Verified 2026-10-27 against the actual code. Anything unverified is marked.

## 1. WHAT THIS IS
ReplyFlow is a SaaS that auto-replies to Instagram comment keywords (e.g. "GUIDE")
with a public reply + a private DM containing the owner's message and up to 3 links.
For creators/small brands who sell via comments; original product, not a DMFast copy.

## 2. TECH STACK
- Backend: Node.js (v24 installed; needs >=22.5 for node:sqlite), Express ^5.3.0, dotenv ^18.0.9. CommonJS.
- Deps: helmet (CSP/headers), express-rate-limit, pino (structured logs). React/react-dom are devDeps (bundled by esbuild).
- Database: built-in `node:sqlite` (DatabaseSync) — file `$DATABASE_PATH` (default `data/replyflow.db`), WAL + busy_timeout=5000. No ORM, no migrations tool (tiny forward-migrations loop in db.js).
- Frontend: build step now exists: Tailwind CLI v4 (`npm run build:css` -> public/assets/app.css) + esbuild (`npm run build:js` -> public/assets/landing.js from src/landing.jsx). landing.html = React 18 (bundled, no CDN); index/admin/auth pages use built app.css. Google Fonts still via CDN link.
- Hosting: Fly.io (fly.toml + Dockerfile, single always-on shared-cpu-1x/256mb, volume at /data). See DEPLOY.md.
- Auth: hand-rolled (scrypt + cookie sessions). No external auth/payment libs.

## 3. FOLDER MAP
- `server.js` — app entry: helmet CSP, raw-body capture, origin check, rate limiters, page routes, api mounts, /health, admin bootstrap, demo seed, token migration, graceful shutdown.
- `src/config.js` — env -> config object; `metaConfigured` flag gates live vs dry-run.
- `src/db.js` — opens SQLite at DATABASE_PATH (WAL, busy_timeout), creates schema, tiny ALTER forward-migrations; exports { db, dbPath }.
- `src/crypto.js` — AES-256-GCM helpers (TOKEN_ENC_KEY, base64 32B). Used ONLY by store.js. Ciphertext format `v1:iv:tag:ct`; legacy plaintext detected + migrated.
- `src/logger.js` — pino structured logger (secrets redacted). Use instead of console.*.
- `src/jobs.js` — background jobs: reminder scheduler (30s), daily token refresh (03:00Z), nightly VACUUM INTO backup to BACKUP_DIR keep-7 (04:00Z), daily expired-session purge (05:00Z).
- `src/store.js` — all DB access helpers (users/accounts/rules/conversations/emails/visits/events/oauth + adminMetrics + plan limits/usage + deleteUserCompletely + purgeExpiredSessions). Encrypts/decrypts access_token transparently.
- `src/auth.js` — scrypt hash/verify, sessions, cookie parse, attachUser/requireUser/requireAdmin; cookie gets `Secure` when NODE_ENV=production.
- `src/meta.js` — Meta Graph client; logs `[meta:dry-run]` instead of calling when unconfigured; retry w/ exponential backoff (3 tries) on rate-limit/5xx, never on permission errors; parseSignedRequest for Meta callbacks.
- `src/actions.js` — core pipeline: comment -> match -> reply -> DM -> conversation (with reminder_at); sendReminder(); DM inbound handler; monthly conversation quota check.
- `src/routes/webhook.js` — GET verify (hub.challenge) + POST events (X-Hub-Signature-256 HMAC verify -> 403 on mismatch; ack fast, handle async).
- `src/routes/auth.js` — /auth/signup|login|logout|me (pw min 10, constant-time login fail) + Meta OAuth /connect (login required) + /callback (account-limit check) + /accounts.
- `src/routes/rules.js` — CRUD, scoped to logged-in user (+ unowned demo rules visible); plan rule-limit enforced (402).
- `src/routes/stats.js` — dashboard numbers (+ plan usage/limits), conversations, emails CSV, POST /delete-account (password-confirm, full erasure).
- `src/routes/admin.js` — /api/admin/metrics, /users, PATCH user plan/status (admin only).
- `src/routes/demo.js` — POST /api/demo: public landing/dashboard demo (synthetic comment through the same pipeline; rate-limited 20/min). Exists so the demo keeps working when /webhook enforces signatures.
- `src/routes/track.js` — POST /track visit beacon (hashed UA, no cookies; rate-limited 60/min).
- `src/routes/meta.js` — POST /meta/data-deletion + /meta/deauthorize (signed_request HMAC verified).
- `test/` — node:test suite (`npm test` -> `node --test "test/*.test.js"`). helpers.js points DATABASE_PATH at a temp DB + sets TOKEN_ENC_KEY before any require; files: crypto, store, auth, webhook (real HTTP against an in-test express app), actions (keyword match, buildDMMessage, parseSignedRequest). 57 tests, all green.
- `src/styles/tailwind.css` — Tailwind v4 source (theme = DESIGN-BRIEF palette) -> build:css.
- `src/landing.jsx` — landing page React app (was inline Babel in landing.html) -> build:js.
- `public/landing.html` — marketing page shell; loads /assets/app.css + /assets/landing.js; OG tags, favicon.
- `public/index.html` — user dashboard at /app (client-side auth gate, 5s polling, plan-usage badge, Delete-my-account).
- `public/auth.html` — login/signup (path /login vs /signup switches mode).
- `public/admin.html` — admin metrics at /admin (cards, 7d charts, funnel, users, events).
- `public/privacy.html|terms.html|data-deletion.html` — legal pages at /privacy /terms /data-deletion.
- `public/assets/` — built app.css, landing.js, favicon.svg, og-image.png. `public/robots.txt`, `public/sitemap.xml`.
- `Dockerfile`, `.dockerignore`, `fly.toml`, `DEPLOY.md` — Fly.io deployment (volume /data, health checks, non-root).
- `DESIGN-BRIEF.md` — brand/design rules (the project's "DESIGN.md"). `UX-FEATURES.md` — reference notes from dmfast.app (behavior only).
- `.env` (gitignored), `.env.example`, `data/` (gitignored DB + backups/).

## 4. HOW TO RUN
- Install: `cmd /c "npm install"` (PowerShell blocks npm.ps1 — use cmd).
- Build assets (after changing HTML/landing.jsx/CSS): `cmd /c "npm run build"` -> public/assets/app.css + landing.js. Static HTML changes need no rebuild; JS/CSS changes do.
- Dev/run: `node server.js` or `npm start` → http://localhost:3000. Restart needed for JS changes.
- Test: none wired (`npm test` is a stub) — verified manually + with a throwaway e2e script (27 checks: signature, dedupe, limits, encryption, rate limit, backup).
- Deploy: see DEPLOY.md (flyctl on Windows; fly launch --no-deploy, volume, secrets, deploy).
- Pages: `/` landing · `/app` dashboard · `/login` `/signup` · `/admin` · `/privacy` `/terms` `/data-deletion` · `/health`.

## 5. ENVIRONMENT VARIABLES (names only — never commit values; .env is gitignored)
- PORT — HTTP port (3000). VERIFY_TOKEN — webhook hub.verify_token match.
- ADMIN_EMAIL / ADMIN_PASSWORD — admin account created on first boot (optional once the admin exists).
- META_APP_ID / META_APP_SECRET / META_REDIRECT_URI — Meta OAuth app creds.
  META_APP_SECRET also verifies X-Hub-Signature-256 + Meta signed_request.
- GRAPH_API_BASE / GRAPH_API_BETA_BASE — Graph API URLs; empty => DRY-RUN everything.
- PUBLIC_BASE_URL — public URL; when set, enables the cross-origin write check.
- REMINDER_MINUTES — default reminder delay.
- DATABASE_PATH — SQLite file (default data/replyflow.db; /data/replyflow.db on Fly).
- TOKEN_ENC_KEY — 32 bytes base64, AES-256-GCM key for access_token at rest.
  Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
  Set BEFORE first OAuth connect; changing it later makes stored tokens undecryptable.
- BACKUP_DIR — nightly VACUUM INTO target (default data/backups; /data/backups on Fly).
- LOG_LEVEL — pino level (default: info in production, debug otherwise).
- NODE_ENV=production — adds `Secure` to the session cookie (set by Dockerfile).

## 6. ARCHITECTURE
Webhook flow (src/actions.js handleCommentEvent):
1. Meta POSTs /webhook -> ack 200 immediately -> per change: comments field.
2. Skip self-replies. Load active rules for account (fallback: unowned "demo" rules).
3. Keyword match: case-insensitive whole-word regex `(^|[\s,.!?])KW($|[\s,.!?])`.
4. Dedupe: one conversation per (rule, commenter psid).
5. Optional followers-only gate (isFollower; dry-run assumes true) -> else nudge reply.
6. Public reply POST /{comment_id}/replies -> DM POST /me/messages (text or <=3 web_url buttons) -> conversation row (status sent, reminder_at set).
7. Reminder: src/jobs.js scheduler every 30s picks due rows (status "sent", reminded=0, inside 24h window) -> sends DM, marks reminded. No in-memory timers.
Meta API calls: retry with exponential backoff (500ms/1s, max 3 attempts) on rate-limit codes (4/17/32/613/429) or 5xx; never on permission/auth errors (10/190/200/368, OAuthException).
Daily jobs: 03:00Z refresh long-lived IG tokens older than 40 days; 04:00Z VACUUM INTO backup (keep 7); 05:00Z purge expired sessions (also on boot).
Inbound DM: email regex -> emails table + status email_collected; "YES" -> replied.
Auth flow: signup/login -> scrypt hash -> sessions row -> HttpOnly cookie rf_session (30d, +Secure in production). Login always runs one scrypt verify and returns the same message (no account-existence leak).
Meta connect: /auth/connect (requireUser) -> OAuth URL (null until .env set) -> /auth/callback -> plan account-limit check -> upsert account owned by user (token encrypted at rest).
Meta callbacks: POST /meta/data-deletion + /meta/deauthorize verify signed_request HMAC(META_APP_SECRET) then drop token/rows.
Admin: landing page sendBeacon /track -> visits table; /api/admin/metrics aggregates totals, 7d series, funnel, plans.
Security: helmet CSP (self + Google Fonts), rate limits (/auth 10/15min, /track 60/min, /webhook unlimited), cross-origin write check vs PUBLIC_BASE_URL, webhook HMAC verify (403 on mismatch), pino redacts tokens/passwords/cookies.

## 7. DATA MODEL (SQLite, src/db.js)
- users: id, email UNIQUE, password_hash (scrypt salt:hash), name, role(user|admin), plan(free|trial|pro), status(trialing|active|canceled), trial_ends_at, created_at, last_seen_at
- sessions: token PK, user_id FK, created_at, expires_at
- accounts: ig_user_id PK, username, access_token (encrypted `v1:iv:tag:ct` when TOKEN_ENC_KEY set), user_id FK, connected_at, token_issued_at
- rules: id PK, account_id, user_id, keyword, scope(all|posts), post_ids JSON, dm_text, links JSON(<=3), followers_only, ask_email, reminder_after_min, active, created_at
- conversations: id PK, account_id, user_id, psid, comment_id (UNIQUE when not NULL — Meta retries can't double-DM), rule_id, status(sent|replied|clicked|email_collected), reminded, reminder_at, sent_at
- emails: id PK, account_id, user_id, psid, email, rule_id, created_at
- visits: id, path, referrer, ua_hash (sha256 16ch), day, created_at
- events: id, name, user_id, meta JSON, created_at
- oauth_states: state PK, user_id, created_at

## 8. KEY DECISIONS
- node:sqlite over Postgres/ORM: zero-config single-file launch; schema in one place. Don't add deps casually (helmet/express-rate-limit/pino approved).
- Hand-rolled auth (scrypt+cookie): no external service; HttpOnly SameSite=Lax, 30d, Secure in production.
- Dry-run by default: every Meta call logs when GRAPH_API_BASE empty — whole pipeline testable pre-credentials. Keep this. Webhook signature check only enforced when META_APP_SECRET is set; the public demos use /api/demo instead of /webhook.
- store.js returns camelCase for rules/conversations (mapped) but raw snake_case for users/accounts rows — check before using fields. accounts rows come back with access_token DECRYPTED (openAccount); listAccountRows() gives raw for the refresh job.
- Token encryption lives only in store.js/crypto.js; ciphertext prefix `v1:` distinguishes it from legacy plaintext (migration on boot, idempotent).
- Plan limits (free 1/3/100, trial 3/15/2000, pro 10/100/50000; trial expired => treated as free via effectivePlan()). Enforced in rules POST, OAuth callback, actions.js conversation quota; shown in dashboard badge.
- Demo rules live under account_id "demo" with user_id NULL, visible to all users (public demo).
- Landing CTAs go to /signup; dashboard is /app (not /). Visit tracking is first-party (no analytics vendors).
- Frontend build: Tailwind CLI v4 + esbuild (devDeps, pinned versions); built assets committed in public/assets so the Docker image needs no build stage. Rebuild with `npm run build` before deploying UI changes.

## 9. DESIGN RULES (from DESIGN-BRIEF.md)
Palette: mist #f4f6fa bg, ink #0c1524, teal #0d9488 primary, amber #f59e0b accent, line #e3e8f0.
Inter UI + Fraunces italic display accent; ⚡ mark; 14-18px radii; soft shadows; calm copy, verbs first, no DMFast wording.
Components live inline in each HTML (no component lib): landing.html has Nav/Hero/Phone(ReelsFrame+DmFrame)/Reveal etc.

## 10. CURRENT STATUS
DONE: everything above plus: deployable on one always-on instance (Dockerfile non-root node:24-slim, fly.toml volume /data, min_machines_running=1, shared-cpu-1x 256mb, /health checks, graceful SIGTERM/SIGINT shutdown, trust proxy); webhook HMAC verification; UNIQUE(comment_id); token encryption at rest + migration; helmet CSP + rate limits + origin check + pw>=10 + constant-time login; session purge; reminder scheduler; Meta retry/backoff; daily token refresh; nightly VACUUM INTO backups; pino logging; plan limits + trial expiry + dashboard usage badge; /privacy /terms /data-deletion pages + Meta data-deletion/deauthorize endpoints; Delete-my-account; Tailwind/esbuild build; robots/sitemap/favicon/OG; DEPLOY.md.
PARTLY: Meta OAuth (code complete, untestable until .env filled); dashboard index.html still demo-flavored (plan badge added, but no connect-error display).
BROKEN/UNVERIFIED: live Meta calls untested. Docker build unverified (Docker not installed on this machine).
DONE (tests): `npm test` wired to node:test — 57 tests covering crypto round-trip/migration, store CRUD + UNIQUE(comment_id) + dueReminders + plan limits + deletion, auth hashing/sessions/middleware/cookie flags, webhook signature enforcement over real HTTP (200/403), keyword matching, buildDMMessage, parseSignedRequest. Found + fixed 3 real bugs: commentMatchesKeyword missed emoji/parenthesis boundaries (now \W-based); getRule/getConversation/lastConversationForPsid returned undefined instead of null for missing rows (node:sqlite .get() quirk).

## 11. NEXT STEPS (priority)
1. Real Meta config pass: fill .env, test OAuth connect + live webhook against a test IG account; fix Graph version/endpoint details; confirm isFollower beta path.
2. Deploy to Fly.io following DEPLOY.md; set secrets incl. TOKEN_ENC_KEY before first connect; verify volume + backups.
3. Dashboard polish: show ?connect= / ?connect_error= flags, plan/upgrade page, billing.
4. Optional: serve built assets with hashed filenames + long cache; error pages; OG image real design.

## 12. KNOWN ISSUES AND GOTCHAS
- PowerShell blocks npm.ps1 (UnauthorizedAccess) -> always `cmd /c "npm install ..."`.
- Windows PowerShell 5.1 Get-Content/Set-Content mangles UTF-8 (emoji) — use node or `-Encoding UTF8` carefully when scripting file edits.
- npm may block esbuild/tailwind postinstall scripts -> `npm install-scripts approve esbuild @tailwindcss/oxide @parcel/watcher` then `npm rebuild`.
- sendBeacon must send a Blob with type application/json or express.json ignores the body.
- express 5: async route errors auto-forward; keep webhook ack-before-handle or Meta disables the webhook.
- Webhook: signature enforced only when META_APP_SECRET set. The landing/dashboard demos post to /api/demo (unsigned by design, rate-limited) — never to /webhook — so they keep working in live mode.
- Meta limits: DM only within 24h window; button templates max 3; private replies need instagram_manage_engagement + instagram_manage_messages; isFollower needs beta Graph API (unverified exact path).
- TOKEN_ENC_KEY: set before first OAuth connect; rotating it later orphans stored tokens (decrypt returns null -> dry-run token fallback).
- UNIQUE(comment_id): demo events reuse fresh ids; NULL comment_id rows allowed (SQLite). createConversation returns null on duplicate — actions.js logs and skips.
- OAuth callback redirects to /app with query flags (?connect=ok|dryrun|connect_error) — dashboard doesn't display them yet.
- Static assets cached 1h: after `npm run build`, hard-reload (Ctrl+F5) to see changes locally.
- node:sqlite `.get()` returns `undefined` (not null) when no row — store helpers that can miss must `|| null` (getRule/getUser*/getConversation/lastConversationForPsid do; tests assert this).
- `node --test test/` fails on Windows (treated as a module path); use the npm script (`node --test "test/*.test.js"`).
- Keyword matching uses `\W` boundaries: emoji/word-chars adjacent to the keyword block a match ("guide🙌" does NOT match "guide") — matches Meta comment reality closely enough.
- Old gotchas fixed: relative requires from routes (use ../), demo rule duplication (seed once in server.js), reminder timers died on restart (now DB-scheduled).

## 13. RULES FOR THE AI
- Read PROJECT.md first; then DESIGN-BRIEF.md for UI work. Don't read everything else until needed.
- Follow existing code style: CommonJS require, small route files, store.js for ALL DB access, no new deps without asking.
- One task at a time from NEXT STEPS. Never touch or print .env values. Ask before deleting files.
- After finishing a task: move it to CURRENT STATUS, update FOLDER MAP/decisions/gotchas, refresh NEXT STEPS.
- Restart the node server after backend changes; verify with a real request before claiming done.
