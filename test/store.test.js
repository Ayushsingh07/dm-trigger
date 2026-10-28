const { cleanup } = require("./helpers");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const store = require("../src/store");

after(cleanup);

const now = () => new Date().toISOString();

test("users: create + lookup by email/id, email normalised", () => {
  const u = store.createUser({ email: "  Alice@Example.COM ", passwordHash: "s:h", name: "Alice" });
  assert.equal(u.email, "alice@example.com");
  assert.equal(u.role, "user");
  assert.equal(u.plan, "free");
  assert.ok(u.trial_ends_at);
  assert.ok(store.getUserById(u.id));
  assert.equal(store.getUserByEmail("alice@example.com").id, u.id);
  assert.equal(store.getUserByEmail("nobody@example.com"), null);
});

test("duplicate email rejected by UNIQUE", () => {
  store.createUser({ email: "dup@x.com", passwordHash: "s:h" });
  assert.throws(() => store.createUser({ email: "dup@x.com", passwordHash: "s:h" }), /UNIQUE/);
});

test("rules: create/update/delete round-trip with JSON fields", () => {
  const r = store.createRule({
    accountId: "acct1", userId: "u1", keyword: " price ",
    links: [{ title: "Shop", url: "https://x.com" }], reminderAfterMin: 30,
  });
  assert.equal(r.keyword, "price");
  assert.equal(r.active, true);
  assert.equal(r.links.length, 1);

  const updated = store.updateRule(r.id, { active: false, keyword: "guide" });
  assert.equal(updated.active, false);
  assert.equal(updated.keyword, "guide");
  assert.equal(updated.reminderAfterMin, 30);

  assert.equal(store.getRule(r.id).keyword, "guide");
  assert.equal(store.rulesForAccount("acct1").length, 1);
  assert.equal(store.deleteRule(r.id), true);
  assert.equal(store.getRule(r.id), null);
});

test("rules: validation — missing fields and >3 links", () => {
  assert.throws(() => store.createRule({ accountId: "a", keyword: "" }), /required/);
  assert.throws(() => store.createRule({ accountId: "", keyword: "X" }), /required/);
  assert.throws(
    () => store.createRule({ accountId: "a", keyword: "X", links: Array.from({ length: 4 }, (_, i) => ({ url: `https://x/${i}` })) }),
    /at most 3 links/
  );
});

test("conversations: UNIQUE(comment_id) returns null on Meta retry", () => {
  const c1 = store.createConversation({ accountId: "a1", userId: "u1", psid: "p1", commentId: "1789_1", ruleId: "r1" });
  assert.ok(c1 && c1.status === "sent");
  const dup = store.createConversation({ accountId: "a1", userId: "u1", psid: "p1", commentId: "1789_1", ruleId: "r1" });
  assert.equal(dup, null);
});

test("conversations: NULL comment_id allowed multiple times (demo rows)", () => {
  const a = store.createConversation({ accountId: "a1", psid: "pd1", commentId: null, ruleId: "r1" });
  const b = store.createConversation({ accountId: "a1", psid: "pd2", commentId: null, ruleId: "r1" });
  assert.ok(a && b);
});

test("conversations: update patch is partial", () => {
  const c = store.createConversation({ accountId: "a2", psid: "p2", commentId: "c-2", ruleId: "r2", reminderAt: "2030-01-01T00:00:00.000Z" });
  const upd = store.updateConversation(c.id, { status: "replied" });
  assert.equal(upd.status, "replied");
  assert.equal(upd.reminderAt, "2030-01-01T00:00:00.000Z"); // untouched
  assert.equal(upd.reminded, false);
  assert.equal(store.updateConversation("missing", { status: "sent" }), null);
});

test("dueReminders: only due, un-reminded, still 'sent'", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();
  const due = store.createConversation({ accountId: "a3", psid: "p3", commentId: "d1", ruleId: "r3", reminderAt: past });
  store.createConversation({ accountId: "a3", psid: "p4", commentId: "d2", ruleId: "r3", reminderAt: future });
  store.createConversation({ accountId: "a3", psid: "p5", commentId: "d3", ruleId: "r3", reminderAt: past });
  store.updateConversation(store.lastConversationForPsid("p5").id, { reminded: true });
  store.createConversation({ accountId: "a3", psid: "p6", commentId: "d4", ruleId: "r3", reminderAt: past });
  store.updateConversation(store.lastConversationForPsid("p6").id, { status: "replied" });

  const dueRows = store.dueReminders();
  const ids = dueRows.map((r) => r.id);
  assert.ok(ids.includes(due.id));
  assert.equal(ids.length, 1, `expected exactly one due row, got ${ids.length}`);
});

test("lastConversationForPsid honours optional status filter", () => {
  store.createConversation({ accountId: "a4", psid: "filterme", commentId: "f1", ruleId: "r4" });
  const c2 = store.createConversation({ accountId: "a4", psid: "filterme", commentId: "f2", ruleId: "r4" });
  store.updateConversation(c2.id, { status: "email_collected" });
  assert.equal(store.lastConversationForPsid("filterme").id, c2.id);
  assert.equal(store.lastConversationForPsid("filterme", "sent").commentId, "f1");
});

