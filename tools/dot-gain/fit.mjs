globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const M = await import("./bundle.mjs");
const measured = {
  floyd: [0.01, 0.04, 0.14, 0.31, 0.39, 0.63, 0.81, 0.92, 0.99],
  blue: [0.04, 0.10, 0.23, 0.39, 0.57, 0.69, 0.86, 0.96, 1.0],
};
const dithers = { floyd: (i) => M.floydSteinberg(i, 128), blue: M.blueNoiseDither };
// Patches like the grey test: 20 dots wide, 54 tall, side by side with 2-dot gaps, dithered together
const bitmaps = {};
for (const [k, d] of Object.entries(dithers)) {
  const W = 10 * 22, H = 54, img = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = Math.floor(x / 22), inGap = x % 22 >= 20, p = (i + 1) / 10;
    const v = inGap ? 255 : Math.round(255 * (1 - p)), o = (y * W + x) * 4;
    img.data.fill(v, o, o + 3); img.data[o + 3] = 255;
  }
  bitmaps[k] = d(img);
}
const predict = (k, m) => {
  const bm = bitmaps[k], dark = M.simulateDarkness(bm, m), W = bm.width;
  const res = [];
  for (let i = 0; i < 10; i++) {
    let s = 0, n = 0;
    for (let y = 8; y < 46; y++) for (let x = i * 22 + 5; x < i * 22 + 15; x++) { s += dark[y * W + x]; n++; }
    res.push(s / n);
  }
  return res.slice(0, 9).map((v) => v / res[9]);
};
const err = (m) => Object.keys(measured).reduce((e, k) => e + predict(k, m).reduce((a, v, i) => a + (v - measured[k][i]) ** 2, 0), 0);
const MINBASE = +(process.env.MINBASE ?? 0);
let best = { base: Math.max(0.3, MINBASE), orth: 0.15, diag: 0.1, spillOrth: 0.08, spillDiag: 0.03 }, bestE = err(best);
const keys = Object.keys(best);
let step = 0.1;
for (let round = 0; round < 400; round++) {
  const cand = { ...best };
  const k = keys[round % keys.length];
  for (const s of [step, -step]) {
    const c = { ...best, [k]: Math.max(k === "base" ? MINBASE : 0, Math.min(1, best[k] + s)) };
    const e = err(c);
    if (e < bestE) { best = c; bestE = e; }
  }
  if (round % 25 === 24) step *= 0.6;
}
console.log("best", JSON.stringify(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(3)]))), "rms", Math.sqrt(bestE / 18).toFixed(3));
for (const k of Object.keys(measured)) {
  console.log(k.padEnd(6), "meas", measured[k].map((v) => v.toFixed(2)).join(" "));
  console.log(k.padEnd(6), "model", predict(k, best).map((v) => v.toFixed(2)).join(" "));
}
