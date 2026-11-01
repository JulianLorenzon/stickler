export const copyImageData = (iData: ImageData): ImageData => {
  return new ImageData(new Uint8ClampedArray(iData.data), iData.width, iData.height);
};

// Original code is taken from https://github.com/NielsLeenheer/CanvasDither
// (but it is has typescript definitions and Atkinson threshold)

/**
 * Change the image to blank and white using a simple threshold
 *
 *
 * @param  {object}   image         The imageData of a Canvas 2d context
 * @param  {number}   threshold     Threshold value (0-255)
 * @return {object}                 The resulting imageData
 *
 */
export const threshold = (image: ImageData, threshold: number): ImageData => {
  for (let i = 0; i < image.data.length; i += 4) {
    const luminance = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const value = luminance < threshold ? 0 : 255;
    image.data.fill(value, i, i + 3);
  }

  return image;
};

/**
 * Change the image to blank and white using the Atkinson algorithm
 *
 * @param  {object}   image         The imageData of a Canvas 2d context
 * @param  {number}   threshold     Threshold value (0-255)
 * @return {object}                 The resulting imageData
 *
 */
export const atkinson = (image: ImageData, threshold: number): ImageData => {
  const src = image.data;
  // Float buffer: a clamped buffer silently drops diffused error near black and white
  const dst = new Float32Array(image.width * image.height);

  for (let l = 0, i = 0; i < src.length; l++, i += 4) {
    dst[l] = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
  }

  for (let l = 0, i = 0; i < src.length; l++, i += 4) {
    const value = dst[l] < threshold ? 0 : 255;
    const error = (dst[l] - value) / 8;
    src.fill(value, i, i + 3);

    dst[l + 1] += error;
    dst[l + 2] += error;
    dst[l + image.width - 1] += error;
    dst[l + image.width] += error;
    dst[l + image.width + 1] += error;
    dst[l + 2 * image.width] += error;
  }

  return image;
};

/**
 * Change the image to blank and white using the Bayer ordered dithering
 *
 * @param  {object}   image         The imageData of a Canvas 2d context
 * @param  {number}   threshold     Threshold value (0-255)
 * @return {object}                 The resulting imageData
 *
 */
export const bayer = (image: ImageData, threshold: number): ImageData => {
  const src = image.data;
  const width = image.width;

  // Pre-calculated 8x8 Bayer matrix (normalized to 0-255)
  const bayerMatrix = [
    [0, 191, 48, 239, 12, 203, 60, 251],
    [128, 64, 176, 112, 140, 76, 188, 124],
    [32, 223, 16, 207, 44, 235, 28, 219],
    [160, 96, 144, 80, 172, 108, 156, 92],
    [8, 199, 56, 247, 4, 195, 52, 243],
    [136, 72, 184, 120, 132, 68, 180, 116],
    [40, 231, 24, 215, 36, 227, 20, 211],
    [168, 104, 152, 88, 164, 100, 148, 84]
  ];

  for (let i = 0; i < src.length; i += 4) {
    const x = (i / 4) % width;
    const y = Math.floor((i / 4) / width);

    const gray = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
    const bayerValue = bayerMatrix[y % 8][x % 8];
    const value = gray < threshold - bayerValue / 2 ? 0 : 255;

    src[i] = src[i + 1] = src[i + 2] = value;
  }

  return image;
};

/**
 * Invert image
 *
 * @param  {object}   image         The imageData of a Canvas 2d context
 * @return {object}                 The resulting imageData
 *
 */
export const invert = (image: ImageData): ImageData => {
  for (let i = 0; i < image.data.length; i += 4) {
    const black = (image.data[i] + image.data[i + 1] + image.data[i + 2]) === 0;
    image.data.fill(black ? 255 : 0, i, i + 3);
  }

  return image;
};

const luminance = (px: Uint8ClampedArray, i: number): number =>
  px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;

/**
 * Lighten or darken the greys with a gamma curve, keeping pure black and white. `value` uses the threshold scale:
 * 128 leaves the image as it is, higher is darker, lower is lighter (255 ≈ gamma 4, 1 ≈ gamma 0.25).
 * Used instead of the threshold for Floyd-Steinberg, which passes every pixel's rounding error on to its
 * neighbours and so keeps the average grey no matter where the threshold is.
 */
/** Map every grey through a 256-entry table (from `dotGainCurve`), only where `mask` is set if given */
export const applyCurve = (image: ImageData, curve: Uint8ClampedArray, mask?: Uint8Array): ImageData => {
  const px = image.data;
  for (let l = 0, i = 0; i < px.length; l++, i += 4) {
    if (mask === undefined || mask[l] === 1) px.fill(curve[Math.round(luminance(px, i))], i, i + 3);
  }
  return image;
};

export const tone = (image: ImageData, value: number): ImageData => {
  const gamma = Math.pow(2, (value - 128) / 64);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.round(255 * Math.pow(v / 255, gamma));
  }

  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    px.fill(lut[Math.round(luminance(px, i))], i, i + 3);
  }

  return image;
};

