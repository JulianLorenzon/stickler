// Refit with both grey test photos: testprints.jpg (no correction) and photo_..432 (correction on, 2026-10-30 model)
globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const M = await import("./bundle.mjs");
const OLD = { base: 0.15, orth: 0.425, diag: 0.027, spillOrth: 0.114, spillDiag: 0 };
const dithers = { floyd: (i) => M.floydSteinberg(i, 128), blue: M.blueNoiseDither, werness: M.werness };
const measured = {
  "floyd": [0.01, 0.04, 0.14, 0.31, 0.39, 0.63, 0.81, 0.92, 0.99],
  "blue": [0.04, 0.10, 0.23, 0.39, 0.57, 0.69, 0.86, 0.96, 1.0],
  "floyd+": [0.06, 0.14, 0.22, 0.35, 0.47, 0.55, 0.66, 0.79, 0.95],
  "blue+": [0.08, 0.17, 0.25, 0.35, 0.45, 0.58, 0.71, 0.89, 1.00],
  "werness+": [0.09, 0.17, 0.25, 0.30, 0.41, 0.52, 0.65, 0.82, 0.97],
};
const bitmaps = {};
for (const key of Object.keys(measured)) {
  const k = key.replace("+", ""), d = dithers[k];
  const W = 10 * 22, H = 54, img = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = Math.floor(x / 22), inGap = x % 22 >= 20, p = (i + 1) / 10;
    const v = inGap ? 255 : Math.round(255 * (1 - p)), o = (y * W + x) * 4;
    img.data.fill(v, o, o + 3); img.data[o + 3] = 255;
  }
  bitmaps[key] = d(key.endsWith("+") ? M.applyCurve(img, M.dotGainCurve(k, d, OLD)) : img);
}
const predict = (k, m) => {
  const bm = bitmaps[k], dark = M.simulateDarkness(bm, m), W = bm.width, res = [];
  for (let i = 0; i < 10; i++) {
    let s = 0, n = 0;
    for (let y = 8; y < 46; y++) for (let x = i * 22 + 5; x < i * 22 + 15; x++) { s += dark[y * W + x]; n++; }
    res.push(s / n);
  }
  return res.slice(0, 9).map((v) => v / res[9]);
};
const N = Object.keys(measured).length * 9;
const err = (m) => Object.keys(measured).reduce((e, k) => e + predict(k, m).reduce((a, v, i) => a + (v - measured[k][i]) ** 2, 0), 0);
const MINBASE = +(process.env.MINBASE ?? 0);
let best = { ...OLD, base: Math.max(OLD.base, MINBASE) }, bestE = err(best);
console.log("old model rms", Math.sqrt(err(OLD) / N).toFixed(3));
const keys = Object.keys(best);
let step = 0.1;
for (let round = 0; round < 600; round++) {
  const k = keys[round % keys.length];
  for (const s of [step, -step]) {
    const c = { ...best, [k]: Math.max(k === "base" ? MINBASE : 0, Math.min(1, best[k] + s)) };
    const e = err(c);
    if (e < bestE) { best = c; bestE = e; }
  }
  if (round % 25 === 24) step *= 0.6;
}
console.log("best", JSON.stringify(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(3)]))), "rms", Math.sqrt(bestE / N).toFixed(3));
for (const k of Object.keys(measured)) {
  console.log(k.padEnd(9), "meas ", measured[k].map((v) => v.toFixed(2)).join(" "));
  console.log(k.padEnd(9), "old  ", predict(k, OLD).map((v) => v.toFixed(2)).join(" "));
  console.log(k.padEnd(9), "new  ", predict(k, best).map((v) => v.toFixed(2)).join(" "));
}
