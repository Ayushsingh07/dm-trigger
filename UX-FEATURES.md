# UX Features — reference analysis of a comment-to-DM SaaS landing experience
(Compiled 2026-10-27 from public pages: home, /docs, /tools, /dm-templates.
Describes layout and behavior only. No text, logo or images copied. Anything
not observable from outside is marked "unknown".)

## 1. Page sections in order (home page)

| # | Section | Purpose |
|---|---------|---------|
| 0 | Dismissible top banner | Scarcity offer (limited free-upgrade spots, live counter) + close button; links to sign-up |
| 1 | Sticky pill navigation | Brand mark, anchor links (how it works, features, pricing), language switcher, "Log in" and primary "Continue with Instagram" CTA |
| 2 | Hero | Value promise in one sentence; primary CTA; secondary "try the demo" link; trust line (free plan, no card, official APIs); beside it a phone mockup showing a post, a keyword comment and the auto-reply, plus floating stat chips (speed, 24/7, price) |
| 3 | Audience strip ("made for…") | Six persona cards (baker, coach, boutique, live cook, skincare…) each with a mini comment→DM example; tells visitors "this is for someone like you" |
| 4 | How it works (numbered 01–05) | Setup walkthrough with product mockups for each step (see §3) |
| 5 | Safety / trust section | Two-column comparison: official-API behavior vs. unofficial tools; closes with a rule of thumb; purpose is objection handling about bans |
| 6 | Feature grid | ~12 cards: comment→DM, story replies, DM keywords, followers-only, email capture, AI answers, product carousels, Facebook support, shared inbox, team roles, Sheets/ads export, spam filtering |
| 7 | Store / monetization section | Cards for courses, calls, events, downloads, paid communities; payments via a named gateway |
| 8 | Add-on product section | A research/scripting add-on with its own price, bullet list and trial CTA, plus a worked example |
| 9 | Interactive demo builder | "Build your first one here" — inputs on the left, live phone preview on the right (see §2) |
| 10 | Research tool teaser | Public-account lookup example (engagement, top comment words) with free-tool CTA |
| 11 | Pain-point section | Emotional framing (missed comments at 3 a.m.) with a photo and a mini activity feed |
| 12 | AI voice section | AI-personality feature bullets with a chat example and a voice-note player mock |
| 13 | ROI calculator | Three sliders → two computed outputs; explains assumptions in small print |
| 14 | Pricing | Four plan cards + add-on row; feature gating list per plan (see §5) |
| 15 | FAQ | Accordion list of ~13 questions (bans, languages, limits, plans…) |
| 16 | Final CTA band | Repeat of primary CTA + demo link + language switcher |
| 17 | Footer | Social follow link, copyright, non-affiliation disclaimer |

/docs: docs-home layout — intro paragraph, "Start here" card list (connect, first auto-reply, auto-replies in depth, AI connector), bulleted capability summary, help/contact block, "Next →" pager. Unknown: sidebar behavior on mobile.

/tools: intro paragraph explaining privacy model (browser/device processing, WebGPU note), then category sections (AI photo, AI video & audio, images, text, links & QR, insights, calculators, giveaways, reference). Each tool is a card: name, one-line description, and a processing badge ("runs on your device", "free · no sign-up"). Unknown: per-tool page internals beyond the engagement calculator being linked from home.

/dm-templates: intro with three rule-principle callouts (one DM per comment, 24-hour window, fill-in-the-blank placeholders), a search box, then grouped card lists (Instagram · 42, Facebook/Messenger · 10, cross-platform · 5) — each card: title, description with template count; a cross-sell strip; final CTA band.

## 2. Interactive components

