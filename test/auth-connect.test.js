// GET /auth/connect must 302 to Instagram when a browser navigates to it
// (the dashboard links it as a plain <a href>), and keep returning JSON for
// API clients. Regression test for the "connect shows raw JSON" bug.
process.env.META_APP_ID = "123456789012345";
process.env.META_APP_SECRET = "test-app-secret";
process.env.META_REDIRECT_URI = "http://localhost:3000/auth/callback";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { cleanup } = require("./helpers");

const store = require("../src/store");
const auth = require("../src/auth");

let server, base;
before(async () => {
  const app = express();
  app.use("/auth", require("../src/routes/auth"));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); cleanup(); });

function cookie() {
  const u = store.createUser({ email: `c${Math.random()}@x.io`, passwordHash: "h" });
  return `${auth.COOKIE}=${auth.createSession(u.id)}`;
}

test("GET /auth/connect 302-redirects browser navigation to Instagram", async () => {
  const res = await fetch(`${base}/auth/connect`, {
    headers: { cookie: cookie(), accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "manual",
  });
  assert.equal(res.status, 302);
  const loc = res.headers.get("location");
  assert.ok(loc.startsWith("https://www.instagram.com/oauth/authorize?"), loc);
  assert.ok(loc.includes("client_id=123456789012345"));
  assert.ok(loc.includes("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback"));
});

test("GET /auth/connect still returns JSON for API clients", async () => {
  const res = await fetch(`${base}/auth/connect`, {
    headers: { cookie: cookie(), accept: "application/json" },
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.authorize_url.startsWith("https://www.instagram.com/oauth/authorize?"));
  assert.ok(j.state);
});

test("GET /auth/connect requires login", async () => {
  const res = await fetch(`${base}/auth/connect`, { headers: { accept: "text/html" } });
  assert.equal(res.status, 401);
});
