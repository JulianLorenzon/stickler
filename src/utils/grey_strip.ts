/**
 * The grey test strip without the drawing: its layout, reading it back from a photo, and fitting a dot model to what
 * was read. No DOM in here, so the same code runs in the app and in tools/dot-gain (Node).
 *
 * Only the continuous-roll strip (one piece, a row per dither mode, see test_prints.ts) can be read from a photo: its
 * four solid 100% patches sit in a column, which gives the position, direction and scale of the whole strip.
 */
import type { PostProcessType } from "$/types";
import { applyCurve, atkinson, blueNoiseDither, floydSteinberg, werness } from "$/utils/post_process";
import type { DotModel } from "$/utils/print_sim";

/** The dither modes on the grey test, with the settings the print preview uses for photos (Atkinson at 128) */
export const GREY_TEST_MODES: { name: string; mode: PostProcessType; dither: (iData: ImageData) => ImageData }[] = [
  { name: "Atkinson", mode: "dither", dither: (iData) => atkinson(iData, 128) },
  { name: "Floyd–Steinberg", mode: "floyd", dither: (iData) => floydSteinberg(iData, 128) },
  { name: "Blue noise", mode: "bluenoise", dither: blueNoiseDither },
  { name: "Werness", mode: "werness", dither: werness },
];
export const GREY_TEST_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export interface GreyRowLayout {
  /** Patches per row and the gap between them, dots */
  n: number;
  gap: number;
  /** Patch width, left edge of the first patch, top and bottom of the patches, dots */
  pw: number;
  x0: number;
  top: number;
  bottom: number;
}

/** Where the patches sit in one W x H row of the grey test */
export const greyRowLayout = (W: number, H: number, dotsPerMm = 8): GreyRowLayout => {
  const margin = Math.round(dotsPerMm / 2);
  const gap = 2;
  const n = GREY_TEST_LEVELS.length;
  const pw = Math.floor((W - 2 * margin - (n - 1) * gap) / n);
  return {
    n,
    gap,
    pw,
    x0: Math.round((W - n * pw - (n - 1) * gap) / 2),
    top: Math.round(H * 0.24),
    bottom: Math.round(H * 0.8),
  };
};

/** Part of a patch that gets sampled, around its centre: clear of the edges, where the paper shows through */
const SAMPLE_W = 0.6;
const SAMPLE_H = 0.66;

// ---------------------------------------------------------------------------------------------------------------
// Reading a photo
// ---------------------------------------------------------------------------------------------------------------

export interface Pixels {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8ClampedArray | Uint8Array;
}

type Pt = [number, number];
/** Corners of a sampled box in photo pixels, to draw over the photo */
export type Quad = [Pt, Pt, Pt, Pt];

export type StripFailure =
  /** No column of four solid patches in the photo */
  | "not_found"
  /** Found a column, but what's around it doesn't look like the strip (paper where patches should be, or the reverse) */
  | "not_a_strip";

export interface StripReading {
  /** Per row (GREY_TEST_MODES order), darkness of the 10..90% patches: 0 = paper, 1 = that row's solid patch */
  measured: number[][];
  /** Photo pixels per printer dot */
  scale: number;
  /** How uneven the light is: darkest / brightest paper sample */
  paperEvenness: number;
  /** What the smooth paper brightness fit leaves over, relative to the paper brightness */
  paperRms: number;
  /** Solid patch brightness relative to the paper (how black the black is in this photo) */
  black: number;
  patchBoxes: Quad[];
  paperBoxes: Quad[];
}

interface Blob {
  x: number;
  y: number;
  cells: number;
}

const luminance = (img: Pixels): Float32Array => {
  const L = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let l = 0, i = 0; l < L.length; l++, i += 4) L[l] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return L;
};

const percentile = (L: Float32Array, p: number): number => {
  const hist = new Uint32Array(256);
  for (let i = 0; i < L.length; i += 7) hist[Math.min(255, L[i] | 0)]++;
  let left = (p * Math.ceil(L.length / 7)) | 0;
  for (let v = 0; v < 256; v++) if ((left -= hist[v]) < 0) return v;
  return 255;
};

