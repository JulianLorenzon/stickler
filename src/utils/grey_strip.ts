/**
 * The grey test without the drawing: its layout, reading it back from a photo, and fitting a dot model to what was
 * read. No DOM in here, so the same code runs in the app and in tools/dot-gain (Node).
 *
 * The test is made of rows, one per dither mode. A row stands on its own: a solid mark at its left end and the solid
 * 100% patch at its right end pin it down in a photo, and four small cells in its corners say which row it is. So
 * it doesn't matter whether the rows are one piece (a continuous roll) or a label each, how big the labels are, or
 * whether they are photographed together or one after another.
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
 * Where the patches sit in one W x H row of the grey test. `marks` false gives the strip as app 1.1.0 printed it
 * (no mark, no code), which can still be read when its four rows are one piece.
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

/** Middle of patch `i` along the row, dots */
const patchX = (lay: GreyRowLayout, i: number) => lay.x0 + i * (lay.pw + lay.gap) + lay.pw / 2;

/** Size of a code cell, dots */
export const CODE_CELL = { w: 12, h: 10 };

/**
 * The code of a row: four cells, above and below the mark and above and below the 100% patch, solid for 1. Below
 * the mark and below the patch: the row's number (bit 0, bit 1). Above the mark: printed with dot correction. Above
 * the patch: always solid, which tells a coded row from anything else with a mark-like bar next to a dark box.
 * Returns the middle of each cell (dots) and whether it's solid.
 */
export const greyRowCode = (lay: GreyRowLayout, H: number, row: number, corrected: boolean) => {
  const left = lay.markX + lay.markW / 2, right = patchX(lay, lay.n - 1);
  const head = lay.top / 2, foot = (lay.bottom + H) / 2;
  return [
    { x: left, y: foot, on: (row & 1) === 1 },
    { x: right, y: foot, on: (row & 2) === 2 },
    { x: left, y: head, on: corrected },
    { x: right, y: head, on: true },
  ];
};

/**
 * Blank paper inside a row, to measure the patches against: right of the mode name, and under the patches that
 * have no number below them (numbers are only printed under 10, 50 and 90). Middles in dots.
 */
export const GREY_NUMBERED = [0, 4, 8];
const paperSpots = (lay: GreyRowLayout, W: number, H: number): Pt[] => [
  [0.7 * W, lay.top / 2],
  [0.8 * W, lay.top / 2],
  ...[1, 2, 3, 5, 6, 7].map((i): Pt => [patchX(lay, i), (lay.bottom + H) / 2]),
];
/** The mode name has to stay left of this (dots), clear of the paper spots */
export const greyTitleRoom = (lay: GreyRowLayout, W: number) => 0.7 * W - 8 - lay.x0;

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

export type Pt = [number, number];
/** Corners of a sampled box in photo pixels, to draw over the photo */
export type Quad = [Pt, Pt, Pt, Pt];

/** Nothing in the photo that reads as a row of the grey test */
export type StripFailure = "not_found";

export interface RowReading {
  /** Which row: index into GREY_TEST_MODES */
  mode: number;
  /** Printed with dot correction (from the row's code) */
  corrected: boolean;
  /** Darkness of the 10..90% patches: 0 = paper, 1 = the row's solid patch */
  measured: number[];
  /** Photo pixels per printer dot */
  scale: number;
  /** How uneven the light is: darkest / brightest paper sample */
  paperEvenness: number;
  /** Solid patch brightness relative to the paper (how black the black is in this photo) */
  black: number;
  patchBoxes: Quad[];
  paperBoxes: Quad[];
  /** Where the row is in the photo, about: its top left corner and one dot along and down it, photo pixels */
  frame: { origin: Pt; u: Pt; v: Pt };
}

export interface StripReading {
  /** The rows found, by mode, each mode once */
  rows: RowReading[];
  /** Every mode is there */
  complete: boolean;
  /** Per mode, `rows[].measured` (only all there when `complete`) */
  measured: number[][];
  /** Rows with mark and code; false for a strip of app 1.1.0. The fit has to know */
  marks: boolean;
  corrected: boolean;
  /** Smallest scale and paper evenness among the rows */
  scale: number;
  paperEvenness: number;
}

