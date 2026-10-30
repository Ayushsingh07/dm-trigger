// ReplyLo — flow builder CRUD (step-style DM automations), scoped to the user.
const express = require("express");
const store = require("../store");
const flows = require("../flows");
const { attachUser, requireUser } = require("../auth");

const router = express.Router();
router.use(attachUser, requireUser);

// Plan limits for flows: free 1, trial 5, pro 25.
const FLOW_LIMITS = { free: 1, trial: 5, pro: 25 };

function flowLimit(user) {
  return FLOW_LIMITS[store.effectivePlan(user)] || 1;
}

function ownsAccount(user, accountId) {
  if (accountId === "demo") return true;
  return store.listAccounts().some((a) => a.ig_user_id === String(accountId) && a.user_id === user.id);
}

function myFlow(req) {
  const flow = store.getFlow(req.params.id);
  return flow && flow.userId === req.user.id ? flow : null;
}

// GET /api/flows — my flows with their steps and stats.
router.get("/", (req, res) => {
  const stats = new Map(store.flowStatsForUser(req.user.id).map((s) => [s.id, s]));
  const out = store.listFlows(req.user.id).map((f) => ({
    ...f,
    steps: store.listFlowSteps(f.id),
    stats: stats.get(f.id) || { sessions: 0, completed: 0 },
  }));
  res.json({ count: out.length, limit: flowLimit(req.user), flows: out });
});

// POST /api/flows — create a draft flow.
router.post("/", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "Flow needs a name" });
  const triggerType = b.triggerType === "comment_keyword" ? "comment_keyword" : "dm_keyword";
  const keyword = String(b.keyword || "").trim();
  if (!keyword) return res.status(400).json({ error: "A trigger keyword is required" });
  if (b.accountId && !ownsAccount(req.user, String(b.accountId))) {
    return res.status(403).json({ error: "Connect that account first" });
  }
  const max = flowLimit(req.user);
  if (store.countFlowsForUser(req.user.id) >= max) {
    return res.status(402).json({
      error: `Your ${store.effectivePlan(req.user)} plan allows ${max} flows. Upgrade to add more.`,
      limit: { kind: "flows", max },
    });
  }
  const flow = store.createFlow({
    userId: req.user.id, accountId: b.accountId ? String(b.accountId) : null,
    name, triggerType, keyword,
  });
  if (Array.isArray(b.steps) && b.steps.length) store.saveFlowSteps(flow.id, b.steps);
  store.trackEvent("flow_created", req.user.id, { triggerType });
  res.status(201).json({ ...flow, steps: store.listFlowSteps(flow.id) });
});

// PUT /api/flows/:id — update name/keyword/account/start step.
router.put("/:id", (req, res) => {
  const flow = myFlow(req);
  if (!flow) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.name = String(b.name).trim();
  if (b.keyword !== undefined) patch.keyword = String(b.keyword).trim();
  if (b.triggerType !== undefined) patch.triggerType = String(b.triggerType);
  if (b.accountId !== undefined) {
    if (b.accountId && !ownsAccount(req.user, String(b.accountId))) return res.status(403).json({ error: "Connect that account first" });
    patch.accountId = b.accountId ? String(b.accountId) : null;
  }
  if (b.startStepId !== undefined) patch.startStepId = b.startStepId ? String(b.startStepId) : null;
  const updated = store.updateFlow(flow.id, patch);
  res.json({ ...updated, steps: store.listFlowSteps(flow.id) });
});

// PUT /api/flows/:id/steps — replace the whole step list (builder sends all).
router.put("/:id/steps", (req, res) => {
  const flow = myFlow(req);
  if (!flow) return res.status(404).json({ error: "Not found" });
  const steps = (req.body && req.body.steps) || [];
  if (!Array.isArray(steps) || steps.length > 25) return res.status(400).json({ error: "steps must be an array of up to 25" });
  if (steps.some((s) => !String(s.text || "").trim())) return res.status(400).json({ error: "Every step needs message text" });
  try {
    res.json({ steps: store.saveFlowSteps(flow.id, steps) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/flows/:id/publish — validate then go live (or pause).
router.post("/:id/publish", (req, res) => {
  const flow = myFlow(req);
  if (!flow) return res.status(404).json({ error: "Not found" });
  const want = (req.body && req.body.status) === "paused" ? "paused" : "live";
  if (want === "live") {
    const steps = store.listFlowSteps(flow.id);
    if (!steps.length) return res.status(400).json({ error: "Add at least one step before publishing" });
    if (!flow.keyword) return res.status(400).json({ error: "Set a trigger keyword before publishing" });
  }
  const updated = store.updateFlow(flow.id, { status: want });
  store.trackEvent(want === "live" ? "flow_published" : "flow_paused", req.user.id, { flow: flow.id });
  res.json(updated);
});

// POST /api/flows/:id/test — validate the steps and return the rendered
// preview (what Meta would receive). No DM is sent from the builder.
router.post("/:id/test", (req, res) => {
  const flow = myFlow(req);
  if (!flow) return res.status(404).json({ error: "Not found" });
  const steps = store.listFlowSteps(flow.id);
  if (!steps.length) return res.status(400).json({ error: "Add steps first" });
  const preview = steps.map((s) => ({
    text: s.text,
    quick_replies: (s.buttons || []).map((b) => b.label || b.payload),
    links: (s.links || []).map((l) => l.url),
    followGate: s.followGate, isEnd: s.isEnd,
  }));
  res.json({ ok: true, preview });
});

// POST /api/flows/:id/start — manually kick a flow for a psid (support tool).
router.post("/:id/start", async (req, res) => {
  const flow = myFlow(req);
  if (!flow) return res.status(404).json({ error: "Not found" });
  const { psid, accountId } = req.body || {};
  if (!psid || !accountId) return res.status(400).json({ error: "psid and accountId required" });
  const account = store.getAccount(String(accountId));
  if (!account || account.user_id !== req.user.id) return res.status(403).json({ error: "Not your account" });
  const r = await flows.startFlow(flow, { account, accessToken: account.accessToken, psid: String(psid) });
  res.json(r);
});

// DELETE /api/flows/:id
router.delete("/:id", (req, res) => {
  const flow = myFlow(req);
  if (!flow) return res.status(404).json({ error: "Not found" });
  store.deleteFlow(flow.id);
  res.json({ ok: true });
});

module.exports = router;
