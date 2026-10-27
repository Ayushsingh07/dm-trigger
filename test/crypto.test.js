const { cleanup } = require("./helpers");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const { encrypt, decrypt, sealToken, openToken, encryptionAvailable, looksLikePlaintext, migrateTokensAtRest } = require("../src/crypto");
const store = require("../src/store");

after(cleanup);

test("encrypt/decrypt round-trip", () => {
  assert.ok(encryptionAvailable());
  const ct = encrypt("IGQVJ7secret");
  assert.ok(ct.startsWith("v1:"));
  assert.notEqual(ct, "IGQVJ7secret");
  assert.equal(decrypt(ct), "IGQVJ7secret");
});

test("two encryptions of same plaintext differ (random IV)", () => {
  assert.notEqual(encrypt("same"), encrypt("same"));
});

test("decrypt throws on tampered ciphertext", () => {
  const ct = encrypt("hello");
  const parts = ct.split(":");
  const bad = Buffer.from(parts[3], "base64");
  bad[0] ^= 0xff;
  parts[3] = bad.toString("base64");
  assert.throws(() => decrypt(parts.join(":")));
});

test("sealToken/openToken round-trip and passthrough", () => {
  assert.equal(openToken(sealToken("tok123")), "tok123");
  assert.equal(sealToken(""), "");
  assert.equal(sealToken(null), null);
  // legacy plaintext row passes through openToken unchanged
  assert.equal(openToken("EAAOldPlainToken"), "EAAOldPlainToken");
  assert.ok(looksLikePlaintext("IGQ..."));
  assert.ok(!looksLikePlaintext(encrypt("x")));
});

test("store encrypts access_token at rest transparently", () => {
  store.upsertAccount({ igUserId: "111", username: "a", accessToken: "plain_secret", userId: null });
  const row = store.db.prepare("SELECT access_token FROM accounts WHERE ig_user_id='111'").get();
  assert.ok(row.access_token.startsWith("v1:"), "column must hold ciphertext");
  assert.equal(store.getAccount("111").accessToken, "plain_secret");
});

test("migrateTokensAtRest encrypts legacy rows, idempotent", () => {
  store.db.prepare("INSERT INTO accounts (ig_user_id, access_token, connected_at) VALUES (?,?,?)")
    .run("222", "EAAlegacytoken", new Date().toISOString());
  const r1 = migrateTokensAtRest(store.db);
  assert.ok(r1.migrated >= 1);
  const row = store.db.prepare("SELECT access_token FROM accounts WHERE ig_user_id='222'").get();
  assert.ok(row.access_token.startsWith("v1:"));
  const r2 = migrateTokensAtRest(store.db);
  assert.equal(r2.migrated, 0); // second run is a no-op
  assert.equal(store.getAccount("222").accessToken, "EAAlegacytoken");
});