interface Blob {
  x: number;
  y: number;
  cells: number;
  /** Direction of its long side */
  axis: Pt;
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
  // Small cells, so the print can be small in the picture: a patch still covers 16 of them at about 1 px per dot
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
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, minX = gw, maxX = 0, minY = gh, maxY = 0;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % gw, py = (p / gw) | 0;
      n++, (sx += px), (sy += py), (sxx += px * px), (syy += py * py), (sxy += px * py);
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
    if (atEdge || n < 16 || n < 0.5 * bw * bh || Math.max(bw, bh) > 4 * Math.min(bw, bh)) continue;
    // The long axis of the blob, from how its cells are spread
    const mx = sx / n, my = sy / n;
    const angle = 0.5 * Math.atan2(2 * (sxy / n - mx * my), sxx / n - mx * mx - (syy / n - my * my));
    blobs.push({ x: (mx + 0.5) * c, y: (my + 0.5) * c, cells: n * c * c, axis: [Math.cos(angle), Math.sin(angle)] });
  }
  return blobs.sort((a, b) => b.cells - a.cells).slice(0, 24);
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

type Mapper = (sx: number, sy: number) => Pt;

/**
 * Measures one row given where its points are in the photo: paper spots, then the patches against the paper around
 * them and the row's solid patch. Undefined when it doesn't look like a row (paper where patches should be, or the
 * reverse, or it leaves the photo).
 */
const measureRow = (
  L: Float32Array,
  w: number,
  h: number,
  lay: GreyRowLayout,
  spots: Pt[],
  toPhoto: Mapper,
  scale: number,
): Pick<RowReading, "measured" | "paperEvenness" | "black" | "patchBoxes" | "paperBoxes"> | undefined => {
  const centerY = (lay.top + lay.bottom) / 2;
  /** Mean brightness of a box around a row point (half sizes in dots), or undefined when it leaves the photo */
  const boxMean = (sx: number, sy: number, hw: number, hh: number): number | undefined => {
    const step = 1 / Math.max(1, scale);
    let sum = 0, n = 0;
    for (let dy = -hh; dy <= hh; dy += step) {
      for (let dx = -hw; dx <= hw; dx += step) {
        const [x, y] = toPhoto(sx + dx, sy + dy);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) return undefined;
        sum += L[yi * w + xi];
        n++;
      }
    }
    return sum / n;
  };
  const quad = (sx: number, sy: number, hw: number, hh: number): Quad => [
    toPhoto(sx - hw, sy - hh),
    toPhoto(sx + hw, sy - hh),
    toPhoto(sx + hw, sy + hh),
    toPhoto(sx - hw, sy + hh),
  ];

  const paperPts: Pt[] = [], paperVals: number[] = [], paperBoxes: Quad[] = [];
  for (const [sx, sy] of spots) {
    const val = boxMean(sx, sy, 4, 3);
    if (val === undefined) continue;
    paperPts.push(toPhoto(sx, sy));
    paperVals.push(val);
    paperBoxes.push(quad(sx, sy, 4, 3));
  }
  if (paperVals.length < spots.length * 0.7) return undefined;
  const sorted = [...paperVals].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  // Light falls off across a photo: a smooth paper brightness (a plane; a row is small), fitted without the odd
  // sample that landed on something else
  const terms = ([x, y]: Pt) => [1, x / w, y / h];
  const keep = paperVals.map((v) => v > 0.6 * median);
  if (keep.filter(Boolean).length < Math.max(4, paperVals.length * 0.8)) return undefined;
  const X = paperPts.filter((_, i) => keep[i]).map(terms);
  const Y = paperVals.filter((_, i) => keep[i]);
  const coef = leastSquares(X, Y);
  const paperAt = (p: Pt) => terms(p).reduce((s, t, i) => s + t * coef[i], 0);

  const refl: number[] = [], patchBoxes: Quad[] = [];
  for (let i = 0; i < lay.n; i++) {
    const hw = (lay.pw * SAMPLE_W) / 2, hh = ((lay.bottom - lay.top) * SAMPLE_H) / 2;
    const val = boxMean(patchX(lay, i), centerY, hw, hh);
    if (val === undefined) return undefined;
    refl.push(val / paperAt(toPhoto(patchX(lay, i), centerY)));
    patchBoxes.push(quad(patchX(lay, i), centerY, hw, hh));
  }
  const black = refl[lay.n - 1];
  const dark = refl.slice(0, -1).map((r) => (1 - r) / (1 - black));
  // A row runs from nearly paper to nearly solid, and never gets clearly lighter on the way
  const drops = dark.filter((v, i) => i > 0 && v < dark[i - 1] - 0.08).length;
  if (black > 0.6 || dark[0] > 0.4 || dark[dark.length - 1] < 0.6 || drops > 1) return undefined;

  return { measured: dark, paperEvenness: Math.min(...Y) / Math.max(...Y), black, patchBoxes, paperBoxes };
};

