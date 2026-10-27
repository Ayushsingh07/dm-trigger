const { cleanup } = require("./helpers");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const auth = require("../src/auth");
const store = require("../src/store");

after(cleanup);

test("hashPassword/verifyPassword round-trip", () => {
  const h = auth.hashPassword("correct horse battery staple");
  assert.match(h, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(auth.verifyPassword("correct horse battery staple", h), true);
  assert.equal(auth.verifyPassword("wrong password here", h), false);
});

test("hashPassword salts (same password -> different hash)", () => {
  assert.notEqual(auth.hashPassword("pw-1234567890"), auth.hashPassword("pw-1234567890"));
});

test("verifyPassword rejects malformed stored values", () => {
  for (const bad of ["", null, undefined, "nocolon", ":abc", "abc:", "salt:notHex"]) {
    assert.equal(auth.verifyPassword("x", bad), false, `should reject ${String(bad)}`);
  }
});

test("looksLikeEmail", () => {
  assert.equal(auth.looksLikeEmail("a@b.co"), true);
  assert.equal(auth.looksLikeEmail("  a@b.co  "), true);
  assert.equal(auth.looksLikeEmail("nope"), false);
  assert.equal(auth.looksLikeEmail("a@b"), false);
  assert.equal(auth.looksLikeEmail(""), false);
});

test("session lifecycle: create -> resolve -> destroy", () => {
  const u = store.createUser({ email: "session@x.com", passwordHash: auth.hashPassword("longenough1") });
  const token = auth.createSession(u.id);
  assert.equal(token.length, 64);
  const found = auth.sessionUser(token);
  assert.equal(found.id, u.id);
  assert.equal(found.email, "session@x.com");
  assert.ok(found.last_seen_at);

  auth.destroySession(token);
  assert.equal(auth.sessionUser(token), null);
});

test("sessionUser: unknown token and expired token -> null", () => {
  assert.equal(auth.sessionUser("no-such-token"), null);
  assert.equal(auth.sessionUser(null), null);

  const u = store.createUser({ email: "expired@x.com", passwordHash: "s:h" });
  store.db.prepare("INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run("exp-tok", u.id, new Date().toISOString(), "2020-01-01T00:00:00.000Z");
  assert.equal(auth.sessionUser("exp-tok"), null);
  assert.equal(store.db.prepare("SELECT 1 FROM sessions WHERE token='exp-tok'").get(), undefined, "expired row cleaned up");
});

test("readCookie parses the session cookie", () => {
  const req = { headers: { cookie: `other=1; ${auth.COOKIE}=abc123; x=y` } };
  assert.equal(auth.readCookie(req, auth.COOKIE), "abc123");
  assert.equal(auth.readCookie(req, "missing"), null);
  assert.equal(auth.readCookie({ headers: {} }, auth.COOKIE), null);
});

test("setSessionCookie sets HttpOnly/SameSite, no Secure outside production", () => {
  const headers = {};
  auth.setSessionCookie({ setHeader: (k, v) => { headers[k] = v; } }, "tok");
  const c = headers["Set-Cookie"];
  assert.ok(c.startsWith("rf_session=tok; Path=/; HttpOnly; SameSite=Lax"));
  assert.ok(!/Secure/.test(c));
});

test("setSessionCookie adds Secure when NODE_ENV=production", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const headers = {};
    auth.setSessionCookie({ setHeader: (k, v) => { headers[k] = v; } }, "tok");
    assert.match(headers["Set-Cookie"], /Secure/);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  }
});

test("clearSessionCookie zeroes Max-Age", () => {
  const headers = {};
  auth.clearSessionCookie({ setHeader: (k, v) => { headers[k] = v; } });
  assert.match(headers["Set-Cookie"], /Max-Age=0/);
});

// ---------------------------------------------------------------- middleware
const respond = () => {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.sendStatus = (c) => { res.statusCode = c; res.ended = true; return res; };
  return res;
};

test("requireUser: 401 without a user, passes with one", () => {
  let nextCalled = false;
  const res = respond();
  auth.requireUser({ user: null }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);

  const res2 = respond();
  auth.requireUser({ user: { id: "u" } }, res2, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("requireAdmin: 401 anonymous, 403 non-admin, passes admin", () => {
  const anon = respond();
  auth.requireAdmin({ user: null }, anon, () => { throw new Error("should not run"); });
  assert.equal(anon.statusCode, 401);

  const user = respond();
  auth.requireAdmin({ user: { role: "user" } }, user, () => { throw new Error("should not run"); });
  assert.equal(user.statusCode, 403);

  let ok = false;
  auth.requireAdmin({ user: { role: "admin" } }, respond(), () => { ok = true; });
  assert.equal(ok, true);
});

test("attachUser resolves the user from the cookie", () => {
  const u = store.createUser({ email: "mw@x.com", passwordHash: "s:h" });
  const token = auth.createSession(u.id);
  const req = { headers: { cookie: `${auth.COOKIE}=${token}` } };
  let next = false;
  auth.attachUser(req, {}, () => { next = true; });
  assert.equal(next, true);
  assert.equal(req.user.id, u.id);

  const anon = { headers: {} };
  auth.attachUser(anon, {}, () => {});
  assert.equal(anon.user, null);
});
