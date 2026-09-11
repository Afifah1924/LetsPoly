#!/usr/bin/env node
/**
 * LetsPoly · shared heart counter doctor
 *
 * Answers one question: "why isn't the counter counting?" — with no
 * dependencies and without touching the live total.
 *
 *   npm run hearts:check                                    # inspect env + store
 *   npm run hearts:check -- --url http://localhost:3000     # also ask the app
 *   npm run hearts:check -- --url http://localhost:3000 --write   # + one real heart
 *
 * Exit code 0 = the store is usable, 1 = something needs fixing.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const PAIRS = [
  { url: "KV_REST_API_URL", token: "KV_REST_API_TOKEN", label: "Vercel KV" },
  { url: "UPSTASH_REDIS_REST_URL", token: "UPSTASH_REDIS_REST_TOKEN", label: "Upstash" },
];
const SETUP =
  "Create a free Redis database (upstash.com, or Vercel → Storage), then set the URL and its token " +
  "from that SAME integration in Vercel → Settings → Environment Variables (Production + Preview) " +
  "and REDEPLOY — env changes only apply to new deployments. For local dev, put the same two lines " +
  "in .env.local (copy .env.example).";

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APP_URL = arg("--url");
const WRITE = argv.includes("--write");

function loadEnvFile(file) {
  const loaded = {};
  if (!fs.existsSync(file)) return loaded;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const text = raw.trim();
    if (!text || text.startsWith("#")) continue;
    const eq = text.indexOf("=");
    if (eq < 1) continue;
    const key = text.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = text.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) && value) loaded[key] = value;
  }
  return loaded;
}

const cwd = process.cwd();
const fromFiles = { ...loadEnvFile(path.join(cwd, ".env.local")), ...loadEnvFile(path.join(cwd, ".env")) };
const read = (name) => process.env[name] || fromFiles[name] || "";
const source = (name) => (process.env[name] ? "process env" : fromFiles[name] ? ".env file" : "—");

let failures = 0;
const line = (mark, text) => console.log(`${mark} ${text}`);

console.log("LetsPoly heart counter check\n");
console.log("1) Store credentials");
for (const pair of PAIRS) {
  for (const name of [pair.url, pair.token]) {
    const value = read(name);
    line(value ? "  ok  " : "  --  ", `${name.padEnd(26)} ${value ? `set (${source(name)})` : "missing"}`);
  }
}

const usable = PAIRS.find((pair) => read(pair.url) && read(pair.token));

if (!usable) {
  const half = [];
  for (const pair of PAIRS) {
    if (read(pair.url) && !read(pair.token)) half.push(`${pair.url} is set but ${pair.token} is missing`);
    if (!read(pair.url) && read(pair.token)) half.push(`${pair.token} is set but ${pair.url} is missing`);
  }
  console.log("");
  if (half.length) {
    failures++; // a half-filled pair is a mistake wherever it is seen from
    console.log(`  => half-configured: ${half.join("; ")}`);
    console.log("     The URL and its token must come from the same integration.");
  } else if (APP_URL) {
    console.log("  => no store configured in this shell / .env file.");
    console.log("     Fine for the deployment — the running app is checked in step 3.");
  } else {
    failures++;
    console.log("  => the shared counter is NOT configured, so each visitor only sees their own device count.");
    console.log(`     ${SETUP}`);
  }
} else {
  console.log(`\n  => using the ${usable.label} pair (${usable.url}).`);
}

/**
 * Minimal JSON request helper. Uses node:http(s) rather than fetch so the
 * sockets are closed immediately (no keep-alive pool) — that keeps the script
 * from tripping Node's process-exit assertion on Windows.
 */
function requestJson(target, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const send = url.protocol === "https:" ? https.request : http.request;
    const req = send(url, { method, agent: false, headers: { connection: "close", ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text.slice(0, 120) };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const store = (command, { url, token }) =>
  requestJson(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });

if (usable) {
  console.log("\n2) Store self-test (temporary keys only — the live total is never touched)");
  const url = read(usable.url);
  const token = read(usable.token);
  const key = `letspoly:hearts:selftest:${Date.now()}`;
  try {
    const set = await store(["SET", key, "1", "NX"], { url, token });
    line(set.body?.result === "OK" ? "  ok  " : "  !!  ", `SET   → ${JSON.stringify(set.body?.result ?? set.body)}`);
    const got = await store(["GET", key], { url, token });
    line(got.body?.result === "1" ? "  ok  " : "  !!  ", `GET   → ${JSON.stringify(got.body?.result ?? got.body)}`);
    const incr = await store(["INCR", key], { url, token });
    line(Number(incr.body?.result) === 2 ? "  ok  " : "  !!  ", `INCR  → ${JSON.stringify(incr.body?.result ?? incr.body)}`);
    await store(["DEL", key], { url, token });
    line("  ok  ", "DEL   → temporary key removed");
    if (set.body?.result !== "OK" || got.body?.result !== "1" || Number(incr.body?.result) !== 2) failures++;
  } catch (error) {
    failures++;
    line("  !!  ", `could not reach the store: ${error instanceof Error ? error.message : error}`);
    console.log("        Check the URL is the REST endpoint (https://…upstash.io) and that the token is");
    console.log("        the write token — the read-only token cannot count hearts.");
  }
}

if (APP_URL) {
  console.log(`\n3) Running app (${APP_URL})`);
  try {
    const res = await requestJson(new URL("/api/hearts", APP_URL).href);
    const data = res.body;
    line(data.configured ? "  ok  " : "  !!  ", `GET /api/hearts → configured=${data.configured} count=${data.count}`);
    if (!data.configured) {
      failures++;
      console.log(`        hint: ${data.hint ?? "not configured"}`);
    }
    if (WRITE && data.configured) {
      const id = `checkup${Date.now().toString(36)}`;
      const w = await requestJson(new URL("/api/hearts", APP_URL).href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const wb = w.body;
      line(wb.ok ? "  ok  " : "  !!  ", `POST /api/hearts → counted=${wb.counted} count=${wb.count} (added one real heart)`);
      if (!wb.ok) failures++;
    } else if (!WRITE) {
      console.log("        (add --write to post a test heart too; that adds 1 to the live total)");
    }
  } catch (error) {
    failures++;
    line("  !!  ", `could not reach the app: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(
  failures === 0
    ? "\nAll good — the shared counter will count every visitor."
    : "\nSomething still needs fixing (see above)."
);
// Setting exitCode (instead of calling process.exit) lets Node tear down its
// sockets normally — process.exit() mid-close trips an assertion on Windows.
process.exitCode = failures === 0 ? 0 : 1;
