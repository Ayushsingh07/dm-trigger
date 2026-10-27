const { cleanup } = require("./helpers");
const { test, after, before, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");

const config = require("../src/config");
const webhook = require("../src/routes/webhook");

// Minimal app mirroring server.js's raw-body capture, without opening a port
// or booting the rest of the app.
const app = express();
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use("/webhook", webhook);

const SECRET = "unit-test-app-secret";
const sign = (body) => "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");

let base;
let server;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  cleanup();
});

const ACK = JSON.stringify({ object: "unittest", entry: [] }); // acked, not processed

describe("POST /webhook signature enforcement", () => {
  before(() => { config.metaAppSecret = SECRET; });

  test("valid signature -> 200", async () => {
    const res = await fetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(ACK) },
      body: ACK,
    });
    assert.equal(res.status, 200);
  });

  test("tampered body -> 403", async () => {
    const res = await fetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(ACK) },
      body: ACK.replace("unittest", "eviltest"),
    });
    assert.equal(res.status, 403);
  });

  test("missing signature -> 403", async () => {
    const res = await fetch(`${base}/webhook`, {
      method: "POST", headers: { "content-type": "application/json" }, body: ACK,
    });
    assert.equal(res.status, 403);
  });

  test("malformed signature header -> 403", async () => {
    for (const header of ["sha256=notHex", "notsha=abc", "sha256=" + "00".repeat(31), "garbage"]) {
      const res = await fetch(`${base}/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": header },
        body: ACK,
      });
      assert.equal(res.status, 403, `header ${header} must be rejected`);
    }
  });

  test("empty-object body still requires a valid signature", async () => {
    const body = "{}";
    const bad = await fetch(`${base}/webhook`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    assert.equal(bad.status, 403);
    const good = await fetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
      body,
    });
    assert.equal(good.status, 200);
  });
});

describe("POST /webhook without META_APP_SECRET (dry-run)", () => {
  before(() => { config.metaAppSecret = ""; });

  test("unsigned body accepted in dry-run mode", async () => {
    const res = await fetch(`${base}/webhook`, {
      method: "POST", headers: { "content-type": "application/json" }, body: ACK,
    });
    assert.equal(res.status, 200);
  });
});

describe("GET /webhook (Meta subscription verification)", () => {
  const url = (q) => `${base}/webhook?${q}`;

  test("correct verify token echoes challenge", async () => {
    config.verifyToken = "expected-token";
    const res = await fetch(url("hub.mode=subscribe&hub.verify_token=expected-token&hub.challenge=42"));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "42");
  });

  test("wrong token -> 403", async () => {
    const res = await fetch(url("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"));
    assert.equal(res.status, 403);
  });

  test("wrong mode -> 403", async () => {
    const res = await fetch(url("hub.mode=unsubscribe&hub.verify_token=expected-token&hub.challenge=42"));
    assert.equal(res.status, 403);
  });

  test("no query params -> 403", async () => {
    assert.equal((await fetch(`${base}/webhook`)).status, 403);
  });
});
