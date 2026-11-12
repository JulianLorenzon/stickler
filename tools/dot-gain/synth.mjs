// How well the reading copes with a tilted phone, curled paper and separate labels, on made-up frames where the right
// answer is known: rows are dithered as the app prints them (mark, code cells, no text), "printed" with the MXW01 dot
// model and rendered into a full HD frame as a camera would see them. Prints the largest difference between a patch
// as read and as rendered.
// usage: node synth.mjs   (FRAME=<file.rgba> / FRAME_ROLL=<file.rgba> also write one view of the D11s labels / the roll
//        as raw pixels, 8 bytes of width and height then RGBA, e.g. to make a fake camera picture for tools/screenshots)
import { writeFileSync } from "node:fs";
globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const M = await import("./bundle.mjs");
const model = M.MXW01_DOT_MODEL;

/** One printed row (W x H dots) as darkness per dot, and what its patches should read */
const printRow = (W, H, mode, corrected = false) => {
  const lay = M.greyRowLayout(W, H), bandH = lay.bottom - lay.top;
  const img = new ImageData(W, H);
  img.data.fill(255);
  const box = (im, x0, y0, w, h, v) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) im.data.fill(v, (y * im.width + x) * 4, (y * im.width + x) * 4 + 3); };
  let band = new ImageData(W, bandH);
  band.data.fill(255);
  M.GREY_TEST_LEVELS.forEach((level, i) => box(band, lay.x0 + i * (lay.pw + lay.gap), 0, lay.pw, bandH, Math.round(255 * (1 - level / 100))));
  box(band, lay.markX, 0, lay.markW, bandH, 0);
  band = M.GREY_TEST_MODES[mode].dither(band);
  img.data.set(band.data, lay.top * W * 4);
  for (const c of M.greyRowCode(lay, H, mode, corrected)) if (c.on) box(img, Math.round(c.x - M.CODE_CELL.w / 2), Math.round(c.y - M.CODE_CELL.h / 2), M.CODE_CELL.w, M.CODE_CELL.h, 0);
  const dark = M.simulateDarkness(img, model);
  const means = M.GREY_TEST_LEVELS.map((_, i) => {
    const cx = lay.x0 + i * (lay.pw + lay.gap) + lay.pw / 2, cy = (lay.top + lay.bottom) / 2;
    let s = 0, n = 0;
    for (let y = Math.round(cy - bandH * 0.33); y < Math.round(cy + bandH * 0.33); y++)
      for (let x = Math.round(cx - lay.pw * 0.3); x < Math.round(cx + lay.pw * 0.3); x++) { s += dark[y * W + x]; n++; }
    return s / n;
  });
  return { dark, truth: means.slice(0, 9).map((v) => v / means[9]) };
};

/**
 * A sheet: pieces of paper (x, y, w, h in dots, with printed rows on them) on a dark table, seen by a camera.
 * view: scale (px per dot at the middle), kx/ky (tilt), turn (degrees), curl (dots).
 */
const photo = (sheet, { scale, kx = 0, ky = 0, turn = 0, curl = 0 }) => {
  const w = 1080, h = 1920, data = new Uint8Array(w * h * 4).fill(255);
  const c = Math.cos(turn * Math.PI / 180), s = Math.sin(turn * Math.PI / 180);
  const at = (sx, sy) => {
    for (const p of sheet.pieces) {
      if (sx < p.x || sx >= p.x + p.w || sy < p.y || sy >= p.y + p.h) continue;
      for (const r of p.rows) {
        const x = Math.floor(sx - p.x - r.x), y = Math.floor(sy - p.y - r.y);
        if (x >= 0 && y >= 0 && x < r.W && y < r.H) return 1 - 0.88 * r.dark[y * r.W + x];
      }
      return 1;
    }
    return undefined;
  };
  for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
    let sum = 0;
    for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]]) {
      const dx = X + ox - w / 2, dy = Y + oy - h / 2, d = scale * (1 + kx * dx / (w / 2) + ky * dy / (h / 2));
      const qy = (-s * dx + c * dy) / d, sy = sheet.h / 2 + qy;
      const sx = sheet.w / 2 + (c * dx + s * dy) / d + curl * Math.sin(Math.PI * qy / sheet.h);
      const v = at(sx, sy);
      sum += v === undefined ? 45 : 205 * (1 + 0.1 * dx / (w / 2)) * v;
    }
    data.fill(sum / 5, (Y * w + X) * 4, (Y * w + X) * 4 + 3);
  }
  return { width: w, height: h, data };
};

