/* Interactive "how it works" demo for the landing page.
 * Pure front-end simulation — no fetch, no /api/demo, no beacons.
 * Copy + timing live in src/flowDemoData.js. Palette: DESIGN-BRIEF
 * (ink bg, teal accent, amber highlight). Logical utilities only (RTL-safe).
 */
import React from "react";
import { SCENARIOS, DEMO_REPLIES_PER_POST, STEP_MS, LOOP_PAUSE_MS, IDLE_RESUME_MS } from "./flowDemoData";

const { useState, useRef, useEffect, useCallback, useMemo } = React;

/* Same i18n contract as landing.jsx: read window.I18N at render time. */
const I18N = () => (typeof window !== "undefined" && window.I18N) || null;
const t = (key, vars) => {
  const i = I18N();
  return i ? i.t(key, vars) : key.split(".").pop();
};
const tp = (key, count, vars) => {
  const i = I18N();
  return i ? i.tplural(key, count, vars) : key.split(".").pop();
};
const num = (n) => {
  const i = I18N();
  return i ? i.num(n) : String(n);
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- icons (inline SVG, currentColor) ---------------- */
const ICONS = {
  bubble: <path d="M4 5.5h12a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V7A1.5 1.5 0 0 1 4 5.5Z" />,
  lock: <><rect x="5" y="10" width="10" height="7" rx="2" /><path d="M8 10V8a2 2 0 0 1 4 0v2" /></>,
  mail: <><rect x="3" y="5.5" width="14" height="11" rx="2" /><path d="m4 7 6 5 6-5" /></>,
  clock: <><circle cx="10" cy="10.5" r="7" /><path d="M10 6.5v4l2.5 1.5" /></>,
  gauge: <><path d="M3.5 14a7.5 7.5 0 1 1 13 0" /><path d="m10 11 3-3.5" /></>,
  globe: <><circle cx="10" cy="10.5" r="7" /><path d="M3 10.5h14M10 3.5c-2.2 2-2.2 12 0 14M10 3.5c2.2 2 2.2 12 0 14" /></>,
  check: <path d="m4.5 10 3.5 3.5 6.5-7" />,
  double: <path d="m2.5 10 3 3 6-7M8 12.5l1.5 1.5 6-7" />,
};
const Icon = ({ name, className = "h-4 w-4" }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {ICONS[name]}
  </svg>
);

/* ---------------- timeline hook ----------------
   Owns: active step, playing state, the step timer, the idle-resume timer,
   and the progress fraction for the tab underline. Every timer is cleared on
   unmount and whenever the scenario or step changes. */
function useFlowTimeline(scenarioIndex) {
  const steps = SCENARIOS[scenarioIndex].steps;
  const reduced = prefersReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [progress, setProgress] = useState(0);
  const tickRef = useRef(0);
  const idleRef = useRef(0);
  const rafRef = useRef(0);
  const hoveredRef = useRef(false);

  const canPlay = playing && !reduced && visible && !hovered;

  const stopTick = () => {
    if (tickRef.current) { clearTimeout(tickRef.current); tickRef.current = 0; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  };

  /* one tick = advance step (longer pause after the last one),
     while a rAF paints the progress bar under the active tab. */
  const schedule = useCallback((fromStep) => {
    if (!canPlay) { setProgress(0); return; }
    const dur = fromStep === steps.length - 1 ? STEP_MS + LOOP_PAUSE_MS : STEP_MS;
    const start = performance.now();
    const loop = () => {
      const p = Math.min(1, (performance.now() - start) / dur);
      setProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    tickRef.current = setTimeout(() => setStep((s) => (s + 1) % steps.length), dur);
  }, [canPlay, steps.length]);

  useEffect(() => { setStep(0); setProgress(0); }, [scenarioIndex]);

  useEffect(() => {
    stopTick();
    schedule(step);
    return stopTick;
  }, [step, scenarioIndex, schedule]);

  /* pause while off-screen */
  useEffect(() => {
    const el = document.getElementById("live-demo");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => () => {
    stopTick();
    if (idleRef.current) clearTimeout(idleRef.current);
  }, []);

  /* user interaction pauses; idle for IDLE_RESUME_MS resumes */
  const pauseForUser = useCallback(() => {
    if (reduced) return;
    setPlaying(false);
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      if (!hoveredRef.current) setPlaying(true);
    }, IDLE_RESUME_MS);
  }, [reduced]);

  /* hover holds the pause; the idle clock only starts once the
     pointer/focus leaves the section */
  const holdPause = useCallback(() => {
    hoveredRef.current = true;
    setHovered(true);
    setPlaying(false);
    if (idleRef.current) clearTimeout(idleRef.current);
  }, [reduced]);

  const releasePause = useCallback(() => {
    hoveredRef.current = false;
    setHovered(false);
    if (reduced) return;
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setPlaying(true), IDLE_RESUME_MS);
  }, [reduced]);

  const goTo = useCallback((i) => {
    setStep(i);
    pauseForUser();
  }, [pauseForUser]);

  const reset = useCallback(() => {
    setStep(0);
    setProgress(0);
  }, []);

  return { step, steps, progress, goTo, reset, pauseForUser, holdPause, releasePause, reduced };
}

/* ---------------- tabs (ARIA tablist + roving tabindex) ---------------- */
function FlowTabs({ active, onSelect, progress }) {
  const refs = useRef([]);

  const onKey = (e) => {
    let next = null;
    if (e.key === "ArrowRight") next = (active + 1) % SCENARIOS.length;
    else if (e.key === "ArrowLeft") next = (active - 1 + SCENARIOS.length) % SCENARIOS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SCENARIOS.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={t("landing.flow.tabsAria")} onKeyDown={onKey}
      className="flex flex-wrap gap-2 lg:flex-nowrap lg:overflow-x-auto lg:pb-1">
      {SCENARIOS.map((s, i) => {
        const on = i === active;
        return (
          <button key={s.id} ref={(el) => (refs.current[i] = el)} type="button" role="tab"
            id={`flow-tab-${s.id}`} aria-selected={on} aria-controls="flow-panel"
            tabIndex={on ? 0 : -1} onClick={() => onSelect(i)}
            className={`relative flex min-w-max snap-center items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal ${
              on ? "bg-teal text-white shadow-soft" : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
            }`}>
            <Icon name={s.icon} className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">{t(s.tab.k)}</span>
            {on && (
              <span className="absolute inset-x-2.5 bottom-0.5 h-[2.5px] overflow-hidden rounded-full bg-white/20" aria-hidden="true">
                <span className="block h-full rounded-full bg-amber" style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- steps list ---------------- */
function FlowSteps({ scenario, step, onJump }) {
  return (
    <ol className="mt-6 flex flex-col gap-1.5">
      {scenario.steps.map((s, i) => {
        const done = i < step, on = i === step;
        return (
          <li key={s.title.k}>
            <button type="button" onClick={() => onJump(i)} aria-current={on || undefined}
              className={`flex w-full items-start gap-3 rounded-[14px] border p-3 text-start transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal ${
                on ? "border-white/20 bg-white/10 shadow-lift" : done ? "border-transparent hover:bg-white/5" : "border-transparent opacity-50 hover:opacity-80"
              }`}>
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-extrabold transition ${
                on ? "bg-amber text-ink" : done ? "border border-teal/60 text-teal" : "border border-white/20 text-white/50"
              }`}>
                {done ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[14px] font-extrabold leading-snug ${on ? "text-white" : "text-white/70"}`}>{t(s.title.k)}</span>
                <span className={`grid transition-all duration-300 ${on ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <span className="overflow-hidden">
                    <span className="block text-[12.5px] leading-relaxed text-white/60">{t(s.desc.k)}</span>
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------- phone mockup ---------------- */
function FlowPhone({ scenario, step, reduced }) {
  const chatRef = useRef(null);
  const items = useMemo(() => {
    const acc = [];
    for (let i = 0; i <= step && i < scenario.steps.length; i++) acc.push(...scenario.steps[i].items);
    /* "Any language": the first fan follows the viewer's locale. Drop the two
       fixed example messages whose handle collides with that localized fan
       (e.g. a Japanese viewer already saw yuki.draws as the first commenter). */
    const fan = t("landing.flow.langDemo.fan");
    return acc.filter((x) => !x.dedupeFan || ((x.who || x.to) !== fan));
  }, [scenario, step]);

  /* auto-scroll the chat area only */
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [items.length, reduced]);

  const counter = [...items].reverse().find((x) => x.kind === "counter");

  return (
    <div className="relative w-[290px] max-w-full">
      <div className="rounded-[42px] border-[9px] border-white/15 bg-white shadow-lift">
        <div className="relative mx-auto mt-2 h-4 w-20 rounded-full bg-ink/90" aria-hidden="true" />
        {/* header */}
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-amber-300 via-pink-400 to-indigo-400 p-[2px]">
            <div className="grid h-full w-full place-items-center rounded-full bg-white text-[13px]">⚡</div>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold text-ink">yourbrand</div>
            <div className="text-[10.5px] font-bold text-teal-dark">● {t("landing.flow.phone.activeNow")}</div>
          </div>
        </div>
        {/* chat area — fixed height, only this scrolls */}
        <div ref={chatRef} className="h-[376px] overflow-y-auto px-3 py-3" role="log"
          aria-label={t("landing.flow.phone.aria")} aria-live={reduced ? "off" : "polite"}>
          {items.map((it, idx) => (
            <FlowItem key={`${scenario.id}-${idx}`} item={it} counter={counter} reduced={reduced} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FlowItem({ item, counter, reduced }) {
  const anim = reduced ? "" : "v-fade-up";
  /* Optional locale-keyed variants (textK/whoK/toK): resolved through t() at
     render time so the "Any language" scenario follows the viewer's locale.
     All other scenarios keep plain text/who/to (never localized, section 12). */
  const text = item.textK ? t(item.textK) : item.text;
  const who = item.whoK ? t(item.whoK) : item.who;
  const to = item.toK ? t(item.toK) : item.to;
  switch (item.kind) {
    case "comment":
      return (
        <div className={`mb-2 flex items-start gap-2 ${anim}`}>
          <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line text-[11px]">🙋</div>
          <div className="max-w-[85%] rounded-ee-xl rounded-es-2xl rounded-ss-2xl rounded-se-xl bg-mist px-3 py-2">
            <div className="text-[10px] font-bold text-slate-400">{who}</div>
            <div className="text-[12.5px] font-semibold text-ink">{text}</div>
          </div>
        </div>
      );
    case "reply":
      return (
        <div className={`mb-2 ms-6 max-w-[85%] rounded-[14px] border border-line bg-white px-3 py-2 shadow-soft ${anim}`}>
          <span className="mb-0.5 inline-block rounded-full bg-teal-soft px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide text-teal-dark">{t("landing.flow.phone.replyBadge")}</span>
          <div className="text-[12px] font-semibold text-slateInk">{text}</div>
        </div>
      );
    case "dm":
      return (
        <div className={`mb-2 ${to ? "ms-6" : ""} ${anim}`}>
          <div className="ms-auto max-w-[85%] rounded-ss-2xl rounded-se-2xl rounded-es-xl rounded-ee-xl bg-gradient-to-br from-teal to-teal-dark px-3 py-2 text-[12.5px] font-semibold leading-snug text-white shadow-soft">
            {to && <div className="mb-0.5 text-[10px] font-bold text-white/70">→ {to}</div>}
            {text}
          </div>
        </div>
      );
    case "buttons":
      return (
        <div className={`mb-2 ms-6 max-w-[88%] overflow-hidden rounded-[14px] border border-line bg-white shadow-soft ${anim}`}>
          {item.buttons.map((b) => (
            <div key={b} className="border-b border-line px-3 py-2 text-center text-[12px] font-extrabold text-teal-dark last:border-b-0">{b}</div>
          ))}
        </div>
      );
    case "tap":
      return <div className={`mb-2 flex justify-end ${anim}`}><span className="rounded-full bg-amber px-3 py-1.5 text-[12px] font-extrabold text-ink">👆 {item.text}</span></div>;
    case "user-reply":
      return <div className={`mb-2 flex justify-end ${anim}`}><span className="max-w-[80%] rounded-[14px] bg-mist px-3 py-2 text-[12.5px] font-semibold text-ink">{item.text}</span></div>;
    case "status":
      return (
        <div className={`mb-2 flex items-center justify-end gap-1.5 pe-1 text-[10.5px] font-bold text-slate-400 ${anim}`}>
          <Icon name="double" className="h-3.5 w-3.5 text-teal" />
          {t("landing.flow.phone.sent", { ms: item.ms })}
        </div>
      );
    case "typing":
      return (
        <div className={`mb-2 flex justify-end ${anim}`} aria-hidden="true">
          <span className="flex items-center gap-1 rounded-[14px] bg-mist px-3 py-2.5">
            {[0, 1, 2].map((d) => (
              <span key={d} className={`h-1.5 w-1.5 rounded-full bg-slate-400 ${reduced ? "" : "fd-dot"}`} style={reduced ? undefined : { animationDelay: `${d * 150}ms` }} />
            ))}
          </span>
        </div>
      );
    case "counter": {
      const cap = DEMO_REPLIES_PER_POST;
      const pct = Math.min(100, Math.round((item.used / cap) * 100));
      const left = Math.max(0, cap - item.used);
      return (
        <div className={`mb-2 ms-6 max-w-[88%] rounded-[14px] border border-line bg-white p-2.5 shadow-soft ${anim}`}>
          <div className="flex items-baseline justify-between gap-2 text-[10.5px] font-extrabold">
            <span className="text-slate-400">{t("landing.flow.phone.counter", { used: num(item.used), cap: num(cap) })}</span>
            {item.capped
              ? <span className="whitespace-nowrap rounded-full bg-amber/15 px-2 py-px text-[10px] text-amber">{t("landing.flow.phone.limitReached")}</span>
              : <span className="whitespace-nowrap text-teal-dark">{tp("landing.flow.phone.repliesLeft", left, { count: num(left) })}</span>}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mist">
            <div className={`h-full rounded-full transition-all duration-700 ${item.capped ? "bg-amber" : "bg-teal"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case "note":
      return (
        <div className={`mb-2 flex justify-center ${anim}`}>
          <span className="rounded-full bg-ink/5 px-2.5 py-1 text-center text-[10px] font-bold text-slate-400">
            {item.text}
            {item.chip === "topup" && <span className="ms-1.5 rounded-full bg-teal-soft px-1.5 py-px text-[9.5px] font-extrabold text-teal-dark">+100 · {t("landing.flow.phone.topup")}</span>}
          </span>
        </div>
      );
    default:
      return null;
  }
}

/* ---------------- section ---------------- */
export function FlowDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const { step, progress, goTo, reset, pauseForUser, holdPause, releasePause, reduced } = useFlowTimeline(scenarioIndex);
  const scenario = SCENARIOS[scenarioIndex];

  const selectScenario = (i) => {
    setScenarioIndex(i);
    reset(); // also when re-clicking the active tab (scenarioIndex unchanged)
    pauseForUser();
  };

  return (
    <section id="live-demo" className="relative overflow-hidden bg-ink" aria-labelledby="flow-heading"
      onMouseEnter={holdPause} onMouseLeave={releasePause}
      onFocusCapture={holdPause} onBlurCapture={releasePause}>
      {/* teal spotlight glow behind the phone */}
      <div className="pointer-events-none absolute end-[6%] top-1/2 h-[520px] w-[520px] -translate-y-1/2 rounded-full bg-teal/20 blur-[120px]" aria-hidden="true" />
      <div className="pointer-events-none absolute start-[-10%] top-[-20%] h-[380px] w-[380px] rounded-full bg-teal/10 blur-[100px]" aria-hidden="true" />

      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[55fr_45fr] lg:items-center">
        {/* left column */}
        <div>
          <p className="text-[13px] font-extrabold uppercase tracking-[0.2em] text-teal">{t("landing.flow.kicker")}</p>
          <h2 id="flow-heading" className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            {t("landing.flow.titleA")} <span className="font-display italic text-teal">{t("landing.flow.titleAccent")}</span> {t("landing.flow.titleB")}
          </h2>
          <p className="mt-3 max-w-xl text-[14.5px] font-semibold leading-relaxed text-white/60">{t("landing.flow.sub")}</p>

          <div className="mt-6">
            <FlowTabs active={scenarioIndex} onSelect={selectScenario} progress={progress} />
          </div>

          <div role="tabpanel" id="flow-panel" aria-labelledby={`flow-tab-${scenario.id}`} tabIndex={0} className="focus:outline-none">
            <FlowSteps scenario={scenario} step={step} onJump={goTo} />
          </div>

          <a href="/signup" onMouseEnter={pauseForUser} onFocus={pauseForUser}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-teal px-6 py-3 text-[14px] font-extrabold text-white shadow-lift transition hover:bg-teal-dark">
            {t("landing.flow.cta")} <span aria-hidden="true">→</span>
          </a>
        </div>

        {/* right column: phone */}
        <div className="flex justify-center lg:justify-end"
          onMouseEnter={pauseForUser} onFocusCapture={pauseForUser}>
          <FlowPhone scenario={scenario} step={step} reduced={reduced} />
        </div>
      </div>
    </section>
  );
}
