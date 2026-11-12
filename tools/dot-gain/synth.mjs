// How well the strip reading copes with a tilted phone and curled paper, on made-up photos where the right answer is
// known: the strip is dithered as the app prints it, "printed" with the MXW01 dot model, and rendered into a full HD
// frame as a camera would see it. Prints the largest difference between a patch as read and as rendered, for the
// strip with the marks left of the patches and for the older one without.
// usage: node synth.mjs   (FRAME=<file.rgba> also writes the tilted, turned, curled view with marks as raw pixels,
//        8 bytes of width and height then RGBA, e.g. to make a fake camera picture for tools/screenshots)
import { writeFileSync } from "node:fs";
globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const M = await import("./bundle.mjs");
const W = 384, ROW = 112, ROWS = 4, model = M.MXW01_DOT_MODEL;

const strip = (marks) => {
  const lay = M.greyRowLayout(W, ROW, 8, marks), H = lay.bottom - lay.top;
  const img = new ImageData(W, ROW * ROWS);
  img.data.fill(255);
  M.GREY_TEST_MODES.forEach((mode, r) => {
    let band = new ImageData(W, H);
    band.data.fill(255);
    const box = (x0, w, v) => { for (let y = 0; y < H; y++) for (let x = x0; x < x0 + w; x++) band.data.fill(v, (y * W + x) * 4, (y * W + x) * 4 + 3); };
    M.GREY_TEST_LEVELS.forEach((level, i) => box(lay.x0 + i * (lay.pw + lay.gap), lay.pw, Math.round(255 * (1 - level / 100))));
    box(lay.markX, lay.markW, 0);
    band = mode.dither(band);
    img.data.set(band.data, (r * ROW + lay.top) * W * 4);
  });
  const dark = M.simulateDarkness(img, model);
  const truth = M.GREY_TEST_MODES.map((_, r) => {
    const means = M.GREY_TEST_LEVELS.map((_, i) => {
      const cx = lay.x0 + i * (lay.pw + lay.gap) + lay.pw / 2, cy = r * ROW + (lay.top + lay.bottom) / 2;
      let s = 0, n = 0;
      for (let y = Math.round(cy - H * 0.33); y < Math.round(cy + H * 0.33); y++)
        for (let x = Math.round(cx - lay.pw * 0.3); x < Math.round(cx + lay.pw * 0.3); x++) { s += dark[y * W + x]; n++; }
      return s / n;
    });
    return means.slice(0, 9).map((v) => v / means[9]);
  });
  return { dark, truth };
};

const photo = (dark, { scale, kx = 0, ky = 0, turn = 0, curl = 0 }) => {
  const w = 1080, h = 1920, data = new Uint8Array(w * h * 4).fill(255);
  const c = Math.cos(turn * Math.PI / 180), s = Math.sin(turn * Math.PI / 180);
  for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
    let sum = 0;
    for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]]) {
      const dx = X + ox - w / 2, dy = Y + oy - h / 2, d = scale * (1 + kx * dx / (w / 2) + ky * dy / (h / 2));
      const qy = (-s * dx + c * dy) / d, sy = ROW * ROWS / 2 + qy;
      const sx = W / 2 + (c * dx + s * dy) / d + curl * Math.sin(Math.PI * qy / (ROW * ROWS));
      const paper = 205 * (1 + 0.1 * dx / (w / 2));
      if (sx < -36 || sx >= W + 36 || sy < -70 || sy >= ROW * ROWS + 60) sum += 45;
      else if (sx < 0 || sx >= W || sy < 0 || sy >= ROW * ROWS) sum += paper;
      else sum += paper * (1 - 0.88 * dark[Math.floor(sy) * W + Math.floor(sx)]);
    }
    data.fill(sum / 5, (Y * w + X) * 4, (Y * w + X) * 4 + 3);
  }
  return { width: w, height: h, data };
};

const views = {
  "flat, 1.5 px/dot": { scale: 1.5 },
  "flat, 0.9 px/dot": { scale: 0.9 },
  "turned 5 deg": { scale: 1.5, turn: 5 },
  "tilted": { scale: 1.5, kx: 0.12, ky: 0.08 },
  "tilted the other way": { scale: 1.5, kx: -0.12, ky: -0.08 },
  "curled 6 dots": { scale: 1.5, curl: 6 },
  "tilted, turned, curled": { scale: 1.3, kx: 0.1, ky: -0.08, turn: -6, curl: 5 },
  "tilted, turned, curled, small": { scale: 0.9, kx: 0.1, ky: -0.08, turn: -6, curl: 5 },
};
for (const marks of [true, false]) {
  const { dark, truth } = strip(marks);
  console.log(marks ? "\nwith marks" : "\nwithout marks (strip of app 1.1.0)");
  for (const [name, view] of Object.entries(views)) {
    const frame = photo(dark, view);
    if (process.env.FRAME && marks && name === "tilted, turned, curled") {
      const head = Buffer.alloc(8);
      head.writeUInt32LE(frame.width, 0), head.writeUInt32LE(frame.height, 4);
      writeFileSync(process.env.FRAME, Buffer.concat([head, Buffer.from(frame.data.buffer)]));
    }
    const r = M.readGreyStrip(frame, W, ROW);
    if (typeof r === "string") { console.log("  " + name.padEnd(32), "FAILED:", r); continue; }
    const diffs = r.measured.flatMap((row, i) => row.map((v, j) => Math.abs(v - truth[i][j])));
    const fit = M.fitDotModel([{ measured: r.measured, marks: r.marks }], W, ROW, M.D11S_DOT_MODEL);
    console.log("  " + name.padEnd(32), `read as ${r.marks ? "marks" : "no marks"}, worst patch ${Math.max(...diffs).toFixed(3)}, mean ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3)}, fit rms ${fit.rms.toFixed(3)}`, JSON.stringify(fit.model));
  }
}
