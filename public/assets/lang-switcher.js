/* ReplyLo — shared language switcher for the non-React pages (dashboard,
 * auth, admin, billing, pricing, legal pages, 404).
 *
 * The server injects this script on any page containing a
 * <span data-lang-switcher></span> placeholder (see src/i18nPages.js).
 * It replaces the placeholder with a compact dropdown that calls
 * I18N.switchTo() — same behavior as the React LanguageSwitcher on the
 * landing page: sets the rf_lang cookie, persists to /api/me/lang when
 * logged in, and navigates to the same path under the new locale prefix. */
(function () {
  "use strict";

  function build(placeholder) {
    var I = window.I18N;
    if (!I) return;

    var wrap = document.createElement("span");
    wrap.style.position = "relative";
    wrap.style.display = "inline-flex";

    var btn = document.createElement("button");
    btn.type = "button";
    // the placeholder's own classes plus any listed in the attribute value
    btn.className = [placeholder.className, placeholder.getAttribute("data-lang-switcher")]
      .filter(Boolean).join(" ").trim();
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.style.cursor = "pointer";

    var label = document.createElement("span");
    label.textContent = I.nativeNames[I.locale] || "English";
    var caret = document.createElement("span");
    caret.textContent = "▾";
    caret.setAttribute("aria-hidden", "true");
    btn.appendChild(label);
    btn.appendChild(caret);

    var menu = document.createElement("div");
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    menu.style.position = "absolute";
    menu.style.insetInlineEnd = "0";
    menu.style.insetBlockStart = "calc(100% + 6px)";
    menu.style.zIndex = "60";
    menu.style.minWidth = "11rem";
    menu.style.maxWidth = "15rem";
    menu.style.background = "#fff";
    menu.style.border = "1px solid #e3e8f0";
    menu.style.borderRadius = "12px";
    menu.style.boxShadow = "0 8px 24px rgba(12,21,36,.12)";
    menu.style.padding = "6px";
    menu.style.textAlign = "start";
    menu.style.maxHeight = "18rem";
    menu.style.overflowY = "auto";
    menu.style.overscrollBehavior = "contain";

    I.supported.forEach(function (loc) {
      var item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(loc === I.locale));
      item.textContent = I.nativeNames[loc] || loc;
      item.style.display = "block";
      item.style.width = "100%";
      item.style.textAlign = "start";
      item.style.padding = "8px 10px";
      item.style.border = "0";
      item.style.borderRadius = "8px";
      item.style.background = loc === I.locale ? "#e6f4f2" : "transparent";
      item.style.fontWeight = loc === I.locale ? "700" : "500";
      item.style.fontSize = "13.5px";
      item.style.cursor = "pointer";
      item.style.whiteSpace = "nowrap";
      item.addEventListener("click", function () { I.switchTo(loc); });
      menu.appendChild(item);
    });

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", function () {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    placeholder.replaceWith(wrap);
  }

  function init() {
    if (!window.I18N) return;
    document.querySelectorAll("[data-lang-switcher]").forEach(build);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