/**
 * Floyd-Steinberg error diffusion (7/16, 3/16, 5/16, 1/16), as in the printer SDK bundled with the official app.
 * Pixels outside `mask` (when given) are left untouched and receive no error.
 */
export const floydSteinberg = (image: ImageData, threshold: number = 128, mask?: Uint8Array): ImageData => {
  const { width: w, height: h, data: px } = image;
  const gray = new Float32Array(w * h);

  for (let l = 0, i = 0; l < gray.length; l++, i += 4) {
    gray[l] = luminance(px, i);
  }

  const inside = (l: number) => mask === undefined || mask[l] === 1;

  // Serpentine scan (alternating row direction) avoids the directional "worm" artifacts of plain raster order
  for (let y = 0; y < h; y++) {
    const dir = y % 2 === 0 ? 1 : -1;
    for (let i = 0; i < w; i++) {
      const x = dir === 1 ? i : w - 1 - i;
      const l = y * w + x;
      if (!inside(l)) continue;

      const old = gray[l];
      const value = old < threshold ? 0 : 255;
      const err = old - value;
      px.fill(value, l * 4, l * 4 + 3);

      const ahead = x + dir;
      const behind = x - dir;
      if (ahead >= 0 && ahead < w && inside(l + dir)) gray[l + dir] += (err * 7) / 16;
      if (y + 1 < h) {
        if (behind >= 0 && behind < w && inside(l + w - dir)) gray[l + w - dir] += (err * 3) / 16;
        if (inside(l + w)) gray[l + w] += (err * 5) / 16;
        if (ahead >= 0 && ahead < w && inside(l + w + dir)) gray[l + w + dir] += err / 16;
      }
    }
  }

  return image;
};

const BLUE_NOISE_SIZE = 64;
let blueNoiseMap: Float32Array | undefined;

/** Small seeded PRNG (mulberry32), so the blue noise map is the same on every run */
const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A 64×64 tileable blue noise threshold map, values spread evenly over 0-255. Made on first use with Ulichney's
 * void-and-cluster method: points are ranked so that every prefix of the ranking is as evenly spread as possible.
 */
export const blueNoise = (): Float32Array => {
  if (blueNoiseMap !== undefined) return blueNoiseMap;

  const S = BLUE_NOISE_SIZE;
  const n = S * S;
  const sigma = 1.5;
  const R = 6;

  // Gaussian "energy" of the points around each cell, wrapping around the edges so the map tiles
  const kernel = new Float64Array((2 * R + 1) * (2 * R + 1));
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      kernel[(dy + R) * (2 * R + 1) + dx + R] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }

  const energy = new Float64Array(n);
  const pattern = new Uint8Array(n);
  const set = (i: number, on: boolean) => {
    pattern[i] = on ? 1 : 0;
    const x = i % S;
    const y = (i / S) | 0;
    for (let dy = -R; dy <= R; dy++) {
      const row = ((y + dy + S) % S) * S;
      for (let dx = -R; dx <= R; dx++) {
        energy[row + ((x + dx + S) % S)] += (on ? 1 : -1) * kernel[(dy + R) * (2 * R + 1) + dx + R];
      }
    }
  };
  const tightestCluster = () => {
    let best = 0;
    for (let i = 0, e = -Infinity; i < n; i++) if (pattern[i] && energy[i] > e) (e = energy[i]), (best = i);
    return best;
  };
  const largestVoid = () => {
    let best = 0;
    for (let i = 0, e = Infinity; i < n; i++) if (!pattern[i] && energy[i] < e) (e = energy[i]), (best = i);
    return best;
  };

  // Random starting points, then move the most crowded one into the emptiest spot until that changes nothing
  const random = seededRandom(1);
  let ones = 0;
  while (ones < n / 10) {
    const i = Math.floor(random() * n);
    if (!pattern[i]) set(i, true), ones++;
  }
  for (;;) {
    const cluster = tightestCluster();
    set(cluster, false);
    const empty = largestVoid();
    set(empty, true);
    if (empty === cluster) break;
  }

  const rank = new Uint16Array(n);
  const prototype = pattern.slice();
  const prototypeEnergy = energy.slice();

  // Rank the starting points by taking them out from the most crowded down
  for (let r = ones - 1; r >= 0; r--) {
    const cluster = tightestCluster();
    set(cluster, false);
    rank[cluster] = r;
  }

  // Then fill the emptiest spot until the map is full. Past the halfway point Ulichney switches to the most crowded
  // empty cell, but with a fixed kernel that is the same cell, so one loop covers both.
  pattern.set(prototype);
  energy.set(prototypeEnergy);
  for (let r = ones; r < n; r++) {
    const empty = largestVoid();
    set(empty, true);
    rank[empty] = r;
  }

  blueNoiseMap = Float32Array.from(rank, (r) => ((r + 0.5) * 255) / n);
  return blueNoiseMap;
};

/**
 * Ordered dithering with the blue noise map: no grid pattern like Bayer and no streaks like error diffusion. Like
 * Floyd-Steinberg it keeps the average grey, so lighten or darken with `tone()` first.
 */
