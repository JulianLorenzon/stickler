import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = "/dist";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(8080);

const arg = process.argv[2] ?? "[]";
const shots = JSON.parse(fs.existsSync(arg) ? fs.readFileSync(arg, "utf8") : arg);
// "camera": a .mjpeg or .y4m file that Chromium plays as the camera (one per run: the first shot that names one)
const camera = shots.find((s) => s.camera)?.camera;
const browser = await chromium.launch({ args: camera
  ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${camera}`] : [] });
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.viewport ?? { width: 393, height: 852 }, deviceScaleFactor: s.scale ?? 2,
    isMobile: s.mobile ?? true, hasTouch: s.mobile ?? true });
  if (s.native) {
    // fake Android bridge, then Capacitor's own bridge script that the Android app injects
    await ctx.addInitScript({ path: "/work/s/native-stub.js" });
    await ctx.addInitScript({ path: "/work/native-bridge.js" });
  }
  // after the stub, so a shot can override what it put in localStorage
  if (s.init) await ctx.addInitScript(s.init);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", s.name, e.message));
  await page.goto("http://localhost:8080/" + (s.path ?? ""));
  await page.waitForTimeout(1500);
  for (const a of s.actions ?? []) {
    if (a.upload) {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(a.upload, { force: true })]);
      await chooser.setFiles(a.file);
    }
    if (a.select) await page.selectOption(a.select, a.value);
    if (a.click) await page.click(a.click, { force: true });
    if (a.at) await page.mouse.click(a.at[0], a.at[1]);
    if (a.tap) await page.touchscreen.tap(a.tap[0], a.tap[1]);
    if (a.tapOn) await page.tap(a.tapOn, { force: true });
    if (a.eval) await page.evaluate(a.eval);
    if (a.type) await page.keyboard.type(a.type);
    if (a.press) await page.keyboard.press(a.press);
    if (a.log) console.log(s.name, JSON.stringify(await page.evaluate(a.log)));
    if (a.viewport) await page.setViewportSize(a.viewport);
    if (a.drag) {
      // mouse drag from [x1, y1] to [x2, y2]
      const [x1, y1, x2, y2] = a.drag;
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 12 });
      await page.mouse.up();
    }
    if (a.swipe) {
      // touch swipe
      const cdp = await ctx.newCDPSession(page);
      // [x1, y, x2] sideways, or [x1, y1, x2, y2]
      const [x1, y1, x2, y2 = y1] = a.swipe;
      const pt = (x, y) => [{ x, y }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x1, y1) });
      for (let i = 1; i <= 10; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10) });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await page.waitForTimeout(a.wait ?? 600);
  }
  await page.screenshot({ path: `/out/${s.name}.png`, fullPage: s.full ?? false });
  console.log("shot", s.name);
  await ctx.close();
}
await browser.close();
server.close();
