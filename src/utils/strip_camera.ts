import { mount, unmount } from "svelte";
import StripCamera from "$/components/StripCamera.svelte";
import type { Quad, StripReading } from "$/utils/grey_strip";

/** The grey test as the camera read it: several frames put together */
export interface StripCapture {
  /** Per row, darkness of the 10..90% patches (median over the frames), as `readGreyStrip` gives it */
  measured: number[][];
  /** Whether the strip has the marks left of the patches */
  marks: boolean;
  /** The strip in the last frame with the measured boxes drawn in, as a data URL */
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

/**
 * The picture to check a reading by: the photo or frame cut down to the strip and enlarged, with the boxes that
 * were measured (red: patches, blue: paper) as thin lines, so it shows whether they sit where they should.
 */
export const stripOverlay = (frame: CanvasImageSource, reading: StripReading): string => {
  const pts = [...reading.patchBoxes, ...reading.paperBoxes].flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 12 * reading.scale;
  const x = Math.max(0, Math.min(...xs) - pad), y = Math.max(0, Math.min(...ys) - pad);
  const w = Math.max(...xs) + pad - x, h = Math.max(...ys) + pad - y;
  const zoom = Math.max(1, Math.min(4, 1200 / w));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * zoom);
  canvas.height = Math.round(h * zoom);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(frame, x, y, w, h, 0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  const moved = (quads: Quad[]) => quads.map((q) => q.map(([px, py]) => [(px - x) * zoom, (py - y) * zoom]) as Quad);
  strokeQuads(ctx, moved(reading.paperBoxes), "#2a9df4");
  strokeQuads(ctx, moved(reading.patchBoxes), "#e53935");
  return canvas.toDataURL("image/jpeg", 0.85);
};

export const stripCameraAvailable = (): boolean => !!navigator.mediaDevices?.getUserMedia;

/**
 * Opens the camera screen and reads the continuous-roll grey test (`width` x `rowHeight` dots per row) as soon as it
 * is in view. Resolves undefined if the user backs out; rejects with the getUserMedia error if there's no camera
 * to use.
 */
export const captureGreyStrip = (width: number, rowHeight: number): Promise<StripCapture | undefined> =>
  new Promise((resolve, reject) => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const component = mount(StripCamera, {
      target,
      props: {
        width,
        rowHeight,
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