export const blueNoiseDither = (image: ImageData): ImageData => {
  const { width: w, data: px } = image;
  const map = blueNoise();
  const S = BLUE_NOISE_SIZE;

  for (let l = 0, i = 0; i < px.length; l++, i += 4) {
    const x = l % w;
    const y = (l / w) | 0;
    px.fill(luminance(px, i) < map[(y % S) * S + (x % S)] ? 0 : 255, i, i + 3);
  }

  return image;
};

const WERNESS_PHASES = 8;
const WERNESS_RADIUS = 2;

/**
 * Werness dithering, as Lucas Pope describes Brent Werness's method for Return of the Obra Dinn: blue noise
 * thresholding mixed with error diffusion, done in phases. There is no published reference, so this is our reading:
 * the blue noise map splits the pixels into evenly spread phases; the first phase is thresholded against the noise,
 * every later pixel is thresholded at 128 after taking in the error of its neighbours from earlier phases, and each
 * pixel's error is shared out (Gaussian weights) over its neighbours in later phases, in every direction. The
 * original gathers the error in a shader instead of pushing it; the result is the same. The devlog mentions two
 * phases; here that pushed the contrast, 8 keeps the greys as well as Floyd-Steinberg does.
 */
export const werness = (image: ImageData): ImageData => {
  const { width: w, height: h, data: px } = image;
  const map = blueNoise();
  const S = BLUE_NOISE_SIZE;
  const P = WERNESS_PHASES;
  const R = WERNESS_RADIUS;

  const gray = new Float32Array(w * h);
  const noise = new Float32Array(w * h);
  const phase = new Uint8Array(w * h);
  for (let l = 0, i = 0; l < gray.length; l++, i += 4) {
    gray[l] = luminance(px, i);
    noise[l] = map[(((l / w) | 0) % S) * S + ((l % w) % S)];
    phase[l] = Math.floor((noise[l] * P) / 255);
  }

  const weight = (dx: number, dy: number) => Math.exp(-(dx * dx + dy * dy) / 2);

  for (let k = 0; k < P; k++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = y * w + x;
        if (phase[l] !== k) continue;

        // The first phase holds the lowest 1/P of the noise values; stretch those back to 0-255
        const value = gray[l] < (k === 0 ? noise[l] * P : 128) ? 0 : 255;
        px.fill(value, l * 4, l * 4 + 3);

        let total = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && phase[ny * w + nx] > k) total += weight(dx, dy);
          }
        }
        if (total === 0) continue;

        const err = (gray[l] - value) / total;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && phase[ny * w + nx] > k) {
              gray[ny * w + nx] += err * weight(dx, dy);
            }
          }
        }
      }
    }
  }

  return image;
};

/**
 * Stretch luminance so the darkest/brightest `cutoff` share of pixels map to black/white,
 * like PIL's ImageOps.autocontrast. Makes washed-out photos dither with real blacks and whites.
 */
export const autocontrast = (image: ImageData, cutoff: number = 0.01, mask?: Uint8Array): ImageData => {
  const px = image.data;
  const hist = new Uint32Array(256);
  let total = 0;

  for (let l = 0, i = 0; i < px.length; l++, i += 4) {
    if (mask !== undefined && mask[l] !== 1) continue;
    hist[Math.round(luminance(px, i))]++;
    total++;
  }

  if (total === 0) return image;

  const cut = total * cutoff;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && acc + hist[lo] <= cut; lo++) acc += hist[lo];
  for (let acc = 0; hi > 0 && acc + hist[hi] <= cut; hi--) acc += hist[hi];
  if (hi <= lo) return image;

  const scale = 255 / (hi - lo);
  for (let l = 0, i = 0; i < px.length; l++, i += 4) {
    if (mask !== undefined && mask[l] !== 1) continue;
    const v = Math.min(255, Math.max(0, (luminance(px, i) - lo) * scale));
    px.fill(v, i, i + 3);
  }

  return image;
};

/**
 * "Auto" mode. The official app's default label mode thresholds everything at 128, photos included. Here text
 * and shapes are thresholded the same way so edges stay crisp, while photos are contrast-stretched and dithered.
 * `label` is the full render; `photos` holds only the visible photo pixels on a transparent background, its alpha
 * marks where a photo is on top.
 */
export const smartProcess = (
  label: ImageData,
  photos: ImageData | undefined,
  thresholdValue: number,
  /** Dot gain correction for the dithered photos */
  curve?: Uint8ClampedArray,
): ImageData => {
  const out = threshold(label, thresholdValue);

  if (photos === undefined) return out;

  const mask = new Uint8Array(photos.width * photos.height);
  for (let l = 0; l < mask.length; l++) {
    mask[l] = photos.data[l * 4 + 3] > 127 ? 1 : 0;
  }

  autocontrast(photos, 0.01, mask);
  if (curve) applyCurve(photos, curve, mask);
  floydSteinberg(photos, 128, mask);

  for (let l = 0, i = 0; l < mask.length; l++, i += 4) {
    if (mask[l] === 1) {
      out.data.fill(photos.data[i], i, i + 3);
    }
  }

  return out;
};
