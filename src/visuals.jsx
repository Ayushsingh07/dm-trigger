/* ReplyLo - reusable visual components (VISUALS.md).
   No new npm deps. Tailwind + existing palette only.
   Imported by src/landing.jsx section by section. */
import React from "react";

/* i18n: window.I18N comes from /assets/i18n.js (loaded before landing.js). */
const t = (key, vars) => {
  const i = (typeof window !== "undefined" && window.I18N) || null;
  return i ? i.t(key, vars) : key.split(".").pop();
};

/* ============================ Illustration ============================ */
/* Flat SVG scene used as the ImageSlot fallback until real photos exist.
   4:5 viewBox, warm palette, teal/amber accents. */
const ILL = {
  boutique: { bg: ["#f1f5f9", "#ccfbf1"], skin: "#c98a5e", top: "#0d9488", accent: "#f59e0b", prop: "drape" },
  kitchen: { bg: ["#fffbeb", "#ccfbf1"], skin: "#a9713f", top: "#f59e0b", accent: "#0d9488", prop: "bowl" },
  tutor: { bg: ["#f1f5f9", "#fef3c7"], skin: "#c98a5e", top: "#0f766e", accent: "#f59e0b", prop: "book" },
  mehndi: { bg: ["#ccfbf1", "#fef3c7"], skin: "#8a5a33", top: "#115e59", accent: "#f59e0b", prop: "leaf" },
  gym: { bg: ["#f1f5f9", "#ccfbf1"], skin: "#a9713f", top: "#0d9488", accent: "#f59e0b", prop: "kettle" },
  jewelry: { bg: ["#fef3c7", "#ccfbf1"], skin: "#c98a5e", top: "#b45309", accent: "#0d9488", prop: "gem" },
  heroA: { bg: ["#ccfbf1", "#f1f5f9"], skin: "#c98a5e", top: "#0d9488", accent: "#f59e0b", prop: "drape" },
  heroB: { bg: ["#fef3c7", "#f1f5f9"], skin: "#a9713f", top: "#f59e0b", accent: "#0d9488", prop: "bowl" },
  workspace: { bg: ["#ccfbf1", "#fef3c7"], skin: "#c98a5e", top: "#0f766e", accent: "#f59e0b", prop: "plant" },
};

function IllProp({ kind, x, y, color }) {
  switch (kind) {
    case "drape":
      return <path d={`M${x - 26} ${y + 6} q26 -34 52 0 l-8 58 q-18 10 -36 0 z`} fill={color} opacity=".9" />;
    case "bowl":
      return (<g><path d={`M${x - 24} ${y + 26} a24 24 0 0 0 48 0 z`} fill={color} /><rect x={x - 30} y={y + 22} width="60" height="5" rx="2.5" fill={color} opacity=".55" /></g>);
    case "book":
      return (<g><rect x={x - 24} y={y + 18} width="48" height="34" rx="4" fill={color} /><rect x={x - 18} y={y + 25} width="36" height="4" rx="2" fill="#fff" opacity=".7" /><rect x={x - 18} y={y + 33} width="26" height="4" rx="2" fill="#fff" opacity=".5" /></g>);
    case "leaf":
      return (<g><path d={`M${x} ${y + 54} C${x - 30} ${y + 30} ${x - 24} ${y + 4} ${x} ${y - 6} C${x + 24} ${y + 4} ${x + 30} ${y + 30} ${x} ${y + 54} z`} fill={color} opacity=".9" /><path d={`M${x} ${y - 2} V${y + 48}`} stroke="#fff" strokeWidth="2.5" opacity=".6" /></g>);
    case "kettle":
      return (<g><circle cx={x} cy={y + 38} r="22" fill={color} /><path d={`M${x - 12} ${y + 18} q12 -16 24 0`} stroke={color} strokeWidth="7" fill="none" strokeLinecap="round" /><rect x={x - 16} y={y + 12} width="32" height="8" rx="4" fill={color} /></g>);
    case "gem":
      return (<g><path d={`M${x - 20} ${y + 20} l20 -16 20 16 -20 30 z`} fill={color} /><path d={`M${x - 20} ${y + 20} h40`} stroke="#fff" strokeWidth="2" opacity=".7" /></g>);
    case "plant":
      return (<g><rect x={x - 14} y={y + 34} width="28" height="24" rx="5" fill="#b45309" opacity=".85" /><path d={`M${x} ${y + 34} C${x - 22} ${y + 16} ${x - 16} ${y - 6} ${x - 2} ${y - 10}`} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" /><path d={`M${x} ${y + 34} C${x + 22} ${y + 14} ${x + 16} ${y - 4} ${x + 2} ${y - 8}`} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" opacity=".75" /></g>);
    default:
      return null;
  }
}

