# Design Brief — **ReplyFlow** (my product, same feature set & flow as UX-FEATURES.md)

## Brand
- **Name:** ReplyFlow · **Mark:** ⚡ bolt in a rounded square · **Voice:** calm, direct, no hype
- **Tagline:** "Every keyword comment, answered in seconds."
- **Copy rules:** short sentences, verbs first, no exclamation marks in CTAs, never imitate DMFast wording.

## Visual system (deliberately different from DMFast's warm cream/ink)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#eef2f7` cool mist | page background |
| `--card` | `#ffffff` | cards, nav |
| `--ink` | `#0e1a2b` deep navy | text, dark pills |
| `--acc` | `#0d9488` teal | primary CTA, highlights |
| `--acc2` | `#f59e0b` amber | accents, phone media, chips |
| `--line` | `#dbe3ee` | borders |
| Fonts | Inter (UI) + Fraunces italic (display accent) | |
| Shapes | 14–18px radii, soft blue-tinted shadows | |

## Flow (kept from the reference)
Hero (promise + CTA) → live demo builder (type → phone updates instantly → run animation → real webhook) → stats → rules → conversations. Same 5-step mental model: connect → keyword → reply → DM → results.

## Landing hero spec
Badge → headline with italic accent → sub → primary CTA (teal pill) + secondary → trust line. Right: phone preview.

## Live demo builder spec (this build)
- Inputs: **keyword**, **public reply**, **DM text** — every keystroke re-renders the phone (caption keyword, reply card, DM toast).
- Business-type chips swap media emoji.
- "Run the demo": comment pops in → typing dots → reply card → DM toast slides down → real `POST /webhook` fires so stats update.
- States: empty (only seed comment), running (button disabled), error (toast with retry).
