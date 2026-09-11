import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Never cached: the answer depends on the deployment's environment variables,
// so a build-time or full-route cache could pin `configured:false` forever.
export const dynamic = "force-dynamic";

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
 *
 *   GET  /api/report -> { ok, configured, hint }
 *   POST /api/report -> { ok, id }
 *
 * GET exists so the panel can say "reports are not connected yet" *before* a
 * visitor types anything, instead of failing afterwards. Failure responses keep
 * a visitor-friendly `error` (what the panel renders) and put the technical
 * reason in `hint`, which names the variable/provider answer a misconfigured
 * deployment is hiding (neither is a secret).
 */

/** Shared project inbox that receives the bug reports / feedback. */
const DEFAULT_REPORT_TO = "letspolymake@gmail.com";

const SETUP_HINT =
  "Set RESEND_API_KEY (re_...) in Vercel -> Settings -> Environment Variables for " +
  "Production AND Preview, then REDEPLOY - env changes only apply to new deployments. " +
  "See README -> Anonymous report emails.";

/** Resend's sandbox sender may only deliver to its own account's address. */
const SANDBOX_HINT =
  "Resend's sandbox sender (onboarding@resend.dev) only delivers to the address that " +
  "owns the Resend account: create the account with the inbox address, or verify a " +
  "domain and set REPORT_FROM.";

/**
 * Configuration probe, so the panel can warn before a report is written.
 * Mirrors `GET /api/hearts`: only the presence of the variable is reported,
 * never its value.
 */
export async function GET() {
  const configured = Boolean(process.env.RESEND_API_KEY);
  return NextResponse.json({
    ok: true,
    configured,
    ...(configured ? {} : { hint: `RESEND_API_KEY is missing. ${SETUP_HINT}` }),
  });
}

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
        configured: false,
        // What the visitor sees: never the raw config detail...
        error: "Reports aren't connected yet — please try again later.",
        // ...which lives here instead, so a misconfigured deployment stays
        // diagnosable from the response body alone (no secret is named).
        hint: `RESEND_API_KEY is missing. ${SETUP_HINT}`,
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
      // The provider's own wording ("you can only send testing emails…") means
      // nothing to a visitor, so it is kept in `hint` and paired with the fix.
      const sandbox = res.status === 403 || /testing email|own email address/i.test(data?.message ?? "");
      return NextResponse.json(
        {
          ok: false,
          error: "The report couldn't be sent — please try again later.",
          hint:
            `Resend answered ${res.status}: ${data?.message ?? "no message"}. ` +
            (res.status === 401
              ? "Check that RESEND_API_KEY is a valid, non-revoked key."
              : sandbox
                ? SANDBOX_HINT
                : "See README -> Anonymous report emails."),
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "The report couldn't be sent — please try again later.",
        hint: "Could not reach api.resend.com from the server (network/DNS).",
      },
      { status: 502 }
    );
  }
}
