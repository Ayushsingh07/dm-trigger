// ReplyLo — Meta Graph API client.
// When config.graphApiBase is empty (the current state), every call runs in
// DRY-RUN mode: the request that WOULD be made is logged and a stub result is
// returned, so the whole pipeline is testable without Meta credentials.

const config = require("./config");
const crypto = require("crypto");
const logger = require("./logger");

const GRAPH = () => config.graphApiBase.replace(/\/+$/, "");
const GRAPH_BETA = () => (config.graphApiBetaBase || config.graphApiBase).replace(/\/+$/, "");

// Three Instagram login integrations exist and are NOT interchangeable — using
// the wrong dialog makes Meta reply "Invalid platform app":
//   instagram -> "Instagram API with Instagram Login"  (instagram.com login, graph.instagram.com)
//   facebook  -> "Instagram API with Facebook Login"   (facebook.com login, graph.facebook.com)
//   business  -> "Login for Business": the dialog is driven by a config id
//                created in the Meta dashboard (facebook.com/<ver>/dialog/oauth?config_id=…),
//                tokens are issued by graph.facebook.com.
// Select with META_OAUTH_FLOW; it must match the product added in the app dashboard.
const isBusinessFlow = () => config.metaOAuthFlow === "business";
const isFacebookFlow = () => config.metaOAuthFlow === "facebook" || isBusinessFlow();
// Host that accepts our access token for API calls under the active flow.
const GRAPH_API = () => (isFacebookFlow() ? GRAPH_BETA() : GRAPH());
// Graph version embedded in the dialog path, e.g. "v23.0".
const API_VERSION = () => (GRAPH_BETA().match(/v\d+(?:\.\d+)?/) || ["v23.0"])[0];

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
  // The landing-page demo has no connected account, so it runs with a
  // placeholder token. Sending that to Meta would only burn app-level quota
  // and earn an OAuth error, so keep those calls in dry-run even once the app
  // secret is configured.
  const token = body?.access_token || new URL(url).searchParams.get("access_token") || "";
  const placeholder = token === "" || token === "DRY_RUN_TOKEN";
  if (!config.metaConfigured || !GRAPH_API() || placeholder) {
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

// Extract a short, human-readable message from a Meta error payload so the
// dashboard can show *why* a call failed instead of a generic "failed".
function metaErrorText(result) {
  const e = result?.error?.error || result?.error || {};
  const msg = String(e.message || result?.error || "").trim();
  const code = Number(e.code) || 0;
  const hint = /invalid platform app/i.test(msg)
    ? " — the app does not have this Instagram login product. In the Meta dashboard add the product, or set META_OAUTH_FLOW=business with META_CONFIG_ID (unified login) to match your app."
    : "";
  return (code ? `${msg} (code ${code})` : msg || `HTTP ${result?.status || "?"}`) + hint;
}

// ------------------------------------------------------------------ OAuth
// Login dialogs differ per integration (see isFacebookFlow above); using the
// wrong one returns "Invalid platform app".
const IG_SCOPES = "instagram_basic,instagram_manage_engagement,instagram_manage_messages";
const FB_SCOPES = "instagram_basic,instagram_manage_engagement,instagram_manage_messages,pages_show_list";

function buildOAuthUrl({ scope, state } = {}) {
  // Unified login ("Facebook Login for Business" with a configuration): the
  // configuration created in the Meta dashboard carries the app id, the
  // permissions and the allowed redirect URIs. The dialog therefore takes
  // client_id + config_id and NO scope — sending a scope list makes Meta
  // ignore the configuration's permission set.
  if (isBusinessFlow()) {
    if (!config.metaConfigId) {
      logger.warn("buildOAuthUrl — META_OAUTH_FLOW=business but META_CONFIG_ID is not set");
      return null;
    }
    const b = new URL("https://www.facebook.com/dialog/oauth");
    b.searchParams.set("client_id", config.metaAppId);
    b.searchParams.set("config_id", config.metaConfigId);
    b.searchParams.set("redirect_uri", config.metaRedirectUri);
    b.searchParams.set("response_type", "code");
    // Tells the dialog to honour response_type instead of the configuration's
    // default (which is often a token for popup flows).
    b.searchParams.set("override_default_response_type", "true");
    // Same parameter set (and order) as the Login URL Meta generates in the
    // dashboard, so the dialog behaves identically to the documented flow.
    b.searchParams.set("display", config.metaDialogDisplay || "popup");
    b.searchParams.set("state", state);
    if (config.metaLoginPrompt) b.searchParams.set("prompt", config.metaLoginPrompt);
    return b.toString();
  }
  if (!config.metaAppId || !config.metaRedirectUri) {
    logger.warn("buildOAuthUrl — META_APP_ID / META_REDIRECT_URI not set yet");
    return null;
  }
  if (isFacebookFlow()) {
    const u = new URL(`https://www.facebook.com/${API_VERSION()}/dialog/oauth`);
    u.searchParams.set("client_id", config.metaAppId);
    u.searchParams.set("redirect_uri", config.metaRedirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", scope || FB_SCOPES);
    return u.toString();
  }
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", config.metaAppId);
  u.searchParams.set("redirect_uri", config.metaRedirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scope || IG_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

// Step 2: exchange the ?code= from the callback for a short-lived token.
// The host must match whoever issued the login: graph.facebook.com for the
// unified/Facebook flows, graph.instagram.com for legacy Instagram Login.
// Meta documents this exchange as a GET on graph.facebook.com.
async function exchangeCode(code) {
  if (isFacebookFlow()) {
    const u = new URL(`${GRAPH_BETA()}/oauth/access_token`);
    u.searchParams.set("client_id", config.metaAppId);
    u.searchParams.set("client_secret", config.metaAppSecret);
    u.searchParams.set("redirect_uri", config.metaRedirectUri);
    u.searchParams.set("code", code);
    return graphCall("oauth.access_token", u.toString(), { method: "GET" });
  }
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
  if (isFacebookFlow()) {
    const u = new URL(`${GRAPH_BETA()}/oauth/access_token`);
    u.searchParams.set("grant_type", "fb_exchange_token");
    u.searchParams.set("client_id", config.metaAppId);
    u.searchParams.set("client_secret", config.metaAppSecret);
    u.searchParams.set("fb_exchange_token", accessToken);
    return graphCall("oauth.long_lived", u.toString(), { method: "GET" });
  }
  const u = new URL(`${GRAPH()}/access_token`);
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", config.metaAppSecret);
  u.searchParams.set("access_token", accessToken);
  return graphCall("oauth.long_lived", u.toString(), { method: "GET" });
}

// Refresh a long-lived token (valid for another 60 days). Meta's docs call
// this with grant_type=ig_refresh_token against the same endpoint.
async function refreshLongLived(accessToken) {
  if (isFacebookFlow()) return exchangeLongLived(accessToken);
  const u = new URL(`${GRAPH()}/access_token`);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", accessToken);
  return graphCall("oauth.refresh_long_lived", u.toString(), { method: "GET" });
}

// Fetch the connected IG account's id + username.
async function fetchIgProfile(accessToken) {
  if (isFacebookFlow()) {
    // Unified login yields a *user* token; the IG business account hangs off a
    // Facebook Page, so resolve it through /me/accounts. The Page's own
    // access_token is what later calls (messages, replies) must be signed with.
    const u = new URL(`${GRAPH_BETA()}/me/accounts`);
    u.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
    u.searchParams.set("access_token", accessToken);
    const res = await graphCall("me.accounts", u.toString(), { method: "GET" });
    if (!res.ok) return res;
    const pages = Array.isArray(res.data) ? res.data : [];
    const page = pages.find((p) => p && p.instagram_business_account);
    if (!page) {
      return {
        ok: false,
        status: 400,
        error: {
          error: {
            message: "No Instagram Business account linked to a Facebook Page you manage",
          },
        },
      };
    }
    const ig = page.instagram_business_account;
    return {
      ok: true,
      id: ig.id,
      username: ig.username,
      // Kept for the caller: which Page to store, and the token to sign calls with.
      pageId: page.id || null,
      pageName: page.name || null,
      pageAccessToken: page.access_token || accessToken,
    };
  }
  const u = new URL(`${GRAPH()}/me`);
  u.searchParams.set("fields", "user_id,username");
  u.searchParams.set("access_token", accessToken);
  return graphCall("me.profile", u.toString(), { method: "GET" });
}

// ------------------------------------------------------------------ Actions
// Public reply under a comment: POST /{comment-id}/replies
// Works with the Page access token on graph.facebook.com and with the IG token
// on graph.instagram.com — the path is identical on both.
async function sendPrivateReply(accessToken, commentId, message) {
  return graphCall(`replies(${commentId})`, `${GRAPH_API()}/${commentId}/replies`, {
    method: "POST",
    body: { message, access_token: accessToken },
  });
}

// Private reply *to* a comment, sent from the IG business account:
// POST /{ig-business-account-id}/messages with recipient = { comment_id }.
// Only the unified (graph.facebook.com) flow documents this shape; on legacy
// Instagram Login the equivalent is /me/messages with recipient.id.
async function sendCommentDM(accessToken, igBusinessId, commentId, message) {
  const target = isFacebookFlow() ? (igBusinessId || "me") : "me";
  return graphCall(`messages(comment:${commentId})`, `${GRAPH_API()}/${target}/messages`, {
    method: "POST",
    body: {
      recipient: { comment_id: commentId },
      message,
      access_token: accessToken,
    },
  });
}

// Private DM: POST /{ig-business-account-id}/messages (unified login) or
// POST /me/messages (legacy Instagram Login).
// recipient = { id: <ig user id> }, message = { text }
// or message = { attachment: { type: "template", payload: {...} } } for buttons/cards.
// `igBusinessId` is the connected account the token is authorised for; under
// unified login Meta requires it in the path instead of "me".
async function sendDM(accessToken, recipientId, message, igBusinessId) {
  const target = isFacebookFlow() ? (igBusinessId || "me") : "me";
  return graphCall(`messages(${recipientId})`, `${GRAPH_API()}/${target}/messages`, {
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
// (used by the followers-only option).
// TODO(meta-docs): the Instagram API with Unified/Facebook login does not
// document an `is_follower` field on graph.facebook.com. Confirm the current
// endpoint (or replace this with the followers_count / messaging-based check)
// before relying on followers-only rules in production.
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
  sendPrivateReply, sendCommentDM, sendDM, buildDMMessage, isFollower, parseSignedRequest,
  shouldRetry, metaErrorText,
};
