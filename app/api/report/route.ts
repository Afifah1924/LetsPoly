import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Anonymous bug-report / feedback endpoint.
 *
 * The browser posts here (never to a third-party relay) and the message is
 * emailed via Resend with a server-side secret, so the API key is never exposed
 * to visitors.
 *
 * Environment variables (set in Vercel + a local `.env.local`):
 *   RESEND_API_KEY   - re_... (required, secret)
 *   REPORT_TO_EMAIL  - optional, overrides the default project inbox below
 *   REPORT_FROM      - optional, defaults to "LetsPoly Reports <onboarding@resend.dev>"
 *
 * Reports default to the shared project inbox; set REPORT_TO_EMAIL to route
 * them somewhere else without touching the code.
 *
 * Resend sandbox caveat: the default `onboarding@resend.dev` sender only
 * delivers to the address that owns the Resend account, so that account must be
 * the inbox above - otherwise verify a sending domain and set REPORT_FROM.
 * The report panel also offers a pre-filled `mailto:` fallback
 * (app/components/SiteFooter.tsx) so a report can reach the inbox by hand.
 */

/** Shared project inbox that receives the bug reports / feedback. */
const DEFAULT_REPORT_TO = "letspolymake@gmail.com";

const MAX_MESSAGE = 2000;
const MIN_MESSAGE = 3;

// Best-effort in-memory rate limit (per warm serverless instance).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    hits.forEach((times, key) => {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    });
  }
  return false;
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

export async function POST(request: Request) {
  let payload: { message?: unknown; page?: unknown; email?: unknown; company?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  // Honeypot: hidden from humans; bots tend to fill it. Pretend success.
  if (typeof payload.company === "string" && payload.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { ok: false, error: `Please write between ${MIN_MESSAGE} and ${MAX_MESSAGE} characters.` },
      { status: 400 }
    );
  }

  const replyTo =
    typeof payload.email === "string" && isEmail(payload.email.trim())
      ? payload.email.trim()
      : undefined;
  const page = typeof payload.page === "string" ? payload.page.slice(0, 300) : "";

  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many reports from this network — please try again later." },
      { status: 429 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_TO_EMAIL ?? DEFAULT_REPORT_TO;
  const from = process.env.REPORT_FROM ?? "LetsPoly Reports <onboarding@resend.dev>";

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        // Names the missing variable so a misconfigured deployment is obvious
        // from the response body alone (the name is not a secret).
        error: "Email service is not configured yet (RESEND_API_KEY is missing).",
      },
      { status: 500 }
    );
  }

  const text = [
    message,
    "",
    "—",
    "Sent anonymously from the LetsPoly site.",
    page ? `Page: ${page}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "[LetsPoly] Bug report / feedback",
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data?.message ?? `Email provider error (${res.status}).` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach the email provider." },
      { status: 502 }
    );
  }
}
