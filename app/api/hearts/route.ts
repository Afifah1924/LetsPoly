import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shared "anonymous love" counter.
 *
 * The count used to live in each visitor's localStorage, so it never grew
 * across users. It now lives in Redis, reached over the Upstash/Vercel KV REST
 * API (no npm dependency, works on serverless):
 *
 *   GET  /api/hearts         -> { ok, configured, count }
 *   POST /api/hearts {id}    -> { ok, configured, counted, count }
 *
 * Rules:
 *  - One heart per visitor. The browser generates a random anonymous id
 *    (localStorage) and the server records it once with SET ... NX; replays of
 *    the same id return counted:false and leave the total untouched.
 *  - A per-IP daily budget (new hearts only) bounds abuse without blocking
 *    shared networks, since the id — not the IP — is the identity.
 *
 * Env (either pair; Vercel KV / Upstash both work):
 *   KV_REST_API_URL      + KV_REST_API_TOKEN
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *
 * With none configured the route reports configured:false and the UI keeps the
 * old per-browser counter, so nothing breaks.
 */

const TOTAL_KEY = "letspoly:hearts:total";
const USER_PREFIX = "letspoly:hearts:user:";
const IP_PREFIX = "letspoly:hearts:ip:";
const IP_DAILY_CAP = 25;
const IP_TTL_SECONDS = 60 * 60 * 24;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

type Store = { url: string; token: string };

function store(): Store | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** Runs a single Redis command through the Upstash REST API. */
async function redis(command: Array<string | number>, { url, token }: Store): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!res.ok || data?.error) {
    throw new Error(data?.error ?? `Counter store error (${res.status})`);
  }
  return data?.result ?? null;
}

const asCount = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export async function GET() {
  const config = store();
  if (!config) return NextResponse.json({ ok: true, configured: false, count: 0 });

  try {
    const count = asCount(await redis(["GET", TOTAL_KEY], config));
    return NextResponse.json({ ok: true, configured: true, count });
  } catch (error) {
    return NextResponse.json(
      { ok: false, configured: true, count: 0, error: error instanceof Error ? error.message : "Counter unavailable." },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  let payload: { id?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid visitor id." }, { status: 400 });
  }

  const config = store();
  if (!config) {
    return NextResponse.json(
      { ok: false, configured: false, error: "Shared counter is not configured yet." },
      { status: 503 }
    );
  }

  // Hashed, never stored raw; only used to cap how many *new* hearts a network
  // can add per day so one person cannot inflate the total.
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const ipKey = IP_PREFIX + createHash("sha256").update(ip).digest("hex").slice(0, 16);

  try {
    // One heart per visitor: SET NX reports "OK" only the first time we see this
    // id. This runs *before* the network cap so a returning visitor always gets a
    // truthful answer instead of an error.
    const stored = await redis(["SET", USER_PREFIX + id, "1", "NX"], config);
    const counted = stored === "OK";

    if (!counted) {
      return NextResponse.json({
        ok: true,
        configured: true,
        counted: false,
        count: asCount(await redis(["GET", TOTAL_KEY], config)),
      });
    }

    // New visitor: enforce the per-network daily budget.
    const usedToday = asCount(await redis(["GET", ipKey], config));
    if (usedToday >= IP_DAILY_CAP) {
      // Release the claim so this visitor can succeed once the budget resets.
      await redis(["DEL", USER_PREFIX + id], config);
      return NextResponse.json(
        { ok: false, configured: true, error: "Too many new hearts from this network today — try again tomorrow." },
        { status: 429 }
      );
    }

    const total = asCount(await redis(["INCR", TOTAL_KEY], config));
    await redis(["INCR", ipKey], config);
    await redis(["EXPIRE", ipKey, IP_TTL_SECONDS], config);

    return NextResponse.json({ ok: true, configured: true, counted: true, count: total });
  } catch (error) {
    return NextResponse.json(
      { ok: false, configured: true, error: error instanceof Error ? error.message : "Counter unavailable." },
      { status: 502 }
    );
  }
}