export function Illustration({ variant = "boutique", className = "" }) {
  const c = ILL[variant] || ILL.boutique;
  const id = `ill-${variant}`;
  return (
    <svg viewBox="0 0 480 600" className={`absolute inset-0 h-full w-full object-cover ${className}`} role="img" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c.bg[0]} /><stop offset="100%" stopColor={c.bg[1]} />
        </linearGradient>
      </defs>
      <rect width="480" height="600" fill={`url(#${id})`} />
      <circle cx="352" cy="150" r="118" fill={c.accent} opacity=".16" />
      <circle cx="96" cy="512" r="86" fill={c.top} opacity=".12" />
      {/* bust */}
      <path d="M118 600 C118 452 172 392 240 392 C308 392 362 452 362 600 Z" fill={c.top} />
      {/* neck + head */}
      <rect x="222" y="330" width="36" height="52" rx="16" fill={c.skin} />
      <circle cx="240" cy="288" r="66" fill={c.skin} />
      <path d="M174 288 a66 66 0 0 1 132 0 q-14 -40 -66 -40 t-66 40 z" fill="#243043" />
      {/* phone in hand */}
      <g transform="translate(292 428) rotate(-8)">
        <rect x="-30" y="-52" width="60" height="104" rx="12" fill="#0e1a2b" />
        <rect x="-24" y="-44" width="48" height="88" rx="7" fill="#fff" />
        <rect x="-18" y="-36" width="30" height="6" rx="3" fill={c.top} />
        <rect x="-18" y="-24" width="36" height="5" rx="2.5" fill="#dbe3ee" />
        <rect x="-18" y="-14" width="26" height="5" rx="2.5" fill="#dbe3ee" />
        <rect x="-18" y="4" width="36" height="14" rx="7" fill={c.accent} />
      </g>
      <ellipse cx="300" cy="486" rx="26" ry="20" fill={c.skin} />
      <IllProp kind={c.prop} x={148} y={452} color={c.accent} />
    </svg>
  );
}

/* ============================ ImageSlot ============================ */
/* <img> with width/height, lazy loading, and a gradient placeholder if the
   file is missing. ratio: "4/5" | "16/9" | "16/10" | "1/1" */