const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + k * b[0], a[1] + k * b[1]];
const unit = (a: Pt): Pt => {
  const len = Math.hypot(a[0], a[1]);
  return [a[0] / len, a[1] / len];
};
/** The direction along a row whose "down" is `n` (a photo isn't mirrored) */
const rightOf = (n: Pt): Pt => [n[1], -n[0]];

/**
 * A row with mark and code, given a point in solid ink that may be in its 100% patch and a guess of which way is
 * down the row. Undefined when there's no such row there.
 *
 * The patch's top, bottom and right edge place the right end of the row and give the scale; the mark is looked for
 * along the row where that puts it, and its edges place the left end. The row then runs from mark to patch. A tilted
 * phone sees one end bigger than the other and the patches in between unevenly spaced: the heights of mark and
 * patch say by how much, so the row is laid out in perspective.
 */
const readCodedRow = (
  L: Float32Array,
  w: number,
  h: number,
  start: Pt,
  down: Pt,
  reach: number,
  tried: Set<number>,
  W: number,
  H: number,
  paper: number,
): RowReading | undefined => {
  const lay = greyRowLayout(W, H);
  const patchH = lay.bottom - lay.top;
  const cy = (lay.top + lay.bottom) / 2;
  const ax = patchX(lay, lay.n - 1), markX = lay.markX + lay.markW / 2;
  // An edge between solid ink and paper sits where the brightness is halfway
  const edgeAt = 0.55 * paper, darkBelow = 0.42 * paper;

  const lum = (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi + 1 >= w || yi + 1 >= h) return NaN;
    const fx = x - xi, fy = y - yi, o = yi * w + xi;
    return (L[o] * (1 - fx) + L[o + 1] * fx) * (1 - fy) + (L[o + w] * (1 - fx) + L[o + w + 1] * fx) * fy;
  };
  /**
   * From a point in solid ink, how far it is along `dir` to the edge of the ink (photo pixels), looking at a band
   * `half` wide to each side. Undefined when the point isn't in ink or no edge comes within `far`.
   */
  const edge = (from: Pt, dir: Pt, half: number, far: number): number | undefined => {
    const side = rightOf(dir);
    const band = (t: number) => {
      let sum = 0, n = 0;
      for (let k = -half; k <= half; k += 1) {
        sum += lum(from[0] + dir[0] * t + side[0] * k, from[1] + dir[1] * t + side[1] * k);
        n++;
      }
      return sum / n;
    };
    let before = band(0);
    if (!(before < edgeAt)) return undefined;
    for (let t = 0.5; t <= far; t += 0.5) {
      const now = band(t);
      if (Number.isNaN(now)) return undefined;
      if (now >= edgeAt) return t - 0.5 + (0.5 * (edgeAt - before)) / (now - before);
      before = now;
    }
    return undefined;
  };

  let n = down;
  let left: Pt | undefined, right: Pt | undefined, leftH = 0, rightH = 0;
  // Twice: the second time with "down" square to the row found the first time, instead of the blob's own direction
  for (let pass = 0; pass < 2; pass++) {
    const from: Pt = right ?? start;
    // `reach`: how far the patch's edges can be from a point inside it, photo pixels
    const far = reach;
    let up = edge(from, [-n[0], -n[1]], 1.5, far), dn = edge(from, n, 1.5, far);
    if (up === undefined || dn === undefined) return undefined;
    if (pass === 0) {
      // The blob's direction is only a start (a blob that took in the 90% patch is nearly square and has none):
      // turn "down" until the patch's top edge is square to it, going by how far away that edge is at two places
      for (let turn = 0; turn < 3; turn++) {
        const k = (0.12 * lay.pw * (up + dn)) / patchH;
        const side = rightOf(n);
        const a = edge(add(from, side, k), [-n[0], -n[1]], 1, far), b = edge(add(from, side, -k), [-n[0], -n[1]], 1, far);
        if (a === undefined || b === undefined) break;
        const along = unit([side[0] * 2 * k - n[0] * (a - b), side[1] * 2 * k - n[1] * (a - b)]);
        n = [-along[1], along[0]];
        const up2 = edge(from, [-n[0], -n[1]], 1.5, far), dn2 = edge(from, n, 1.5, far);
        if (up2 === undefined || dn2 === undefined) return undefined;
        (up = up2), (dn = dn2);
      }
      // Many starts end up square to the same edge: what follows is only worth doing once for each
      const key = Math.round(Math.atan2(n[1], n[0]) / (Math.PI / 60));
      if (tried.has(key)) return undefined;
      tried.add(key);
    }
    rightH = up + dn;
    const s = rightH / patchH;
    if (s < 0.5) return undefined;
    const u = rightOf(n);
    const mid = add(from, n, (dn - up) / 2);
    // The patch's left edge runs into the 90% patch; its right edge is clean
    const toEdge = edge(mid, u, rightH * 0.25, lay.pw * s * 1.5 + 4);
    if (toEdge === undefined) return undefined;
    right = add(mid, u, toEdge - (lay.pw * s) / 2);

    // The mark along the row as guessed from this end: a dark stretch about as long as the mark is wide, with paper
    // on both sides. The guess can be well off at that end, so this looks from left of the mark to a few patches in
    const guess: Mapper = (sx, sy) => add(add(right!, u, (sx - ax) * s), n, (sy - cy) * s);
    const step = 0.5, first = markX - 60, end = markX + 90;
    const profile: number[] = [];
    for (let sx = first; sx <= end; sx += step) {
      let sum = 0, cnt = 0;
      for (let dy = -12; dy <= 12; dy += 2) {
        const v = lum(...guess(sx, cy + dy));
        if (!Number.isNaN(v)) (sum += v), cnt++;
      }
      profile.push(cnt > 0 ? sum / cnt : 0);
    }
    const around = (i: number) => profile[Math.max(0, Math.min(profile.length - 1, i))];
    let found: number | undefined;
    for (let i = 0; i < profile.length && found === undefined; i++) {
      if (profile[i] >= darkBelow) continue;
      let j = i;
      while (j + 1 < profile.length && profile[j + 1] < darkBelow * 1.3) j++;
      const length = (j - i + 1) * step;
      if (i > 0 && length > lay.markW * 0.5 && length < lay.markW * 1.8 && around(i - 8) > 0.65 * paper && around(j + 5) > 0.65 * paper) {
        found = first + ((i + j) / 2) * step;
      }
      i = j;
    }
    if (found === undefined) return undefined;

    const inMark = guess(found, cy);
    const mUp = edge(inMark, [-n[0], -n[1]], lay.markW * s * 0.25, patchH * s * 1.5);
    const mDn = edge(inMark, n, lay.markW * s * 0.25, patchH * s * 1.5);
    if (mUp === undefined || mDn === undefined) return undefined;
    leftH = mUp + mDn;
    if (leftH < 0.6 * rightH || leftH > 1.6 * rightH) return undefined;
    const mMid = add(inMark, n, (mDn - mUp) / 2);
    const mL = edge(mMid, [-u[0], -u[1]], leftH * 0.25, lay.markW * s * 2), mR = edge(mMid, u, leftH * 0.25, lay.markW * s * 2);
    if (mL === undefined || mR === undefined) return undefined;
    if (mL + mR < lay.markW * s * 0.5 || mL + mR > lay.markW * s * 1.8) return undefined;
    left = add(mMid, u, (mR - mL) / 2);

    const along = unit([right[0] - left[0], right[1] - left[1]]);
    const square: Pt = [-along[1], along[0]];
    n = square[0] * n[0] + square[1] * n[1] > 0 ? square : [-square[0], -square[1]];
  }
  if (!left || !right) return undefined;

  const l = left, r = right;
  const vl: Pt = [(n[0] * leftH) / patchH, (n[1] * leftH) / patchH], vr: Pt = [(n[0] * rightH) / patchH, (n[1] * rightH) / patchH];
  const ratio = leftH / rightH;
  const toPhoto: Mapper = (sx, sy) => {
    const a = (sx - markX) / (ax - markX);
    const t = (ratio * a) / (1 + (ratio - 1) * a);
    return [
      l[0] + t * (r[0] - l[0]) + (sy - cy) * (vl[0] + t * (vr[0] - vl[0])),
      l[1] + t * (r[1] - l[1]) + (sy - cy) * (vl[1] + t * (vr[1] - vl[1])),
    ];
  };
  const span = Math.hypot(r[0] - l[0], r[1] - l[1]) / (ax - markX);
  const scale = (span + (leftH + rightH) / 2 / patchH) / 2;

  // The code
  const cells = greyRowCode(lay, H, 0, false).map((cell) => {
    let sum = 0, cnt = 0;
    for (let dy = -2.5; dy <= 2.5; dy += 1.25) {
      for (let dx = -3; dx <= 3; dx += 1.5) {
        const v = lum(...toPhoto(cell.x + dx, cell.y + dy));
        if (!Number.isNaN(v)) (sum += v), cnt++;
      }
    }
    return cnt > 0 && sum / cnt < edgeAt;
  });
  if (!cells[3]) return undefined;
  const mode = (cells[0] ? 1 : 0) + (cells[1] ? 2 : 0);

  const read = measureRow(L, w, h, lay, paperSpots(lay, W, H), toPhoto, scale);
  if (!read) return undefined;
  const u: Pt = [(r[0] - l[0]) / (ax - markX), (r[1] - l[1]) / (ax - markX)];
  const v: Pt = [(vl[0] + vr[0]) / 2, (vl[1] + vr[1]) / 2];
  const middle = toPhoto(W / 2, H / 2);
  return {
    ...read,
    mode,
    corrected: cells[2],
    scale,
    frame: { origin: [middle[0] - (W / 2) * u[0] - (H / 2) * v[0], middle[1] - (W / 2) * u[1] - (H / 2) * v[1]], u, v },
  };
};

