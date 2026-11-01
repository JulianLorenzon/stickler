// What zxing-cpp reads → the formats and text the rest of the app uses. No imports, so tools/scan-test.mjs can run
// it in Node.

export type ScannedFormat =
  | "QR_CODE"
  | "EAN_13"
  | "EAN_8"
  | "UPC_A"
  | "UPC_E"
  | "ITF"
  | "CODE_39"
  | "CODE_93"
  | "CODE_128"
  | "CODABAR"
  | "DATA_MATRIX"
  | "PDF417"
  | "AZTEC"
  | "UNKNOWN";

export type ScanResult = { text: string; format: ScannedFormat };

/** zxing-cpp format names (variants included) → ours */
const toScannedFormat = (f: string): ScannedFormat => {
  if (f.startsWith("QRCode") || f === "MicroQRCode" || f === "RMQRCode") return "QR_CODE";
  if (f === "EAN13" || f === "ISBN") return "EAN_13";
  if (f === "EAN8") return "EAN_8";
  if (f === "UPCA") return "UPC_A";
  if (f === "UPCE") return "UPC_E";
  if (f.startsWith("ITF")) return "ITF";
  if (f.startsWith("Code39") || f === "Code32" || f === "PZN") return "CODE_39";
  if (f === "Code93") return "CODE_93";
  if (f === "Code128") return "CODE_128";
  if (f === "Codabar") return "CODABAR";
  if (f === "DataMatrix") return "DATA_MATRIX";
  if (f.includes("PDF417")) return "PDF417";
  if (f.startsWith("Aztec")) return "AZTEC";
  return "UNKNOWN";
};

/**
 * The 8-digit UPC-E for a 12-digit UPC-A, or undefined if it has none. The inverse of the standard UPC-E → UPC-A
 * expansion; where two UPC-E codes expand to the same number, this gives the first rule's (same number, so any
 * scanner reads it the same).
 */
export const compressUpcE = (upcA: string): string | undefined => {
  const ns = upcA[0];
  if (ns !== "0" && ns !== "1") return undefined;
  const maker = upcA.slice(1, 6);
  const product = upcA.slice(6, 11);
  let e: string | undefined;
  if (["000", "100", "200"].includes(maker.slice(2)) && product.startsWith("00")) {
    e = maker.slice(0, 2) + product.slice(2) + maker[2];
  } else if (maker.slice(3) === "00" && product.startsWith("000")) {
    e = maker.slice(0, 3) + product.slice(3) + "3";
  } else if (maker[4] === "0" && product.startsWith("0000")) {
    e = maker.slice(0, 4) + product[4] + "4";
  } else if (product.startsWith("0000") && Number(product[4]) >= 5) {
    e = maker + product[4];
  }
  return e && ns + e + upcA[11];
};

/** A zxing-cpp result as a ScanResult */
export const fromZxing = (format: string, text: string): ScanResult => {
  // zxing-cpp gives UPC-A as an EAN-13 with a leading 0 (same bars) and UPC-E expanded to that number too
  if ((format === "EAN13" || format === "UPCA") && /^0\d{12}$/.test(text)) {
    return { text: text.slice(1), format: "UPC_A" };
  }
  if (format === "UPCE" && /^0\d{12}$/.test(text)) {
    const upcE = compressUpcE(text.slice(1));
    return upcE ? { text: upcE, format: "UPC_E" } : { text: text.slice(1), format: "UPC_A" };
  }
  return { text, format: toScannedFormat(format) };
};
