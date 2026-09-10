import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9996;
const OUT = fileURLToPath(new URL(".", import.meta.url));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars",
  "--user-data-dir=" + OUT + "profile", "--window-size=1600,1200", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const p = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
      if (p) return p;
    } catch {}
    await sleep(300);
  }
  throw new Error("no target");
}
let id = 0;
function send(ws, m, p = {}) {
  return new Promise((res, rej) => {
    const myId = ++id;
    const on = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === myId) { ws.removeEventListener("message", on); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: myId, method: m, params: p }));
  });
}
async function ev(ws, expression) {
  const r = await send(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}
async function waitFor(ws, expr, timeout = 60000) {
  const s = Date.now();
  while (Date.now() - s < timeout) { try { if (await ev(ws, expr)) return true; } catch {} await sleep(300); }
  return false;
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send(ws, "Page.enable");
await send(ws, "Runtime.enable");
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
});
await send(ws, "Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
await send(ws, "Page.navigate", { url: "http://localhost:3000/generator?selected=Icosahedron&height=120" });
await waitFor(ws, `document.body && document.body.innerText.includes('LIVE MODEL PREVIEW')`);
for (let i = 0; i < 90; i++) {
  await ev(ws, `(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.innerText||'').trim()==='CM'); b&&b.click(); })()`);
  await sleep(220);
  if (await ev(ws, `(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.innerText||'').trim()==='CM'); return !!(b&&b.className.includes('bg-teal-400')); })()`)) break;
}
await ev(ws, `(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.innerText||'').trim()==='MM'); b&&b.click(); })()`);
await sleep(300);
for (let i = 0; i < 20; i++) {
  await ev(ws, `(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.innerText||'').trim()==='2D Net'); b&&b.click(); })()`);
  await sleep(600);
  if (await ev(ws, `[...document.querySelectorAll('button')].some((b)=>(b.innerText||'').trim()==='2D Net' && b.className.includes('bg-teal-400'))`)) break;
}
await sleep(2000);
const net = await ev(ws, `(() => {
  const svg = document.querySelector('svg[aria-label]');
  if (!svg) return null;
  const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
  const fills = [...svg.querySelectorAll('path')].filter(p => p.getAttribute('fill') === 'rgba(148,163,184,0.12)').length;
  return { texts, fills, hasCenterEdgeText: texts.some(t => /each edge|faces \u00b7/.test(t||'')), tabTexts: texts.filter(t => /(mm|cm)$/.test(t||'')) };
})()`);
console.log(JSON.stringify({ net, errors: errors.slice(0, 5) }, null, 1));
ws.close();
chrome.kill();
process.exit(0);
