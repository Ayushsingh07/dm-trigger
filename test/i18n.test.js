// i18n: locale resolution, Accept-Language parsing, translation fallback,
// and the "/" redirect behavior (including that API/webhook paths are never
// redirected). Runs against the real locale files.
require("./helpers");
const { test } = require("node:test");
const assert = require("node:assert");

const {
  SUPPORTED, DEFAULT, normalizeLocale, parseAcceptLanguage, fromAcceptLanguage,
  resolveLocale, rootRedirect, t,
} = require("../src/i18n");
const { localeRouting } = require("../src/i18nPages");

// ------------------------------------------------------------------ basics
test("SUPPORTED contains every required locale, default is en", () => {
  for (const loc of ["en", "es", "pt-BR", "fr", "de", "ja", "hi", "id"]) {
    assert.ok(SUPPORTED.includes(loc), `missing ${loc}`);
  }
  assert.strictEqual(DEFAULT, "en");
});

test("normalizeLocale matches exact tags case-insensitively and bases", () => {
  assert.strictEqual(normalizeLocale("pt-BR"), "pt-BR");
  assert.strictEqual(normalizeLocale("pt-br"), "pt-BR");
  assert.strictEqual(normalizeLocale("ES"), "es");
  assert.strictEqual(normalizeLocale("pt"), "pt-BR"); // base falls to full variant
  assert.strictEqual(normalizeLocale("xx"), null);
  assert.strictEqual(normalizeLocale(null), null);
});

// ------------------------------------------------------------------ Accept-Language
test("parseAcceptLanguage sorts by q desc, then original order", () => {
  const p = parseAcceptLanguage("en;q=0.9,pt-BR;q=0.8,hi");
  assert.deepStrictEqual(p.map((x) => x.tag), ["hi", "en", "pt-BR"]);
  assert.strictEqual(p[0].q, 1);
  assert.strictEqual(p[1].q, 0.9);
});

test("fromAcceptLanguage matches full tag before base language", () => {
  assert.strictEqual(fromAcceptLanguage("pt-PT,pt;q=0.9"), "pt-BR");
  assert.strictEqual(fromAcceptLanguage("en-GB"), "en");
  assert.strictEqual(fromAcceptLanguage("de-DE,ja;q=0.5"), "de");
  assert.strictEqual(fromAcceptLanguage("sw"), null); // unsupported
  assert.strictEqual(fromAcceptLanguage("hi;q=0"), null); // q=0 excluded
  assert.strictEqual(fromAcceptLanguage(null), null);
});

// ------------------------------------------------------------------ resolveLocale priority
const req = (o) => ({ headers: {}, ...o });

test("resolveLocale: URL prefix beats cookie, user and header", () => {
  const r = req({
    params: { lang: "ja" },
    headers: { cookie: "rf_lang=de", "accept-language": "fr" },
    user: { lang: "es" },
  });
  assert.strictEqual(resolveLocale(r), "ja");
});

test("resolveLocale: cookie beats saved user lang and header", () => {
  const r = req({
    headers: { cookie: "rf_lang=fr", "accept-language": "de" },
    user: { lang: "es" },
  });
  assert.strictEqual(resolveLocale(r), "fr");
});

test("resolveLocale: user lang beats header", () => {
  const r = req({ headers: { "accept-language": "de" }, user: { lang: "hi" } });
  assert.strictEqual(resolveLocale(r), "hi");
});

test("resolveLocale: header used when no cookie/user, else en", () => {
  assert.strictEqual(resolveLocale(req({ headers: { "accept-language": "id,en;q=0.5" } })), "id");
  assert.strictEqual(resolveLocale(req({})), "en");
});

