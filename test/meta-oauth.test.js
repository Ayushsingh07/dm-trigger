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
