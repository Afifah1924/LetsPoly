"use client";

import { useRef, useState } from "react";

/**
 * Support email for bug reports / feedback.
 */
const SUPPORT_EMAIL = "afifahakram.aa@gmail.com";

function BugIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="6" width="8" height="12" rx="4" />
      <path d="M8 9H5a3 3 0 0 0 0 6h3M16 9h3a3 3 0 0 1 0 6h-3M9 2l1.5 2.5M15 2l-1.5 2.5M12 6v1M12 14v1" />
    </svg>
  );
}

function HeartIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 21s-7.2-4.35-9.33-8.02C1.05 10.02 2.6 6.5 5.86 5.7c1.9-.47 3.72.36 4.94 1.9.18.22.3.48.4.75.1-.27.22-.53.4-.75 1.22-1.54 3.04-2.37 4.94-1.9 3.26.8 4.81 4.32 3.19 7.28C19.2 16.65 12 21 12 21Z" />
    </svg>
  );
}

/** Soft two-note "ding" (synthesised, no asset) played when the heart is tapped. */
function playLikeDing() {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    // Gentle rising pair: A5 -> E6.
    [
      { f: 880, t: 0 },
      { f: 1318.51, t: 0.09 },
    ].forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now + t);
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.16, now + t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.55);
    });
    window.setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* audio unavailable — silently ignore */
  }
}

function ReportBugButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [hearts, setHearts] = useState<
    Array<{ id: number; left: number; delay: number; size: number; duration: number }>
  >([]);
  const [heartCount, setHeartCount] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const stored = Number(window.localStorage.getItem("letspoly_likes") || "0");
      return Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch {
      return 0;
    }
  });
  const countedRef = useRef(false);

  const showLove = () => {
    playLikeDing();
    const base = Date.now();
    const batch = Array.from({ length: 7 }, (_, i) => ({
      id: base + i,
      left: Math.round(Math.random() * 64),
      delay: Math.round(Math.random() * 150),
      size: Math.round(10 + Math.random() * 9),
      duration: Math.round(950 + Math.random() * 500),
    }));
    setHearts((prev) => [...prev, ...batch]);
    window.setTimeout(
      () => setHearts((prev) => prev.filter((h) => !batch.some((b) => b.id === h.id))),
      1700
    );
    // Count this visitor only once per website open (per page load).
    if (!countedRef.current) {
      countedRef.current = true;
      setHeartCount((prev) => {
        const next = prev + 1;
        try {
          window.localStorage.setItem("letspoly_likes", String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
  };

  /**
   * Send the report anonymously via an AJAX mail relay — the visitor never
   * leaves the page and no personal details are collected.
   * NOTE: formsubmit.co requires a one-time activation click sent to the
   * support inbox on the very first submission.
   */
  const sendReport = async () => {
    const text = message.trim();
    if (!text || status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch(`https://formsubmit.co/ajax/${SUPPORT_EMAIL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: "[LetsPoly Beta] Bug report / feedback",
          _template: "table",
          _captcha: "false",
          page: typeof window !== "undefined" ? window.location.href : "",
          report: text,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean | string; message?: string }
        | null;
      const delivered =
        res.ok && (data?.success === true || data?.success === "true");
      if (!delivered) {
        throw new Error(
          typeof data?.message === "string" ? data.message : `Request failed: ${res.status}`
        );
      }
      setStatus("sent");
      setMessage("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <>
      {/* Floating report button — stays in the bottom-right corner of the screen. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close report panel" : "Report a bug"}
        title="Report a bug or give feedback"
        className="fixed bottom-5 right-5 z-50 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 text-slate-950 shadow-lg shadow-teal-500/25 transition hover:scale-105 hover:shadow-teal-400/40"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <BugIcon className="h-5 w-5" />
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-[min(21rem,calc(100vw-2.5rem))] overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur">
          <div className="border-b border-slate-800/80 bg-gradient-to-br from-teal-400/10 to-emerald-500/5 px-5 py-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-teal-300">
              <BugIcon /> Report bug / feedback
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              Spotted something? Let us know, anonymously!
            </p>
          </div>

          <div className="space-y-3 p-4">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder="Describe what happened…"
              className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-teal-400"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setMessage("");
                  setStatus("idle");
                }}
                className="rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400 transition hover:border-slate-600 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendReport}
                disabled={!message.trim() || status === "sending"}
                className="rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] text-slate-950 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "sending" ? "Sending…" : "Send report"}
              </button>
            </div>

            {status === "sent" && (
              <p className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
                Thanks! Your report was sent anonymously.
              </p>
            )}
            {status === "error" && (
              <p className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                Couldn&apos;t send right now. Try again in a moment, or email{" "}
                <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
              <button
                type="button"
                onClick={showLove}
                title="Leave your mark"
                aria-label="Leave your mark"
                className="group inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/5 px-3.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:border-rose-400/60 hover:bg-rose-500/10"
              >
                <HeartIcon className="h-4 w-4 text-rose-400 transition group-hover:scale-110" />
                <span>{heartCount}</span>
              </button>
              <span className="text-[11px] text-slate-500">anonymous love</span>
            </div>
          </div>
        </div>
      )}

      {/* Rising low-opacity hearts when the heart is tapped. */}
      {open && (
        <div className="pointer-events-none fixed bottom-24 right-8 z-[60] h-24 w-24">
          {hearts.map((h) => (
            <span
              key={h.id}
              className="absolute bottom-0 text-rose-400"
              style={{
                left: h.left,
                fontSize: h.size,
                opacity: 0,
                animation: `heart-float ${h.duration}ms ease-out ${h.delay}ms forwards`,
              }}
            >
              ♥
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export default function SiteFooter() {
  return (
    <>
      <footer className="border-t border-slate-800/70 bg-gradient-to-b from-transparent to-slate-950/60">
        <div className="mx-auto flex w-full max-w-[min(90vw,1600px)] flex-col items-center justify-between gap-5 px-6 py-7 sm:flex-row sm:items-center">
          <div className="text-center sm:text-left">
            <p className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-teal-300 sm:justify-start">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
              Beta
            </p>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
              One last fold to go. Last updated: 10 September 2026
            </p>
          </div>

          <div className="text-center sm:text-right">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-600">
              © 2026 LetsPoly · All rights reserved
            </p>
          </div>
        </div>
      </footer>

      <ReportBugButton />
    </>
  );
}
