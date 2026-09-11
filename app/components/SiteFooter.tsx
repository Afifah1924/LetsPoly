"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Bug reports / feedback go straight to the project inbox through FormSubmit - a
 * form-to-email relay the browser posts to itself, so there is no API key, no
 * server route and nothing to configure per deployment.
 *
 * The AJAX endpoint is used (JSON in, JSON out) so the panel can show its own
 * success/error state without the visitor ever leaving the page. The address in
 * the URL is the destination, and it has to click FormSubmit's one-off
 * "Activate Form" link once before submissions are delivered.
 */
const FORM_ENDPOINT = "https://formsubmit.co/ajax/letspolymake@gmail.com";

/** Subject the report arrives under, so replies keep the thread readable. */
const REPORT_SUBJECT = "Let's Poly Make — Bug / Feedback Report";

/** localStorage keys for the anonymous heart counter. */
const ANON_ID_KEY = "letspoly_anon_id";
const HEART_GIVEN_KEY = "letspoly_heart_given";
const LOCAL_COUNT_KEY = "letspoly_likes";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Random anonymous id — never derived from anything personal. */
function randomAnonId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Id used when the browser refuses to store anything (this page view only). */
let memoryAnonId = "";

/**
 * Stable random id for this browser — no personal data, just something the
 * server can de-duplicate on so one visitor counts once.
 *
 * The id has to exist even when storage is unavailable (Safari private
 * browsing, "block all cookies"): returning an empty string used to abandon the
 * request, so those visitors were never counted at all. A page-view id keeps
 * their heart in the shared total instead of silently dropping it.
 */
