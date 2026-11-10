/**
 * Calibration prints: the offset test strip (labels with gaps) and the grey test (dot gain). Drawn here and printed
 * from the printer sheet, for whichever printer is connected.
 */
import { DEFAULT_LABEL_PROPS, DOTS_PER_MM, OBJECT_DEFAULTS_TEXT, printerOf } from "$/defaults";
import type { PrintDirection, PrinterModelMeta, PrintTaskName } from "$/lib/printer";
import { LabelType, type PrinterClient } from "$/lib/printer";
import type { LabelProps, PostProcessType, PrinterId, PreviewPropsOffset } from "$/types";
import { applyCurve, atkinson, bayer, blueNoiseDither, floydSteinberg, threshold, werness } from "$/utils/post_process";
import { dotGainCurve, dotModelFor } from "$/utils/print_sim";

/**
 * The dot gain correction for a printer and dither mode, or undefined when the printer has no dot model or the mode
 * doesn't dither. `thresholdValue` is the slider, which Atkinson and Bayer use.
 */
export const dotGainCurveFor = (
  printer: PrinterId,
  mode: PostProcessType,
  thresholdValue: number,
): Uint8ClampedArray | undefined => {
  const m = dotModelFor(printer);
  if (!m) return undefined;
  const p = printer;
  switch (mode) {
    case "floyd":
      return dotGainCurve(`${p}:floyd`, (i) => floydSteinberg(i, 128), m);
    case "bluenoise":
      return dotGainCurve(`${p}:bluenoise`, blueNoiseDither, m);
    case "werness":
      return dotGainCurve(`${p}:werness`, werness, m);
    case "smart":
      return dotGainCurve(`${p}:atkinson:128`, (i) => atkinson(i, 128), m);
    case "dither":
      return dotGainCurve(`${p}:atkinson:${thresholdValue}`, (i) => atkinson(i, thresholdValue), m);
    case "bayer":
      return dotGainCurve(`${p}:bayer:${thresholdValue}`, (i) => bayer(i, thresholdValue), m);
    default:
      return undefined;
  }
};

export type TestLabel = { width: number; height: number; direction: PrintDirection };

/** Height of one row of the grey test on a continuous roll */
const GREY_ROW = 14 * DOTS_PER_MM;

/**
 * Size and direction of a test label for a printer: the label last open in the designer when it's for that printer,
 * otherwise the default label (D11s) or a piece as wide as the print head (continuous rolls)
 */
export const testLabelFor = (printer: PrinterId, meta: PrinterModelMeta, label: LabelProps | null): TestLabel => {
  if (label && printerOf(label) === printer) return { ...label.size, direction: label.printDirection };
  if (meta.printDirection === "left") return { ...DEFAULT_LABEL_PROPS.size, direction: "left" };
  return { width: meta.printheadPixels, height: GREY_ROW, direction: "top" };
};

/** The offset test only makes sense where the print has to land on a label between gaps */
export const hasLabelGaps = (meta: PrinterModelMeta): boolean => meta.paperTypes.includes(LabelType.WithGaps);

export const formatMm = (dots: number): string => {
  const mm = dots / DOTS_PER_MM;
  return `${mm > 0 ? "+" : mm < 0 ? "−" : ""}${Number(Math.abs(mm).toFixed(3))}`;
};

export const OFFSET_TEST_LABELS = 3;

/** X offsets (dots) for an offset test strip, centered on the current offset */
export const offsetPlan = (center: number, step: number): number[] =>
  Array.from({ length: OFFSET_TEST_LABELS }, (_, i) => center + (i - (OFFSET_TEST_LABELS - 1) / 2) * step);

const blank = (W: number, H: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
};

/**
 * A test label for dialing in the offset: a frame on the edges of the design area, a tick every millimetre
 * from both ends and in the middle, and the offset it was printed with.
 */
