// Keyword match, language-aware (extracted from actions.js so the flow
// engine can use it without a circular require):
//  - Both sides are NFKC-normalized (full-width "ＧＵＩＤＥ" -> "GUIDE") and
//    lowercased with toLocaleLowerCase (correct for Turkish, Lithuanian, ...).
//  - A second pass strips combining marks so "MENÚ" matches a comment that
//    says "menu" (and vice versa).
//  - Scripts that don't use spaces between words (Han / kana / Thai) match as
//    a plain substring; everything else needs Unicode word boundaries, so
//    "guider" does NOT match "guide" but "guide🙌" does (emoji is not a letter).

// Scripts without word spacing: Han, Hiragana, Katakana, Thai.
const NO_SPACING_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

// NFKC folds compatibility forms; NFKD + strip Mn + re-compose removes accents
// (menú -> menu). Devanagari matras are also Mn, so the accent-stripped form
// is only ever a SECOND pass — the exact form is tried first, which keeps
// "मेनू" matching "मेनू".
function normalizeForMatch(s, stripAccents) {
  let n = String(s).normalize("NFKC").toLocaleLowerCase();
  if (stripAccents) n = n.normalize("NFKD").replace(/\p{Mn}/gu, "").normalize("NFKC");
  return n;
}

function commentMatchesKeyword(commentText, keyword) {
  if (!commentText || !keyword) return false;
  const kwRaw = String(keyword).trim();
  if (!kwRaw) return false;
  const substringMode = NO_SPACING_RE.test(normalizeForMatch(kwRaw, false));
  for (const stripAccents of [false, true]) {
    const comment = normalizeForMatch(commentText, stripAccents);
    const kw = normalizeForMatch(kwRaw, stripAccents);
    if (!kw) continue;
    if (substringMode) {
      if (comment.includes(kw)) return true;
    } else {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u");
      if (re.test(comment)) return true;
    }
  }
  return false;
}

module.exports = { commentMatchesKeyword, normalizeForMatch };