// ------------------------------------------------------------------ t() fallback
test("t: exact hit, English fallback for missing key, key itself when unknown", () => {
  assert.strictEqual(t("en", "landing.how.title"), "Three steps. Zero typing.");
  // es is fully translated -> returns Spanish
  assert.strictEqual(t("es", "landing.how.title"), "Tres pasos. Cero esfuerzo.");
  // de is fully translated -> returns German
  assert.strictEqual(t("de", "landing.how.title"), "Drei Schritte. Null Tipparbeit.");
  assert.strictEqual(t("de", "no.such.key.exists"), "no.such.key.exists");
  assert.strictEqual(t("xx", "landing.how.title"), "Three steps. Zero typing."); // bad locale -> en
});

test("t: placeholders interpolated from vars", () => {
  assert.strictEqual(t("en", "pricing.repliesPerPost", { count: 100 }), "100 replies per post");
  assert.strictEqual(t("en", "common.rights", { year: "2026" }), "© 2026 ReplyLo");
});

// ------------------------------------------------------------------ "/" redirect
test("rootRedirect: non-English Accept-Language without cookie -> 302 target", () => {
  assert.strictEqual(rootRedirect(req({ headers: { "accept-language": "pt-BR,pt;q=0.9" } })), "pt-BR");
  assert.strictEqual(rootRedirect(req({ headers: { "accept-language": "fr-FR" } })), "fr");
});

test("rootRedirect: no Accept-Language header -> no redirect (serve English)", () => {
  assert.strictEqual(rootRedirect(req({})), null);
});

test("rootRedirect: English or unsupported header -> no redirect", () => {
  assert.strictEqual(rootRedirect(req({ headers: { "accept-language": "en-US,en;q=0.9" } })), null);
  assert.strictEqual(rootRedirect(req({ headers: { "accept-language": "sw,tl" } })), null);
});

test("rootRedirect: existing rf_lang cookie wins -> no redirect", () => {
  const r = req({ headers: { cookie: "rf_lang=en", "accept-language": "ja" } });
  assert.strictEqual(rootRedirect(r), null);
});

// ------------------------------------------------------------------ routing middleware
function fakeRes() {
  const res = {
    statusCode: null, location: null, sent: null, headers: {},
    redirect(code, loc) { this.statusCode = code; this.location = loc; },
    set(k, v) { this.headers[k] = v; },
    append(k, v) { if (!this.headers[k]) this.headers[k] = []; this.headers[k].push(v); },
    send(body) { this.sent = body; },
  };
  return res;
}

test("localeRouting: /webhook, /health, /api/*, /billing/*, /meta/* fall through", () => {
  for (const path of ["/webhook", "/health", "/api/status", "/api/me/lang", "/billing/webhook", "/meta/data-deletion"]) {
    let nexted = false;
    localeRouting({ method: "GET", path, headers: { "accept-language": "ja" } }, fakeRes(), () => { nexted = true; });
    assert.ok(nexted, `${path} must not be redirected or served`);
  }
});

test("localeRouting: / with Accept-Language ja redirects 302 and sets cookie", () => {
  const res = fakeRes();
  localeRouting({ method: "GET", path: "/", headers: { "accept-language": "ja" } }, res, () => {});
  assert.strictEqual(res.statusCode, 302);
  assert.strictEqual(res.location, "/ja");
  assert.match(res.headers["Set-Cookie"][0], /^rf_lang=ja;/);
  assert.match(res.headers["Set-Cookie"][0], /SameSite=Lax/);
  assert.match(res.headers["Set-Cookie"][0], /Max-Age=31536000/);
});

test("localeRouting: / without Accept-Language serves the landing page (200 HTML)", () => {
  const res = fakeRes();
  localeRouting({ method: "GET", path: "/", headers: {} }, res, () => {});
  assert.strictEqual(res.statusCode, null); // no redirect
  assert.ok(res.sent.includes("<html lang=\"en\" dir=\"ltr\""));
  assert.ok(res.sent.includes("id=\"i18n\""));
  assert.ok(!res.sent.includes("{{t:"), "all tokens replaced");
});

