// Flow engine: multi-step DM automations driven by quick-reply chips.
// A flow session tracks one follower's position; inbound DMs (typed text or
// quick_reply payloads) advance them through the steps. Sessions expire after
// the 24h messaging window so we never send outside it.

const store = require("./store");
const meta = require("./meta");
const logger = require("./logger");
const { commentMatchesKeyword } = require("./keyword");

const WINDOW_MS = 24 * 3600 * 1000; // Meta's 24-hour user-initiated window
const GATE_YES = /^(yes|y|done|followed|ok|done✅|haan|ho gaya|kiya)\b/i;

// Default progression: next step by position (steps are ordered).
function nextStepAfter(flowId, stepId) {
  const steps = store.listFlowSteps(flowId);
  const i = steps.findIndex((s) => s.id === stepId);
  if (i === -1 || i === steps.length - 1) return null;
  return steps[i + 1];
}

// Send one step's message(s) to the follower and park the session on it.
async function sendStep({ flow, step, account, accessToken, psid, name, sessionId }) {
  const links = (step.links || []).map((l) => ({ ...l, url: rewriteLink(l.url, { flow, account, psid }) }));
  const messages = meta.buildStepMessage(step, links, name);
  let allOk = true;
  for (const m of messages) {
    const res = await meta.sendDM(accessToken, psid, m, account.ig_user_id || account.id);
    if (!res.ok) { allOk = false; logger.warn({ flow: flow.id, step: step.id, psid, status: res.status }, "[flow] step send failed"); }
  }
  store.updateFlowSession(sessionId, { stepId: step.id, status: step.isEnd ? "completed" : "active", lastMsg: new Date().toISOString() });
  return allOk;
}

// Track flow links like rule links (rewrite to /go/<token>) when we know the owner.
function rewriteLink(url, { flow, account, psid }) {
  if (!flow.userId || !url || !/^https?:\/\//i.test(url)) return url;
  try {
    const conv = store.lastConversationForPsid(psid);
    const token = store.createGoLink({
      convId: conv ? conv.id : null, userId: flow.userId,
      accountId: account.ig_user_id || account.id, ruleId: null,
      postId: null, url,
    });
    const base = (require("./config").publicBaseUrl || "").replace(/\/$/, "");
    return `${base}/go/${token}`;
  } catch {
    return url;
  }
}

// Start a follower on a flow (from a comment keyword or a DM keyword trigger).
async function startFlow(flow, { account, accessToken, psid, name = "there" }) {
  const steps = store.listFlowSteps(flow.id);
  if (!steps.length) return { ok: false, reason: "no_steps" };
  const first = steps.find((s) => s.id === flow.startStepId) || steps[0];
  const sessionId = store.startFlowSession({
    flowId: flow.id, userId: flow.userId, accountId: account.ig_user_id || account.id, psid, stepId: first.id,
  });
  logger.info({ flow: flow.id, psid, step: first.id }, "[flow] start");
  const ok = await sendStep({ flow, step: first, account, accessToken, psid, name, sessionId });
  return { ok, sessionId };
}

// Advance an active session from an inbound message. Returns true when the
// message was consumed by a flow (so other handlers don't double-answer).
async function advanceFlow(session, { text, payload, name = "there" }) {
  const flow = store.getFlow(session.flow_id);
  if (!flow || flow.status !== "live") { store.updateFlowSession(session.id, { status: "completed" }); return false; }
  const account = store.getAccount(session.account_id);
  if (!account) return false;

  // Outside the messaging window? Close the session; never send.
  const last = session.last_msg_at ? new Date(session.last_msg_at).getTime() : 0;
  if (!last || Date.now() - last > WINDOW_MS) {
    store.updateFlowSession(session.id, { status: "completed" });
    return false;
  }

  const step = store.getFlowStep(session.step_id);
  if (!step) { store.updateFlowSession(session.id, { status: "completed" }); return false; }

  const input = (payload || text || "").trim();
  const lower = input.toLocaleLowerCase();

  // Quick-reply / button branch match first (payload, then label text). Works
  // on follow-gate steps too, so creators can label the choices freely.
  for (const b of step.buttons || []) {
    const hit = (payload && payload === b.payload) || (lower && lower === String(b.label || "").toLocaleLowerCase());
    if (!hit) continue;
    if (step.followGate && !session.gate_confirmed) store.updateFlowSession(session.id, { gateConfirmed: true });
    if (b.end || !b.nextStepId) {
      store.updateFlowSession(session.id, { status: "completed" });
      logger.info({ flow: flow.id, psid: session.psid, choice: b.payload }, "[flow] end via choice");
      return true;
    }
    const next = store.getFlowStep(b.nextStepId);
    if (!next) { store.updateFlowSession(session.id, { status: "completed" }); return true; }
    logger.info({ flow: flow.id, psid: session.psid, choice: b.payload, step: next.id }, "[flow] branch");
    await sendStep({ flow, step: next, account, accessToken: account.accessToken, psid: session.psid, name, sessionId: session.id });
    return true;
  }

  // Follow gate without matching buttons: wait for a yes/no answer.
  if (step.followGate && !session.gate_confirmed) {
    if (lower === "gate_yes" || GATE_YES.test(input)) {
      store.updateFlowSession(session.id, { gateConfirmed: true });
      const next = nextStepAfter(flow.id, step.id);
      if (!next || step.isEnd) { store.updateFlowSession(session.id, { status: "completed" }); return true; }
      await sendStep({ flow, step: next, account, accessToken: account.accessToken, psid: session.psid, name, sessionId: session.id });
      return true;
    }
    if (lower === "gate_no" || /^(no|not yet|nahi)\b/i.test(input)) {
      await meta.sendDM(account.accessToken, session.psid,
        { text: "No worries — follow and tap “Done” anytime to continue 😊" }, account.ig_user_id || account.id);
      return true;
    }
    return false; // unrelated message: let other handlers take it
  }

  // No button matched. Free text: end (keeps behavior predictable) unless
  // the step has no buttons at all, in which case advance by position.
  if ((step.buttons || []).length === 0) {
    if (step.isEnd) { store.updateFlowSession(session.id, { status: "completed" }); return true; }
    const next = nextStepAfter(flow.id, step.id);
    if (!next) { store.updateFlowSession(session.id, { status: "completed" }); return true; }
    await sendStep({ flow, step: next, account, accessToken: account.accessToken, psid: session.psid, name, sessionId: session.id });
    return true;
  }
  return false;
}

// DM keyword triggers: start a live flow when the follower's message matches.
async function tryStartFromDm({ accountId, psid, text, name }) {
  const account = store.getAccount(accountId);
  if (!account || !account.user_id) return false;
  for (const flow of store.listLiveDmFlows()) {
    if (flow.accountId && flow.accountId !== String(accountId)) continue;
    if (!commentMatchesKeyword(text, flow.keyword)) continue;
    await startFlow(flow, { account, accessToken: account.accessToken, psid, name });
    return true;
  }
  return false;
}

module.exports = { startFlow, advanceFlow, tryStartFromDm, sendStep, WINDOW_MS };
