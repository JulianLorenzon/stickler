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
  /** Left edge and width of the solid mark left of the patches (as tall as they are); width 0 without marks */
  markX: number;
  markW: number;
}

/**
 * Where the patches sit in one W x H row of the grey test. Left of them is a solid mark: with the solid 100% patch at
 * the other end it pins both ends of the row in a photo. `marks` false gives the strip as it was printed before the
 * marks (app 1.1.0), which can still be read.
 */
export const greyRowLayout = (W: number, H: number, dotsPerMm = 8, marks = true): GreyRowLayout => {
  const margin = Math.round(dotsPerMm / 2);
  const gap = 2;
  const n = GREY_TEST_LEVELS.length;
  const markW = marks ? 2 * dotsPerMm : 0;
  const markGap = marks ? margin : 0;
  const pw = Math.floor((W - 2 * margin - markW - markGap - (n - 1) * gap) / n);
  const markX = Math.round((W - markW - markGap - n * pw - (n - 1) * gap) / 2);
  return {
    n,
    gap,
    pw,
    x0: markX + markW + markGap,
    top: Math.round(H * 0.24),
    bottom: Math.round(H * 0.8),
    markX,
    markW,
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
  /** Whether the strip has the marks left of the patches (see greyRowLayout); the fit has to know */
  marks: boolean;
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

type Mapper = (row: number, sx: number, sy: number) => Pt;

/** Measures the strip given where its points are in the photo; undefined when it doesn't look like the strip */
const measureRows = (
  L: Float32Array,
  w: number,
  h: number,
  rows: number,
  W: number,
  rowH: number,
  lay: GreyRowLayout,
  toPhoto: Mapper,
  scaleOf: (row: number) => number,
): StripReading | undefined => {
  const centerX = (i: number) => lay.x0 + i * (lay.pw + lay.gap) + lay.pw / 2;
  const centerY = (lay.top + lay.bottom) / 2;
  /** Mean brightness of a box around a strip point (half sizes in dots), or undefined when it leaves the photo */
  const boxMean = (row: number, sx: number, sy: number, hw: number, hh: number): number | undefined => {
    const step = 1 / Math.max(1, scaleOf(row));
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

  let scale = 0;
  for (let row = 0; row < rows; row++) scale += scaleOf(row) / rows;
  return {
    measured,
    marks: lay.markW > 0,
    scale,
    paperEvenness: Math.min(...Y) / Math.max(...Y),
    paperRms,
    black: blackSum / rows,
    patchBoxes,
    paperBoxes,
  };
};

/** Direction and size of one dot down the strip at each of a column of points a row apart, photo pixels */
const downVectors = (pts: Pt[], rowH: number): Pt[] =>
  pts.map((_, r) => {
    const i = Math.max(0, r - 1), j = Math.min(pts.length - 1, r + 1);
    return [(pts[j][0] - pts[i][0]) / ((j - i) * rowH), (pts[j][1] - pts[i][1]) / ((j - i) * rowH)];
  });

/**
 * Reads the strip with the solid patches at `anchors`, first row first. Returns undefined when it doesn't look like
 * the strip this way round.
 *
 * The solid patches give the right end of every row and, from one row to the next, the direction and scale down the
 * strip. With only that, a row is assumed to run square to the column at the same scale, which a tilted phone or
 * curled paper breaks towards the left end. So the marks left of the patches are looked for where that guess puts
 * them; when every row has one, each row runs from its mark to its solid patch instead.
 */
const readColumn = (
  L: Float32Array,
  w: number,
  h: number,
  anchors: Blob[],
  W: number,
  rowH: number,
  darkBelow: number,
): StripReading | undefined => {
  const rows = anchors.length;
  const right: Pt[] = anchors.map((a) => [a.x, a.y]);
  const vRight = downVectors(right, rowH);

  /** Rows square to the column of solid patches, for a layout */
  const square = (lay: GreyRowLayout): Mapper => {
    const ax = lay.x0 + (lay.n - 1) * (lay.pw + lay.gap) + lay.pw / 2, ay = (lay.top + lay.bottom) / 2;
    return (row, sx, sy) => {
      const v = vRight[row];
      return [right[row][0] + (sx - ax) * v[1] + (sy - ay) * v[0], right[row][1] - (sx - ax) * v[0] + (sy - ay) * v[1]];
    };
  };
  const scaleRight = (row: number) => Math.hypot(...vRight[row]);

  const lay = greyRowLayout(W, rowH);
  const guess = square(lay);
  const markX = lay.markX + lay.markW / 2, markY = (lay.top + lay.bottom) / 2;
  const markH = lay.bottom - lay.top;
  /** Middle of the dark pixels in a box around a strip point (half sizes in dots), and how much of a mark they make */
  const darkMiddle = (row: number, sx: number, sy: number, hw: number, hh: number) => {
    const step = 1 / Math.max(1, scaleRight(row));
    let n = 0, mx = 0, my = 0, msx = 0, msy = 0;
    for (let dy = -hh; dy <= hh; dy += step) {
      for (let dx = -hw; dx <= hw; dx += step) {
        const [x, y] = guess(row, sx + dx, sy + dy);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h || L[yi * w + xi] >= darkBelow) continue;
        n++, (mx += x), (my += y), (msx += sx + dx), (msy += sy + dy);
      }
    }
    return { photo: [mx / n, my / n] as Pt, strip: [msx / n, msy / n] as Pt, part: (n * step * step) / (lay.markW * markH) };
  };
  /**
   * The mark along the guessed row: a dark stretch about as long as the mark is wide, with paper on both sides. The
   * guess can be far off at this end of the row (a tilted phone changes the scale along it), so this looks from
   * well left of the mark to a few patches in; the table beyond the paper's edge has no paper to its left.
   */
  const findMark = (row: number): number | undefined => {
    const step = 0.5, from = markX - 60, to = markX + 90;
    const profile: number[] = [];
    for (let sx = from; sx <= to; sx += step) {
      let sum = 0, n = 0;
      for (let dy = -12; dy <= 12; dy += 2) {
        const [x, y] = guess(row, sx, markY + dy);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
        sum += L[yi * w + xi];
        n++;
      }
      profile.push(n > 0 ? sum / n : 0);
    }
    const paperOver = darkBelow / 0.42 * 0.65;
    const around = (i: number) => profile[Math.max(0, Math.min(profile.length - 1, i))];
    for (let i = 0; i < profile.length; i++) {
      if (profile[i] >= darkBelow) continue;
      let j = i;
      while (j + 1 < profile.length && profile[j + 1] < darkBelow * 1.3) j++;
      const length = (j - i + 1) * step;
      if (i > 0 && length > lay.markW * 0.5 && length < lay.markW * 1.8 && around(i - 8) > paperOver && around(j + 5) > paperOver) {
        return from + ((i + j) / 2) * step;
      }
      i = j;
    }
    return undefined;
  };
  const left: Pt[] = [];
  for (let row = 0; row < rows; row++) {
    const sx = findMark(row);
    if (sx === undefined) break;
    // Its middle: a box just bigger than the mark, moved onto what it finds a few times (clear of the mode name
    // above and the first patch to the right)
    let at: Pt = [sx, markY], found;
    for (let pass = 0; pass < 4; pass++) {
      found = darkMiddle(row, at[0], at[1], lay.markW / 2 + 3, markH / 2 + 4);
      if (!(found.part > 0.3)) break;
      at = found.strip;
    }
    if (!found || !(found.part > 0.6)) break;
    left.push(found.photo);
  }

  if (left.length < rows) {
    // No marks: a strip from before them
    return measureRows(L, w, h, rows, W, rowH, greyRowLayout(W, rowH, 8, false), square(greyRowLayout(W, rowH, 8, false)), scaleRight);
  }

  const vLeft = downVectors(left, rowH);
  const ax = lay.x0 + (lay.n - 1) * (lay.pw + lay.gap) + lay.pw / 2;
  // A tilted phone sees one end of the row bigger than the other, and the patches in between aren't evenly spaced
  // in the photo then. The row pitch at both ends says by how much, so the row is laid out in perspective.
  const pinned: Mapper = (row, sx, sy) => {
    const l = left[row], r = right[row], vl = vLeft[row], vr = vRight[row];
    const ratio = Math.hypot(...vl) / Math.hypot(...vr);
    const along = (sx - markX) / (ax - markX);
    const t = (ratio * along) / (1 + (ratio - 1) * along);
    return [
      l[0] + t * (r[0] - l[0]) + (sy - markY) * (vl[0] + t * (vr[0] - vl[0])),
      l[1] + t * (r[1] - l[1]) + (sy - markY) * (vl[1] + t * (vr[1] - vl[1])),
    ];
  };
  const scalePinned = (row: number) =>
    (Math.hypot(right[row][0] - left[row][0], right[row][1] - left[row][1]) / (ax - markX) + scaleRight(row)) / 2;
  return measureRows(L, w, h, rows, W, rowH, lay, pinned, scalePinned);
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
  const darkBelow = 0.42 * paper;
  const columns = patchColumns(solidBlobs(L, w, h, darkBelow));
  if (columns.length === 0) return "not_found";

  // The 90% patches can be solid enough to make a column of their own, and the photo can be upside down: the
  // right column, the right way round, is the one with paper and rising greys where the layout says
  for (const column of columns.slice(0, 6)) {
    for (const anchors of [column, [...column].reverse()]) {
      const reading = readColumn(L, w, h, anchors, W, rowH, darkBelow);
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
  curve: Uint8ClampedArray | undefined,
  marks: boolean,
): Float64Array[] => {
  const lay = greyRowLayout(W, rowH, 8, marks);
  const H = lay.bottom - lay.top;
  let band = new ImageData(W, H);
  band.data.fill(255);
  GREY_TEST_LEVELS.forEach((level, i) => {
    const v = Math.round(255 * (1 - level / 100));
    const x0 = lay.x0 + i * (lay.pw + lay.gap);
    for (let y = 0; y < H; y++) for (let x = x0; x < x0 + lay.pw; x++) band.data.fill(v, (y * W + x) * 4, (y * W + x) * 4 + 3);
  });
  for (let y = 0; y < H; y++) for (let x = lay.markX; x < lay.markX + lay.markW; x++) band.data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
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
  /** Whether the strip has the marks left of the patches, as `readGreyStrip` says */
  marks: boolean;
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
      counts: patchDotCounts(W, rowH, GREY_TEST_MODES[r].dither, s.curves?.[r], s.marks),
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
