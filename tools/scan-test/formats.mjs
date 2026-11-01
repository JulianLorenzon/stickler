// Scanner checks that need no camera: `node tools/scan-test/formats.mjs` (Node 23.6+, from the repo root)
// 1. Every barcode format the app prints, drawn with the app's own encoders, is read back by zxing-cpp and comes out
//    of scan_formats.ts as the same format and text, so addScannedCode keeps it (no "converted" message)
// 2. 2D codes (zxing-cpp's writer) map to QR or to the formats that get converted to QR
// 3. QR codes made the app's way (qr_text.ts) read back with the same text, also past Latin-1
// 4. UPC-E: every possible code survives zxing-cpp's expansion to 13 digits and back
import fs from "node:fs";
import { createRequire } from "node:module";
import QRCodeFactory from "qrcode-generator";
import * as reader from "zxing-wasm/reader";
import * as writer from "zxing-wasm/writer";
import { compressUpcE, fromZxing } from "../../src/utils/scan_formats.ts";
import { qrTextToBytes } from "../../src/utils/qr_text.ts";

const require = createRequire(import.meta.url);
const encoders = require("jsbarcode/bin/barcodes/index.js").default;
const wasm = (name) => fs.readFileSync(`node_modules/zxing-wasm/dist/${name}/zxing_${name}.wasm`).buffer;
reader.prepareZXingModule({ overrides: { wasmBinary: wasm("reader") } });
writer.prepareZXingModule({ overrides: { wasmBinary: wasm("writer") } });

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};

/** Black-on-white pixels for a module string ("1" = bar), with quiet zones */
const drawBars = (bits, m = 3) => {
  const q = 12 * m, w = bits.length * m + 2 * q, h = 90;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") continue;
    for (let y = 10; y < h - 10; y++) data.fill(0, (y * w + q + i * m) * 4, (y * w + q + (i + 1) * m) * 4 - 1);
  }
  return { width: w, height: h, data };
};

const read = async (image) => (await reader.readBarcodes(image, { tryHarder: true })).find((r) => r.isValid);

// 1. 1D formats: [app encoding (barcode.ts), JsBarcode encoder, text typed in the app, ScanResult expected back]
const BARCODES = [
  ["EAN13", "EAN13", "5901234123457", "EAN_13", "5901234123457"],
  ["EAN8", "EAN8", "96385074", "EAN_8", "96385074"],
  ["UPC", "UPC", "036000291452", "UPC_A", "036000291452"],
  ["UPC", "UPC", "12345678901", "UPC_A", "123456789012"],
  ["UPCE", "UPCE", "123456", "UPC_E", "01234565"],
  ["UPCE", "UPCE", "01234565", "UPC_E", "01234565"],
  ["UPCE", "UPCE", "11234562", "UPC_E", "11234562"],
  ["ITF", "ITF", "12345678", "ITF", "12345678"],
  ["CODE39", "CODE39", "CODE39", "CODE_39", "CODE39"],
  ["CODE93", "CODE93", "CODE93", "CODE_93", "CODE93"],
  ["CODE128B", "CODE128", "Hello-128", "CODE_128", "Hello-128"],
  ["codabar", "codabar", "A12345B", "CODABAR", "A12345B"],
];
for (const [coding, encoder, input, format, text] of BARCODES) {
  const encoded = new encoders[encoder](input, { flat: true }).encode();
  const bits = Array.isArray(encoded) ? encoded.map((p) => p.data).join("") : encoded.data;
  const r = await read(drawBars(bits));
  const got = r && fromZxing(r.format, r.text);
  const ok = got?.format === format && got.text === text && new encoders[encoder](got.text, {}).valid();
  check(ok, `${coding} "${input}"`, ok ? "" : `zxing: ${r?.format} "${r?.text}" → ${JSON.stringify(got)}`);
}

// 2. 2D formats
const MATRIX = [
  ["QRCode", "QR_CODE"], ["MicroQRCode", "QR_CODE"], ["RMQRCode", "QR_CODE"],
  ["DataMatrix", "DATA_MATRIX"], ["PDF417", "PDF417"], ["Aztec", "AZTEC"],
];
for (const [zxingFormat, format] of MATRIX) {
  const text = zxingFormat === "MicroQRCode" ? "12345" : `${zxingFormat} test`;
  const r = await read((await writer.writeBarcode(text, { format: zxingFormat, scale: 4 })).image);
  const got = r && fromZxing(r.format, r.text);
  const ok = got?.format === format && got.text === text;
  check(ok, zxingFormat, ok ? "" : JSON.stringify(got));
}

// 3. QR text, encoded like src/fabric-object/qrcode.ts does
QRCodeFactory.stringToBytes = qrTextToBytes;
const QR_TEXTS = ["https://example.com/stickler", "Año nuevo, café, señor", "Grüße aus Köln", "Precio: 5 €",
  "日本語のテキスト", "Привет", "Party 🎉", "Mañana 10 € 🎉"];
for (const text of QR_TEXTS) {
  const qr = QRCodeFactory(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount(), m = 4, q = 16, w = n * m + 2 * q;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let y = q + r * m; y < q + (r + 1) * m; y++) data.fill(0, (y * w + q + c * m) * 4, (y * w + q + (c + 1) * m) * 4 - 1);
  }
  const back = (await read({ width: w, height: w, data }))?.text;
  check(back === text, `QR ${JSON.stringify(text)}`, back === text ? "" : `read back as ${JSON.stringify(back)}`);
}

// 4. UPC-E, all 2 × 10^6 codes: the standard expansion, then back
const expand = (e) => {
  const d = e.split(""), x = d[5];
  if ("012".includes(x)) return d[0] + d[1] + x + "0000" + d[2] + d[3] + d[4];
  if (x === "3") return d[0] + d[1] + d[2] + "00000" + d[3] + d[4];
  if (x === "4") return d[0] + d[1] + d[2] + d[3] + "00000" + d[4];
  return d.slice(0, 5).join("") + "0000" + x;
};
let exact = 0, sameNumber = 0, lost = 0;
for (const ns of "01") {
  for (let i = 0; i < 1e6; i++) {
    const e = String(i).padStart(6, "0");
    const upcA = ns + expand(e) + "7";
    const back = compressUpcE(upcA);
    if (back === ns + e + "7") exact++;
    else if (back && ns + expand(back.slice(1, 7)) + "7" === upcA) sameNumber++;
    else lost++;
  }
}
check(lost === 0, "UPC-E round trip", `${exact} exact, ${sameNumber} same number with the other bar pattern, ${lost} lost`);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
