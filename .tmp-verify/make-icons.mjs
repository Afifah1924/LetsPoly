import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 10066;
const OUT = fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.resolve(OUT, "..");
const SHOTS = path.join(ROOT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const svg = fs.readFileSync(path.join(ROOT, "app", "icon.svg"), "utf8")
  .replace('width="64" height="64"', 'width="100%" height="100%"');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  svg{display:block;width:100vw;height:100vh}
</style></head><body>${svg}</body></html>`;
fs.writeFileSync(path.join(OUT, "icon.html"), html, "utf8");

const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check",
   "--hide-scrollbars", "--force-device-scale-factor=1", "--allow-file-access-from-files",
   "--user-data-dir=" + path.join(OUT, "profile-icons"), "--window-size=256,256", "about:blank"],
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

const ws = new WebSocket((await target()).webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send(ws, "Page.enable");
await send(ws, "Runtime.enable");
await send(ws, "Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

const url = "file:///" + path.join(OUT, "icon.html").replace(/\\/g, "/");
const pngs = [];
for (const size of [16, 32, 48, 64]) {
  await send(ws, "Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send(ws, "Page.navigate", { url });
  await sleep(600);
  const { data } = await send(ws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  pngs.push({ size, data: Buffer.from(data, "base64") });
}

// 256 px preview saved for human review
await send(ws, "Emulation.setDeviceMetricsOverride", { width: 256, height: 256, deviceScaleFactor: 1, mobile: false });
await send(ws, "Page.navigate", { url });
await sleep(800);
const preview = await send(ws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
fs.writeFileSync(path.join(SHOTS, "logo-preview.png"), Buffer.from(preview.data, "base64"));

function buildIco(items) {
  const header = Buffer.alloc(6 + 16 * items.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(items.length, 4);
  let offset = header.length;
  items.forEach((it, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(it.size >= 256 ? 0 : it.size, e);
    header.writeUInt8(it.size >= 256 ? 0 : it.size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(it.data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += it.data.length;
  });
  return Buffer.concat([header, ...items.map((it) => it.data)]);
}

const ico = buildIco(pngs);
fs.writeFileSync(path.join(ROOT, "app", "favicon.ico"), ico);

console.log(JSON.stringify({
  iconSvgPngs: pngs.map((p) => `${p.size}x${p.size} (${Math.round(p.data.length / 1024)} KB)`),
  faviconIco: `${Math.round(ico.length / 1024)} KB -> app/favicon.ico`,
  preview: "screenshots/logo-preview.png",
  pngSignatureOk: pngs.every((p) => p.data.slice(0, 8).toString("hex") === "89504e470d0a1a0a"),
}, null, 1));
ws.close();
chrome.kill();
process.exit(0);
