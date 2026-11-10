import { mount, unmount } from "svelte";
import CameraScanner from "$/components/CameraScanner.svelte";
import type { BarcodeCoding } from "$/utils/barcode";
import { fromZxing, type ScanResult, type ScannedFormat } from "$/utils/scan_formats";
import type { WorkerReply, ZxingResult } from "$/utils/scan_worker";

export type { ScanResult, ScannedFormat };

/** Scanning runs in the WebView (camera + zxing-cpp as WebAssembly), so it works wherever there's a camera API */
export const codeScannerAvailable = (): boolean => !!navigator.mediaDevices?.getUserMedia;

/**
 * Opens the camera screen; resolves undefined if the user backs out. Rejects with the getUserMedia error
 * (NotAllowedError, NotFoundError, …) if there's no camera to use.
 */
export const scanCode = (): Promise<ScanResult | undefined> =>
  new Promise((resolve, reject) => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const component = mount(CameraScanner, {
      target,
      props: {
        onDone: (result, error) => {
          // Unmount after this callback returns, not from inside the component
          setTimeout(() => {
            unmount(component);
            target.remove();
          });
          if (error !== undefined) reject(error);
          else resolve(result && fromZxing(result.format, result.text));
        },
      },
    });
  });

/** Barcode format to recreate a scanned 1D code with; undefined for 2D codes */
export const BARCODE_FOR_SCANNED: Partial<Record<ScannedFormat, BarcodeCoding>> = {
  EAN_13: "EAN13",
  EAN_8: "EAN8",
  UPC_A: "UPC",
  UPC_E: "UPCE",
  ITF: "ITF",
  CODE_39: "CODE39",
  CODE_93: "CODE93",
  CODE_128: "CODE128B",
  CODABAR: "codabar",
};

/** 2D codes we can't draw; their content becomes a QR code */
export const OTHER_2D: ScannedFormat[] = ["DATA_MATRIX", "PDF417", "AZTEC"];

/** Pictures are scaled down to this many pixels on the long side before decoding (a phone photo is 4000+) */
const MAX_IMAGE_SIDE = 3000;

/** Read a code from a picture (a screenshot, a photo), with the same decoder as the camera; undefined if none */
export const readCodeFromImage = async (blob: Blob): Promise<ZxingResult | undefined> => {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // Transparent screenshots would decode as black on black
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const worker = new Worker(new URL("./scan_worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<ZxingResult | undefined>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerReply>) => resolve(e.data.result);
      worker.onerror = (e) => reject(e);
      worker.postMessage(img, [img.data.buffer]);
    });
  } finally {
    worker.terminate();
  }
};

/** Like readCodeFromImage, as a ScanResult for the designer */
export const scanImage = async (blob: Blob): Promise<ScanResult | undefined> => {
  const r = await readCodeFromImage(blob);
  return r && fromZxing(r.format, r.text);
};