/** Solid dark areas of about a patch's shape: connected cells that are nearly all dark, clear of the photo's edge */
const solidBlobs = (L: Float32Array, w: number, h: number, darkBelow: number): Blob[] => {
  // Small cells, so the strip can be small in the picture: a patch still covers 40 of them at 0.8 px per dot
  const c = Math.max(2, Math.round(Math.max(w, h) / 480));
  const gw = Math.floor(w / c);
  const gh = Math.floor(h / c);
  const solid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let dark = 0;
      for (let y = gy * c; y < gy * c + c; y++) for (let x = gx * c; x < gx * c + c; x++) if (L[y * w + x] < darkBelow) dark++;
      if (dark > 0.97 * c * c) solid[gy * gw + gx] = 1;
    }
  }

  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < solid.length; start++) {
    if (solid[start] !== 1) continue;
    solid[start] = 2;
    stack.push(start);
    let n = 0, sx = 0, sy = 0, minX = gw, maxX = 0, minY = gh, maxY = 0;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % gw, py = (p / gw) | 0;
      n++, (sx += px), (sy += py);
      minX = Math.min(minX, px), (maxX = Math.max(maxX, px)), (minY = Math.min(minY, py)), (maxY = Math.max(maxY, py));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || solid[ny * gw + nx] !== 1) continue;
        solid[ny * gw + nx] = 2;
        stack.push(ny * gw + nx);
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const atEdge = minX === 0 || minY === 0 || maxX === gw - 1 || maxY === gh - 1;
    // A patch is a filled box, about 1 : 1.8, at any angle
    if (atEdge || n < 40 || n < 0.5 * bw * bh || Math.max(bw, bh) > 4 * Math.min(bw, bh)) continue;
    blobs.push({ x: (sx / n + 0.5) * c, y: (sy / n + 0.5) * c, cells: n * c * c });
  }
  return blobs.sort((a, b) => b.cells - a.cells).slice(0, 18);
};

/** Sets of four blobs in a straight, evenly spaced line and of one size, in order along the line; best first */
const patchColumns = (blobs: Blob[]): Blob[][] => {
  const found: { score: number; column: Blob[] }[] = [];
  const n = blobs.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const set = [blobs[a], blobs[b], blobs[c], blobs[d]];
    // Order along the longest stretch
    let far: [Blob, Blob] = [set[0], set[1]], farD = 0;
    for (const p of set) for (const q of set) {
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      if (dist > farD) (farD = dist), (far = [p, q]);
    }
    const [o, e] = far;
    const ux = (e.x - o.x) / farD, uy = (e.y - o.y) / farD;
    const along = (p: Blob) => (p.x - o.x) * ux + (p.y - o.y) * uy;
    const col = [...set].sort((p, q) => along(p) - along(q));
    const pitch = farD / 3;
    const spacing = Math.max(...[1, 2].map((i) => Math.abs(along(col[i]) - i * pitch))) / pitch;
    const offLine = Math.max(...col.map((p) => Math.abs((p.x - o.x) * uy - (p.y - o.y) * ux))) / pitch;
    const sizes = col.map((p) => p.cells);
    const size = 1 - Math.min(...sizes) / Math.max(...sizes);
    // Row pitch against patch size: 112 dots against a 35 x 63 patch is 2.4; the cells miss the patch's rim
    const ratio = pitch / Math.sqrt(sizes.reduce((s, v) => s + v, 0) / 4);
    if (spacing > 0.15 || offLine > 0.12 || size > 0.5 || ratio < 1.8 || ratio > 4.5) continue;
    found.push({ score: spacing + offLine + 0.3 * size, column: col });
  }
  return found.sort((p, q) => p.score - q.score).map((f) => f.column);
};

/** Least squares for a handful of unknowns: solves (XᵀX) c = Xᵀy */
const leastSquares = (X: number[][], y: number[]): number[] => {
  const k = X[0].length;
  const A = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k + 1 }, (_, j) =>
      j < k ? X.reduce((s, r) => s + r[i] * r[j], 0) : X.reduce((s, r, n) => s + r[i] * y[n], 0),
    ),
  );
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    if (Math.abs(A[i][i]) < 1e-12) continue;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let j = i; j <= k; j++) A[r][j] -= f * A[i][j];
    }
  }
  return A.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[k] / r[i]));
};

