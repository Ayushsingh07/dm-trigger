/* Interactive landing demo — scenario scripts + timing.
 *
 * EDIT COPY HERE. Components live in src/flowDemo.jsx and never hold text.
 *
 * What is a locale key vs plain text (PROJECT.md section 12):
 *   - step titles/descriptions, tab labels, headline, CTA, counter labels
 *     -> locale keys, written as { k: "landing.flow.<scenario>.<field>" }.
 *   - handles, keywords and the chat text inside the phone are NOT locale
 *     keys (same rule as the hero and the setup mocks).
 *
 * Timing constants are at the bottom of this file.
 */

/* Per-post reply cap shown in the "Post limits" scenario. Single source of
   truth: PLANS.starter.repliesPerPost in src/pricing.js (the same number the
   quota gate and the /billing page use). Do not hardcode it a second time.
   pricing.js is CommonJS; esbuild interop gives it a default export. */
import pricing from "./pricing";
export const DEMO_REPLIES_PER_POST = pricing.PLANS.starter.repliesPerPost;

/* Each scenario is exactly 4 steps. `items` are appended to the phone when
   that step becomes active, so the chat and the step list always agree.
   item.kind: comment | reply | dm | buttons | tap | user-reply | status
              | typing | counter | note                                          */
export const SCENARIOS = [
  {
    id: "comment-dm",
    icon: "bubble",
    tab: { k: "landing.flow.tabs.commentDm" },
    steps: [
      {
        title: { k: "landing.flow.commentDm.s1t" },
        desc: { k: "landing.flow.commentDm.s1d" },
        items: [{ kind: "comment", who: "priya.makes", text: "GUIDE 🙌" }],
      },
      {
        title: { k: "landing.flow.commentDm.s2t" },
        desc: { k: "landing.flow.commentDm.s2d" },
        items: [{ kind: "reply", text: "Sent you the guide — check your DMs 🤍" }],
      },
      {
        title: { k: "landing.flow.commentDm.s3t" },
        desc: { k: "landing.flow.commentDm.s3d" },
        items: [
          { kind: "typing" },
          { kind: "dm", text: "Here's the free guide 👇" },
          { kind: "buttons", buttons: ["Open the guide"] },
        ],
      },
      {
        title: { k: "landing.flow.commentDm.s4t" },
        desc: { k: "landing.flow.commentDm.s4d" },
        items: [
          { kind: "tap", text: "Open the guide" },
          { kind: "status", ms: "0.8s" },
        ],
      },
    ],
  },
  {
    id: "followers",
    icon: "lock",
    tab: { k: "landing.flow.tabs.followers" },
    steps: [
      {
        title: { k: "landing.flow.followers.s1t" },
        desc: { k: "landing.flow.followers.s1d" },
        items: [{ kind: "comment", who: "new.visitor", text: "PRICE" }],
      },
      {
        title: { k: "landing.flow.followers.s2t" },
        desc: { k: "landing.flow.followers.s2d" },
        items: [{ kind: "reply", text: "Following us first and I'll DM you the price list 🤍" }],
      },
      {
        title: { k: "landing.flow.followers.s3t" },
        desc: { k: "landing.flow.followers.s3d" },
        items: [{ kind: "note", text: "@new.visitor followed" }],
      },
      {
        title: { k: "landing.flow.followers.s4t" },
        desc: { k: "landing.flow.followers.s4d" },
        items: [
          { kind: "typing" },
          { kind: "dm", text: "Thanks for following! Here's the price list 👇" },
          { kind: "buttons", buttons: ["Price list", "Book a call"] },
          { kind: "status", ms: "0.9s" },
        ],
      },
    ],
  },
  {
    id: "emails",
    icon: "mail",
    tab: { k: "landing.flow.tabs.emails" },
    steps: [
      {
        title: { k: "landing.flow.emails.s1t" },
        desc: { k: "landing.flow.emails.s1d" },
        items: [
          { kind: "comment", who: "arun.eats", text: "MENU" },
          { kind: "typing" },
          { kind: "dm", text: "Menu's ready! What email should I send it to?" },
        ],
      },
      {
        title: { k: "landing.flow.emails.s2t" },
        desc: { k: "landing.flow.emails.s2d" },
        items: [{ kind: "user-reply", text: "arun@mailbox.com" }],
      },
      {
        title: { k: "landing.flow.emails.s3t" },
        desc: { k: "landing.flow.emails.s3d" },
        items: [
          { kind: "typing" },
          { kind: "dm", text: "Got it — sending now 👇" },
          { kind: "buttons", buttons: ["Open the menu"] },
        ],
      },
      {
        title: { k: "landing.flow.emails.s4t" },
        desc: { k: "landing.flow.emails.s4d" },
        items: [
          { kind: "note", text: "email_collected · arun@mailbox.com" },
          { kind: "status", ms: "0.7s" },
        ],
      },
    ],
  },
  {
    id: "reminder",
    icon: "clock",
    tab: { k: "landing.flow.tabs.reminder" },
    steps: [
      {
        title: { k: "landing.flow.reminder.s1t" },
        desc: { k: "landing.flow.reminder.s1d" },
        items: [
          { kind: "comment", who: "meera.style", text: "CATALOG" },
          { kind: "typing" },
          { kind: "dm", text: "Here's the catalog 👇" },
          { kind: "buttons", buttons: ["Browse the catalog"] },
          { kind: "status", ms: "0.8s" },
        ],
      },
      {
        title: { k: "landing.flow.reminder.s2t" },
        desc: { k: "landing.flow.reminder.s2d" },
        items: [{ kind: "note", text: "reminder_after_min · 180" }],
      },
      {
        title: { k: "landing.flow.reminder.s3t" },
        desc: { k: "landing.flow.reminder.s3d" },
        items: [
          { kind: "typing" },
          { kind: "dm", text: "Still interested? The catalog is one tap away 🤍" },
        ],
      },
      {
        title: { k: "landing.flow.reminder.s4t" },
        desc: { k: "landing.flow.reminder.s4d" },
        items: [
          { kind: "tap", text: "Browse the catalog" },
          { kind: "status", ms: "0.8s" },
        ],
      },
    ],
  },
  {
    id: "limits",
    icon: "gauge",
    tab: { k: "landing.flow.tabs.limits" },
    steps: [
      {
        title: { k: "landing.flow.limits.s1t" },
        desc: { k: "landing.flow.limits.s1d" },
        items: [
          { kind: "comment", who: "riya.home", text: "LINK" },
          { kind: "dm", text: "Everything from this drop, in one link 👇" },
          { kind: "buttons", buttons: ["Shop the drop"] },
          { kind: "counter", used: 36 },
        ],
      },
      {
        title: { k: "landing.flow.limits.s2t" },
        desc: { k: "landing.flow.limits.s2d" },
        items: [{ kind: "counter", used: 114 }],
      },
      {
        title: { k: "landing.flow.limits.s3t" },
        desc: { k: "landing.flow.limits.s3d" },
        items: [{ kind: "counter", used: DEMO_REPLIES_PER_POST, capped: true }],
      },
      {
        title: { k: "landing.flow.limits.s4t" },
        desc: { k: "landing.flow.limits.s4d" },
        items: [{ kind: "note", text: "blocked_limit_reached", chip: "topup" }],
      },
    ],
  },
  {
    id: "language",
    icon: "globe",
    tab: { k: "landing.flow.tabs.language" },
    steps: [
      {
        title: { k: "landing.flow.language.s1t" },
        desc: { k: "landing.flow.language.s1d" },
        /* First fan follows the viewer's locale (landing.flow.langDemo.*) so a
           Japanese visitor sees a Japanese comment, not Hindi. The other two
           comments stay fixed foreign examples — that IS the point. */
        items: [{ kind: "comment", whoK: "landing.flow.langDemo.fan", textK: "landing.flow.langDemo.keyword" }],
      },
      {
        title: { k: "landing.flow.language.s2t" },
        desc: { k: "landing.flow.language.s2d" },
        items: [
          { kind: "comment", who: "yuki.draws", text: "ガイド", dedupeFan: true },
          { kind: "comment", who: "leo.arte", text: "guía!", dedupeFan: true },
        ],
      },
      {
        title: { k: "landing.flow.language.s3t" },
        desc: { k: "landing.flow.language.s3d" },
        items: [
          { kind: "typing" },
          { kind: "dm", textK: "landing.flow.langDemo.guide", toK: "landing.flow.langDemo.fan" },
          { kind: "dm", text: "ガイドを送ります 👇", to: "yuki.draws", dedupeFan: true },
          { kind: "dm", text: "Aquí tienes la guía 👇", to: "leo.arte", dedupeFan: true },
        ],
      },
      {
        title: { k: "landing.flow.language.s4t" },
        desc: { k: "landing.flow.language.s4d" },
        items: [{ kind: "status", ms: "0.8s" }],
      },
    ],
  },
];

/* ---------------- timing (edit here) ---------------- */
export const STEP_MS = 2500;        /* time on each step while playing */
export const LOOP_PAUSE_MS = 2000;  /* extra pause after the last step */
export const IDLE_RESUME_MS = 8000; /* resume autoplay after this idle gap */
export const TYPING_MS = 700;       /* typing dots before an owner message */
