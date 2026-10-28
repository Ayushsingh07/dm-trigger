import React from "react";
import * as ReactDOM from "react-dom/client";
import { ImageSlot, AvatarStack, CommentToDM, KeywordChips, MessageEditor, ResultsBars, KeywordMarquee, MockConnected, MockPickPost, MockReplyEditor, MockEveryComment, MockResults, ChatMock, Bubble, LinkCard } from "./visuals";

const { useState, useRef, useEffect } = React;

/* ---------------- data ---------------- */
const TYPES = [
  { id: "creator", emoji: "🎨", label: "Creator", media: "🧁", niche: "creator", audio: "baker's beat — original audio", base: "#312e81", blobs: ["#f472b6", "#fbbf24", "#22d3ee"], caption: "New drop tomorrow — comment GUIDE and I'll send it to you 🤍" },
  { id: "shop", emoji: "🛍️", label: "Shop", media: "👗", niche: "shop", audio: "runway mix — original audio", base: "#831843", blobs: ["#f9a8d4", "#a78bfa", "#38bdf8"], caption: "Which colour? Comment PRICE and it's yours ✨" },
  { id: "coach", emoji: "🧠", label: "Coach", media: "🏋️", niche: "coach", audio: "gym hype — original audio", base: "#064e3b", blobs: ["#34d399", "#22d3ee", "#818cf8"], caption: "Free plan this week — comment COACH to get it 💪" },
  { id: "restaurant", emoji: "🍝", label: "Restaurant", media: "🍜", niche: "restaurant", audio: "kitchen lo-fi — original audio", base: "#7c2d12", blobs: ["#fb923c", "#f43f5e", "#fbbf24"], caption: "New menu just dropped — comment MENU to peek 🤫" },
  { id: "salon", emoji: "💇", label: "Salon", media: "💅", niche: "salon", audio: "glow-up sounds — original audio", base: "#581c87", blobs: ["#e879f9", "#818cf8", "#67e8f9"], caption: "Book a slot — comment BOOK and I'll hold one for you 💫" },
];

const Avatar = ({ size = "h-8 w-8" }) => (
  <div className={`${size} shrink-0 rounded-full bg-gradient-to-br from-amber-300 via-pink-400 to-indigo-400 p-[2px]`}>
    <div className="grid h-full w-full place-items-center rounded-full bg-white text-[45%]">👩‍🍳</div>
  </div>
);
const UserAvatar = ({ size = "h-6 w-6" }) => (
  <div className={`${size} shrink-0 rounded-full bg-gradient-to-br from-sky-300 to-violet-400 p-[2px]`}>
    <div className="grid h-full w-full place-items-center rounded-full bg-white text-[45%]">🙋‍♀️</div>
  </div>
);

