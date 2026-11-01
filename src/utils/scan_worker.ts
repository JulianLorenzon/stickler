/// <reference lib="webworker" />
// Reads QR codes and barcodes in camera frames with zxing-cpp (WebAssembly), off the main thread so the preview
// stays smooth. CameraScanner.svelte sends one frame at a time and waits for the reply.
import { prepareZXingModule, readBarcodes, type ReadResult } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

// The library fetches the .wasm from a CDN by default; load the copy bundled with the app instead
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
  },
  fireImmediately: true,
});

/** zxing-cpp's format name (e.g. "EAN13", "QRCode") and text; scan_formats.ts turns it into a ScanResult */
export type ZxingResult = { text: string; format: string };
export type WorkerReply = { result?: ZxingResult };

self.onmessage = async (e: MessageEvent<ImageData>) => {
  let results: ReadResult[] = [];
  try {
    results = await readBarcodes(e.data, { tryHarder: true, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 1 });
  } catch (err) {
    console.error(err);
  }
  const hit = results.find((r) => r.isValid && r.text !== "");
  const reply: WorkerReply = { result: hit && { text: hit.text, format: hit.format } };
  self.postMessage(reply);
};