- **Live demo builder** (home): business-type chips (Creator / Shop / Coach / Restaurant / Salon) that swap the phone's media; text inputs for keyword, public reply text and DM text; the phone preview re-renders on every keystroke (caption shows the keyword, comment shows the sample, reply card shows the reply text). CTA "turn this on for my account" carries the typed values into sign-up (query param). No sign-up required to play.
- **Savings calculator**: three range sliders (posts/week, comments/post, % asking for a link). Outputs recompute live: people reached per month and hours saved; a line relates the result to plan limits. Assumptions printed below.
- **FAQ accordions**: question rows expand/collapse one answer at a time; chevron rotates; deep-linkable anchors (#faq).
- **Language switcher**: dropdown in footer area (English observed; other options unknown).
- **Top banner**: fixed above nav, live "spots left" counter (decrements across visits — server-backed), dismiss with ×.
- **Phone mockups**: static in hero/how-it-works; the demo-builder phone is the only input-driven one. Unknown: whether hero phone has 3D/parallax (a WebGL library is loaded, so likely yes).
- **Scroll reveals**: sections fade/slide in on scroll (IntersectionObserver flag in page source).

## 3. Five-step setup flow (as shown in mockups)

1. **Connect account** — account card list with "Connected" state; login happens through the platform's own OAuth; explicit "we never see your password" note. Controls: connect button, account type label (creator/business/Page).
2. **Pick post + keyword** — post scope selector (one post / several / all posts incl. future posts) and keyword chips with add/remove ("GUIDE ×", "Add another").
3. **Write the reply** — message editor with `{name}` placeholder support, up to three link rows (title + URL rendered as a button preview), and option toggles: followers-only, ask for email, reminder after N hours.
4. **Every comment gets the DM** — activity feed mock: several commenters, each marked "DM sent", with a paced-through-limits note.
5. **Results** — per-auto-reply stat row: people reached, click count + rate, emails collected; time-range selector shown (14 days).

## 4. Dashboard features visible from mockups

- Post picker (scope + per-post selection), keyword chips with × remove and add
- Message editor: textarea, `{name}` variable, link rows → tappable button card preview
- Toggles: followers-only (with follow-check nudge flow), email capture (in-chat question + validation), reminder timer
- Product carousel composer (swipeable cards: photo, price, "Shop now"; paste-a-URL autofill)
- Results stats per auto-reply with date range; funnel from comment → DM → click → email
- Live shared inbox: unified DM list across accounts, real-time arrival + chime, delayed reply up to 7 days, scheduled replies
- Team: invite by email, role presets (admin / manager / view-only), own sign-ins
- Integrations: new emails → Google Sheets; email list → downloadable ads audience
- Research/lookup panel: public account stats + "words they ask people to comment" with one-tap convert-to-rule
- Spam handling: spam/links/repeat commenters skipped, shown as "Spam: skipped" chip
- Unknown: actual dashboard navigation, loading skeletons, empty states (not observable pre-login)

## 5. Pricing plans and gating

| Plan | Price | Includes (gating observed) |
|---|---|---|
| Free | $0 | 1 account, capped people/month, capped emails, core auto-replies, capped look-ups, branded link-in-bio |
| Pro | low $/mo | 3 accounts, unlimited people & emails, Live replies, media in DMs, followers-only, reminders/scheduled, older-comment replies, 3 links/DM, lifetime results, no badge |
| Growth | mid $/mo | Pro + AI replies/goals/intents, monthly AI credit allowance, higher look-up cap, buyable extra credits |
| Business | high $/mo | Growth + 10 accounts, 5 team seats, Sheets sync, ads-audience export, multiple bio pages, larger credits, priority support |
| Add-on | separate $/mo | Research/script lab, available on any plan |

Gating mechanisms seen: counts (accounts, people, emails, look-ups, credits, seats), feature flags (followers-only, reminders, AI, integrations), branding (badge on/off), and credit packs purchasable on upper tiers.

## 6. Navigation, CTAs, states

- **Nav**: sticky pill bar; anchor links to page sections; persistent primary CTA (platform-login) + secondary log-in; language switcher near footer.
- **CTA hierarchy**: one primary verb repeated everywhere ("Continue with Instagram"), one low-commitment alternative ("Try the demo"), contextual CTAs on each feature/add-on section, and a final band. Demo builder CTA pre-fills sign-up.
- **Empty/loading/error states**: on the marketing pages — none observable (content is server-rendered). Post-login states: unknown. The demo workspace (private sandbox where nothing is sent) is advertised in docs as the safe empty-state playground.
- **Other**: cookie/consent UI unknown; analytics present (first-party + CDN beacon); SEO route family (templates/tools/glossaries) doubles as navigation content.
