// The two Instagram API integrations use different login dialogs and token
// endpoints. Selecting the wrong one is the usual cause of Meta's
// "Invalid platform app" error, so both flows are pinned here.
process.env.META_APP_ID = "4242424242";
process.env.META_APP_SECRET = "test-app-secret";
process.env.META_REDIRECT_URI = "http://localhost:3000/auth/callback";
process.env.GRAPH_API_BASE = "https://graph.instagram.com/v23.0";
process.env.GRAPH_API_BETA_BASE = "https://graph.facebook.com/v23.0";
process.env.META_OAUTH_FLOW = "facebook";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { cleanup } = require("./helpers");

const config = require("../src/config");
const meta = require("../src/meta");

after(cleanup);

test("facebook flow builds the facebook.com dialog URL", () => {
  assert.equal(config.metaOAuthFlow, "facebook");
  const url = new URL(meta.buildOAuthUrl({ state: "st1" }));
  assert.equal(url.origin, "https://www.facebook.com");
  assert.match(url.pathname, /\/v\d+(\.\d+)?\/dialog\/oauth$/);
  assert.equal(url.searchParams.get("client_id"), "4242424242");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/auth/callback");
  assert.equal(url.searchParams.get("state"), "st1");
  assert.ok(url.searchParams.get("scope").includes("instagram_manage_messages"));
});

test("instagram flow builds the instagram.com authorize URL", () => {
  config.metaOAuthFlow = "instagram";
  try {
    const url = new URL(meta.buildOAuthUrl({ state: "st2" }));
    assert.equal(url.origin, "https://www.instagram.com");
    assert.equal(url.pathname, "/oauth/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "st2");
    assert.ok(!url.searchParams.get("scope").includes("pages_show_list"));
  } finally {
    config.metaOAuthFlow = "facebook";
  }
});

// Unified login = "Facebook Login for Business" with a configuration. The
// dialog is /dialog/oauth (no API version in the path), carries client_id and
// config_id, and must NOT carry a scope — permissions come from the config.
test("unified login dialog uses client_id + config_id, no scope, no API version", () => {
  const prev = config.metaOAuthFlow, prevCfg = config.metaConfigId;
  config.metaOAuthFlow = "business";
  config.metaConfigId = "1104328282219829";
  try {
    const url = meta.buildOAuthUrl({ state: "st3" });
    const u = new URL(url);
    assert.equal(u.origin, "https://www.facebook.com");
    assert.equal(u.pathname, "/dialog/oauth");
    assert.equal(u.searchParams.get("client_id"), "4242424242");
    assert.equal(u.searchParams.get("config_id"), "1104328282219829");
    assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:3000/auth/callback");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("override_default_response_type"), "true");
    assert.equal(u.searchParams.get("state"), "st3");
    assert.doesNotMatch(url, /scope=/);
    // matches the Login URL Meta generates in the dashboard
    assert.equal(u.searchParams.get("display"), "popup");
    assert.equal(u.searchParams.get("prompt"), "login");
  } finally {
    config.metaOAuthFlow = prev;
    config.metaConfigId = prevCfg;
  }
});

// Under unified login the IG business account id belongs in the request path;
// "/me/messages" is the legacy Instagram Login shape.
test("unified login sends DMs to /{ig-business-account-id}/messages on graph.facebook.com", async () => {
  const prev = config.metaOAuthFlow;
  config.metaOAuthFlow = "business";
  try {
    const real = global.fetch;
    let seen = "";
    global.fetch = async (url) => { seen = String(url); return { ok: true, status: 200, json: async () => ({}) }; };
    try {
      await meta.sendDM("page-token", "1234", { text: "hi" }, "17899999");
      assert.equal(seen, "https://graph.facebook.com/v23.0/17899999/messages");
      await meta.sendCommentDM("page-token", "17899999", "cmt1", { text: "hi" });
      assert.equal(seen, "https://graph.facebook.com/v23.0/17899999/messages");
    } finally {
      global.fetch = real;
    }
  } finally {
    config.metaOAuthFlow = prev;
  }
});

test("Login for Business without META_CONFIG_ID returns null", () => {
  const prev = config.metaOAuthFlow, prevCfg = config.metaConfigId;
  config.metaOAuthFlow = "business";
  config.metaConfigId = "";
  try {
    assert.equal(meta.buildOAuthUrl({ state: "st4" }), null);
  } finally {
    config.metaOAuthFlow = prev;
    config.metaConfigId = prevCfg;
  }
});

test("metaErrorText surfaces Meta's message and hints at the flow mismatch", () => {
  const text = meta.metaErrorText({
    status: 400,
    error: { error: { message: "Invalid request: Request parameters are invalid: Invalid platform app", code: 3600 } },
  });
  assert.ok(text.includes("Invalid platform app"), text);
  assert.ok(text.includes("code 3600"), text);
  assert.ok(/META_OAUTH_FLOW/.test(text), "should hint at the flow setting");
});

test("metaErrorText falls back for non-Graph errors", () => {
  assert.equal(meta.metaErrorText({ status: 500, error: "boom" }), "boom");
  assert.equal(meta.metaErrorText({ status: 502 }), "HTTP 502");
});
