// Generates the Stickler logo SVGs. Run: node branding/make.mjs, then render the PNGs with branding/render.sh.
//
// The mark: a smooth S above an accent "printhead line", Atkinson-dithered pixels below it, the way the printer
// turns a shape into dots. Geometry: the S is two arcs (radius R, centres C1/C2) stroked at 2·HW; the pixels sit
// on a 28×28 grid of 16 px cells in a 512 px square.
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
export const COLORS = { ink: "#16181a", inkOnDark: "#e4e7eb", accent: "#ff5a36", surface: "#161819" };

const S = { R: 86, C1: [256, 170], C2: [256, 342], HW: 40 };
const r = (n) => Math.round(n * 10) / 10;

function sDist(p) {
  const arc = (c, from, to) => {
    const a = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
    const within = from <= to ? a >= from && a <= to : a >= from || a <= to;
    if (within) return Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - S.R);
    const end = (d) => [c[0] + S.R * Math.cos((d * Math.PI) / 180), c[1] + S.R * Math.sin((d * Math.PI) / 180)];
    return Math.min(...[from, to].map((d) => Math.hypot(p[0] - end(d)[0], p[1] - end(d)[1])));
  };
  return Math.min(arc(S.C1, 90, -35), arc(S.C2, -90, 145));
}

const pt = (c, deg) => [r(c[0] + S.R * Math.cos((deg * Math.PI) / 180)), r(c[1] + S.R * Math.sin((deg * Math.PI) / 180))];
const centre = `M${pt(S.C1, -35)} A${S.R},${S.R} 0 1 0 ${S.C1[0]},${S.C1[1] + S.R} A${S.R},${S.R} 0 1 1 ${pt(S.C2, 145)}`;

// Atkinson dithering of a grey fade (0.2 → 0.8) inside the S, rows 15–27 (below the line)
function pixels() {
  const N = 28, x0 = 32, cell = 16, from = 15;
  const inside = [], val = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    inside.push(j >= from && sDist([x0 + (i + 0.5) * cell, x0 + (j + 0.5) * cell]) <= S.HW);
    val.push(0.2 + ((j - from) / (N - 1 - from)) * 0.6);
  }
  let d = "";
  for (let j = from; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (!inside[k]) continue;
    const black = val[k] < 0.5, err = (val[k] - (black ? 0 : 1)) / 8;
    for (const [di, dj] of [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]]) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && ii < N && jj < N && inside[jj * N + ii]) val[jj * N + ii] += err;
    }
    if (black) d += `M${x0 + i * cell},${x0 + j * cell}h${cell}v${cell}h-${cell}z`;
  }
  return d;
}

/** The mark in a 512×512 box: `ink` for the S, `line` for the printhead line */
function mark(ink, line, id) {
  return `<clipPath id="${id}"><rect width="512" height="240"/></clipPath>
<path d="${centre}" fill="none" stroke="${ink}" stroke-width="${S.HW * 2}" clip-path="url(#${id})"/>
<path d="${pixels()}" fill="${ink}" shape-rendering="crispEdges"/>
<rect x="96" y="246" width="320" height="20" rx="10" fill="${line}"/>`;
}

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n${body}\n</svg>\n`;
// Icons: the mark on an orange square. Android masks the full-bleed one itself; 60% keeps the mark inside the
// adaptive icon's 66/108 safe zone. The web icon has no mask, so the mark can be bigger.
const icon = (radius, scale) => svg(`<rect width="512" height="512" rx="${radius}" fill="${COLORS.accent}"/>
<g transform="translate(${r(256 * (1 - scale))} ${r(256 * (1 - scale))}) scale(${scale})">${mark(COLORS.ink, "#ffffff", "top")}</g>`);

const files = {
  "logo.svg": svg(mark(COLORS.ink, COLORS.accent, "top")), // on light backgrounds
  "logo-dark.svg": svg(mark(COLORS.inkOnDark, COLORS.accent, "top")), // on dark backgrounds
  "logo-mono.svg": svg(mark("#000000", "#000000", "top")), // 1-bit, for printing on labels
  "icon.svg": icon(0, 0.6), // full bleed, source for the Android launcher icons
  "icon-rounded.svg": icon(112, 0.78), // web: favicon, app bar, manifest
};
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
console.log("wrote", Object.keys(files).join(", "));
