import type { PrinterId } from "$/types";

/**
 * A rough model of how the D11s burns its dots, for the "on paper" preview and the dot gain correction.
 *
 * A thermal dot needs heat: one on its own gets little and comes out faint, dots next to each other share heat and
 * spread into the white around them. So each dot's darkness depends on how many of its 8 neighbours are burnt.
 * Fitted to the grey test print in `pictures/testprints.jpg` (Floyd–Steinberg and blue noise, 10-100%), which was
 * measured from a phone photo, so treat it as an approximation.
 */
export interface DotModel {
  /** Darkness of a burnt dot with no burnt neighbours */
  base: number;
  /** Extra darkness of a burnt dot per burnt neighbour, side by side and diagonal */
  orth: number;
  diag: number;
  /** Darkness an empty dot picks up per burnt neighbour */
  spillOrth: number;
  spillDiag: number;
}

// Least squares fit to the 18 patches gives base 0 (rms 0.036); 0.15 fits nearly as well (0.042) and matches the
// faint dots visible in the lightest blue noise patch
export const D11S_DOT_MODEL: DotModel = {
  base: 0.15,
  orth: 0.425,
  diag: 0.027,
  spillOrth: 0.114,
  spillDiag: 0,
};

/**
 * MXW01 on its 57 mm roll, fitted with tools/dot-gain/fit_strip.mjs to three grey strips (all four dither modes):
 * the uncorrected strip in two photos and a strip printed with the first fit's correction (2026-11-10/11, data in
 * mxw01-2026-11-11.json). rms 0.045 over 108 patches; the two photos of the same strip already differ by 0.05-0.08 in
 * the mid greys, so this is about as close as phone photos get. The corrected strip came out within 0.05 of the
 * intended greys with blue noise and Werness but 0.1 too light with Floyd–Steinberg and Atkinson above 50%; one model
 * can't fit both, this one corrects a little less than the first fit. A free fit gives base 0.06 at the same error;
 * 0.15 keeps the single dots visible in the lightest patches.
 */
export const MXW01_DOT_MODEL: DotModel = {
  base: 0.15,
  orth: 0.235,
  diag: 0.103,
  spillOrth: 0.122,
  spillDiag: 0.007,
};

/**
 * Dot models of the printers that have one. A printer without one gets no dot gain correction: another printer's model
 * would correct for the wrong dots. Fit a new one from that printer's grey test.
 */
const DOT_MODELS: Partial<Record<PrinterId, DotModel>> = { d11s: D11S_DOT_MODEL, mxw01: MXW01_DOT_MODEL };

export const dotModelFor = (printer: PrinterId): DotModel | undefined => DOT_MODELS[printer];

/** Paper and ink colours of the Fichero labels, for drawing the simulation */
const PAPER = [244, 240, 234];
const INK = [59, 42, 40];

/** Darkness (0 = paper, 1 = full ink) of every dot of a 1-bit image, black pixels being burnt dots */
export const simulateDarkness = (bitmap: ImageData, m: DotModel = D11S_DOT_MODEL): Float32Array => {
  const { width: w, height: h, data } = bitmap;
  const burnt = new Uint8Array(w * h);
  for (let i = 0; i < burnt.length; i++) burnt[i] = data[i * 4] < 128 ? 1 : 0;

  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? burnt[y * w + x] : 0);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const orth = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1);
      const diag = at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1);
      const d = burnt[y * w + x]
        ? m.base + m.orth * orth + m.diag * diag
        : m.spillOrth * orth + m.spillDiag * diag;
      out[y * w + x] = Math.min(1, d);
    }
  }

  return out;
};

/** What a 1-bit image should look like printed, in paper and ink colours */
export const simulatePrint = (bitmap: ImageData, m: DotModel = D11S_DOT_MODEL): ImageData => {
  const dark = simulateDarkness(bitmap, m);
  const out = new ImageData(bitmap.width, bitmap.height);
  for (let i = 0; i < dark.length; i++) {
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = PAPER[c] + (INK[c] - PAPER[c]) * dark[i];
    out.data[i * 4 + 3] = 255;
  }
  return out;
};

const CURVE_STEPS = 32;
const CURVE_PATCH = 64;
const curves = new Map<string, Uint8ClampedArray>();

/**
 * A grey → grey table that undoes the dot model for one dither: it measures how dark flat patches come out after
 * `dither` and the model, then for each grey picks the input that prints as that grey. Cached per `key`.
 */
export const dotGainCurve = (
  key: string,
  dither: (image: ImageData) => ImageData,
  m: DotModel = D11S_DOT_MODEL,
): Uint8ClampedArray => {
  const cached = curves.get(key);
  if (cached) return cached;

  // Printed darkness for coverage i / CURVE_STEPS, kept rising so it can be inverted
  const printed: number[] = [];
  for (let i = 0; i <= CURVE_STEPS; i++) {
    const grey = Math.round(255 * (1 - i / CURVE_STEPS));
    const patch = new ImageData(CURVE_PATCH, CURVE_PATCH);
    for (let p = 0; p < patch.data.length; p += 4) patch.data.fill(grey, p, p + 3), (patch.data[p + 3] = 255);
    const dark = simulateDarkness(dither(patch), m);
    const mean = dark.reduce((a, b) => a + b, 0) / dark.length;
    printed.push(Math.max(mean, printed[i - 1] ?? 0));
  }
  const max = printed[CURVE_STEPS];

  const lut = new Uint8ClampedArray(256);
  for (let g = 0; g < 256; g++) {
    const target = (1 - g / 255) * max;
    let i = printed.findIndex((v) => v >= target);
    if (i <= 0) i = Math.max(i, 1);
    const [a, b] = [printed[i - 1], printed[i]];
    const coverage = (i - 1 + (b > a ? (target - a) / (b - a) : 0)) / CURVE_STEPS;
    lut[g] = Math.round(255 * (1 - Math.min(1, Math.max(0, coverage))));
  }
  // Paper stays paper and solid black stays solid, even where the model saturates a little early
  lut[0] = 0;
  lut[255] = 255;

  curves.set(key, lut);
  return lut;
};
