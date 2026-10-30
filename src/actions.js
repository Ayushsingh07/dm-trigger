// ReplyLo — the core pipeline: comment event -> keyword match -> private
// reply + DM -> conversation record (with a scheduled reminder_at).

const store = require("./store");
const meta = require("./meta");
const config = require("./config");
const logger = require("./logger");
const flows = require("./flows");
const { commentMatchesKeyword } = require("./keyword");

// Re-exported for existing requires/tests; implementation lives in keyword.js.

// Handle one `comments` change webhook payload.
async function handleCommentEvent(accountId, value) {
  const text = (value.text || "").trim();
  const commenterId = value.from?.id ?? null;
  const commenterName = value.from?.username ?? "there";
  const mediaId = value.media?.id ?? null;
  const commentId = value.id ?? null;

  logger.info({ account: accountId, media: mediaId, from: commenterName, commenterId, text }, "[comment]");

  // Self-replies and ads are skipped so we never reply to ourselves.
  if (value.comment_type === "comment" && value.from?.id === accountId) return;

  const account = store.getAccount(accountId);

  // Analytics: log every comment we ever see (matched or not) so per-post
  // comment totals are measurable without extra Meta permissions.
  store.recordCommentEvent({
    accountId, userId: account?.user_id ?? null, postId: mediaId,
    commentId, commenterId, matched: false, // upgraded below on a real match
  });

  let rules = store.rulesForAccount(accountId);
  if (rules.length === 0 && account === null) {
    rules = store.rulesForAccount("demo"); // dev fallback until an account is connected
  }

  const matched = rules.filter(
    (r) =>
      r.active &&
      (r.scope === "all" || (r.postIds || []).includes(String(mediaId))) &&
      commentMatchesKeyword(text, r.keyword)
  );

  if (matched.length === 0) {
    logger.debug("[comment] no keyword match");
    return;
  }
  store.markCommentMatched(commentId);

  // One DM per commenter per rule — dedupe repeat comments.
  for (const rule of matched) {
    const already = store
      .conversationsForAccount(accountId)
      .some((c) => c.ruleId === rule.id && c.psid === commenterId);
    if (already) {
      logger.debug({ commenter: commenterName, rule: rule.id }, "[dedupe] already sent, skipping");
      continue;
    }

    // Prepaid-pass quota: one reply unit per (user, post) in the current
    // period. Checked BEFORE anything is sent, so a capped post sends nothing.
    // Demo rules (no owner) are exempt.
    if (rule.userId) {
      const quota = store.tryConsumeReply(rule.userId, mediaId);
      if (!quota.ok) {
        logBlockOnce(rule.userId, mediaId, quota.reason, commenterName);
        continue;
      }
    }

    const sent = await runRule({ account, rule, accountId, commenterId, commenterName, commentId, mediaId });

    // A unit that produced no delivered DM goes back: permanently failed send,
    // a duplicate Meta delivery, or a follower-gate nudge instead of a DM.
    if (sent.refund && rule.userId) {
      if (store.refundReply(rule.userId, mediaId)) {
        logger.info({ user: rule.userId, media: mediaId }, "[quota] refunded unit (no DM delivered)");
      }
    }
  }
}

// Records blocked_<reason> at most once per day per (user, post, reason) so a
// capped post doesn't log an event for every single comment.
function logBlockOnce(userId, mediaId, reason, commenterName) {
  logger.warn({ user: userId, media: mediaId, reason }, "[quota] blocked");
  if (store.hasBlockEventToday(userId, mediaId, reason)) return;
  store.trackEvent(`blocked_${reason}`, userId, { post: mediaId ?? null, commenter: commenterName ?? null });
}

