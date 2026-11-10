// Fit a dot model to a continuous-roll grey test (measure_strip.py output): the strip is simulated exactly as
// test_prints.ts draws it (384 dots wide, patches 35 dots with 2-dot gaps, dithered as one band, Atkinson at 128).
// usage: node fit_strip.mjs '<measured json>'   (MINBASE=0.15 keeps single dots visible)
globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const M = await import("./bundle.mjs");
const measured = JSON.parse(process.argv[2]);
const dithers = { atkinson: (i) => M.atkinson(i, 128), floyd: (i) => M.floydSteinberg(i, 128), bluenoise: M.blueNoiseDither, werness: M.werness };
const W = 384, H = 63, N = 10, GAP = 2, PW = 35, X0 = 8;
const bitmaps = {};
for (const k of Object.keys(measured)) {
  const img = new ImageData(W, H);
  img.data.fill(255);
  for (let i = 0; i < N; i++) {
    const v = Math.round(255 * (1 - (i + 1) / 10));
    for (let y = 0; y < H; y++) for (let x = X0 + i * (PW + GAP); x < X0 + i * (PW + GAP) + PW; x++) {
      const o = (y * W + x) * 4; img.data.fill(v, o, o + 3);
    }
  }
  bitmaps[k] = dithers[k](img);
}
// Same sample box as the measurement: 60% of the width, 66% of the height, centred
const predict = (k, m) => {
  const bm = bitmaps[k], dark = M.simulateDarkness(bm, m), res = [];
  for (let i = 0; i < N; i++) {
    const cx = X0 + i * (PW + GAP) + PW / 2, cy = H / 2;
    let s = 0, n = 0;
    for (let y = Math.round(cy - H * 0.33); y < Math.round(cy + H * 0.33); y++)
      for (let x = Math.round(cx - PW * 0.3); x < Math.round(cx + PW * 0.3); x++) { s += dark[y * W + x]; n++; }
    res.push(s / n);
  }
  return res.slice(0, 9).map((v) => v / res[9]);
};
const keys = Object.keys(measured), NPTS = keys.length * 9;
const err = (m) => keys.reduce((e, k) => e + predict(k, m).reduce((a, v, i) => a + (v - measured[k][i]) ** 2, 0), 0);
const MINBASE = +(process.env.MINBASE ?? 0);
const D11S = M.D11S_DOT_MODEL;
let best = { ...D11S, base: Math.max(D11S.base, MINBASE) }, bestE = err(best);
const none = { base: 1, orth: 0, diag: 0, spillOrth: 0, spillDiag: 0 };
console.log("no dot gain rms", Math.sqrt(err(none) / NPTS).toFixed(3), " D11s model rms", Math.sqrt(err(D11S) / NPTS).toFixed(3));
const params = Object.keys(best);
let step = 0.1;
for (let round = 0; round < 800; round++) {
  const p = params[round % params.length];
  for (const s of [step, -step]) {
    const c = { ...best, [p]: Math.max(p === "base" ? MINBASE : 0, Math.min(1, best[p] + s)) };
    const e = err(c);
    if (e < bestE) { best = c; bestE = e; }
  }
  if (round % 25 === 24) step *= 0.6;
}
console.log("best", JSON.stringify(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(3)]))), "rms", Math.sqrt(bestE / NPTS).toFixed(3));
for (const k of keys) {
  console.log(k.padEnd(10), "meas ", measured[k].map((v) => v.toFixed(2)).join(" "));
  console.log(k.padEnd(10), "D11s ", predict(k, D11S).map((v) => v.toFixed(2)).join(" "));
  console.log(k.padEnd(10), "fit  ", predict(k, best).map((v) => v.toFixed(2)).join(" "));
}