export const drawOffsetLabel = (W: number, H: number, xOffset: number, index: number): HTMLCanvasElement => {
  const { canvas, ctx } = blank(W, H);
  const line = 2;
  const mm = DOTS_PER_MM;
  ctx.fillStyle = "black";

  // Frame
  ctx.fillRect(0, 0, W, line);
  ctx.fillRect(0, H - line, W, line);
  ctx.fillRect(0, 0, line, H);
  ctx.fillRect(W - line, 0, line, H);

  // Millimetre ticks from both ends, longer every 5 mm
  const ticks = Math.min(10, Math.floor(W / mm / 3));
  for (let i = 1; i <= ticks; i++) {
    const len = i % 5 === 0 ? Math.round(H * 0.3) : Math.round(H * 0.15);
    for (const x of [i * mm, W - i * mm]) {
      ctx.fillRect(x - 1, 0, line, len);
      ctx.fillRect(x - 1, H - len, line, len);
    }
  }

  // Middle
  const mid = Math.round(H * 0.15);
  ctx.fillRect(W / 2 - 1, 0, line, mid);
  ctx.fillRect(W / 2 - 1, H - mid, line, mid);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(H * 0.3)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
  ctx.fillText(`${formatMm(xOffset)} mm`, W / 2, H * 0.44);
  ctx.font = `${Math.round(H * 0.13)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
  ctx.fillText(`X ${xOffset} · ${index + 1}/${OFFSET_TEST_LABELS}`, W / 2, H * 0.72);

  ctx.putImageData(threshold(ctx.getImageData(0, 0, W, H), 128), 0, 0);
  return canvas;
};

/** The dither modes on the grey test, with the settings the print preview uses for photos (Atkinson at 128) */
export const GREY_TEST_MODES: { name: string; mode: PostProcessType; dither: (iData: ImageData) => ImageData }[] = [
  { name: "Atkinson", mode: "dither", dither: (iData) => atkinson(iData, 128) },
  { name: "Floyd–Steinberg", mode: "floyd", dither: (iData) => floydSteinberg(iData, 128) },
  { name: "Blue noise", mode: "bluenoise", dither: blueNoiseDither },
  { name: "Werness", mode: "werness", dither: werness },
];
const GREY_TEST_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * A row of grey patches from 10 to 100% ink, dithered without any tone change, with the mode name above and the
 * percentages below. Photographed in even light it shows how much darker each grey prints (dot gain). With a
 * curve the greys are corrected first, and the label says so.
 */
export const drawGreyLabel = (
  mode: (typeof GREY_TEST_MODES)[number],
  W: number,
  H: number,
  curve?: Uint8ClampedArray,
): HTMLCanvasElement => {
  const { canvas, ctx } = blank(W, H);

  const margin = Math.round(DOTS_PER_MM / 2);
  const gap = 2;
  const top = Math.round(H * 0.24);
  const bottom = Math.round(H * 0.8);
  const n = GREY_TEST_LEVELS.length;
  const pw = Math.floor((W - 2 * margin - (n - 1) * gap) / n);
  const x0 = Math.round((W - n * pw - (n - 1) * gap) / 2);

  GREY_TEST_LEVELS.forEach((level, i) => {
    const v = Math.round(255 * (1 - level / 100));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x0 + i * (pw + gap), top, pw, bottom - top);
  });
  const patches = ctx.getImageData(0, top, W, bottom - top);
  ctx.putImageData(mode.dither(curve ? applyCurve(patches, curve) : patches), 0, top);

  ctx.fillStyle = "black";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(H * 0.16)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
  ctx.fillText(curve ? `${mode.name} · corrected` : mode.name, x0, top / 2);
  ctx.textAlign = "center";
  ctx.font = `${Math.round(H * 0.13)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
  GREY_TEST_LEVELS.forEach((level, i) => ctx.fillText(`${level}`, x0 + i * (pw + gap) + pw / 2, (bottom + H) / 2));

  // Only the text rows still have grey edges
  ctx.putImageData(threshold(ctx.getImageData(0, 0, W, top), 128), 0, 0);
  ctx.putImageData(threshold(ctx.getImageData(0, bottom, W, H - bottom), 128), 0, bottom);
  return canvas;
};

/**
 * The grey test as images to print. Labels with gaps get one label per mode; a continuous roll gets a single piece
 * with a row per mode, so there's no blank feed between them.
 */
export const greyTestPages = (
  printer: PrinterId,
  meta: PrinterModelMeta,
  label: TestLabel,
  corrected: boolean,
): HTMLCanvasElement[] => {
  const curve = (mode: PostProcessType) => (corrected ? dotGainCurveFor(printer, mode, 128) : undefined);
  if (hasLabelGaps(meta)) {
    return GREY_TEST_MODES.map((m) => drawGreyLabel(m, label.width, label.height, curve(m.mode)));
  }
  const { canvas, ctx } = blank(label.width, GREY_ROW * GREY_TEST_MODES.length);
  GREY_TEST_MODES.forEach((m, i) => ctx.drawImage(drawGreyLabel(m, label.width, GREY_ROW, curve(m.mode)), 0, i * GREY_ROW));
  return [canvas];
};

/**
 * The image shifted by the calibration offset. "inner" keeps the label size (content that moves past an edge is
 * cut off), "outer" grows the image by the offset instead.
 */
export const withOffset = (source: HTMLCanvasElement, offset: PreviewPropsOffset): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const { width, height } = source;

  if (offset.offsetType === "inner") {
    canvas.width = width;
    canvas.height = height;
  } else {
    canvas.width = width + Math.abs(offset.x);
    canvas.height = height + Math.abs(offset.y);
  }

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const x = offset.offsetType === "inner" ? offset.x : Math.max(offset.x, 0);
  const y = offset.offsetType === "inner" ? offset.y : Math.max(offset.y, 0);
  ctx.drawImage(source, x, y);
  return canvas;
};

export interface TestPrintOptions {
  direction: PrintDirection;
  density: number;
  labelType: LabelType;
  printTaskName: PrintTaskName;
}

/** Print one image and wait until it's out, without the print preview's progress display */
export const printTestImage = async (
  client: PrinterClient,
  canvas: HTMLCanvasElement,
  opts: TestPrintOptions,
): Promise<void> => {
  client.stopHeartbeat();
  const task = client.abstraction.newPrintTask(opts.printTaskName, {
    totalPages: 1,
    density: opts.density,
    speed: 1,
    labelType: opts.labelType,
    statusPollIntervalMs: 100,
    statusTimeoutMs: 8_000,
  });
  try {
    await task.printInit();
    await task.printPage(client.encodeCanvas(canvas, opts.direction), 1);
    await task.waitForFinished();
  } finally {
    await task.printEnd().catch(() => {});
    client.startHeartbeat();
  }
};