async function runRule({ account, rule, accountId, commenterId, commenterName, commentId, mediaId }) {
  const accessToken = account?.accessToken || "DRY_RUN_TOKEN";
  // Under unified login the IG business account id goes in the request path.
  const igId = account?.ig_user_id;

  // 1. Followers-only gate.
  if (rule.followersOnly) {
    const follow = await meta.isFollower(accessToken, commenterId);
    const isFollower = follow.dryRun ? true : Boolean(follow.is_follower);
    if (!isFollower) {
      logger.info({ commenter: commenterName }, "[followers-only] not following, nudging instead");
      await meta.sendPrivateReply(accessToken, commentId,
        `Hey ${commenterName}! 👋 Follow us and comment ${rule.keyword} again to get it!`);
      // No DM was ever attempted; the reserved unit goes back.
      return { ok: true, refund: true };
    }
  }

  // 2. Public reply under the comment.
  const replyRes = await meta.sendPrivateReply(accessToken, commentId,
    `Sent you a DM! 📩 Check your inbox, ${commenterName}.`);
  logger.info({ comment: commentId, ok: replyRes.ok }, "[reply]");

  // 3. Record the conversation FIRST (when the reminder scheduler should
  //    fire). Its id seeds the /go/ click-tracking tokens in the DM links;
  //    if the send ultimately fails the row is deleted again below.
  //    reminder_at is only set when the nudge would still land inside Meta's
  //    24h messaging window.
  let reminderAt = null;
  if (rule.reminderAfterMin > 0) {
    const delayMs = Math.min(rule.reminderAfterMin, 1440) * 60 * 1000;
    if (delayMs <= config.messagingWindowMs) {
      reminderAt = new Date(Date.now() + delayMs).toISOString();
    }
  }
  const conv = store.createConversation({
    accountId, userId: rule.userId, psid: commenterId, commentId, ruleId: rule.id, reminderAt, postId: mediaId,
  });
  if (!conv) {
    // UNIQUE(comment_id) — a Meta retry of this delivery already sent the DM.
    logger.debug({ commentId }, "[dedupe] duplicate comment_id (Meta retry), ignored");
    return { ok: true, refund: true }; // duplicate delivery: don't charge it twice
  }

  // 4. Private DM with text + up to 3 link buttons. Addressed by comment_id
  //    (Meta's "private reply"), which works before the commenter has ever
  //    opened a conversation. Links are rewritten to /go/<token> so link
  //    clicks are measurable (Instagram never reports them); dry-run keeps
  //    the original URLs since nothing is actually delivered.
  const trackedLinks = trackRuleLinks(conv, rule);
  const message = meta.buildDMMessage(rule.dmText, trackedLinks, commenterName);
  const dmRes = await meta.sendCommentDM(accessToken, igId, commentId, message);
  logger.info({ to: commenterId, ok: dmRes.ok, dryRun: !!dmRes.dryRun }, "[dm]");
  if (!dmRes.ok) {
    store.deleteConversation(conv.id); // no DM delivered -> don't count it as reached
    // Failed after retries (or never retryable). Refund unless Meta might
    // still deliver it later — a retryable-looking failure keeps the charge.
    return { ok: false, refund: !meta.shouldRetry(dmRes) };
  }
  logger.info({ rule: rule.id, keyword: rule.keyword, commenter: commenterName, conv: conv.id }, "[MATCH]");

  // Side effects that must never break the pipeline: broadcast opt-in and
  // Fan Mode points for the commenter.
  try {
    if (rule.userId) {
      store.upsertSubscriber({ userId: rule.userId, accountId, psid: commenterId,
        igUsername: commenterName, source: "comment" });
      const fan = store.getFanConfig(rule.userId);
      if (fan.enabled) {
        store.awardFanPoints({ userId: rule.userId, accountId, psid: commenterId,
          igUsername: commenterName, kind: "comment", points: fan.pointsComment });
      }
    }
  } catch (err) { logger.warn({ err: err.message }, "[fan/subs] side effect failed"); }

  return { ok: true, refund: false };
}