export function ImageSlot({ src, alt, ratio = "4/5", w = 480, className = "", caption = "", eager = false, bare = false, fill = false, fallback = "boutique" }) {
  const [missing, setMissing] = React.useState(false);
  const [rw, rh] = ratio.split("/").map(Number);
  const shell = bare ? "relative overflow-hidden" : "relative overflow-hidden rounded-2xl border border-line bg-white shadow-soft";
  return (
    <figure className={`${shell} ${className}`}>
      <div className={fill ? "absolute inset-0" : "relative"} style={fill ? undefined : { aspectRatio: `${rw} / ${rh}` }}>
        {missing ? (
          fallback ? <Illustration variant={fallback} /> : (
            <div className="absolute inset-0 grid place-items-center bg-linear-to-br from-teal/15 to-amber/15 p-4 text-center">
              <span className="text-[11px] font-semibold text-slate-400">{src.split("/").pop()}</span>
            </div>
          )
        ) : (
          <img src={src} alt={alt} width={w} height={Math.round((w * rh) / rw)}
            loading={eager ? "eager" : "lazy"} decoding="async"
            onError={() => setMissing(true)}
            className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      {caption && <figcaption className="px-4 py-3 text-[13px] font-medium text-slateInk">{caption}</figcaption>}
    </figure>
  );
}

/* ============================ PhoneFrame ============================ */
/* The hero phone shell, reusable for static mockups (no interactivity). */
export function PhoneFrame({ children, className = "", tilt = false }) {
  return (
    <div className={`relative w-[300px] overflow-hidden rounded-[46px] border-[10px] border-ink bg-white shadow-lift ${tilt ? "tilt" : ""} ${className}`}>
      <div className="absolute left-1/2 top-2.5 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-ink" />
      <div className="relative h-[500px] overflow-hidden">{children}</div>
    </div>
  );
}

/* ============================ CommentToDM ============================ */
/* Animated 3-step loop: comment appears -> public reply -> DM card.
   CSS keyframes v-step-1/2/3 (tailwind.css), one infinite 9s cycle.
   Under prefers-reduced-motion the final state shows statically. */
export function CommentToDM({ keyword = "GUIDE", compact = false }) {
  const kw = (keyword || "KEYWORD").toUpperCase();
  /* One 9s master cycle, repeated forever. Each step has its own keyframes
     (v-step-1/2/3 in tailwind.css) whose percentages map to its in/out window,
     so the sequence loops instead of ending hidden. */
  const stepIn = (n) => `v-step-${n} 9s cubic-bezier(.2,.9,.3,1.15) infinite both`;
  return (
    <div className={`flex flex-col gap-2.5 ${compact ? "max-w-[300px]" : "max-w-[360px]"}`} aria-label={t("landing.mock.c2dAria")}>
      {/* 1 - comment */}
      <div className="v-step" style={{ animation: stepIn(1) }}>
        <div className="flex items-start gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-300 to-violet-400 text-[13px]">🙋‍♀️</span>
          <div className="rounded-2xl rounded-tl-md bg-white px-3.5 py-2 text-[13px] shadow-soft">
            <b className="me-1.5 text-[12px]">maya.creates</b>{kw.toLowerCase()} please! 🙌
            <span className="ms-2 text-[11px] text-slate-400">now</span>
          </div>
        </div>
      </div>
      {/* 2 - public reply */}
      <div className="v-step ps-6" style={{ animation: stepIn(2) }}>
        <div className="flex items-start gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 via-pink-400 to-indigo-400 text-[13px]">⚡</span>
          <div className="rounded-2xl rounded-tl-md bg-teal-soft px-3.5 py-2 text-[13px] text-teal-dark">
            <b className="me-1.5 text-[12px] text-ink">your.brand</b>{t("landing.mock.sentYouDm")}
          </div>
        </div>
      </div>
      {/* 3 - DM card */}
      <div className="v-step mt-1 ms-auto w-[85%] rounded-2xl border border-line bg-white p-3 shadow-chip" style={{ animation: stepIn(3) }}>
        <div className="flex items-center gap-2 border-b border-line pb-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-amber-300 via-pink-400 to-indigo-400 text-[11px]">👩‍🍳</span>
          <span className="text-[12px] font-extrabold">your.brand</span>
          <span className="ms-auto rounded-full bg-mist px-2 py-0.5 text-[10px] font-bold text-slate-400">DM</span>
        </div>
        <p className="pt-2 text-[13px] leading-snug">{t("landing.visuals.demoDm")}</p>
        <div className="mt-2 flex gap-1.5">
          <span className="rounded-full bg-teal px-3 py-1 text-[11px] font-bold text-white">{t("landing.visuals.getGuide")}</span>
          <span className="rounded-full border border-line px-3 py-1 text-[11px] font-bold text-slateInk">{t("landing.visuals.askQuestion")}</span>
        </div>
      </div>
    </div>
  );
}

/* ============================ StatCard + Sparkline ============================ */
export function Sparkline({ values, stroke = "#0d9488", fill = "rgba(13,148,136,.12)" }) {
  const w = 96, h = 28, max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - (v / max) * (h - 6)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-24" aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={fill} />
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function StatCard({ label, value, hint, values = [3, 5, 4, 7, 6, 9, 12], tone = "teal" }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="text-[26px] font-extrabold tracking-tight text-ink">{value}</div>
        <Sparkline values={values} stroke={tone === "amber" ? "#f59e0b" : "#0d9488"} fill={tone === "amber" ? "rgba(245,158,11,.14)" : "rgba(13,148,136,.12)"} />
      </div>
      {hint && <div className="mt-1 text-[12px] text-slate-400">{hint}</div>}
    </div>
  );
}

/* ============================ MiniUI set ============================ */
export function KeywordChips({ match = "GUIDE" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="rounded-full bg-teal-soft px-3 py-1 text-[12px] font-extrabold text-teal-dark ring-1 ring-teal/30">{match} ✓</span>
      <span className="rounded-full bg-mist px-3 py-1 text-[12px] font-bold text-slate-400 line-through">guilt</span>
      <span className="rounded-full bg-mist px-3 py-1 text-[12px] font-bold text-slate-400">PRICE</span>
    </div>
  );
}

export function MessageEditor({ text = "Hey! 👋 Here's the guide you asked for." }) {
  return (
    <div className="w-full max-w-[260px] rounded-2xl border border-line bg-white p-3 shadow-soft">
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{t("landing.visuals.dmText")}</div>
      <div className="mt-1.5 rounded-xl bg-mist px-3 py-2 text-[12.5px] leading-snug">{text}<span className="v-caret" /></div>
      <div className="mt-2 flex justify-end">
        <span className="rounded-full bg-teal px-3 py-1 text-[11px] font-bold text-white">{t("landing.visuals.save")}</span>
      </div>
    </div>
  );
}

export function FollowersOnlyToggle() {
  return (
    <div className="flex items-center gap-2.5 rounded-full border border-line bg-white px-3.5 py-2 shadow-soft">
      <span className="text-[12.5px] font-bold text-slateInk">{t("landing.visuals.followersOnly")}</span>
      <span className="relative h-5 w-9 rounded-full bg-teal">
        <span className="absolute end-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow" />
      </span>
    </div>
  );
}

export function EmailCollect() {
  return (
    <div className="flex w-full max-w-[260px] flex-col gap-2">
      <div className="ms-auto rounded-2xl rounded-ee-md bg-sky-500 px-3.5 py-2 text-[12.5px] font-medium text-white">maya@mail.com</div>
      <div className="flex items-center gap-2 self-end rounded-full bg-teal-soft px-3 py-1.5 text-[12px] font-bold text-teal-dark">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
        {t("landing.visuals.emailSaved")}
      </div>
    </div>
  );
}

export function ResultsBars({ bars = [40, 65, 52, 88] }) {
  return (
    <div className="flex h-20 items-end gap-2" role="img" aria-label={t("landing.mock.resultsAria")}>
      {bars.map((v, i) => (
        <div key={i} className="v-bar w-5 rounded-t-md" style={{ height: `${v}%`, background: i === bars.length - 1 ? "#0d9488" : "#99d5ce", animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  );
}

/* ============================ Tutorial mocks ============================ */
/* Small static mockups used by the setup tutorial stepper in landing.jsx. */

export function MockConnected() {
  const rows = [
    { icon: "👩‍🍳", grad: "from-amber-300 via-pink-400 to-indigo-400", name: "your.brand", sub: t("landing.tutorial.mock.igSub") },
    { icon: "f", grad: "from-sky-500 to-blue-600", name: t("landing.tutorial.mock.pageName"), sub: t("landing.tutorial.mock.fbSub") },
  ];
  return (
    <div className="flex w-full max-w-[340px] flex-col gap-3">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-soft">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br ${r.grad} text-[15px] font-extrabold text-white`}>{r.icon}</span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-extrabold">{r.name}</div>
            <div className="text-[11.5px] text-slate-400">{r.sub}</div>
          </div>
          <span className="ms-auto flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[11px] font-extrabold text-teal-dark">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
            {t("landing.tutorial.mock.connected")}
          </span>
        </div>
      ))}
      <p className="text-center text-[11.5px] text-slate-400">{t("landing.tutorial.mock.loginNote")}</p>
    </div>
  );
}

export function MockPickPost({ keyword = "GUIDE" }) {
  const tiles = ["🍝", "👩‍🍳", "🧑‍🍳", "📋", "💻", "🪞"];
  return (
    <div className="w-full max-w-[340px] rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="text-[13px] font-extrabold">{t("landing.tutorial.mock.whichPost")}</div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {tiles.map((t, i) => (
          <div key={i} className={`relative grid aspect-square place-items-center rounded-xl bg-linear-to-br text-2xl ${i === 0 ? "from-teal-soft to-amber/15 ring-2 ring-ink" : "from-mist to-line/60"}`}>
            {t}
            {i === 0 && (
              <span className="absolute end-1.5 top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-ink text-white">
                <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 text-[13px] font-extrabold">{t("landing.tutorial.mock.whichWord")}</div>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line px-3 py-2">
        <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-extrabold text-white">{keyword} ×</span>
        <span className="text-[12px] text-slate-400">{t("landing.tutorial.mock.addAnother")}</span>
      </div>
    </div>
  );
}

export function MockReplyEditor({ text = "Here's the guide you asked for 👇", link = "yourlink.com/guide" }) {
  return (
    <div className="w-full max-w-[340px] rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{t("landing.tutorial.mock.dmLabel")}</div>
      <div className="mt-2 rounded-xl bg-mist px-3 py-2.5 text-[12.5px] leading-snug">{text}<span className="v-caret" /></div>
      <div className="mt-2.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{t("landing.tutorial.mock.buttonLabel")}</div>
      <div className="mt-1.5 flex items-center justify-between rounded-xl border border-line px-3 py-2">
        <span className="text-[12px] font-bold text-teal-dark">{link}</span>
        <span className="rounded-full bg-teal px-3 py-1 text-[11px] font-bold text-white">{t("landing.tutorial.mock.open")}</span>
      </div>
      <div className="mt-3 flex justify-end">
        <span className="rounded-full bg-ink px-4 py-1.5 text-[11.5px] font-extrabold text-white">{t("landing.tutorial.mock.saveRule")}</span>
      </div>
    </div>
  );
}

export function MockEveryComment() {
  const rows = [
    { u: "maya.creates", c: "guide please! 🙌", ok: true },
    { u: "priya_shops", c: "GUIDE", ok: true },
    { u: "the.guilt.trip", c: "feeling guilty lol", ok: false },
    { u: "arun.eats", c: "guide?", ok: true },
  ];
  return (
    <div className="flex w-full max-w-[340px] flex-col gap-2">
      {rows.map((r) => (
        <div key={r.u} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[12.5px] shadow-soft ${r.ok ? "border-line bg-white" : "border-line bg-mist/70 opacity-70"}`}>
          <span className="font-extrabold">{r.u}</span>
          <span className="text-slateInk">{r.c}</span>
          {r.ok ? (
            <span className="ms-auto rounded-full bg-teal-soft px-2 py-0.5 text-[10.5px] font-extrabold text-teal-dark">{t("landing.tutorial.mock.dmSent")}</span>
          ) : (
            <span className="ms-auto rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-slate-400">{t("landing.tutorial.mock.noMatch")}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function MockResults() {
  return (
    <div className="w-full max-w-[340px] rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[[t("landing.tutorial.mock.matches"), "128"], [t("landing.tutorial.mock.dmsSent"), "121"], [t("landing.tutorial.mock.emails"), "34"]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-mist px-2 py-2.5">
            <div className="text-[18px] font-extrabold text-teal-dark">{v}</div>
            <div className="text-[10.5px] font-bold text-slate-400">{l}</div>
          </div>
        ))}
      </div>
      <div className="mt-3"><ResultsBars bars={[35, 55, 48, 85]} /></div>
      <div className="mt-2 text-center text-[11.5px] text-slate-400">{t("landing.tutorial.mock.monthNote")}</div>
    </div>
  );
}

/* ============================ Chat mock cards (features) ============================ */
/* dmfast-style: a mini chat scene on top, title + one line below. */
export function ChatMock({ children, className = "" }) {
  return (
    <div className={`flex min-h-[150px] flex-col justify-end gap-2 rounded-2xl bg-mist/80 p-4 ${className}`}>
      {children}
    </div>
  );
}
export function Bubble({ me = false, children }) {
  return me ? (
    <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-sky-500 px-3.5 py-2 text-[12.5px] font-medium text-white">{children}</div>
  ) : (
    <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[12.5px] font-medium shadow-soft">{children}</div>
  );
}
export function LinkCard({ title, cta }) {
  return (
    <div className="max-w-[80%] overflow-hidden rounded-xl border border-line bg-white text-center shadow-soft">
      <div className="border-b border-line px-3 py-2 text-[12px] font-bold">{title}</div>
      <div className="px-3 py-2 text-[12px] font-extrabold text-sky-600">{cta}</div>
    </div>
  );
}

/* ============================ AvatarStack ============================ */
export function AvatarStack({ emojis = ["🧑‍🍳", "👨‍🎨", "👩‍💼", "🧔"], max = 4 }) {
  return (
    <div className="flex -space-x-2">
      {emojis.slice(0, max).map((e, i) => (
        <span key={i} className="grid h-8 w-8 place-items-center rounded-full bg-white text-sm shadow-soft ring-2 ring-mist">{e}</span>
      ))}
    </div>
  );
}