test("localeRouting: /ja serves Japanese landing with hreflang links", () => {
  const res = fakeRes();
  localeRouting({ method: "GET", path: "/ja", headers: {} }, res, () => {});
  assert.ok(res.sent.includes("<html lang=\"ja\" dir=\"ltr\""));
  assert.ok(res.sent.includes('hreflang="ja"'));
  assert.ok(res.sent.includes('hreflang="x-default"'));
  assert.ok(res.sent.includes('rel="canonical"'));
});

test("localeRouting: /es/pricing renders localized pricing page", () => {
  const res = fakeRes();
  localeRouting({ method: "GET", path: "/es/pricing", headers: {} }, res, () => {});
  assert.ok(res.sent.includes("<html lang=\"es\""));
  assert.ok(res.sent.includes("Precios prepago simples")); // es is translated
  assert.ok(!res.sent.includes("{{t:"));
});

test("localeRouting: /en/pricing 301s to canonical /pricing", () => {
  const res = fakeRes();
  localeRouting({ method: "GET", path: "/en/pricing", headers: {} }, res, () => {});
  assert.strictEqual(res.statusCode, 301);
  assert.strictEqual(res.location, "/pricing");
});

test("localeRouting: unknown paths fall through", () => {
  let nexted = false;
  localeRouting({ method: "GET", path: "/app", headers: {} }, fakeRes(), () => { nexted = true; });
  assert.ok(nexted);
});

// ---------------------------------------------------------------- plurals
const { tplural, pluralCategory } = require("../src/i18n");

test("pluralCategory: english one/other", () => {
  assert.strictEqual(pluralCategory("en", 1), "one");
  assert.strictEqual(pluralCategory("en", 0), "other");
  assert.strictEqual(pluralCategory("en", 5), "other");
});

test("tplural: picks key.one / key.other and interpolates {count}", () => {
  assert.strictEqual(tplural("en", "app.daysLeft", 1, { count: 1 }), "1 day left");
  assert.strictEqual(tplural("en", "app.daysLeft", 7, { count: 7 }), "7 days left");
});

test("tplural: falls back to other when the exact category is missing", () => {
  // ja is fully translated -> ja key.other for count 2
  assert.strictEqual(tplural("ja", "app.daysLeft", 2, { count: 2 }), "残り2日");
});

test("tplural: unknown key returns the key itself", () => {
  assert.strictEqual(tplural("en", "nope.missing", 3, { count: 3 }), "nope.missing");
});

test("localeRouting: /<lang>/app-style pages redirect to the canonical URL with the lang cookie", () => {
  const cases = [
    ["/hi/app", "/app"], ["/ja/login", "/login"], ["/ko/signup", "/signup"],
    ["/de/billing", "/billing"], ["/fr/admin", "/admin"], ["/bn/app/", "/app"],
  ];
  for (const [from, to] of cases) {
    const res = fakeRes();
    localeRouting({ method: "GET", path: from, originalUrl: from, headers: {} }, res, () => {});
    assert.strictEqual(res.statusCode, 302, `${from} must redirect`);
    assert.strictEqual(res.location, to, `${from} -> ${to}`);
    const cookie = (res.headers["Set-Cookie"] || []).join(";");
    assert.ok(cookie.includes("rf_lang="), `${from} must set the lang cookie`);
  }
});

test("localeRouting: /hi/app keeps the query string; /webhook and /api still fall through", () => {
  const res = fakeRes();
  localeRouting({ method: "GET", path: "/hi/app", originalUrl: "/hi/app?x=1", headers: {} }, res, () => {});
  assert.strictEqual(res.location, "/app?x=1");
  for (const path of ["/webhook", "/api/status", "/billing/webhook"]) {
    let nexted = false;
    localeRouting({ method: "GET", path, originalUrl: path, headers: {} }, fakeRes(), () => { nexted = true; });
    assert.ok(nexted, `${path} must not be touched`);
  }
});
