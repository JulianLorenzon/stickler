import jsBarcodeEncoders from "jsbarcode/bin/barcodes/index.js";

/** Barcode formats, the same set the official Fichero app offers. "CODE128B" is Code 128 (auto A/B/C) */
export type BarcodeCoding =
  | "EAN13"
  | "EAN8"
  | "UPC"
  | "UPCE"
  | "ITF"
  | "CODE39"
  | "CODE93"
  | "CODE128B"
  | "codabar";

export const BARCODE_FORMATS: { value: BarcodeCoding; label: string; hint: string; example: string }[] = [
  { value: "CODE128B", label: "Code 128", hint: "Any text", example: "123456789012" },
  { value: "EAN13", label: "EAN-13", hint: "12 digits (13 with check digit)", example: "590123412345" },
  { value: "EAN8", label: "EAN-8", hint: "7 digits (8 with check digit)", example: "9638507" },
  { value: "UPC", label: "UPC-A", hint: "11 digits (12 with check digit)", example: "12345678901" },
  { value: "UPCE", label: "UPC-E", hint: "6 digits, or 8 starting with 0 or 1", example: "123456" },
  { value: "ITF", label: "ITF", hint: "An even number of digits", example: "12345678" },
  { value: "CODE39", label: "Code 39", hint: "A-Z, 0-9 and - . $ / + % space", example: "CODE39" },
  { value: "CODE93", label: "Code 93", hint: "A-Z, 0-9 and - . $ / + % space", example: "CODE93" },
  { value: "codabar", label: "Codabar", hint: "Digits and - $ : / . +, optional A-D at both ends", example: "A12345B" },
];

/** A run of modules (one character per module, "1" = bar) and the caption under it */
export type BarcodeSegment = {
  data: string;
  text?: string;
  textAlign?: "left" | "center" | "right";
  /** Guard bars reach down into the caption */
  guard: boolean;
};

const ENCODER_NAME: Record<BarcodeCoding, string> = {
  EAN13: "EAN13",
  EAN8: "EAN8",
  UPC: "UPC",
  UPCE: "UPCE",
  ITF: "ITF",
  CODE39: "CODE39",
  CODE93: "CODE93",
  CODE128B: "CODE128",
  codabar: "codabar",
};

type JsBarcodeResult = { data: string; text?: string; options?: { textAlign?: string; height?: number } };

/**
 * Encode `text` as bars with JsBarcode's encoders (only the encoding, drawing is ours so every bar lands on whole
 * printer dots). Throws if the text isn't valid for the format.
 */
export const encodeBarcode = (encoding: BarcodeCoding, text: string, withCaption: boolean): BarcodeSegment[] => {
  // Older labels relied on short EAN-13 numbers being padded with zeros
  if (encoding === "EAN13" && /^\d{0,11}$/.test(text)) {
    text = text.padEnd(12, "0");
  }

  const Encoder = jsBarcodeEncoders[ENCODER_NAME[encoding]];
  const options = {
    displayValue: withCaption,
    flat: false,
    fontSize: 20,
    width: 2,
    height: 100,
    textMargin: 2,
    mod43: false,
    ean128: false,
  };
  const encoder = new Encoder(text, options);

  if (!encoder.valid()) {
    throw new Error("Invalid content");
  }

  const encoded: JsBarcodeResult | JsBarcodeResult[] = encoder.encode();
  const parts = Array.isArray(encoded) ? encoded : [encoded];

  return parts.map((p) => ({
    data: p.data,
    text: p.text,
    textAlign: (p.options?.textAlign as BarcodeSegment["textAlign"]) ?? "center",
    // Guard bars are the only parts that set their own height
    guard: Array.isArray(encoded) && p.options?.height !== undefined,
  }));
};
