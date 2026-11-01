/**
 * Bytes to put in a QR code for `text`. qrcode-generator's own conversion keeps only the low byte of each
 * character, which garbles everything past Latin-1 (€, emoji, Cyrillic, CJK). Latin-1 text keeps its old bytes
 * (Latin-1 is the QR default, so existing labels print the same); anything else is UTF-8, which scanners detect.
 */
export const qrTextToBytes = (text: string): number[] =>
  /^[\u0000-ÿ]*$/.test(text)
    ? Array.from(text, (c) => c.charCodeAt(0))
    : Array.from(new TextEncoder().encode(text));
