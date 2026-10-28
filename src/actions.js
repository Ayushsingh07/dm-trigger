// ReplyLo — the core pipeline: comment event -> keyword match -> private
// reply + DM -> conversation record (with a scheduled reminder_at).

const store = require("./store");
const meta = require("./meta");
const config = require("./config");
const logger = require("./logger");

// Keyword match: case-insensitive, whole-word, tolerant of punctuation/emoji.
// "guide please! 🙌" matches "GUIDE"; "guider" does not.
// Boundaries are the string edges or any non-word character, so emoji,
// parentheses and quotes around the keyword are all fine.
function commentMatchesKeyword(commentText, keyword) {
  if (!keyword) return false;
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i");
  return re.test(commentText || "");
}

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

  // 3. Private DM with text + up to 3 link buttons.
  const message = meta.buildDMMessage(rule.dmText, rule.links, commenterName);
  const dmRes = await meta.sendDM(accessToken, commenterId, message);
  logger.info({ to: commenterId, ok: dmRes.ok, dryRun: !!dmRes.dryRun }, "[dm]");
  if (!dmRes.ok) {
    // Failed after retries (or never retryable). Refund unless Meta might
    // still deliver it later — a retryable-looking failure keeps the charge.
    return { ok: false, refund: !meta.shouldRetry(dmRes) };
  }

  // 4. Record the conversation (+ when the reminder scheduler should fire).
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
  logger.info({ rule: rule.id, keyword: rule.keyword, commenter: commenterName, conv: conv.id }, "[MATCH]");
  return { ok: true, refund: false };
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
    { text: `Still want ${keyword}? Tap the link above 👆` });
  logger.info({ conv: conv.id, ok: res.ok }, "[reminder]");
}

// Dev fallback rules live in the store under accountId "demo" (seeded in server.js).

// Handle an inbound DM (entry.messaging). Records clicks/emails.
function handleDMEvent(event) {
  if (!event.message) return;
  const psid = event.sender?.id;
  const text = event.message.text || "";
  logger.info({ from: psid, text }, "[dm-in]");

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
