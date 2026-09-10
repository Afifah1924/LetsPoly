import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 10055;
const OUT = fileURLToPath(new URL(".", import.meta.url));
const SHOTS = path.resolve(OUT, "..", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
   "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--hide-scrollbars",
   "--user-data-dir=" + path.join(OUT, "profile-shots"), "--window-size=1600,1200", "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) return p; } catch {}
    await sleep(300);
  }
  throw new Error("no target");
}
let id = 0;
function send(ws, method, params = {}) {
  return new Promise((res, rej) => {
    const myId = ++id;
    const on = (e) => { const m = JSON.parse(e.data); if (m.id === myId) { ws.removeEventListener("message", on); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}
const ev = async (ws, expression) => (await send(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
const waitUntil = async (ws, expr, timeout = 40000, step = 400) => {
  const s = Date.now();
  while (Date.now() - s < timeout) { try { if (await ev(ws, expr)) return Date.now() - s; } catch {} await sleep(step); }
  return -1;
};
const clickText = (t) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()===${JSON.stringify(t)}); if(!b) return false; b.click(); return true; })()`;
const clickContains = (t) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes(${JSON.stringify(t)})); if(!b) return false; b.click(); return true; })()`;

const ws = new WebSocket((await target()).webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send(ws, "Page.enable");
await send(ws, "Runtime.enable");
await send(ws, "Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });

async function shot(name) {
  const { data } = await send(ws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const file = path.join(SHOTS, name);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return `${name} (${Math.round(fs.statSync(file).size / 1024)} KB)`;
}

const done = [];
await send(ws, "Page.navigate", { url: "http://localhost:3000/explorer" });
const hydrated = await waitUntil(ws, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='Cube'); return !!(b && Object.keys(b).some(k=>k.startsWith('__reactFiber$'))); })()`, 180000, 500);
const canvasReady = await waitUntil(ws, `document.querySelectorAll('canvas').length>0`, 90000, 400);
await sleep(1500);
done.push(await shot("01-explorer-3d-model.png"));

await ev(ws, clickText("2D Net"));
await waitUntil(ws, `!!document.querySelector('svg[aria-label]')`, 20000);
await sleep(800);
done.push(await shot("02-explorer-2d-net.png"));

await ev(ws, clickText("Transition"));
await waitUntil(ws, `document.querySelectorAll('canvas').length>0`, 30000);
await sleep(800);
done.push(await shot("03-explorer-transition-3d.png"));

await ev(ws, clickContains("PARTIAL FOLD"));
await waitUntil(ws, `!!document.querySelector('input[type=range]')`, 25000);
await sleep(900);
done.push(await shot("04-explorer-transition-partial-fold.png"));

await ev(ws, `(() => { const b=document.querySelector('button[aria-label="Report a bug"]'); if(!b) return false; b.click(); return true; })()`);
await waitUntil(ws, `document.body.innerText.includes('REPORT BUG')`, 8000);
await sleep(500);
done.push(await shot("05-report-panel.png"));

await send(ws, "Page.navigate", { url: "http://localhost:3000/" });
await waitUntil(ws, `document.body.innerText.includes('Beta')`, 90000);
await sleep(1200);
done.push(await shot("06-home.png"));

console.log(JSON.stringify({ hydratedMs: hydrated, canvasReadyMs: canvasReady, shots: done, folder: SHOTS }, null, 1));
ws.close();
chrome.kill();
process.exit(0);
