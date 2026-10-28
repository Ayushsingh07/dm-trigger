# VISUALS.md — landing page visual plan

Plan only. No code changed yet. Built from PROJECT.md, DESIGN-BRIEF.md, src/landing.jsx (as of 2026-10-28).

## Global rules
- **Palette (DESIGN-BRIEF.md):** teal `#0d9488` (primary), amber `#f59e0b` (accent), ink `#0e1a2b`, mist `#eef2f7`, line `#dbe3ee`. Photos must carry natural teal/amber accents so they sit in the palette.
- **Copy budget:** every visual carries at most ONE short sentence of body text. Headlines stay; paragraphs get cut to one line.
- **Page weight:** SVG/CSS visuals are free (inline, no requests). Photos: max 6, 4:5 portrait, ≤120 KB each after WebP/AVIF conversion, lazy-loaded, served from `/assets/img` (already covered by CSP `img-src 'self' data: https:` and the 1h static cache; add a longer-cache rule for `/assets/img` in the polish pass).
- **Photo handling:** `ImageSlot` renders a teal→amber gradient placeholder with the filename in small text when the file is missing, so the page looks intentional before photos arrive. Never hotlink third-party photos (copyright).
- **Motion:** all loops pause under `prefers-reduced-motion` (final state shown statically).

---

## 1. Nav
- **Current:** logo, links, sign-in/start buttons.
- **Visual:** none needed. Keep as-is.
- **Caption:** —

## 2. Hero (`#demo`)
- **Current:** badge, headline, 2-line sub, control card (chips + 2 inputs + run button), avatar row, interactive phone (ReelsFrame/DmFrame, ~9 stages).
- **Visual:** keep the phone (it IS the hero visual). Add **(b) two photo slots as a small offset collage behind/beside the phone** — real sellers make the promise believable. Cut the sub-paragraph to one line.
- **Photo slots:**
  - `public/assets/img/hero-boutique.jpg` — 4:5 — alt: "Saree boutique owner checking her phone in her shop" — caption: *"Comment PRICE, order in the DM."*
  - `public/assets/img/hero-kitchen.jpg` — 4:5 — alt: "Cloud-kitchen cook plating an order in warm window light" — caption: *"Comment MENU, the menu lands in their inbox."*
- **Type:** (a) phone stays code-drawn; (b) two photos.
- **Weight:** 2 photos ≈ 240 KB total (after WebP).

## 3. Logo strip
- **Current:** six text names.
- **Visual:** replace with **(f) KeywordMarquee** — a slow-scrolling single row of example keywords as chips (`GUIDE · PRICE · MENU · BOOK · COACH · DIET · CATALOG · QUOTE …`), amber/teal tinted. Keeps the "who uses this" feeling, adds motion, zero weight.
- **Caption:** "Keywords our users are live on right now"

## 4. How it works (`#how`)
- **Current:** 3 text cards with emoji + 2-sentence descriptions.
- **Visual:** **(a) CommentToDM animated sequence** as one wide band above the three steps: comment bubble appears → public reply slides in → DM card lands, CSS-keyframe loop with pauses. The three step cards stay but each gets a **MiniUI** instead of an emoji:
  - step 1 → `KeywordChips` (chip with a check on whole-word match)
  - step 2 → `MessageEditor` (tiny DM bubble + 1 button)
  - step 3 → `ResultsBars` (3 mini bars)
  - Cut each card's description to one sentence.
- **Caption:** "Comment → reply → DM. Watch it loop."
- **Type:** (a)

## 5. NEW — Who it's for (use cases)
- **Current:** does not exist (the TYPES data in the hero chips is the seed).
- **Visual:** **(b) grid of six photo cards**, each: photo, one keyword chip, one example DM line (≤10 words). This is where the six generated photos live.
- **Photo slots (all 4:5 portrait, candid, window light, teal/amber accents, no text/logos):**
  | file | subject | alt | chip + one-liner |
  |---|---|---|---|
  | `img/boutique-owner.jpg` | saree boutique owner with phone | "Saree boutique owner in her shop holding a phone" | PRICE — "Which colour? It's on its way 💫" |
  | `img/cloud-kitchen.jpg` | cloud-kitchen cook | "Cloud-kitchen cook holding a phone near the pass" | MENU — "New menu, sent 🍜" |
  | `img/home-tutor.jpg` | home tutor | "Home tutor at a desk holding a phone" | CLASS — "Free demo slot? Booked ✅" |
  | `img/mehndi-artist.jpg` | mehndi artist | "Mehndi artist holding a phone in her studio" | DESIGN — "Here's the design you asked for 🌿" |
  | `img/gym-trainer.jpg` | gym trainer | "Gym trainer holding a phone in the gym" | PLAN — "Your 7-day plan, coming up 💪" |
  | `img/jewelry-seller.jpg` | handmade jewelry seller | "Handmade jewelry seller at her workbench holding a phone" | CATALOG — "Full catalog, one tap away ✨" |