/* scroll reveal */
function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add("in"); el.style.animationDelay = delay + "ms"; io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`}>{children}</div>;
}

/* ---------------- nav ---------------- */
function Nav() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch("/auth/me").then((r) => r.json()).then((j) => setUser(j.user)).catch(() => {});
  }, []);
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <a href="#" className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-teal to-teal-dark text-white shadow-soft">⚡</span>
          ReplyLo
        </a>
        <nav className="hidden items-center gap-7 text-[14px] font-semibold text-slateInk md:flex">
          <a href="#how" className="transition hover:text-ink">How it works</a>
          <a href="#setup" className="transition hover:text-ink">Setup</a>
          <a href="#who" className="transition hover:text-ink">Who it's for</a>
          <a href="#features" className="transition hover:text-ink">Features</a>
          <a href="#demo" className="transition hover:text-ink">Live demo</a>
        </nav>
        <div className="flex items-center gap-3">
          {user ? (
            <a href="/app" className="rounded-full bg-ink px-4 py-2 text-[14px] font-bold text-white shadow-soft transition hover:bg-teal-dark hover:shadow-chip">
              Open dashboard →
            </a>
          ) : (
            <>
              <a href="/login" className="hidden text-[14px] font-semibold text-slateInk transition hover:text-ink sm:block">Sign in</a>
              <a href="/signup" className="rounded-full bg-ink px-4 py-2 text-[14px] font-bold text-white shadow-soft transition hover:bg-teal-dark hover:shadow-chip">
                Start free →
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ---------------- floating interactive icon chips ---------------- */
function FloatChip({ emoji, cls, r, d, badge, hot, onHot }) {
  const [sparks, setSparks] = useState([]);
  const burst = () => {
    const id = Date.now() + Math.random();
    setSparks((s) => [...s, id]);
    setTimeout(() => setSparks((s) => s.filter((x) => x !== id)), 850);
    if (hot && onHot) onHot();
  };
  return (
    <div className={`absolute z-20 animate-bob ${cls}`} style={{ "--r": r, animationDelay: d }}>
      <button onClick={burst} aria-label={`${emoji} — tap me`}
        className="relative grid h-14 w-14 place-items-center rounded-full bg-white text-2xl shadow-chip ring-1 ring-black/5 transition duration-300 hover:-translate-y-1 hover:scale-110 hover:shadow-lift active:scale-90">
        <span className="drop-shadow-sm">{emoji}</span>
        {badge && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">{badge}</span>}
      </button>
      {sparks.map((id) => (
        <span key={id} className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 animate-burst text-xl">✨</span>
      ))}
    </div>
  );
}
function FloatingChips({ onLike }) {
  return (
    <>
      <FloatChip emoji="❤️" cls="-right-11 top-14" r="8deg" d="0s" badge="1.2k" hot onHot={onLike} />
      <FloatChip emoji="💬" cls="-left-14 top-[34%]" r="-8deg" d=".8s" />
      <FloatChip emoji="📨" cls="-left-11 bottom-[19%]" r="-6deg" d="1.5s" />
      <FloatChip emoji="🔖" cls="-right-10 bottom-12" r="9deg" d="2.1s" />
    </>
  );
}

/* ---------------- one reel slide ---------------- */
function Reel({ t, keyword, stage, liked, likeCount, onLike, onCommentTap, onShare, isCurrent }) {
  return (
    <div className="relative h-full w-full shrink-0 overflow-hidden" style={{ background: t.base }}>
      <div className="absolute -left-16 -top-10 h-64 w-64 animate-blob1 rounded-full opacity-70 blur-2xl" style={{ background: t.blobs[0], animationPlayState: isCurrent ? "running" : "paused" }} />
      <div className="absolute -right-20 top-1/3 h-72 w-72 animate-blob2 rounded-full opacity-60 blur-2xl" style={{ background: t.blobs[1], animationPlayState: isCurrent ? "running" : "paused" }} />
      <div className="absolute -bottom-16 left-1/4 h-64 w-64 animate-blob3 rounded-full opacity-60 blur-2xl" style={{ background: t.blobs[2], animationPlayState: isCurrent ? "running" : "paused" }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
      <div className="absolute inset-0 grid place-items-center">
        <span className="animate-kenburns text-[120px] drop-shadow-2xl">{t.media}</span>
      </div>

      {/* right action rail */}
      <div className="absolute bottom-24 right-2.5 z-10 flex flex-col items-center gap-4 text-white">
        <button onClick={onLike} aria-label="Like" className={`flex flex-col items-center transition active:scale-75 ${liked ? "animate-beat" : "hover:scale-125"}`}>
          <span className="text-2xl drop-shadow">{liked ? "❤️" : "🤍"}</span>
          <span className="text-[10px] font-bold drop-shadow">{likeCount.toLocaleString()}</span>
        </button>
        <button onClick={onCommentTap} aria-label="Comments" className="flex flex-col items-center transition hover:scale-125 active:scale-90">
          <span className="text-2xl drop-shadow">💬</span>
          <span className="text-[10px] font-bold drop-shadow">128</span>
        </button>
        <button onClick={onShare} aria-label="Share" className="flex flex-col items-center transition hover:scale-125 active:scale-90">
          <span className="text-2xl drop-shadow">📨</span>
          <span className="text-[10px] font-bold drop-shadow">Share</span>
        </button>
        <span className="text-xl drop-shadow">⋯</span>
        <span className="mt-1 grid h-8 w-8 animate-spin place-items-center rounded-full bg-ink/70 text-sm">🎵</span>
      </div>

      {/* bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-3 text-white">
        <div className="flex items-center gap-2">
          <Avatar size="h-7 w-7" />
          <span className="text-[13px] font-extrabold drop-shadow">your.brand</span>
          <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold backdrop-blur">Follow</span>
        </div>
        <div className="mt-1.5 line-clamp-2 text-[12px] leading-snug drop-shadow"><b>your.brand</b> {t.caption}</div>
        <div className="mt-1.5 overflow-hidden rounded-full bg-black/35 py-1 backdrop-blur">
          <div className="animate-marquee whitespace-nowrap text-[11px] font-semibold" style={{ animationPlayState: isCurrent ? "running" : "paused" }}>
            <span className="px-4">♫ {t.audio}</span><span className="px-4">♫ {t.audio}</span>
          </div>
        </div>
      </div>

    </div>
  );
}

/* ---------------- comments bottom sheet (like real IG) ---------------- */
function CommentsSheet({ kw, stage, onClose }) {
  const open = stage === "peek" || stage === "typingCmt" || stage === "posted";
  const typing = stage === "typingCmt";
  const posted = stage === "posted" || stage === "opening";
  return (
    <div className={`absolute inset-0 z-30 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}>
      {/* dim scrim — tap to close */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* sheet */}
      <div className={`absolute inset-x-0 bottom-0 flex h-[68%] flex-col rounded-t-2xl bg-white transition-transform duration-300 [transition-timing-function:cubic-bezier(.3,.8,.3,1)] ${open ? "translate-y-0" : "translate-y-full"}`}>
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-slate-300" />
        <div className="px-4 pb-1.5 pt-1 text-center text-[13px] font-extrabold">Comments</div>

        <div className="flex-1 space-y-3 overflow-hidden px-4 py-2">
          {/* pre-existing comments */}
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-200 to-pink-400 text-[11px]">👩</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-snug"><b>beauty.by.gig</b> First!! This reel is everything 🔥</p>
              <p className="mt-0.5 text-[10px] text-slate-400">2d · 3 likes · Reply</p>
            </div>
            <span className="text-[10px] text-slate-400">♡</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-200 to-indigo-400 text-[11px]">🧑</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-snug"><b>the.socialista</b> yaay so glad you liked it 🔥🔥</p>
              <p className="mt-0.5 text-[10px] text-slate-400">1d · 1 like · Reply</p>
            </div>
            <span className="text-[10px] text-slate-400">♡</span>
          </div>

          {/* maya's comment appears here */}
          {typing && (
            <div className="flex items-center gap-2">
              <UserAvatar size="h-7 w-7" />
              <div className="flex gap-1 rounded-2xl bg-mist px-3 py-2.5">
                <i className="h-1.5 w-1.5 animate-blink rounded-full bg-slate-400" />
                <i className="h-1.5 w-1.5 animate-blink rounded-full bg-slate-400 [animation-delay:.18s]" />
                <i className="h-1.5 w-1.5 animate-blink rounded-full bg-slate-400 [animation-delay:.36s]" />
              </div>
            </div>
          )}
          {posted && (
            <div className="animate-slideup flex items-start gap-2">
              <UserAvatar size="h-7 w-7" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-snug"><b>maya.creates</b> {kw.toLowerCase()} please! 🙌</p>
                <p className="mt-0.5 text-[10px] text-slate-400">now · Reply</p>
              </div>
              <span className="text-[10px] text-slate-400">♡</span>
            </div>
          )}
          {posted && (
            <div className="animate-slideup flex items-start gap-2 [animation-delay:.35s]">
              <Avatar size="h-7 w-7" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-snug"><b>your.brand</b> Checking your DMs 📩</p>
                <p className="mt-0.5 text-[10px] text-slate-400">now · Reply</p>
              </div>
              <span className="rounded-full bg-teal-soft px-1.5 py-0.5 text-[9px] font-bold text-teal-dark">auto-reply</span>
            </div>
          )}
        </div>

        {/* composer */}
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <UserAvatar size="h-6 w-6" />
          <span className="flex-1 text-[12px] text-slate-400">Add a comment…</span>
          <span className="text-[13px]">❤️ 🙌 🔥 😍 😮</span>
        </div>
      </div>
    </div>
  );
}/* ---------------- reels feed frame ---------------- */
function ReelsFrame({ types, reel, keyword, stage, ...inter }) {
  return (
    <div className="relative h-full w-full bg-ink">
      <div className="absolute inset-x-0 top-0 z-20 flex justify-between px-5 pt-2 text-[11px] font-bold text-white">
        <span>9:41</span><span>📶 🔋</span>
      </div>
      <div className="absolute inset-x-0 top-7 z-20 flex items-center justify-between px-4">
        <span className="text-lg text-white/90">📷</span>
        <span className="text-[15px] font-extrabold text-white drop-shadow">Reels</span>
        <span className="text-lg text-white/90">🔍</span>
      </div>

      <div className="flex h-full flex-col transition-transform duration-[900ms] [transition-timing-function:cubic-bezier(.5,.05,.25,1)]"
        style={{ transform: `translateY(-${reel * 100}%)` }}>
        {types.map((t, i) => (
          <Reel key={t.id} t={t} keyword={keyword} stage={i === reel ? stage : "idle"}
            liked={i === reel ? inter.liked : false} likeCount={inter.likeCount}
            onLike={inter.onLike} onCommentTap={inter.onCommentTap} onShare={inter.onShare}
            isCurrent={i === reel} />
        ))}
      </div>

      {stage === "opening" && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/40 backdrop-blur-[2px]">
          <div className="animate-pop rounded-full bg-white px-4 py-2 text-[12px] font-bold text-ink shadow-chip">Opening your DMs →</div>
        </div>
      )}

      <CommentsSheet kw={keyword || "KEYWORD"} stage={stage} onClose={inter.onCommentTap} />
    </div>
  );
}

