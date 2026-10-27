// ReplyFlow — Meta Graph API client.
// When config.graphApiBase is empty (the current state), every call runs in
// DRY-RUN mode: the request that WOULD be made is logged and a stub result is
// returned, so the whole pipeline is testable without Meta credentials.

const config = require("./config");
const crypto = require("crypto");
const logger = require("./logger");

const GRAPH = () => config.graphApiBase.replace(/\/+$/, "");
const GRAPH_BETA = () => (config.graphApiBetaBase || config.graphApiBase).replace(/\/+$/, "");

const MAX_ATTEMPTS = 3;          // 1 try + 2 retries
const BASE_BACKOFF_MS = 500;

function dryRun(name, details) {
  logger.debug({ meta: name, ...details }, "[meta:dry-run]");
  return { ok: true, dryRun: true, id: `dry_${Date.now()}` };
}

// Should this failure be retried? Rate limits and 5xx yes; permission /
// auth / invalid-request errors never (retrying them wastes quota and can
// get the app banned).
function shouldRetry(result) {
  if (result.ok) return false;
  const status = Number(result.status) || 0;
  const err = result.error || {};
  const e = err.error || {};
  const code = Number(e.code) || 0;
  const subcode = Number(e.error_subcode) || 0;
  const msg = String(e.message || err.message || "").toLowerCase();
  const type = String(e.type || "").toLowerCase();

  const permissionish =
    type === "oauthexception" || type === "permission" ||
    code === 10 || code === 200 || code === 190 || code === 368 ||
    subcode === 459 ||
    msg.includes("permission") || msg.includes("requires permission") ||
    msg.includes("not authorized") || msg.includes("invalid token") ||
    msg.includes("unsupported") || msg.includes("unknown path");
  if (permissionish) return false;

  const rateLimited =
    code === 4 || code === 17 || code === 32 || code === 613 ||
    status === 429 || msg.includes("rate point") || msg.includes("too many calls");
  if (rateLimited) return true;

  return status >= 500 && status <= 599;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function graphCall(name, url, { method = "POST", body } = {}) {
  if (!config.metaConfigured || !GRAPH()) {
    return dryRun(name, { url, method, body });
  }
  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        result = { ok: false, status: res.status, error: json };
      } else {
        return { ok: true, ...json };
      }
    } catch (err) {
      result = { ok: false, status: 0, error: String(err.message || err) };
    }

    if (!shouldRetry(result) || attempt === MAX_ATTEMPTS) break;
    const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    logger.warn({ name, attempt, status: result.status }, `[meta:retry] ${name} failed, retrying in ${delay}ms`);
    await sleep(delay);
  }
  logger.error({ name, status: result.status, error: result.error }, `[meta:error] ${name} failed`);
  return result;
}

// ------------------------------------------------------------------ OAuth
// Step 1: send the user to this URL to connect with Instagram/Facebook login.
function buildOAuthUrl({ scope = "instagram_basic,instagram_manage_engagement,instagram_manage_messages", state } = {}) {
  if (!config.metaAppId || !config.metaRedirectUri) {
    logger.warn("buildOAuthUrl — META_APP_ID / META_REDIRECT_URI not set yet");
    return null;
  }
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", config.metaAppId);
  u.searchParams.set("redirect_uri", config.metaRedirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope);
  u.searchParams.set("state", state);
  return u.toString();
}

// Step 2: exchange the ?code= from the callback for a short-lived token.
async function exchangeCode(code) {
  return graphCall("oauth.access_token", `${GRAPH()}/oauth/access_token`, {
    method: "POST",
    body: {
      client_id: config.metaAppId,
      client_secret: config.metaAppSecret,
      grant_type: "authorization_code",
      redirect_uri: config.metaRedirectUri,
      code,
    },
  });
}

// Step 3: short-lived -> long-lived (60 days) token.
async function exchangeLongLived(accessToken) {
  const u = new URL(`${GRAPH()}/access_token`);
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", config.metaAppSecret);
  u.searchParams.set("access_token", accessToken);
  return graphCall("oauth.long_lived", u.toString(), { method: "GET" });
}

// Refresh a long-lived token (valid for another 60 days). Meta's docs call
// this with grant_type=ig_refresh_token against the same endpoint.
async function refreshLongLived(accessToken) {
  const u = new URL(`${GRAPH()}/access_token`);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", accessToken);
  return graphCall("oauth.refresh_long_lived", u.toString(), { method: "GET" });
}

// Fetch the connected IG user's profile (id + username).
async function fetchIgProfile(accessToken) {
  const u = new URL(`${GRAPH()}/me`);
  u.searchParams.set("fields", "user_id,username");
  u.searchParams.set("access_token", accessToken);
  return graphCall("me.profile", u.toString(), { method: "GET" });
}

// ------------------------------------------------------------------ Actions
// Public reply under a comment: POST /{comment-id}/replies
async function sendPrivateReply(accessToken, commentId, message) {
  return graphCall(`replies(${commentId})`, `${GRAPH()}/${commentId}/replies`, {
    method: "POST",
    body: { message, access_token: accessToken },
  });
}

// Private DM to the commenter: POST /me/messages
// recipient = { recipient: { id: <ig_scoped_user_id> } }, message = { text }
// or message = { attachment: { type: "template", payload: {...} } } for buttons/cards.
async function sendDM(accessToken, recipientId, message) {
  return graphCall(`messages(${recipientId})`, `${GRAPH()}/me/messages`, {
    method: "POST",
    body: {
      recipient: { id: recipientId },
      message,
      access_token: accessToken,
    },
  });
}

// Build a DM message with up to 3 URL buttons from rule.links.
function buildDMMessage(dmText, links, name = "there") {
  const text = (dmText || "").replace(/\{name\}/g, name);
  if (!links || links.length === 0) return { text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: links.slice(0, 3).map((l) => ({
          type: "web_url",
          title: (l.title || "Open link").slice(0, 20),
          url: l.url,
          webview_height_ratio: "tall",
        })),
      },
    },
  };
}

// Check whether the commenter follows the business account
// (used by the followers-only option). Needs the Instagram_manage_messages
// path on the beta Graph API in production.
async function isFollower(accessToken, scopedUserId) {
  if (!config.metaConfigured) {
    return dryRun(`check_follow(${scopedUserId})`, { note: "assume follower in dry-run" });
  }
  const u = new URL(`${GRAPH_BETA()}/${scopedUserId}`);
  u.searchParams.set("fields", "is_follower");
  u.searchParams.set("access_token", accessToken);
  return graphCall(`check_follow(${scopedUserId})`, u.toString(), { method: "GET" });
}

// ---------------------------------------------------------- signed_request
// Meta sends a `signed_request` (base64url payload + HMAC-SHA256 of
// "payload_b64" keyed with the app secret) to the data-deletion and
// deauthorize callbacks. Returns the decoded payload, or null when the
// signature does not match.
function parseSignedRequest(signedRequest) {
  if (!signedRequest || !config.metaAppSecret) return null;
  const [sigB64, payloadB64] = String(signedRequest).split(".");
  if (!sigB64 || !payloadB64) return null;
  const expected = crypto
    .createHmac("sha256", config.metaAppSecret)
    .update(payloadB64)
    .digest();
  let given;
  try {
    given = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  buildOAuthUrl, exchangeCode, exchangeLongLived, refreshLongLived, fetchIgProfile,
  sendPrivateReply, sendDM, buildDMMessage, isFollower, parseSignedRequest,
};
