#!/usr/bin/env node
/**
 * LetsPoly · report email doctor
 *
 * Answers one question: "why can't a visitor send a report?" — with no
 * dependencies, and without sending any mail unless explicitly asked.
 *
 *   npm run report:check                                   # inspect the env only
 *   npm run report:check -- --url http://localhost:3000     # also ask the app
 *   npm run report:check -- --url http://localhost:3000 --test   # + one real email
 *
 * Exit code 0 = reports can be delivered, 1 = something needs fixing.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const SETUP =
  "Create a Resend account at resend.com (sign up AS the inbox address — the sandbox sender " +
  "onboarding@resend.dev only delivers to the account's own address), make an API key, then set " +
  "RESEND_API_KEY in Vercel → Settings → Environment Variables (Production + Preview) and " +
  "REDEPLOY — env changes only apply to new deployments. For local dev, put it in .env.local.";

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APP_URL = arg("--url");
const TEST = argv.includes("--test");

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

console.log("LetsPoly report email check\n");
console.log("1) Email credentials");

const apiKey = read("RESEND_API_KEY");
line(apiKey ? "  ok  " : "  --  ", `RESEND_API_KEY            ${apiKey ? `set (${source("RESEND_API_KEY")})` : "missing"}`);
if (apiKey && !apiKey.startsWith("re_")) {
  // The most common mix-up: a hosting/provider token pasted as an email key.
  failures++;
  line("  !!  ", `that does not look like a Resend key — they start with "re_" (got "${apiKey.slice(0, 4)}…")`);
}
for (const name of ["REPORT_TO_EMAIL", "REPORT_FROM"]) {
  const value = read(name);
  line("  ok  ", `${name.padEnd(26)} ${value ? `set (${source(name)})` : "not set — using the built-in default"}`);
}
const support = read("NEXT_PUBLIC_SUPPORT_EMAIL");
line(
  "  ok  ",
  `NEXT_PUBLIC_SUPPORT_EMAIL  ${support ? `set to ${support} (adds a mailto: fallback link)` : "not set — panel is server-side only (intended)"}`
);

if (!apiKey) {
  console.log("");
  failures++;
  console.log("  => reports cannot be sent: the endpoint answers 500 configured:false.");
  console.log(`     ${SETUP}`);
} else {
  console.log("\n  => the endpoint will try to hand the message to Resend (api.resend.com).");
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

if (APP_URL) {
  console.log(`\n2) Running app (${APP_URL})`);
  try {
    const res = await requestJson(new URL("/api/report", APP_URL).href);
    const data = res.body;
    line(data.configured ? "  ok  " : "  !!  ", `GET /api/report → configured=${data.configured}`);
    if (!data.configured) {
      failures++;
      console.log(`        hint: ${data.hint ?? "not configured"}`);
    }
    if (!TEST) {
      console.log("        (add --test to send one real report through the app)");
    } else if (!data.configured) {
      console.log("        (--test skipped: the app says it is not configured)");
    } else {
      const probe = `Setup check: test report sent by report-check.mjs at ${new Date().toISOString()}.`;
      const w = await requestJson(new URL("/api/report", APP_URL).href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: probe, page: APP_URL }),
      });
      line(
        w.body?.ok ? "  ok  " : "  !!  ",
        `POST /api/report → ok=${w.body?.ok} id=${w.body?.id ?? "-"} (one real email sent)`
      );
      if (!w.body?.ok) {
        failures++;
        console.log(`        hint: ${w.body?.hint ?? w.body?.error ?? JSON.stringify(w.body)}`);
      } else {
        console.log("        Check the receiving inbox (REPORT_TO_EMAIL, default the project inbox).");
      }
    }
  } catch (error) {
    failures++;
    line("  !!  ", `could not reach the app: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(
  failures === 0
    ? "\nAll good — a report typed on the site goes straight to the inbox from our own server."
    : "\nSomething still needs fixing (see above)."
);
// Setting exitCode (instead of calling process.exit) lets Node tear down its
// sockets normally — process.exit() mid-close trips an assertion on Windows.
process.exitCode = failures === 0 ? 0 : 1;