/* ---------------- DM frame ---------------- */
function DmFrame({ type, keyword, dmText, stage }) {
  const kw = (keyword || "KEYWORD").toUpperCase();
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex justify-between px-5 pb-1 pt-2 text-[11px] font-bold"><span>9:41</span><span>📶 🔋</span></div>
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
        <span className="text-lg">‹</span>
        <Avatar size="h-7 w-7" />
        <div>
          <div className="text-[13px] font-extrabold leading-tight">your.brand</div>
          <div className="text-[11px] text-slate-400">your.brand</div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pb-2 pt-3">
        <Avatar size="h-14 w-14" />
        <div className="mt-1 text-[14px] font-extrabold">your.brand</div>
        <div className="text-[11px] text-slate-400">Instagram · {type.niche} account</div>
        <span className="mt-1 rounded-full bg-mist px-4 py-1 text-[11px] font-bold">View profile</span>
      </div>

      <div className="flex min-h-[185px] flex-1 flex-col gap-2.5 px-3.5 pb-3">
        <div className="animate-pop text-center text-[11px] text-slate-400">
          Replying to your comment “{kw.toLowerCase()} please! 🙌”
        </div>
        {(stage === "replied" || stage === "yes") && (
          <div className="flex animate-pop items-end gap-1.5">
            <Avatar size="h-6 w-6" />
            <div className="max-w-[210px] rounded-2xl rounded-bl-md bg-mist px-3.5 py-2.5 text-[13px] leading-snug">{dmText}</div>
          </div>
        )}
        {stage === "yes" && (
          <div className="flex animate-pop justify-end">
            <span className="rounded-full bg-sky-500 px-4 py-2 text-[13px] font-semibold text-white">YES!</span>
          </div>
        )}
        {stage === "typing" && (
          <div className="flex animate-pop items-end gap-1.5">
            <Avatar size="h-6 w-6" />
            <div className="flex gap-1 rounded-2xl rounded-bl-md bg-mist px-3.5 py-3">
              <i className="h-1.5 w-1.5 animate-blink rounded-full bg-slate-400" />
              <i className="h-1.5 w-1.5 animate-blink rounded-full bg-slate-400 [animation-delay:.18s]" />
              <i className="h-1.5 w-1.5 animate-blink rounded-full bg-slate-400 [animation-delay:.36s]" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line px-3.5 py-2.5">
        <div className="flex items-center gap-2 rounded-full bg-mist px-4 py-2 text-[13px] text-slate-400">
          <Avatar size="h-5 w-5" /> Message…
        </div>
      </div>
    </div>
  );
}

/* ---------------- phone shell ---------------- */
function Phone({ type, keyword, dmText, stage, frame, ...inter }) {
  const inDm = frame === "dm";
  return (
    <div className="relative flex justify-center py-6">
      <div className="relative">
        <FloatingChips onLike={inter.onLike} />
        <div className="tilt relative w-[300px] overflow-hidden rounded-[46px] border-[10px] border-ink bg-white shadow-lift">
          <div className="absolute left-1/2 top-2.5 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-ink" />
          <div className="relative h-[500px] overflow-hidden">
            <div className="flex h-full w-[200%] transition-transform duration-700 [transition-timing-function:cubic-bezier(.6,.05,.3,1)]"
              style={{ transform: inDm ? "translateX(-50%)" : "translateX(0)" }}>
              <div className="relative h-full w-1/2 shrink-0 overflow-hidden">
                <ReelsFrame types={TYPES} reel={inter.reel} keyword={keyword} stage={stage}
                  liked={inter.liked} likeCount={inter.likeCount}
                  onLike={inter.onLike} onCommentTap={inter.onCommentTap} onShare={inter.onShare} />
              </div>
              <div className="h-full w-1/2 shrink-0 overflow-hidden">
                <DmFrame type={type} keyword={keyword} dmText={dmText} stage={stage} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- hero + live demo ---------------- */
function Hero() {
  const [type, setType] = useState(TYPES[0]);
  const [keyword, setKeyword] = useState("GUIDE");
  const [dmText, setDmText] = useState("Hey Maya! 👋 Here's the guide you asked for. Reply YES and it's yours.");
  const [stage, setStage] = useState("idle");
  const [frame, setFrame] = useState("post");
  const [reel, setReel] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(1204);
  const [running, setRunning] = useState(false);
  const busy = useRef(false);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  useEffect(() => {
    if (running || stage !== "idle") return;
    const id = setInterval(() => setReel((r) => (r + 1) % TYPES.length), 3600);
    return () => clearInterval(id);
  }, [running, stage]);

  const pickType = (t) => { setType(t); setReel(TYPES.findIndex((x) => x.id === t.id)); };
  const onLike = () => { const next = !liked; setLiked(next); setLikeCount((c) => c + (next ? 1 : -1)); };
  const onCommentTap = () => { if (!busy.current) setStage((s) => (s === "idle" ? "peek" : "idle")); };
  const onShare = async () => { if (busy.current) return; setStage("opening"); await wait(650); setStage("idle"); };

  async function runDemo() {
    if (busy.current) return;
    busy.current = true; setRunning(true);
    setFrame("post"); setStage("idle"); setLiked(false);
    setType(TYPES[reel]);
    await wait(400);
    setStage("peek");      await wait(500);   // comments sheet slides up
    setStage("typingCmt"); await wait(900);   // maya is typing...
    setStage("posted");    await wait(1700);  // comment lands + auto-reply
    setStage("opening");   await wait(750);   // sheet closes, DM overlay
    setFrame("dm");      setStage("typing");  await wait(1300);
    setStage("replied"); await wait(1400);
    setStage("yes");
    try {
      await fetch("/api/demo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, username: "maya.creates" }),
      });
    } catch {}
    setRunning(false); busy.current = false;
  }

  return (
    <section id="demo" className="relative overflow-hidden">
      {/* backdrop glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-teal/10 blur-3xl" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 md:grid-cols-[1.05fr_.95fr]">
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px] font-semibold text-slateInk shadow-soft">
              <span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-teal/60" /><span className="h-2 w-2 rounded-full bg-teal" /></span>
              Live demo — no sign-up needed
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-6 text-[44px] font-extrabold leading-[1.06] tracking-tight md:text-[60px]">
              Every keyword comment,<br />
              <span className="font-display italic text-teal-dark">answered in seconds.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-slateInk">
              ReplyLo watches your posts and opens the DM — with your message, in seconds.
            </p>
          </Reveal>

          {/* control card */}
          <Reveal delay={240}>
            <div className="mt-8 max-w-md rounded-2xl border border-line bg-white p-5 shadow-soft">
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <button key={t.id} onClick={() => pickType(t)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-bold transition-all
                      ${type.id === t.id ? "border-teal bg-teal-soft text-teal-dark shadow-[inset_0_0_0_1px_#0d9488]" : "border-line bg-white text-slateInk hover:border-teal/50 hover:text-ink"}`}>
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Keyword they comment</span>
                  <input className="w-full rounded-xl border border-line bg-mist px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal focus:bg-white focus:ring-4 focus:ring-teal/10"
                    value={keyword} maxLength={14} onChange={(e) => setKeyword(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">The DM they get</span>
                  <input className="w-full rounded-xl border border-line bg-mist px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal focus:bg-white focus:ring-4 focus:ring-teal/10"
                    value={dmText} maxLength={90} onChange={(e) => setDmText(e.target.value)} />
                </label>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button onClick={runDemo} disabled={running}
                  className="rounded-full bg-teal px-5 py-2.5 text-[14px] font-bold text-white shadow-soft transition hover:bg-teal-dark hover:shadow-chip active:scale-95 disabled:opacity-50">
                  {running ? "Running…" : "▶ Run the demo"}
                </button>
                <span className="text-[12px] text-slate-400">~6 seconds · fires a real webhook</span>
              </div>
            </div>
          </Reveal>

          {/* social proof */}
          <Reveal delay={320}>
            <div className="mt-7 flex items-center gap-3">
              <AvatarStack />
              <p className="text-[13px] font-medium text-slateInk">
                <b className="text-ink">★★★★★</b> loved by 2,400+ creators &amp; small brands
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={200} className="md:mt-32">
          <div className="relative mx-auto w-fit">
            {/* photo collage behind the phone (files land in public/assets/img/) */}
            <ImageSlot src="/assets/img/hero-boutique.jpg" ratio="4/5" w={220} eager fallback="heroA"
              alt="Saree boutique owner checking her phone in her shop"
              className="absolute -left-16 top-8 hidden w-40 rotate-[-4deg] lg:block" />
            <ImageSlot src="/assets/img/hero-kitchen.jpg" ratio="4/5" w={220} eager fallback="heroB"
              alt="Cloud-kitchen cook plating an order in warm window light"
              className="absolute -right-14 bottom-14 hidden w-36 rotate-[3deg] lg:block" />
            <Phone type={type} keyword={keyword} dmText={dmText} stage={stage} frame={frame}
              liked={liked} likeCount={likeCount} reel={reel} onLike={onLike} onCommentTap={onCommentTap} onShare={onShare} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- logo strip ---------------- */
function Logos() {
  const names = ["BLOOM studio", "northbrew", "LUXE resale", "macrofit", "pasta nonna", "glowroom"];
  return (
    <section className="border-y border-line bg-white py-8">
      <p className="text-center text-[12px] font-bold uppercase tracking-[0.2em] text-slate-400">Powering DMs for</p>
      <div className="mx-auto mt-5 flex max-w-4xl flex-wrap items-center justify-center gap-x-12 gap-y-3 px-4 opacity-60">
        {names.map((n) => <span key={n} className="text-[17px] font-extrabold tracking-tight text-slateInk">{n}</span>)}
      </div>
    </section>
  );
}

/* ---------------- how it works ---------------- */
function HowItWorks() {
  const steps = [
    { n: "01", t: "They comment a keyword", d: "Whole-word matching — \"GUIDE\" hits, \"guilt\" doesn't.", ui: <KeywordChips /> },
    { n: "02", t: "ReplyLo opens the DM", d: "Compliant reply + DM in under two seconds, 24/7.", ui: <MessageEditor text="Here's the guide you asked for 👇" /> },
    { n: "03", t: "You get the lead", d: "Replies, clicks and emails land in your dashboard.", ui: <ResultsBars bars={[35, 55, 48, 85]} /> },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-20">
      <Reveal>
        <p className="text-center text-[13px] font-extrabold uppercase tracking-[0.2em] text-teal-dark">How it works</p>
        <h2 className="mt-3 text-center text-4xl font-extrabold tracking-tight">Three steps. Zero typing.</h2>
      </Reveal>

      {/* animated comment -> reply -> DM loop */}
      <Reveal delay={100}>
        <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center rounded-3xl border border-line bg-mist/70 px-6 py-8">
          <CommentToDM />
          <p className="mt-5 text-[13px] font-semibold text-slate-400">Comment → reply → DM. Watch it loop.</p>
        </div>
      </Reveal>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 120}>
            <div className="group relative flex h-full flex-col rounded-2xl border border-line bg-white p-6 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-chip">
              {i < steps.length - 1 && (
                <span className="absolute -right-[26px] top-1/2 hidden w-6 border-t-2 border-dashed border-slate-300 md:block" aria-hidden="true">
                  <span className="absolute -right-1 -top-[5px] text-[10px] text-slate-300">▸</span>
                </span>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-extrabold text-slate-300 transition group-hover:text-teal">{s.n}</span>
              </div>
              <div className="mt-4 min-h-[64px]">{s.ui}</div>
              <h3 className="mt-4 text-[17px] font-extrabold">{s.t}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slateInk">{s.d}</p>
            </div>
          </Reveal>
        ))}
      </div>

      {/* keyword marquee */}
      <Reveal delay={120}>
        <div className="mt-10">
          <KeywordMarquee />
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------- setup tutorial (scroll-driven stepper) ---------------- */
function Tutorial() {
  const steps = [
    { t: "Connect Instagram or Facebook", d: "A business or creator account through Meta's own login. We never see your password.", mock: <MockConnected /> },
    { t: "Pick a post and a word", d: "One post, a few, or every post. Anyone who comments GUIDE gets it.", mock: <MockPickPost /> },
    { t: "Write the reply, add your link", d: "The DM text and one tap-through button — shop, booking, lead magnet.", mock: <MockReplyEditor /> },
    { t: "Every comment gets the DM", d: "Whole-word matching: \"GUIDE\" hits, \"guilt\" doesn't. Reply + DM in ~2s.", mock: <MockEveryComment /> },
    { t: "See what it brings in", d: "Matches, DMs, replies, emails — one honest dashboard, exportable.", mock: <MockResults /> },
  ];
  const [active, setActive] = useState(0);
  const trackRef = useRef(null);

  /* Scroll-driven: each segment is 80vh tall; whichever segment covers the
     viewport middle sets the active step. No timers, so it works with
     prefers-reduced-motion too (only the fade is disabled there). */
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;
    let raf = 0;
    let timer = 0;

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = window.innerHeight * 0.5;
        const segs = el.querySelectorAll("[data-seg]");
        let best = 0, bestDist = Infinity;
        segs.forEach((s, i) => {
          const r = s.getBoundingClientRect();
          const c = r.top + r.height / 2;
          const d = Math.abs(c - mid);
          if (r.top < mid && r.bottom > mid && d < bestDist) { best = i; bestDist = d; }
        });
        setActive((a) => (a === best ? a : best));
      });
    };

    /* mobile has no scroll segments (too jumpy on touch) -> auto-advance */
    const startTimer = () => {
      if (timer || isDesktop()) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      timer = setInterval(() => setActive((a) => (a + 1) % steps.length), 4200);
    };
    const stopTimer = () => { if (timer) { clearInterval(timer); timer = 0; } };

    const sync = () => { if (isDesktop()) { stopTimer(); onScroll(); } else startTimer(); };
    sync();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      stopTimer();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", sync);
    };
  }, [steps.length]);

  const jump = (i) => {
    const seg = trackRef.current?.querySelector(`[data-seg="${i}"]`);
    if (seg) seg.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section id="setup" className="border-t border-line bg-white">
      <div className="mx-auto max-w-6xl px-4 pt-20">
        <Reveal>
          <p className="text-center text-[13px] font-extrabold uppercase tracking-[0.2em] text-teal-dark">Setup</p>
          <h2 className="mt-3 text-center text-4xl font-extrabold tracking-tight">Live in five minutes. Five steps.</h2>
          <p className="mt-3 text-center text-[14px] font-semibold text-slate-400">Scroll to walk through them ↓</p>
        </Reveal>
      </div>

      <div ref={trackRef} className="relative mx-auto max-w-6xl px-4 pb-20">
        {/* desktop: each column = a viewport-height sticky box + an identical
            segment track, so both columns are the same height and pin in sync */}
        <div className="hidden lg:grid lg:grid-cols-2 lg:gap-10">
          {/* left: step list, centered in a viewport-height sticky box */}
          <div>
            <div className="lg:sticky lg:top-0 lg:h-screen">
              <ol className="flex h-full flex-col justify-center">
                {steps.map((s, i) => {
                  const on = i === active;
                  return (
                    <li key={s.t}>
                      <button
                        type="button"
                        onClick={() => jump(i)}
                        aria-current={on}
                        className={`flex w-full items-start gap-4 border-l-2 py-3 pl-4 text-left transition ${on ? "border-ink" : "border-line hover:border-slate-300"}`}
                      >
                        <span className={`w-7 shrink-0 pt-0.5 text-[13px] font-extrabold transition ${on ? "text-ink" : "text-slate-300"}`}>{String(i + 1).padStart(2, "0")}</span>
                        <span className="min-w-0">
                          <span className={`block text-[17px] font-extrabold leading-snug transition sm:text-[19px] ${on ? "text-ink" : "text-slate-300"}`}>{s.t}</span>
                          {on && <span className="mt-1.5 block max-w-md text-[14px] leading-relaxed text-slateInk">{s.d}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            {/* scroll length (segments measured in the right column) */}
            <div className="pointer-events-none" aria-hidden="true">
              {steps.map((s, i) => (
                <div key={s.t} className="h-screen" />
              ))}
            </div>
          </div>
          {/* right: mock panel, centered in an identical sticky box so they stay aligned */}
          <div>
            <div className="lg:sticky lg:top-0 lg:h-screen">
              <div className="flex h-full items-center justify-center">
                <div className="flex min-h-[340px] w-full max-w-[440px] items-center justify-center overflow-hidden rounded-3xl bg-linear-to-br from-amber/10 via-teal/5 to-violet-400/10 p-6 shadow-soft">
                  <div key={active} className="v-fade-up flex w-full flex-col items-center">{steps[active].mock}</div>
                </div>
              </div>
            </div>
            {/* invisible scroll segments that drive `active` */}
            <div className="pointer-events-none" aria-hidden="true">
              {steps.map((s, i) => (
                <div key={s.t} data-seg={i} className="h-[80vh]" />
              ))}
            </div>
          </div>
        </div>

        {/* mobile: panel + compact active card (auto-advances; no scroll-jacking on touch) */}
        <div className="flex flex-col gap-5 lg:hidden">
          <div className="relative mx-auto flex min-h-[300px] w-full max-w-[440px] items-center justify-center overflow-hidden rounded-3xl bg-linear-to-br from-amber/10 via-teal/5 to-violet-400/10 p-5">
            <div key={active} className="v-fade-up flex flex-col items-center">{steps[active].mock}</div>
          </div>
          <div className="w-full">
            <div className="flex items-center gap-2">
              {steps.map((s, i) => (
                <button key={s.t} type="button" aria-label={`Step ${i + 1}: ${s.t}`} onClick={() => jump(i)}
                  className={`h-1.5 rounded-full transition-all ${i === active ? "w-8 bg-ink" : "w-4 bg-line"}`} />
              ))}
            </div>
            <div className="mt-3 text-[13px] font-extrabold text-ink">{String(active + 1).padStart(2, "0")} · {steps[active].t}</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-slateInk">{steps[active].d}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- who it's for ---------------- */
function UseCases() {
  const personas = [
    { name: "Saree boutique", img: "/assets/img/boutique-owner.jpg", fb: "boutique", alt: "Saree boutique owner in her shop holding a phone", kw: "PRICE", q: "price?", line: "Which colour? It's on its way 💫" },
    { name: "Cloud kitchen", img: "/assets/img/cloud-kitchen.jpg", fb: "kitchen", alt: "Cloud-kitchen cook holding a phone near the pass", kw: "MENU", q: "menu 🍜", line: "New menu, sent 🍜" },
    { name: "Home tutor", img: "/assets/img/home-tutor.jpg", fb: "tutor", alt: "Home tutor at a desk holding a phone", kw: "CLASS", q: "class?", line: "Free demo slot? Booked ✅" },
    { name: "Mehndi artist", img: "/assets/img/mehndi-artist.jpg", fb: "mehndi", alt: "Mehndi artist holding a phone in her studio", kw: "DESIGN", q: "design pls", line: "Here's the design you asked for 🌿" },
  ];
  const [sel, setSel] = React.useState(0);
  const p = personas[sel];
  return (
    <section id="who" className="border-t border-line bg-mist/50">
      <div className="mx-auto max-w-4xl px-4 py-20">
        <Reveal>
          <p className="text-center text-[13px] font-extrabold uppercase tracking-[0.2em] text-teal-dark">Who it's for</p>
          <h2 className="mt-3 text-center text-4xl font-extrabold tracking-tight">Pick a business. See it work.</h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-10 overflow-hidden rounded-3xl border border-line bg-white shadow-chip">
            <div className="grid sm:grid-cols-[240px_1fr]">
              {/* small photo that swaps with the persona */}
              <div key={sel} className="v-fade-up relative h-52 sm:h-auto">
                <ImageSlot src={p.img} alt={p.alt} w={480} bare fill fallback={p.fb} className="absolute inset-0 h-full w-full" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-ink/70 to-transparent" />
                <span className="absolute bottom-3 left-3 rounded-full bg-amber px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-ink">{p.kw}</span>
              </div>
              {/* the DM that gets sent */}
              <div key={`t${sel}`} className="v-fade-up flex flex-col justify-center gap-2.5 p-6 sm:p-8">
                <p className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{p.name}</p>
                <div className="flex flex-col gap-2.5">
                  <Bubble>{p.q}</Bubble>
                  <Bubble me>{p.line}</Bubble>
                </div>
                <p className="mt-1 text-[13px] font-semibold text-teal-dark">
                  One comment. One instant reply. {p.name === "Cloud kitchen" ? "Every order starts in the comments." : "No app to open, no reply to miss."}
                </p>
              </div>
            </div>
            {/* persona tabs */}
            <div className="flex flex-wrap gap-2 border-t border-line bg-mist/60 px-4 py-3.5" role="tablist" aria-label="Choose a business type">
              {personas.map((x, i) => (
                <button
                  key={x.name}
                  type="button"
                  role="tab"
                  aria-selected={i === sel}
                  onClick={() => setSel(i)}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition ${
                    i === sel ? "bg-teal text-white shadow-soft" : "bg-white text-slate-500 ring-1 ring-line hover:text-teal-dark"
                  }`}
                >
                  {x.name}
                </button>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- features ---------------- */
function Features() {
  const items = [
    {
      t: "Comment → DM", d: "A public reply so everyone sees you answer, plus up to 3 buttons in a private DM.",
      mock: <><Bubble>GUIDE please! 🙌</Bubble><Bubble me>Sent it to your DMs! 💌</Bubble><LinkCard title="Your free guide ✨" cta="Get the guide" /></>,
    },
    {
      t: "Whole-word matching", d: "\"GUIDE\" matches \"guide please!\" — never \"guilt\". Per-post scopes too.",
      mock: <><Bubble>guide please! 🙌</Bubble><Bubble me>Sent you a DM 📩</Bubble><Bubble>feeling guilty lol</Bubble><div className="ml-auto rounded-full bg-white px-3 py-1.5 text-[11.5px] font-bold text-slate-400 shadow-soft">ignored — no match</div></>,
    },
    {
      t: "Buttons & links", d: "Up to 3 tap-through buttons per DM — shop, booking, lead magnet, anything.",
      mock: <><Bubble me>What's the best way to book? 👇</Bubble><LinkCard title="Book a slot" cta="Open calendar" /><LinkCard title="Price list" cta="See prices" /></>,
    },
    {
      t: "Followers only", d: "Optionally gate the DM behind a follow — turns viewers into audience.",
      mock: <><Bubble me>Almost there! Follow us, then tap below 👇</Bubble><div className="ml-auto rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-sky-600 shadow-soft">I followed ✅</div></>,
    },
    {
      t: "Email capture", d: "ReplyLo listens in the thread and saves emails when they reply, inside the 24-hour window.",
      mock: <><Bubble me>What's the best email to send it to?</Bubble><Bubble>maya@gmail.com</Bubble><LinkCard title="On its way ✨" cta="Open now" /></>,
    },
    {
      t: "One honest dashboard", d: "Matches, DMs sent, replies, clicks, emails — per rule, exportable as CSV.",
      mock: <><div className="grid grid-cols-3 gap-2"><div className="rounded-xl bg-white px-2 py-2 text-center shadow-soft"><div className="text-[16px] font-extrabold text-teal-dark">128</div><div className="text-[10px] font-bold text-slate-400">Matches</div></div><div className="rounded-xl bg-white px-2 py-2 text-center shadow-soft"><div className="text-[16px] font-extrabold text-teal-dark">121</div><div className="text-[10px] font-bold text-slate-400">DMs</div></div><div className="rounded-xl bg-white px-2 py-2 text-center shadow-soft"><div className="text-[16px] font-extrabold text-teal-dark">34</div><div className="text-[10px] font-bold text-slate-400">Emails</div></div></div><ResultsBars bars={[35, 55, 48, 85]} /></>,
    },
  ];
  return (
    <section id="features" className="border-t border-line bg-mist/50">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <p className="text-center text-[13px] font-extrabold uppercase tracking-[0.2em] text-teal-dark">Features</p>
          <h2 className="mt-3 text-center text-4xl font-extrabold tracking-tight">Everything between the comment<br />and the customer.</h2>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((f, i) => (
            <Reveal key={f.t} delay={(i % 3) * 100}>
              <div className="flex h-full flex-col rounded-2xl border border-line bg-white p-4 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-chip">
                <ChatMock>{f.mock}</ChatMock>
                <h3 className="mt-4 px-1 text-[16px] font-extrabold">{f.t}</h3>
                <p className="mt-1.5 px-1 pb-1 text-[13.5px] leading-relaxed text-slateInk">{f.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- CTA + footer ---------------- */
function CtaFooter() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-ink px-6 py-14 text-center text-white shadow-lift">
            {/* photo background (falls back to the gradient blobs if missing) */}
            <img src="/assets/img/cta-workspace.jpg" alt="" aria-hidden="true" width="928" height="522"
              loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }}
              className="absolute inset-0 h-full w-full object-cover opacity-40" />
            <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-ink via-ink/70 to-ink/40" />
            <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-teal/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-amber/20 blur-3xl" />
            <h2 className="relative text-4xl font-extrabold tracking-tight">Your next customer is<br />one comment away.</h2>
            <p className="relative mx-auto mt-4 max-w-md text-[16px] text-white/70">Set up in five minutes. Free to start, no card — and the demo above already proved it works.</p>
            <div className="relative mt-8 flex items-center justify-center gap-3">
              <a href="/signup" className="rounded-full bg-white px-6 py-3 text-[15px] font-extrabold text-ink transition hover:bg-teal hover:text-white active:scale-95">
                Start free →
              </a>
              <a href="/app" className="rounded-full border border-white/25 px-6 py-3 text-[15px] font-bold text-white/90 transition hover:bg-white/10">Open dashboard</a>
            </div>
          </div>
        </Reveal>
      </section>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-[13px] text-slate-400 sm:flex-row">
          <span className="flex items-center gap-2 font-extrabold text-ink"><span className="grid h-6 w-6 place-items-center rounded-lg bg-teal text-[11px] text-white">⚡</span>ReplyLo</span>
          <span>Built on Meta's official APIs · not affiliated with Instagram</span>
          <a href="/app" className="font-semibold text-slateInk transition hover:text-ink">Dashboard →</a>
        </div>
      </footer>
    </>
  );
}

function App() {
  useEffect(() => {
    // first-party visit beacon (no cookies, hashed UA server-side)
    try {
      const body = new Blob([JSON.stringify({ path: location.pathname })], { type: "application/json" });
      navigator.sendBeacon("/track", body);
    } catch {}
  }, []);
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Logos />
        <HowItWorks />
        <Tutorial />
        <UseCases />
        <Features />
        <CtaFooter />
      </main>
    </>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