/**
 * Reads the strip with the solid patches at `anchors`, first row first. Each row gets its own direction and scale
 * from the anchors next to it, since the paper curls. Returns undefined when it doesn't look like the strip this
 * way round.
 */
const readColumn = (
  L: Float32Array,
  w: number,
  h: number,
  anchors: Blob[],
  W: number,
  rowH: number,
): StripReading | undefined => {
  const lay = greyRowLayout(W, rowH);
  const rows = anchors.length;
  const centerX = (i: number) => lay.x0 + i * (lay.pw + lay.gap) + lay.pw / 2;
  const centerY = (lay.top + lay.bottom) / 2;

  // Row axes in photo pixels per dot: v down the strip, u along the row (to the right when v points down)
  const axes = anchors.map((_, r) => {
    const a = anchors[Math.max(0, r - 1)], b = anchors[Math.min(rows - 1, r + 1)];
    const steps = (Math.min(rows - 1, r + 1) - Math.max(0, r - 1)) * rowH;
    const v: Pt = [(b.x - a.x) / steps, (b.y - a.y) / steps];
    return { v, u: [v[1], -v[0]] as Pt };
  });
  const toPhoto = (row: number, sx: number, sy: number): Pt => {
    const { u, v } = axes[row];
    const dx = sx - centerX(lay.n - 1), dy = sy - centerY;
    return [anchors[row].x + dx * u[0] + dy * v[0], anchors[row].y + dx * u[1] + dy * v[1]];
  };
  /** Mean brightness of a box around a strip point (half sizes in dots), or undefined when it leaves the photo */
  const boxMean = (row: number, sx: number, sy: number, hw: number, hh: number): number | undefined => {
    const s = Math.hypot(...axes[row].v);
    const step = 1 / Math.max(1, s);
    let sum = 0, n = 0;
    for (let dy = -hh; dy <= hh; dy += step) {
      for (let dx = -hw; dx <= hw; dx += step) {
        const [x, y] = toPhoto(row, sx + dx, sy + dy);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) return undefined;
        sum += L[yi * w + xi];
        n++;
      }
    }
    return sum / n;
  };
  const quad = (row: number, sx: number, sy: number, hw: number, hh: number): Quad => [
    toPhoto(row, sx - hw, sy - hh),
    toPhoto(row, sx + hw, sy - hh),
    toPhoto(row, sx + hw, sy + hh),
    toPhoto(row, sx - hw, sy + hh),
  ];

  // Paper: the margins left and right of the print and the blank band right of the mode name (also clear of the
  // longer "· corrected" titles)
  const paperSpots: Pt[] = [
    ...[0.27, 0.54, 0.76].flatMap((f): Pt[] => [[-14, f * rowH], [W + 14, f * rowH]]),
    ...[0.755, 0.833, 0.911, 0.977].map((f): Pt => [f * W, 0.09 * rowH]),
  ];
  const paperPts: Pt[] = [], paperVals: number[] = [], paperBoxes: Quad[] = [];
  for (let row = 0; row < rows; row++) {
    for (const [sx, sy] of paperSpots) {
      const val = boxMean(row, sx, sy, 4, 3);
      if (val === undefined) continue;
      paperPts.push(toPhoto(row, sx, sy));
      paperVals.push(val);
      paperBoxes.push(quad(row, sx, sy, 4, 3));
    }
  }
  if (paperVals.length < rows * paperSpots.length * 0.7) return undefined;
  const sorted = [...paperVals].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  // Light falls off across a photo: a smooth (quadratic) paper brightness, fitted without the odd sample that
  // landed on something else
  const terms = ([x, y]: Pt) => {
    const nx = x / w, ny = y / h;
    return [1, nx, ny, nx * nx, ny * ny, nx * ny];
  };
  const keep = paperVals.map((v) => v > 0.6 * median);
  if (keep.filter(Boolean).length < paperVals.length * 0.85) return undefined;
  const X = paperPts.filter((_, i) => keep[i]).map(terms);
  const Y = paperVals.filter((_, i) => keep[i]);
  const coef = leastSquares(X, Y);
  const paperAt = (p: Pt) => terms(p).reduce((s, t, i) => s + t * coef[i], 0);
  const paperRms = Math.sqrt(X.reduce((s, r, i) => s + (Y[i] - r.reduce((a, t, j) => a + t * coef[j], 0)) ** 2, 0) / Y.length) / median;

  const measured: number[][] = [];
  const patchBoxes: Quad[] = [];
  let blackSum = 0;
  for (let row = 0; row < rows; row++) {
    const refl: number[] = [];
    for (let i = 0; i < lay.n; i++) {
      const hw = (lay.pw * SAMPLE_W) / 2, hh = ((lay.bottom - lay.top) * SAMPLE_H) / 2;
      const val = boxMean(row, centerX(i), centerY, hw, hh);
      if (val === undefined) return undefined;
      refl.push(val / paperAt(toPhoto(row, centerX(i), centerY)));
      patchBoxes.push(quad(row, centerX(i), centerY, hw, hh));
    }
    const black = refl[lay.n - 1];
    blackSum += black;
    const dark = refl.slice(0, -1).map((r) => (1 - r) / (1 - black));
    // The strip runs from nearly paper to nearly solid, and never gets clearly lighter on the way
    const drops = dark.filter((v, i) => i > 0 && v < dark[i - 1] - 0.08).length;
    if (black > 0.6 || dark[0] > 0.4 || dark[dark.length - 1] < 0.6 || drops > 1) return undefined;
    measured.push(dark);
  }

  return {
    measured,
    scale: axes.reduce((s, a) => s + Math.hypot(...a.v), 0) / rows,
    paperEvenness: Math.min(...Y) / Math.max(...Y),
    paperRms,
    black: blackSum / rows,
    patchBoxes,
    paperBoxes,
  };
};