/** MXW01: four rows in one piece on the 57 mm roll */
const roll = () => {
  const W = 384, H = 112, rows = [0, 1, 2, 3].map((m) => ({ ...printRow(W, H, m), W, H, x: 36, y: 70 + m * H }));
  return { W, H, w: W + 72, h: 4 * H + 130, pieces: [{ x: 0, y: 0, w: W + 72, h: 4 * H + 130, rows }], truth: rows.map((r) => r.truth) };
};
/** D11s: a label each (print area W x 96 on a 14 mm label), `modes` of them one under the other on the liner */
const labels = (mm, modes = [0, 1, 2, 3]) => {
  const W = mm * 8 - 8, H = 96, lw = mm * 8, lh = 112, pitch = lh + 24;
  const pieces = modes.map((m, i) => ({ x: 20, y: 20 + i * pitch, w: lw, h: lh, rows: [{ ...printRow(W, H, m), W, H, x: 8, y: 8 }] }));
  return { W, H, w: lw + 40, h: modes.length * pitch + 16, pieces, truth: Object.fromEntries(modes.map((m, i) => [m, pieces[i].rows[0].truth])) };
};

const check = (name, sheet, view) => {
  const frame = photo(sheet, view);
  const r = M.readGreyStrip(frame, sheet.W, sheet.H);
  if (typeof r === "string") { console.log("  " + name.padEnd(46), "FAILED:", r); return frame; }
  const diffs = r.rows.flatMap((row) => row.measured.map((v, j) => Math.abs(v - sheet.truth[row.mode][j])));
  let fit = "";
  if (r.complete) {
    const f = M.fitDotModel([{ measured: r.measured, marks: r.marks }], sheet.W, sheet.H, M.D11S_DOT_MODEL);
    fit = `, fit rms ${f.rms.toFixed(3)} ${JSON.stringify(f.model)}`;
  }
  console.log("  " + name.padEnd(46), `rows ${r.rows.map((x) => x.mode).join("")}, ${r.scale.toFixed(2)} px/dot, worst patch ${Math.max(...diffs).toFixed(3)}, mean ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3)}${fit}`);
  return frame;
};

console.log("MXW01 roll, four rows in one piece (rendered with", JSON.stringify(model) + ")");
const R = roll();
check("flat, 1.5 px/dot", R, { scale: 1.5 });
check("flat, 1.0 px/dot", R, { scale: 1.0 });
check("tilted", R, { scale: 1.5, kx: 0.12, ky: 0.08 });
check("tilted the other way, turned 90", R, { scale: 1.5, kx: -0.12, ky: -0.08, turn: 90 });
const rollFrame = check("tilted, turned -6, curled", R, { scale: 1.3, kx: 0.1, ky: -0.08, turn: -6, curl: 5 });
check("upside down, small", R, { scale: 1.0, turn: 180, kx: 0.05 });

console.log("D11s labels");
check("40 mm, four labels, flat", labels(40), { scale: 2.2 });
check("40 mm, four labels, tilted, turned 8", labels(40), { scale: 2.0, kx: 0.1, ky: 0.06, turn: 8 });
const frame = check("40 mm, four labels, tilted, turned 8, small", labels(40), { scale: 1.45, kx: 0.1, ky: 0.06, turn: 8 });
check("40 mm, four labels along the frame", labels(40), { scale: 1.9, turn: 90, kx: -0.05 });
check("30 mm, four labels, tilted", labels(30), { scale: 2.6, kx: 0.08, ky: -0.06, turn: -4 });
check("50 mm, four labels, tilted", labels(50), { scale: 1.8, kx: -0.08, ky: 0.05, turn: 3 });
for (const m of [0, 3]) check(`40 mm, label ${m} alone, close, turned 20`, labels(40, [m]), { scale: 2.8, turn: 20, kx: 0.08 });
check("30 mm, one label, small in the frame", labels(30, [2]), { scale: 1.1, turn: -10 });
for (const [file, f] of [[process.env.FRAME, frame], [process.env.FRAME_ROLL, rollFrame]]) {
  if (!file) continue;
  const head = Buffer.alloc(8);
  head.writeUInt32LE(f.width, 0), head.writeUInt32LE(f.height, 4);
  writeFileSync(file, Buffer.concat([head, Buffer.from(f.data.buffer)]));
}