// Rewrite rule links through /go/<token> when click tracking is available
// (PUBLIC_BASE_URL configured + an owning user). Falls back to raw links.
function trackRuleLinks(conv, rule) {
  const links = rule.links || [];
  if (!links.length || !config.publicBaseUrl || !rule.userId) return links;
  let base;
  try { base = new URL(config.publicBaseUrl).origin; } catch { return links; }
  return links.map((l) => {
    try {
      const u = new URL(l.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return l;
      const token = store.createGoLink({
        convId: conv.id, userId: rule.userId, accountId: conv.accountId,
        ruleId: rule.id, postId: conv.postId, url: u.toString(),
      });
      return { ...l, url: `${base}/go/${token}` };
    } catch { return l; } // malformed URL — send as-is, Meta will reject it the same way
  });
}

// Send the scheduled reminder for one conversation. Called by the scheduler.
async function sendReminder(conv) {
  const account = store.getAccount(conv.accountId);
  const accessToken = account?.accessToken || "DRY_RUN_TOKEN";
  const rule = store.getRule(conv.ruleId);
  const keyword = rule?.keyword || "it";
  // Mark first so a crash mid-send can't double-nudge.
  store.updateConversation(conv.id, { reminded: true });
  const res = await meta.sendDM(accessToken, conv.psid,
    { text: `Still want ${keyword}? Tap the link above 👆` }, account?.ig_user_id);
  logger.info({ conv: conv.id, ok: res.ok }, "[reminder]");
}

// Dev fallback rules live in the store under accountId "demo" (seeded in server.js).

// Handle an inbound DM (entry.messaging). Records clicks/emails.
async function handleDMEvent(event, accountIdHint) {
  // Delivery receipts (message_deliveries): mark the matching conversation as
  // delivered. Only an actual delivery carries attachment metadata.
  if (event.message_deliveries && Array.isArray(event.message_deliveries.metadata)) {
    const recipientId = event.recipient?.id; // our IG business id
    const psid = event.sender?.id;
    if (recipientId && psid) {
      const conv = store.lastConversationForPsid(psid);
      if (conv && conv.accountId === String(recipientId)) store.markDelivered(conv.id);
    }
    // deliveries carry no message body; nothing else to do
    return;
  }

  if (!event.message && !event.postback) return;
  const psid = event.sender?.id;
  const recipientId = String(event.recipient?.id || accountIdHint || "");
  const text = event.message?.text || "";
  // Quick-reply chips arrive as message.quick_reply.payload; Messenger-style
  // postbacks arrive on event.postback.payload.
  const payload = event.message?.quick_reply?.payload || event.postback?.payload || null;
  logger.info({ from: psid, text, payload: payload || undefined }, "[dm-in]");

  // Broadcast list building: anyone who DMs us is an addressable follower.
  if (psid && recipientId) {
    const acct = store.getAccount(recipientId);
    if (acct && acct.user_id) {
      try { store.upsertSubscriber({ userId: acct.user_id, accountId: recipientId, psid, source: "dm" }); } catch { /* non-fatal */ }
    }
  }

  // Opt-out keyword: honor STOP/UNSUBSCRIBE for broadcast lists.
  if (/^(stop|unsubscribe|opt\s*out)$/i.test(text.trim())) {
    const acct = store.getAccount(recipientId);
    if (acct && acct.user_id) {
      store.optOutSubscriber(acct.user_id, recipientId, psid);
      await meta.sendDM(acct.accessToken, psid, { text: "You're unsubscribed — no more broadcasts. Send START to rejoin. 🙏" }, acct.ig_user_id || recipientId);
      return;
    }
  }

  // Flow engine first: an active session (or a DM keyword trigger) owns the
  // conversation and answers before anything else.
  try {
    const session = store.activeFlowSession(recipientId, psid);
    if (session) {
      const consumed = await flows.advanceFlow(session, { text, payload });
      if (consumed) return;
    } else if ((text || payload) && await flows.tryStartFromDm({ accountId: recipientId, psid, text: text || payload, name: "there" })) {
      return;
    }
  } catch (err) {
    logger.error({ err: err.message }, "[flow] handler error");
  }

  // Email capture: if the last DM asked for an email and this looks like one.
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (emailMatch) {
    const conv = store.lastConversationForPsid(psid, "sent");
    if (conv) {
      store.collectEmail({ accountId: conv.accountId, userId: conv.userId, psid, email: emailMatch[0], ruleId: conv.ruleId });
      store.updateConversation(conv.id, { status: "email_collected" });
      if (conv.userId) store.trackEvent("email_collected", conv.userId, { psid });
      logger.info({ conv: conv.id }, "[email] collected");
    }
  }

  // Any "YES" reply counts as engagement.
  if (/^yes$/i.test(text.trim())) {
    const conv = store.lastConversationForPsid(psid);
    if (conv) store.updateConversation(conv.id, { status: "replied" });
  }
}

module.exports = { handleCommentEvent, handleDMEvent, commentMatchesKeyword, sendReminder };