- **Caption:** "Built for whoever replies from their phone."
- **Type:** (b) — 6 photos ≈ 720 KB max, lazy-loaded below the fold.

## 6. Features (`#features`)
- **Current:** 6 cards, emoji + title + 2-sentence body.
- **Visual:** **(a) bento grid of mixed-size tiles, each tile a MiniUI mockup** (HTML/CSS, no images), one sentence max per tile:
  | tile | size | MiniUI |
  |---|---|---|
  | Comment → DM in ~2s | 2×2 | `CommentToDM` compact loop |
  | Whole-word matching | 1×1 | `KeywordChips` (GUIDE ✓, guilt ✗) |
  | Buttons & links | 1×1 | DM bubble + 3 tap buttons |
  | Email capture | 1×1 | `EmailCollect` (reply → saved chip) |
  | Followers-only rules | 1×1 | `FollowersOnlyToggle` (on state) |
  | Official APIs only | 1×1 | `ShieldCheck` SVG (lock + badge) |
  | Honest dashboard | 2×1 | `ResultsBars` + `StatCard` row |
- **Caption:** none (tiles speak).
- **Type:** (a)

## 7. NEW — Results
- **Current:** none (stats only exist in the dashboard).
- **Visual:** **(c) one real product screenshot** of `/app` (warm dashboard) inside a browser frame, plus **(a) three StatCards with inline SVG sparklines** beside it (reached / DMs sent / emails). Numbers labeled "sample data".
- **Screenshot slot:** `public/assets/img/shot-dashboard.png` — 16:10 — alt: "ReplyLo dashboard showing DMs sent, clicks and emails" — caption: "One honest dashboard."
- **Type:** (c) + (a). Screenshot ≤150 KB, lazy.

## 8. Pricing teaser
- **Current:** none on landing (there is a /pricing page).
- **Visual:** **(a) three plan cards** (free / starter ₹199 / growth ₹349) where each shows **"posts × replies" as dots**: 15 post dots (filled per plan) + one amber bar for replies-per-post. Links to /pricing. No feature lists.
- **Caption:** "Prepaid passes. No auto-renew."
- **Type:** (a)

## 9. Final CTA + footer
- **Current:** dark card, headline, 2 buttons.
- **Visual:** **(b) one large photo** as the card background (dark scrim for contrast): `public/assets/img/cta-workspace.jpg` — 16:9 — alt: "Small business owner smiling at her phone in a warm-lit workspace" — caption: the existing headline, sub cut to one line.
- **Type:** (b) — 1 photo ≈ 150 KB.

---

## New Tailwind classes / fonts (for build:css)
- **No new fonts.** Inter + Fraunces already loaded and themed.
- Expected new utilities (all standard Tailwind v4, picked up by `build:css` from `src/visuals.jsx` via the `@source` glob — must add `@source "../src/visuals.jsx";` to `src/styles/tailwind.css`):
  `aspect-[4/5]`, `aspect-video`, `grid-rows-*`, `col-span-*`, `row-span-*`, `object-cover`, `bg-linear-to-br`, `from-teal/15`, `to-amber/15`, `ring-amber/30`, `animate-marquee-slow`, `animate-step-*`.
- New keyframes in `@theme` of tailwind.css: `marquee-slow` (30s), `step-cycle` (comment→reply→DM loop with pauses), plus a `@media (prefers-reduced-motion: reduce)` block that disables them.

## Weight budget
| kind | count | est. total |
|---|---|---|
| SVG/CSS visuals | ~15 | ~0 KB (inline) |
| photos (4:5) | 8 | ≤ 1.0 MB, lazy |
| screenshot | 1 | ≤ 150 KB |
| **landing delta** | | **≈ 1.2 MB lazy, +0 KB blocking** |

## Build order (matches the agreed prompts)
1. ✅ this file
2. `src/visuals.jsx` — ImageSlot, PhoneFrame, CommentToDM, StatCard, MiniUI set, AvatarStack, KeywordMarquee (no new npm deps)
3. Section-by-section rebuild of `src/landing.jsx` (hero → how → who → features → results → pricing → CTA), `npm run build` after each
4. Polish pass: alt/width/height/lazy audit, long-cache for `/assets/img`, 360px check, reduced-motion check, weight report, new og-image (1200×630, teal/amber, supplied by you)
