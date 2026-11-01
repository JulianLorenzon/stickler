import { mount, unmount } from "svelte";
import CameraScanner from "$/components/CameraScanner.svelte";
import type { BarcodeCoding } from "$/utils/barcode";
import { fromZxing, type ScanResult, type ScannedFormat } from "$/utils/scan_formats";

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