test("emails collected and listed", () => {
  const id = store.collectEmail({ accountId: "a5", userId: "u5", psid: "p9", email: " Bob@X.com ", ruleId: "r5" });
  assert.ok(id.startsWith("e_"));
  const list = store.emailsForAccount("a5");
  assert.equal(list[0].email, "bob@x.com");
});

test("plans: limits, trial expiry, effective plan", () => {
  assert.equal(store.limitsForPlan("free").rules, 3);
  assert.equal(store.limitsForPlan("free").accounts, 1);
  assert.equal(store.limitsForPlan("free").conversationsPerMonth, 100);
  assert.equal(store.limitsForPlan("trial").rules, 15);
  assert.equal(store.limitsForPlan("pro").accounts, 10);
  assert.equal(store.limitsForPlan("bogus").rules, 3, "unknown plan falls back to free");

  const expired = { plan: "trial", status: "trialing", trial_ends_at: "2020-01-01T00:00:00.000Z" };
  const live = { plan: "trial", status: "trialing", trial_ends_at: "2099-01-01T00:00:00.000Z" };
  assert.equal(store.isTrialExpired(expired), true);
  assert.equal(store.isTrialExpired(live), false);
  assert.equal(store.effectivePlan(expired), "free");
  assert.equal(store.effectivePlan(live), "trial");
  assert.equal(store.effectivePlan({ plan: "pro", status: "canceled" }), "free");
  assert.equal(store.effectivePlan(null), "free");
});

test("planUsage counts accounts, rules and this month's conversations", () => {
  const u = store.createUser({ email: "usage@x.com", passwordHash: "s:h", plan: "trial" });
  store.upsertAccount({ igUserId: "acc-u1", accessToken: "t", userId: u.id });
  store.createRule({ accountId: "acc-u1", userId: u.id, keyword: "K1" });
  store.createRule({ accountId: "acc-u1", userId: u.id, keyword: "K2" });
  store.createConversation({ accountId: "acc-u1", userId: u.id, psid: "p", commentId: "pu1", ruleId: "r" });

  const usage = store.planUsage(store.getUserById(u.id));
  assert.equal(usage.plan, "trial");
  assert.equal(usage.usage.accounts, 1);
  assert.equal(usage.usage.rules, 2);
  assert.equal(usage.usage.conversationsThisMonth, 1);
  assert.equal(usage.trialExpired, false);
  assert.equal(store.countConversationsThisMonth(u.id), 1);
});

test("deleteUserCompletely erases everything owned", () => {
  const u = store.createUser({ email: "gone@x.com", passwordHash: "s:h" });
  store.upsertAccount({ igUserId: "acc-del", accessToken: "t", userId: u.id });
  const rule = store.createRule({ accountId: "acc-del", userId: u.id, keyword: "DEL" });
  store.createConversation({ accountId: "acc-del", userId: u.id, psid: "pp", commentId: "del1", ruleId: rule.id });
  store.collectEmail({ accountId: "acc-del", userId: u.id, psid: "pp", email: "gone@x.com", ruleId: rule.id });
  store.trackEvent("signup", u.id, {});

  store.deleteUserCompletely(u.id);
  assert.equal(store.getUserById(u.id), null);
  assert.equal(store.getAccount("acc-del"), null);
  assert.equal(store.getRule(rule.id), null);
  assert.equal(store.countConversationsThisMonth(u.id), 0);
  assert.equal(store.emailsForAccount("acc-del").length, 0);
});

test("deleteAccountByIgUserId removes account, reassigns rules", () => {
  const u = store.createUser({ email: "reassign@x.com", passwordHash: "s:h" });
  store.upsertAccount({ igUserId: "acc-re", accessToken: "t", userId: u.id });
  const rule = store.createRule({ accountId: "acc-re", userId: u.id, keyword: "RE" });
  assert.equal(store.deleteAccountByIgUserId("acc-re"), true);
  assert.equal(store.deleteAccountByIgUserId("nope"), false);
  assert.equal(store.getRule(rule.id).accountId, "demo");
});

test("purgeExpiredSessions removes only expired rows", () => {
  const u = store.createUser({ email: "sess@x.com", passwordHash: "s:h" });
  store.db.prepare("INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run("expired-tok", u.id, now(), "2020-01-01T00:00:00.000Z");
  store.db.prepare("INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run("valid-tok", u.id, now(), "2099-01-01T00:00:00.000Z");
  const removed = store.purgeExpiredSessions();
  assert.ok(removed >= 1);
  assert.equal(store.db.prepare("SELECT 1 FROM sessions WHERE token='expired-tok'").get(), undefined);
  assert.ok(store.db.prepare("SELECT 1 FROM sessions WHERE token='valid-tok'").get());
});

test("oauth state is single-use", () => {
  const state = store.createOAuthState("u_x");
  assert.ok(store.consumeOAuthState(state));
  assert.equal(store.consumeOAuthState(state), null);
});

test("trackVisit + adminMetrics return the expected shape", () => {
  store.trackVisit({ path: "/pricing", referrer: "google", ua: "ua-string" });
  const m = store.adminMetrics();
  assert.ok(m.totals.users >= 1);
  assert.ok(m.totals.visits >= 1);
  assert.ok(m.funnel.visited >= 1);
  assert.ok(Array.isArray(m.series.signups));
  assert.ok(Array.isArray(m.recentUsers));
  assert.ok(m.topPaths.some((p) => p.path === "/pricing"));
});
