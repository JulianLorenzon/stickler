// Renders the logo PNGs with Playwright. Run through branding/render.sh (Docker), after branding/make.mjs.
import fs from "node:fs";
import { chromium } from "playwright";

const src = "/branding";
const font = fs.readFileSync("/fonts/montserrat-latin-wght-normal.woff2").toString("base64");
const svgFile = (name) => fs.readFileSync(`${src}/${name}`, "utf8");

// [output, width, height, html body, transparent]
const jobs = [
  ["icon-1024.png", 1024, 1024, svgFile("icon.svg"), false],
  ["../public/logo.png", 512, 512, svgFile("icon-rounded.svg"), true],
  ["logo-512.png", 512, 512, svgFile("logo.svg"), true],
  // README header: mark + wordmark, light and dark
  ...[["lockup.png", "#16181a", "logo.svg"], ["lockup-dark.png", "#e4e7eb", "logo-dark.svg"]].map(([out, color, logo]) => [
    out, 1200, 360,
    `<div style="display:flex;align-items:center;gap:36px;height:100%;padding-left:60px">
       <div style="width:280px;height:280px">${svgFile(logo)}</div>
       <span style="font:800 190px/1 Montserrat;letter-spacing:-0.03em;color:${color};margin-top:-30px">stickler</span></div>`,
    true,
  ]),
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, w, h, body, transparent] of jobs) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>@font-face{font-family:Montserrat;src:url(data:font/woff2;base64,${font});font-weight:100 900}
    html,body{margin:0;width:${w}px;height:${h}px;background:${transparent ? "transparent" : "#fff"}}
    body>svg{display:block;width:100%;height:100%} svg{width:100%;height:100%}</style>${body}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${src}/${out}`, omitBackground: transparent });
  console.log("rendered", out);
}
await browser.close();
