const { cleanup } = require("./helpers");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { commentMatchesKeyword } = require("../src/actions");
const { buildDMMessage, parseSignedRequest } = require("../src/meta");
const config = require("../src/config");

after(cleanup);

// ---------------------------------------------------------------- keyword matching
test("keyword match: case-insensitive whole word", () => {
  assert.equal(commentMatchesKeyword("guide please! 🙌", "GUIDE"), true);
  assert.equal(commentMatchesKeyword("Guide", "guide"), true);
  assert.equal(commentMatchesKeyword("  PRICE  ", "price"), true);
});

test("keyword match: punctuation and emoji boundaries count", () => {
  assert.equal(commentMatchesKeyword("price?", "price"), true);
  assert.equal(commentMatchesKeyword("hi,price,now", "price"), true);
  assert.equal(commentMatchesKeyword("want the guide 🙌", "guide"), true);
  assert.equal(commentMatchesKeyword("(link)", "link"), true);
});

test("keyword match: no partial-word matches", () => {
  assert.equal(commentMatchesKeyword("guider", "guide"), false);
  assert.equal(commentMatchesKeyword("overpriced", "price"), false);
  assert.equal(commentMatchesKeyword("aguide", "guide"), false);
  assert.equal(commentMatchesKeyword("guidez", "guide"), false);
  assert.equal(commentMatchesKeyword("", "guide"), false);
  assert.equal(commentMatchesKeyword("guide", ""), false, "empty keyword never matches");
  assert.equal(commentMatchesKeyword(null, "guide"), false);
});

test("keyword match: emoji directly adjacent still matches", () => {
  // \p{L}\p{N} boundaries: emoji is neither a letter nor a number.
  assert.equal(commentMatchesKeyword("guide🙌", "GUIDE"), true);
  assert.equal(commentMatchesKeyword("🙌guide🙌", "guide"), true);
  assert.equal(commentMatchesKeyword("guide please! 🙌", "GUIDE"), true);
});

test("keyword match: accents folded both directions", () => {
  assert.equal(commentMatchesKeyword("send the menu pls", "MENÚ"), true);
  assert.equal(commentMatchesKeyword("send the menú pls", "MENU"), true);
  assert.equal(commentMatchesKeyword("quero o preco", "PREÇO"), true);
  assert.equal(commentMatchesKeyword("o preço por favor", "PRECO"), true);
});

test("keyword match: Devanagari matches exactly (matras not stripped first)", () => {
  assert.equal(commentMatchesKeyword("मुझे मेनू भेजो 🙌", "मेनू"), true);
  assert.equal(commentMatchesKeyword("मेनू", "मेनू"), true);
  assert.equal(commentMatchesKeyword("मेनूूू", "मेनू"), true, "accent-fold pass");
});

test("keyword match: Japanese substring mode + full-width folding", () => {
  // kana keyword -> substring match (no spaces in Japanese)
  assert.equal(commentMatchesKeyword("レシピを教えてください", "レシピ"), true);
  assert.equal(commentMatchesKeyword("ガイド", "ガイド"), true);
  assert.equal(commentMatchesKeyword("みんガイドさん", "ガイド"), true, "substring mode ignores boundaries");
  // full-width Latin folds to ASCII and uses Latin boundaries
  assert.equal(commentMatchesKeyword("ＧＵＩＤＥ please", "guide"), true);
  assert.equal(commentMatchesKeyword("please ＧＵＩＤＥ!", "GUIDE"), true);
  assert.equal(commentMatchesKeyword("guider", "ＧＵＩＤＥ"), false);
});

test("keyword match: Thai substring mode", () => {
  assert.equal(commentMatchesKeyword("สวัสดีครับขอคู่มือ", "คู่มือ"), true);
});

test("keyword match: regex metacharacters are escaped", () => {
  assert.equal(commentMatchesKeyword("a+b", "a+b"), true);
  assert.equal(commentMatchesKeyword("axb", "a+b"), false);
  assert.equal(commentMatchesKeyword("c.d", "c.d"), true);
  assert.equal(commentMatchesKeyword("cxd", "c.d"), false);
});

// ---------------------------------------------------------------- DM message shape
test("buildDMMessage: plain text with {name} substitution", () => {
  assert.deepEqual(buildDMMessage("Hi {name}!", [], "Bob"), { text: "Hi Bob!" });
  assert.deepEqual(buildDMMessage("Hi {name} and {name}", [{ url: "u", title: "t" }], "Z"),
    {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Hi Z and Z",
          buttons: [{ type: "web_url", title: "t", url: "u", webview_height_ratio: "tall" }],
        },
      },
    });
});

test("buildDMMessage: caps at 3 buttons and 20-char titles", () => {
  const links = Array.from({ length: 5 }, (_, i) => ({ title: `very long title number ${i}`, url: `https://x/${i}` }));
  const msg = buildDMMessage("t", links);
  const buttons = msg.attachment.payload.buttons;
  assert.equal(buttons.length, 3);
  for (const b of buttons) assert.ok(b.title.length <= 20);
});

test("buildDMMessage: missing name defaults to 'there'", () => {
  assert.equal(buildDMMessage("Hey {name}").text, "Hey there");
});

// ---------------------------------------------------------------- signed_request
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

test("parseSignedRequest: valid request decodes", () => {
  config.metaAppSecret = "s3cr3t-app-secret";
  const payload = b64u({ algorithm: "HMAC-SHA256", user_id: "1234", issued_at: 1700000000 });
  const sig = crypto.createHmac("sha256", "s3cr3t-app-secret").update(payload).digest("base64url");
  assert.deepEqual(parseSignedRequest(`${sig}.${payload}`).user_id, "1234");
});

test("parseSignedRequest: wrong secret / tampered payload -> null", () => {
  config.metaAppSecret = "s3cr3t-app-secret";
  const payload = b64u({ user_id: "1234" });
  const sig = crypto.createHmac("sha256", "WRONG-secret").update(payload).digest("base64url");
  assert.equal(parseSignedRequest(`${sig}.${payload}`), null);

  const good = crypto.createHmac("sha256", "s3cr3t-app-secret").update(payload).digest("base64url");
  const evil = b64u({ user_id: "attacker" });
  assert.equal(parseSignedRequest(`${good}.${evil}`), null);
});

test("parseSignedRequest: malformed input -> null", () => {
  config.metaAppSecret = "s3cr3t-app-secret";
  for (const bad of ["", null, undefined, "nodot", "a.b", "sig."]) {
    assert.equal(parseSignedRequest(bad), null, `should reject ${String(bad)}`);
  }
});

test("parseSignedRequest: no app secret configured -> null", () => {
  config.metaAppSecret = "";
  const payload = b64u({ user_id: "1" });
  const sig = crypto.createHmac("sha256", "").update(payload).digest("base64url");
  assert.equal(parseSignedRequest(`${sig}.${payload}`), null);
});