/**
 * A strip of app 1.1.0 (no marks, no code) with the solid patches at `anchors`, first row first. The patches give
 * the right end of every row and, from one row to the next, the direction and scale down the strip; a row is taken
 * to run square to that at the same scale. Undefined when it doesn't look like the strip this way round.
 */
const readPlainColumn = (
  L: Float32Array,
  w: number,
  h: number,
  anchors: Blob[],
  W: number,
  rowH: number,
): RowReading[] | undefined => {
  const lay = greyRowLayout(W, rowH, 8, false);
  const ax = patchX(lay, lay.n - 1), ay = (lay.top + lay.bottom) / 2;
  // Paper: the margins left and right of the print and the blank band right of the mode name
  const spots: Pt[] = [
    ...[0.27, 0.54, 0.76].flatMap((f): Pt[] => [[-14, f * rowH], [W + 14, f * rowH]]),
    ...[0.755, 0.833, 0.911, 0.977].map((f): Pt => [f * W, 0.09 * rowH]),
  ];
  const rows: RowReading[] = [];
  for (let row = 0; row < anchors.length; row++) {
    const i = Math.max(0, row - 1), j = Math.min(anchors.length - 1, row + 1);
    const v: Pt = [(anchors[j].x - anchors[i].x) / ((j - i) * rowH), (anchors[j].y - anchors[i].y) / ((j - i) * rowH)];
    const u = rightOf(v);
    const at: Pt = [anchors[row].x, anchors[row].y];
    const toPhoto: Mapper = (sx, sy) => add(add(at, u, sx - ax), v, sy - ay);
    const scale = Math.hypot(v[0], v[1]);
    const read = measureRow(L, w, h, lay, spots, toPhoto, scale);
    if (!read) return undefined;
    rows.push({ ...read, mode: row, corrected: false, scale, frame: { origin: toPhoto(0, 0), u, v } });
  }
  return rows;
};

