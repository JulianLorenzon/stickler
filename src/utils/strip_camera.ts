import { mount, unmount } from "svelte";
import StripCamera from "$/components/StripCamera.svelte";
import type { Quad, RowReading } from "$/utils/grey_strip";

/** The grey test as the camera read it: several frames of every row put together */
export interface StripCapture {
  /** Per row (GREY_TEST_MODES order), darkness of the 10..90% patches: the median over the frames */
  measured: number[][];
  /** Rows with mark and code (false: a strip of app 1.1.0) */
  marks: boolean;
  /** Printed with dot correction: a check print */
  corrected: boolean;
  /** Width of a row as it was read, dots: not what was asked for when the labels turned out to be another size */
  width: number;
  /** Every row as last seen, with the measured boxes drawn in, as a data URL */
  overlay: string;
  /** Darkest / brightest paper sample (median over the frames) */
  paperEvenness: number;
}

export const strokeQuads = (ctx: CanvasRenderingContext2D, quads: Quad[], colour: string) => {
  ctx.strokeStyle = colour;
  for (const q of quads) {
    ctx.beginPath();
    q.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }
};

/** Width of the picture of a row, pixels */
const PICTURE_WIDTH = 1000;

/**
 * A row cut out of a photo or frame, turned upright and enlarged, with the boxes that were measured (red: patches,
 * blue: paper) as thin lines: the picture to check a reading by. `W` and `H` are the row's size in dots.
 */
export const rowPicture = (frame: CanvasImageSource, row: RowReading, W: number, H: number): HTMLCanvasElement => {
  const pad = 10;
  const zoom = PICTURE_WIDTH / (W + 2 * pad);
  const canvas = document.createElement("canvas");
  canvas.width = PICTURE_WIDTH;
  canvas.height = Math.round((H + 2 * pad) * zoom);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Photo pixel p = origin + sx * u + sy * v; the canvas wants the way back, from p to (sx + pad, sy + pad) * zoom
  const { origin, u, v } = row.frame;
  const det = u[0] * v[1] - v[0] * u[1];
  const a = (zoom * v[1]) / det, c = (-zoom * v[0]) / det, b = (-zoom * u[1]) / det, d = (zoom * u[0]) / det;
  ctx.setTransform(a, b, c, d, zoom * pad - (a * origin[0] + c * origin[1]), zoom * pad - (b * origin[0] + d * origin[1]));
  ctx.drawImage(frame, 0, 0);
  ctx.lineWidth = (2 * Math.sqrt(Math.abs(det))) / zoom;
  strokeQuads(ctx, row.paperBoxes, "#2a9df4");
  strokeQuads(ctx, row.patchBoxes, "#e53935");
  return canvas;
};

/** Row pictures one under the other, as a data URL */
export const stackPictures = (pictures: HTMLCanvasElement[]): string => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(...pictures.map((p) => p.width));
  canvas.height = pictures.reduce((h, p) => h + p.height, 0);
  const ctx = canvas.getContext("2d")!;
  let y = 0;
  for (const p of pictures) {
    ctx.drawImage(p, 0, y);
    y += p.height;
  }
  return canvas.toDataURL("image/jpeg", 0.85);
};

export const stripCameraAvailable = (): boolean => !!navigator.mediaDevices?.getUserMedia;

/**
 * Opens the camera screen and reads the grey test, rows of `width` x `rowHeight` dots, as they come into view:
 * `together` of them in one piece (4 on a roll, 1 for a label each). Resolves undefined if the user backs out;
 * rejects with the getUserMedia error if there's no camera to use.
 */
export const captureGreyStrip = (width: number, rowHeight: number, together: number): Promise<StripCapture | undefined> =>
  new Promise((resolve, reject) => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const component = mount(StripCamera, {
      target,
      props: {
        width,
        rowHeight,
        together,
        onDone: (result, error) => {
          // Unmount after this callback returns, not from inside the component
          setTimeout(() => {
            unmount(component);
            target.remove();
          });
          if (error !== undefined) reject(error);
          else resolve(result);
        },
      },
    });
  });