/**
 * Finds the continuous-roll grey test in a photo and measures its patches against the paper around them. The photo
 * can be any way up; about 1500 px on the long side is plenty. `W` and `rowH` are the strip's width and row height
 * in dots.
 */
export const readGreyStrip = (photo: Pixels, W: number, rowH: number): StripReading | StripFailure => {
  const { width: w, height: h } = photo;
  const L = luminance(photo);
  // Paper is the brightest part of the photo, even when the strip is small on a dark table (a few percent of the
  // picture); solid ink is well under half of it
  const paper = percentile(L, 0.97);
  const columns = patchColumns(solidBlobs(L, w, h, 0.42 * paper));
  if (columns.length === 0) return "not_found";

  // The 90% patches can be solid enough to make a column of their own, and the photo can be upside down: the
  // right column, the right way round, is the one with paper and rising greys where the layout says
  for (const column of columns.slice(0, 6)) {
    for (const anchors of [column, [...column].reverse()]) {
      const reading = readColumn(L, w, h, anchors, W, rowH);
      if (reading) return reading;
    }
  }
  return "not_a_strip";
};

// ---------------------------------------------------------------------------------------------------------------
// Fitting a dot model
// ---------------------------------------------------------------------------------------------------------------

const MODEL_KEYS = ["base", "orth", "diag", "spillOrth", "spillDiag"] as const;

/**
 * For each patch of a row, how many sampled dots there are of each kind: burnt or not, with 0-4 burnt neighbours
 * side by side and 0-4 diagonal. That's all a dot model looks at, so the fit doesn't have to simulate the strip again
 * for every model it tries. The row is dithered exactly as test_prints.ts prints it.
 */
const patchDotCounts = (
  W: number,
  rowH: number,
  dither: (i: ImageData) => ImageData,
  curve?: Uint8ClampedArray,
): Float64Array[] => {
  const lay = greyRowLayout(W, rowH);
  const H = lay.bottom - lay.top;
  let band = new ImageData(W, H);
  band.data.fill(255);
  GREY_TEST_LEVELS.forEach((level, i) => {
    const v = Math.round(255 * (1 - level / 100));
    const x0 = lay.x0 + i * (lay.pw + lay.gap);
    for (let y = 0; y < H; y++) for (let x = x0; x < x0 + lay.pw; x++) band.data.fill(v, (y * W + x) * 4, (y * W + x) * 4 + 3);
  });
  band = dither(curve ? applyCurve(band, curve) : band);
  const burnt = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H && band.data[(y * W + x) * 4] < 128 ? 1 : 0);

  return GREY_TEST_LEVELS.map((_, i) => {
    const counts = new Float64Array(50);
    const cx = lay.x0 + i * (lay.pw + lay.gap) + lay.pw / 2, cy = H / 2;
    for (let y = Math.round(cy - (H * SAMPLE_H) / 2); y < Math.round(cy + (H * SAMPLE_H) / 2); y++) {
      for (let x = Math.round(cx - (lay.pw * SAMPLE_W) / 2); x < Math.round(cx + (lay.pw * SAMPLE_W) / 2); x++) {
        const orth = burnt(x - 1, y) + burnt(x + 1, y) + burnt(x, y - 1) + burnt(x, y + 1);
        const diag = burnt(x - 1, y - 1) + burnt(x + 1, y - 1) + burnt(x - 1, y + 1) + burnt(x + 1, y + 1);
        counts[burnt(x, y) * 25 + orth * 5 + diag]++;
      }
    }
    return counts;
  });
};

