// The whole scan path in headless Chromium with a fake camera: Scan button → camera screen → worker → zxing-cpp
// → object on the label. Run through run.sh (Docker). Screenshots go to tools/scan-test/out/.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import qrcode from "/repo/node_modules/qrcode-generator/dist/qrcode.mjs";

// Chromium's fake camera plays a .y4m file: an 8-bit luma plane plus flat chroma per frame
const W = 480, H = 640;
const makeY4m = (file, draw) => {
  const y = Buffer.alloc(W * H, 235);
  draw((x0, y0, w, h) => {
    for (let yy = y0; yy < y0 + h; yy++) y.fill(16, yy * W + x0, yy * W + x0 + w);
  });
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < 15; i++) parts.push(Buffer.from("FRAME\n"), y, uv);
  fs.writeFileSync(file, Buffer.concat(parts));
};

const QR_TEXT = "https://example.com/stickler-scan-test";
makeY4m("/tmp/qr.y4m", (rect) => {
  const qr = qrcode(0, "M");
  qr.addData(QR_TEXT);
  qr.make();
  const n = qr.getModuleCount(), m = 5, x0 = ((W - n * m) / 2) | 0, y0 = ((H - n * m) / 2) | 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rect(x0 + c * m, y0 + r * m, m, m);
});

// EAN-13 4006381333931, encoded by hand so this file needs nothing but qrcode-generator
const EAN = "4006381333931";
makeY4m("/tmp/ean.y4m", (rect) => {
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const R = L.map((s) => [...s].map((b) => (b === "0" ? "1" : "0")).join(""));
  const G = R.map((s) => [...s].reverse().join(""));
  const P = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const d = EAN.split("").map(Number);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (P[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += "101";
  const m = 2, x0 = ((W - bits.length * m) / 2) | 0;
  [...bits].forEach((b, i) => b === "1" && rect(x0 + i * m, H / 2 - 50, m, 100));
});

makeY4m("/tmp/blank.y4m", () => {});

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm",
  ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
http.createServer((req, res) => {
  let f = path.join("/dist", decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = "/dist/index.html";
  res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(8080);

let failures = 0;
// [fake camera video, text expected in the barcode/QR properties, or undefined if the scanner should stay open]
for (const [name, expected] of [["qr", QR_TEXT], ["ean", EAN], ["blank", undefined]]) {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=/tmp/${name}.y4m`] });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true,
    hasTouch: true, permissions: ["camera"] });
  const page = await ctx.newPage();
  const outside = [];
  page.on("request", (r) => { if (!r.url().startsWith("http://localhost")) outside.push(r.url()); });
  page.on("pageerror", (e) => { console.log(`${name}: page error ${e.message}`); failures++; });

  await page.goto("http://localhost:8080/");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /\bscan$/i }).first().click();
  await page.waitForSelector(".scanner");
  const closed = await page.waitForSelector(".scanner", { state: "detached", timeout: expected ? 10000 : 2000 })
    .then(() => true, () => false);
  await page.screenshot({ path: `/out/${name}.png` });

  let ok;
  if (expected) {
    // The new object is selected; its text shows in the properties panel
    const shown = await page.locator("input, textarea").evaluateAll((els) => els.map((e) => e.value));
    ok = closed && shown.some((v) => v === expected);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${closed ? "scanner closed" : "scanner still open"}, label has "${expected}": ${shown.includes(expected)}`);
  } else {
    ok = !closed;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: scanner stays open with nothing to read`);
  }
  if (outside.length) console.log(`FAIL ${name}: requests outside the app: ${outside.join(", ")}`);
  if (!ok || outside.length) failures++;
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
