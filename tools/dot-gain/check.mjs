globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const M = await import("./bundle.mjs");
const modes = { floyd: (i) => M.floydSteinberg(i, 128), bluenoise: M.blueNoiseDither, werness: M.werness };
const patch = (grey) => { const p = new ImageData(64, 64); for (let i = 0; i < p.data.length; i += 4) { p.data.fill(grey, i, i + 3); p.data[i + 3] = 255; } return p; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log("intended         ", [10,20,30,40,50,60,70,80,90].map((v) => (v / 100).toFixed(2)).join(" "));
for (const [k, d] of Object.entries(modes)) {
  const curve = M.dotGainCurve(k, d);
  const off = [], on = [], used = [];
  for (const p of [10,20,30,40,50,60,70,80,90]) {
    const g = Math.round(255 * (1 - p / 100));
    off.push(mean(M.simulateDarkness(d(patch(g)))));
    on.push(mean(M.simulateDarkness(d(M.applyCurve(patch(g), curve)))));
    used.push(1 - curve[g] / 255);
  }
  console.log(k.padEnd(9), "off   ", off.map((v) => v.toFixed(2)).join(" "));
  console.log(k.padEnd(9), "on    ", on.map((v) => v.toFixed(2)).join(" "));
  console.log(k.padEnd(9), "dots  ", used.map((v) => v.toFixed(2)).join(" "));
}