/** Darkness of the 10..90% patches relative to the solid one, as `m` prints them (same as simulateDarkness) */
const predictRow = (counts: Float64Array[], m: DotModel): number[] => {
  const dark = counts.map((c) => {
    let sum = 0, n = 0;
    for (let k = 0; k < 50; k++) {
      if (c[k] === 0) continue;
      const orth = ((k % 25) / 5) | 0, diag = k % 5;
      const d = k >= 25 ? m.base + m.orth * orth + m.diag * diag : m.spillOrth * orth + m.spillDiag * diag;
      sum += c[k] * Math.min(1, d);
      n += c[k];
    }
    return sum / n;
  });
  const solid = dark[dark.length - 1];
  return dark.slice(0, -1).map((v) => v / solid);
};

export interface StripToFit {
  /** Rows in GREY_TEST_MODES order, as `readGreyStrip` gives them */
  measured: number[][];
  /** The curves the strip was printed with, per row, when it was printed with dot correction */
  curves?: (Uint8ClampedArray | undefined)[];
}

export interface DotFit {
  model: DotModel;
  /** Root mean square difference between the measured patches and what the model predicts (0-1 darkness) */
  rms: number;
  /** The same for the model the fit started from, and for dots that print exactly as drawn */
  startRms: number;
  plainRms: number;
  /** Per strip and row, what the fitted model predicts for the measured patches */
  predicted: number[][][];
}

/**
 * Fits a dot model to one or more measured strips, starting from `start`. `minBase` keeps a single dot from fitting to
 * nothing: the photos can't tell 0 from 0.15, and at 0 the correction would stop using single dots.
 */
export const fitDotModel = (strips: StripToFit[], W: number, rowH: number, start: DotModel, minBase = 0.15): DotFit => {
  const rows = strips.flatMap((s) =>
    s.measured.map((measured, r) => ({
      measured,
      counts: patchDotCounts(W, rowH, GREY_TEST_MODES[r].dither, s.curves?.[r]),
    })),
  );
  const points = rows.reduce((n, r) => n + r.measured.length, 0);
  const err = (m: DotModel) =>
    rows.reduce((e, r) => e + predictRow(r.counts, m).reduce((a, v, i) => a + (v - r.measured[i]) ** 2, 0), 0);
  const rms = (m: DotModel) => Math.sqrt(err(m) / points);

  let best: DotModel = { ...start, base: Math.max(start.base, minBase) };
  let bestE = err(best);
  let step = 0.1;
  for (let round = 0; round < 800; round++) {
    const p = MODEL_KEYS[round % MODEL_KEYS.length];
    for (const s of [step, -step]) {
      const c = { ...best, [p]: Math.max(p === "base" ? minBase : 0, Math.min(1, best[p] + s)) };
      const e = err(c);
      if (e < bestE) (best = c), (bestE = e);
    }
    if (round % 25 === 24) step *= 0.6;
  }
  const model = Object.fromEntries(MODEL_KEYS.map((k) => [k, Math.round(best[k] * 1000) / 1000])) as unknown as DotModel;

  let r = 0;
  return {
    model,
    rms: rms(model),
    startRms: rms(start),
    plainRms: rms({ base: 1, orth: 0, diag: 0, spillOrth: 0, spillDiag: 0 }),
    predicted: strips.map((s) => s.measured.map(() => predictRow(rows[r++].counts, model))),
  };
};