/**
 * Finds the rows of the grey test in a photo and measures their patches against the paper around them. The photo can
 * be any way up and hold any number of the rows. `W` and `rowH` are the width and height of a row in dots: the
 * label the test was printed on, or the roll's width and the row height used on rolls.
 */
export const readGreyStrip = (photo: Pixels, W: number, rowH: number): StripReading | StripFailure => {
  const { width: w, height: h } = photo;
  const L = luminance(photo);
  // Paper is the brightest part of the photo, even when the print is small on a dark table (a few percent of the
  // picture); solid ink is well under half of it
  const paper = percentile(L, 0.97);
  const blobs = solidBlobs(L, w, h, 0.42 * paper);

  // Every solid blob could be a row's 100% patch, with the row going off any way: along the blob's sides first, then
  // every 22.5 degrees. Its middle can sit on the gap to the 90% patch when the blob took that in, so a few places
  // around the middle are tried too
  const byMode = new Map<number, RowReading>();
  for (const blob of blobs) {
    const angle = Math.atan2(blob.axis[1], blob.axis[0]);
    const q = 0.2 * Math.sqrt(blob.cells);
    // A patch is at most 1 : 4, and the cells miss its rim
    const reach = 3 * Math.sqrt(blob.cells) + 8;
    const tried = new Set<number>();
    let row: RowReading | undefined;
    search: for (const [ox, oy] of [[0, 0], [q, 0], [-q, 0], [0, q], [0, -q]]) {
      for (const k of [0, 4, 8, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15]) {
        const a = angle + (k * Math.PI) / 8;
        row = readCodedRow(L, w, h, [blob.x + ox, blob.y + oy], [Math.cos(a), Math.sin(a)], reach, tried, W, rowH, paper);
        if (row) break search;
      }
    }
    if (!row) continue;
    const have = byMode.get(row.mode);
    if (!have || row.scale > have.scale) byMode.set(row.mode, row);
  }
  let rows = [...byMode.values()].sort((a, b) => a.mode - b.mode);
  let marks = true;

  if (rows.length === 0) {
    // A strip from before the marks: four solid patches in a column. The 90% patches can be solid enough to make
    // a column of their own, and the photo can be upside down: the right column, the right way round, is the one
    // with paper and rising greys where the layout says
    marks = false;
    for (const column of patchColumns(blobs).slice(0, 6)) {
      const found = readPlainColumn(L, w, h, column, W, rowH) ?? readPlainColumn(L, w, h, [...column].reverse(), W, rowH);
      if (found) {
        rows = found;
        break;
      }
    }
  }
  if (rows.length === 0) return "not_found";

  return {
    rows,
    complete: rows.length === GREY_TEST_MODES.length,
    measured: rows.map((r) => r.measured),
    marks,
    corrected: rows.some((r) => r.corrected),
    scale: Math.min(...rows.map((r) => r.scale)),
    paperEvenness: Math.min(...rows.map((r) => r.paperEvenness)),
  };
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
  /** Rows with mark and code, as `readGreyStrip` says */
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
