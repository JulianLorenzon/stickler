// The app's own strip reading and dot model fit (src/utils/grey_strip.ts) on photos, outside the app.
// usage: node calibrate.mjs <photo.rgba>[+] ...   ("+" after a file: that strip was printed with dot correction,
//        using the app's MXW01 model unless PRINTED='{"base":...}' says otherwise). Raw files come from to_raw.py.
import { readFileSync } from "node:fs";
globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const M = await import("./bundle.mjs");
const W = 384, ROW = 112;
const printed = process.env.PRINTED ? JSON.parse(process.env.PRINTED) : M.MXW01_DOT_MODEL;
const start = process.env.START ? JSON.parse(process.env.START) : M.D11S_DOT_MODEL;
const fmt = (a) => a.map((v) => v.toFixed(2)).join(" ");
const strips = [];
for (const arg of process.argv.slice(2)) {
  const corrected = arg.endsWith("+"), file = corrected ? arg.slice(0, -1) : arg;
  const buf = readFileSync(file);
  const photo = { width: buf.readUInt32LE(0), height: buf.readUInt32LE(4), data: new Uint8Array(buf.buffer, buf.byteOffset + 8, buf.length - 8) };
  const t0 = performance.now();
  const r = M.readGreyStrip(photo, W, ROW);
  const ms = performance.now() - t0;
  console.log(`\n${arg}  ${photo.width}x${photo.height}  read in ${ms.toFixed(0)} ms`);
  if (typeof r === "string") { console.log("  FAILED:", r); continue; }
  console.log(`  ${r.marks ? "coded rows" : "no marks"}, ${r.rows.length} row(s), scale ${r.scale.toFixed(2)} px/dot, paper evenness ${r.paperEvenness.toFixed(2)}`);
  r.rows.forEach((row) => console.log("  " + M.GREY_TEST_MODES[row.mode].mode.padEnd(10), fmt(row.measured)));
  if (!r.complete) continue;
  strips.push({
    measured: r.measured,
    marks: r.marks,
    curves: corrected ? M.GREY_TEST_MODES.map((m) => M.dotGainCurve(`printed:${m.mode}`, m.dither, printed)) : undefined,
  });
}
if (strips.length > 0) {
  const t0 = performance.now();
  const fit = M.fitDotModel(strips, W, ROW, start);
  console.log(`\nfit of ${strips.length} strip(s) in ${(performance.now() - t0).toFixed(0)} ms:`, JSON.stringify(fit.model));
  console.log(`  rms ${fit.rms.toFixed(3)} (start model ${fit.startRms.toFixed(3)}, no dot gain ${fit.plainRms.toFixed(3)}, app's MXW01 model ${M.fitDotModel(strips, W, ROW, M.MXW01_DOT_MODEL).startRms.toFixed(3)})`);
}