function readAnonId(): string {
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing && ID_PATTERN.test(existing)) return existing;
    const created = randomAnonId();
    window.localStorage.setItem(ANON_ID_KEY, created);
    return created;
  } catch {
    if (!memoryAnonId) memoryAnonId = randomAnonId();
    return memoryAnonId;
  }
}

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
  const [errorText, setErrorText] = useState("");
  // Optional: only used to set the reply-to address on the emailed report.
  const [email, setEmail] = useState("");
  // Honeypot: invisible to humans; bots that fill it are silently ignored.
  const [honeypot, setHoneypot] = useState("");
  const [hearts, setHearts] = useState<
    Array<{ id: number; left: number; delay: number; size: number; duration: number }>
  >([]);
  const [heartCount, setHeartCount] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const stored = Number(window.localStorage.getItem(LOCAL_COUNT_KEY) || "0");
      return Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch {
      return 0;
    }
  });
  const inFlightRef = useRef(false);
  // True once the shared counter answers; false keeps the older per-browser count.
  const [shared, setShared] = useState(false);
  // One heart per visitor, remembered per browser so a reload cannot re-count.
  const [contributed, setContributed] = useState(false);
  // Why the last heart was not counted (rate limited / store missing / down), so
  // a rejected click never looks like nothing happened.
  const [heartNote, setHeartNote] = useState("");
  // Set while this visitor's own heart may not have reached a stale GET yet.
  const gaveHeartRef = useRef(false);

  // Load the shared total once, and remember whether this browser already gave
  // a heart (so a reload/second visit cannot count twice).
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        if (window.localStorage.getItem(HEART_GIVEN_KEY) === "1" && !cancelled) setContributed(true);
      } catch {
        /* ignore */
      }

      try {
        const res = await fetch("/api/hearts", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; configured?: boolean; count?: number }
          | null;
        if (cancelled || !data?.ok || !data.configured || typeof data.count !== "number") return;
        setShared(true);
        // A total that lands after this visitor's own heart must never make the
        // counter look like it went backwards.
        const total = data.count;
        setHeartCount((prev) => (gaveHeartRef.current ? Math.max(prev, total) : total));
        try {
          window.localStorage.setItem(LOCAL_COUNT_KEY, String(total));
        } catch {
          /* ignore */
        }
      } catch {
        /* offline / no store — keep the per-browser count */
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const showLove = async () => {
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
    // One heart per visitor: the server de-duplicates on this browser's
    // anonymous id, so a repeat click (or a cleared page) cannot grow the total.
    if (contributed || inFlightRef.current) return;
    inFlightRef.current = true;
    setContributed(true);
    setHeartCount((prev) => prev + 1); // optimistic
    setHeartNote("");
    gaveHeartRef.current = true;
    try {
      window.localStorage.setItem(HEART_GIVEN_KEY, "1");
    } catch {
      /* ignore */
    }

    const id = readAnonId();
    try {
      if (!id) throw new Error("no visitor id");
      const res = await fetch("/api/hearts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; configured?: boolean; counted?: boolean; count?: number; error?: string }
        | null;

      if (res.status === 503 && data?.configured === false) {
        // No shared store configured: the count can only live on this device, so
        // say that rather than showing a number that looks global.
        setShared(false);
        setHeartNote("Shown on this device only — the shared counter is not connected yet.");
        try {
          window.localStorage.setItem(LOCAL_COUNT_KEY, String(heartCount + 1));
        } catch {
          /* ignore */
        }
        return;
      }

      if (res.status === 429) {
        // Network burst guard: the heart was not counted, so undo the optimistic
        // bump, release the lock and tell the visitor they can retry — silently
        // reverting is what made the counter look frozen.
        setContributed(false);
        gaveHeartRef.current = false;
        setHeartCount((prev) => Math.max(0, prev - 1));
        setHeartNote(
          data?.error || "Lots of new hearts from this network just now — try again in a few minutes."
        );
        try {
          window.localStorage.removeItem(HEART_GIVEN_KEY);
        } catch {
          /* ignore */
        }
        return;
      }

      if (!res.ok || !data?.ok || typeof data.count !== "number") {
        throw new Error(data?.error || `Request failed: ${res.status}`);
      }

      setShared(true);
      setHeartCount(data.count);
      setHeartNote(
        data.counted === false ? "You already left your heart on this device — thank you." : ""
      );
      try {
        window.localStorage.setItem(LOCAL_COUNT_KEY, String(data.count));
      } catch {
        /* ignore */
      }
    } catch {
      // Genuine failure (offline, store down): undo the heart, but explain it so
      // the visitor knows the click was not swallowed.
      setContributed(false);
      gaveHeartRef.current = false;
      setHeartCount((prev) => Math.max(0, prev - 1));
      setHeartNote("Couldn't reach the shared counter — please try again in a moment.");
      try {
        window.localStorage.removeItem(HEART_GIVEN_KEY);
      } catch {
        /* ignore */
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  /**
   * Sends the feedback to the project inbox through FormSubmit's AJAX endpoint:
   * no server route, no key, and the visitor never leaves the page.
   *
   * FormSubmit answers HTTP 200 even when it refuses a submission, so the body's
   * `success` flag - never the status code - decides whether the message was
   * accepted.
   */
  const sendReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || status === "sending") return;
    // The browser has already run native validation by the time onSubmit fires
    // (required feedback, `type="email"` address); this keeps programmatic
    // submits honest too.
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }

    // Honeypot: hidden from humans, so a value here means a bot. Show what a
    // person would see and send nothing.
    if (honeypot.trim()) {
      setStatus("sent");
      setMessage("");
      setEmail("");
      return;
    }

    const replyTo = email.trim();
    setStatus("sending");
    setErrorText("");
    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          Feedback: text,
          // Only sent when the visitor asked for a reply: `email` is the row that
          // appears in the mail, `_replyto` is what makes "Reply" address the
          // visitor instead of the form itself. Left out entirely otherwise, so
          // an anonymous report stays anonymous.
          ...(replyTo ? { email: replyTo, _replyto: replyTo } : {}),
          ...(typeof window !== "undefined" ? { Page: window.location.href } : {}),
          _subject: REPORT_SUBJECT,
          _template: "table",
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: string | boolean; message?: string }
        | null;
      if (!(data?.success === true || data?.success === "true")) {
        // FormSubmit's own wording is the useful part here - it is what tells the
        // maintainer that the form still needs activating.
        throw new Error(data?.message || `The form service answered ${res.status}.`);
      }
      setStatus("sent");
      setMessage("");
      setEmail("");
      setHoneypot("");
    } catch (err) {
      // Never claim the report was sent, and never throw away what was typed.
      setErrorText(err instanceof Error ? err.message : "Something went wrong.");
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
        className="fixed bottom-4 right-4 z-50 grid h-14 w-14 touch-manipulation place-items-center rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 text-slate-950 shadow-lg shadow-teal-500/25 transition hover:scale-105 hover:shadow-teal-400/40 sm:bottom-5 sm:right-5 sm:h-12 sm:w-12"
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
        <div className="fixed bottom-20 right-4 z-50 max-h-[calc(100svh-7rem)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-3xl border border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur sm:right-5">
          <div className="border-b border-slate-800/80 bg-gradient-to-br from-teal-400/10 to-emerald-500/5 px-5 py-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-teal-300">
              <BugIcon /> Report bug / feedback
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              Spotted something? Let us know, anonymously!
            </p>
          </div>

          <div className="space-y-3 p-4">
            {/* A real form: the feedback is required, the email is not, and the
                browser validates the address before onSubmit runs. */}
            <form className="space-y-3" onSubmit={sendReport}>
              {/* Honeypot — hidden from humans, filled by bots (never sent). */}
              <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="report-company">Company</label>
                <input
                  id="report-company"
                  name="company"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                />
              </div>
              <textarea
                name="feedback"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={4}
                required
                minLength={3}
                maxLength={2000}
                placeholder="Describe what happened…"
                className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-base text-white placeholder-slate-500 outline-none transition focus:border-teal-400 sm:text-sm"
              />
              <div className="space-y-1.5">
                <input
                  type="email"
                  name="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Your email (optional)"
                  autoComplete="email"
                  className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-base text-white placeholder-slate-500 outline-none transition focus:border-teal-400 sm:text-sm"
                />
                <p className="px-1 text-[11px] leading-relaxed text-slate-500">
                  Leave your email if you&rsquo;d like a reply.
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Feedback is sent privately. Thanks for helping us improve.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setMessage("");
                    setEmail("");
                    setStatus("idle");
                    setErrorText("");
                    setHoneypot("");
                  }}
                  className="min-h-10 touch-manipulation rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400 transition hover:border-slate-600 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!message.trim() || status === "sending"}
                  className="min-h-10 touch-manipulation rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] text-slate-950 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {status === "sending" ? "Sending…" : "Send report"}
                </button>
              </div>

              {status === "sent" && (
                <p className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
                  Thanks! Your feedback has been sent.
                </p>
              )}
              {status === "error" && (
                <p className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                  {errorText || "Couldn’t send that just now."} Your message is still here — please
                  try again in a moment.
                </p>
              )}
            </form>
            <div className="flex items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
              <button
                type="button"
                onClick={showLove}
                aria-pressed={contributed}
                title={
                  contributed
                    ? "Thanks — one heart per visitor"
                    : shared
                      ? "Leave your mark — counted across all visitors"
                      : "Leave your mark — counted on this device"
                }
                aria-label={
                  contributed
                    ? "You already left a heart — thank you"
                    : "Leave your mark (one heart per visitor)"
                }
                className={`group inline-flex min-h-10 touch-manipulation items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                  contributed
                    ? "border-rose-400/60 bg-rose-500/20 text-rose-100"
                    : "border-rose-500/30 bg-rose-500/5 text-rose-200 hover:border-rose-400/60 hover:bg-rose-500/10"
                }`}
              >
                <HeartIcon
                  className={`h-4 w-4 text-rose-400 transition group-hover:scale-110 ${
                    contributed ? "scale-125" : ""
                  }`}
                />
                <span>{heartCount.toLocaleString("en-US")}</span>
              </button>
              <span className="text-[11px] text-slate-500">
                {contributed ? "thanks for the love" : "anonymous love"}
              </span>
            </div>

            {heartNote && (
              <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                {heartNote}
              </p>
            )}
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
        <div className="mx-auto flex w-full max-w-full flex-col items-center justify-between gap-5 px-4 py-7 sm:max-w-[min(90vw,1600px)] sm:flex-row sm:items-center sm:px-6">
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
