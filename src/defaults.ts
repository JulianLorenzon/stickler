import * as fabric from "fabric";
import type { AppConfig, LabelPreset, LabelProps, PrinterId } from "$/types";
import { TextboxExt } from "$/fabric-object/textbox-ext";
import { installPhotoCrop } from "$/fabric-object/photo-crop";

export const configureFabric = () => {
  fabric.config.disableStyleCopyPaste = true;

  fabric.classRegistry.setClass(TextboxExt, "Textbox");

  // Downscaled photos alias badly with the default "low" smoothing, which ruins dithering
  const renderImage = fabric.FabricImage.prototype._render;
  fabric.FabricImage.prototype._render = function (ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingQuality = "high";
    renderImage.call(this, ctx);
  };
  installPhotoCrop();

  fabric.Line.prototype.setControlsVisibility({
    tl: false,
    bl: false,
    tr: false,
    br: false,
    mt: false,
    mb: false,
  });

};

/** D11s prints at 203 dpi */
export const DOTS_PER_MM = 8;

/**
 * The D11s starts burning about 1 mm after the front edge of a label (the end towards the red feed mark), whatever
 * the image says, so that strip isn't part of the design area. It prints right up to the trailing edge.
 */
export const PRINT_START_MARGIN = DOTS_PER_MM;

/** Fichero label rolls sold for the D11s. The printhead covers the middle 12 mm of the 14 mm labels */
export const D11S_ROLLS: LabelPreset[] = [
  { width: 30, height: 14, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30×14 mm" },
  { width: 40, height: 14, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "40×14 mm" },
  { width: 50, height: 14, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "50×14 mm" },
];

/** 57 mm continuous rolls (plain and sticker) for the MXW01; its head prints the middle 48 mm */
export const MXW01_ROLLS: LabelPreset[] = [
  { printer: "mxw01", width: 57, height: 30, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "57×30 mm" },
  { printer: "mxw01", width: 57, height: 40, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "57×40 mm" },
  { printer: "mxw01", width: 57, height: 60, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "57×60 mm" },
];

/** "Auto length": the design area follows the content (at least 60 mm, 20 mm free after it, 10 mm steps) */
export const AUTO_LENGTH_MIN = 60 * DOTS_PER_MM;
export const AUTO_LENGTH_ROOM = 20 * DOTS_PER_MM;
export const AUTO_LENGTH_STEP = 10 * DOTS_PER_MM;

/** Design area for "auto length": grows with the content, prints only as long as the content */
export const MXW01_AUTO_LENGTH: LabelPreset = {
  printer: "mxw01",
  autoLength: true,
  width: 57,
  height: 60,
  unit: "mm",
  dpmm: 8,
  printDirection: "top",
  shape: "rect",
};

export const ROLLS: Record<PrinterId, LabelPreset[]> = { d11s: D11S_ROLLS, mxw01: MXW01_ROLLS };

/** Printer a label or preset is made for */
export const printerOf = (p: { printer?: PrinterId }): PrinterId => p.printer ?? "d11s";

/** MXW01: blank paper before every print (print head to tear bar) and after it (its own feed), in dots */
export const MXW01_LEAD = 68; // 8.5 mm
export const MXW01_TAIL = 48; // 6 mm

/**
 * Paper along the feed the printer can't print on, in dots: before the image (at the front edge) and after it.
 * Auto length labels end wherever the content ends, so their tail is drawn as a tear line instead.
 */
export const feedMargins = (props: { printer?: PrinterId; autoLength?: boolean }): { lead: number; tail: number } =>
  printerOf(props) === "mxw01"
    ? { lead: MXW01_LEAD, tail: props.autoLength ? 0 : MXW01_TAIL }
    : { lead: PRINT_START_MARGIN, tail: 0 };

/** Length of the label along the paper feed, "width" or "height" of the design area */
export const feedAxis = (props: LabelProps): "width" | "height" => (props.printDirection === "left" ? "width" : "height");

/**
 * A label size is the physical piece. Take what the printer can't print on along the feed (feedMargins) out of the
 * design area; objects keep their place relative to where the printer starts. Labels that already have it (paper
 * longer than the design area along the feed) stay as they are.
 */
export const withPrintStartMargin = (props: LabelProps): LabelProps => {
  const axis = feedAxis(props);
  const paper = props.paper ?? props.size;
  const { lead, tail } = feedMargins(props);
  const margins = lead + tail;
  if (props.shape === "circle" || paper[axis] !== props.size[axis] || props.size[axis] - margins < 2 * DOTS_PER_MM) {
    return props;
  }
  return {
    ...props,
    size: { ...props.size, [axis]: props.size[axis] - margins },
    paper: { ...paper },
  };
};

/** Old presets may be in px or use another dot density; the D11s is always 8 dots/mm */
export const presetDots = (preset: LabelPreset, value: number): number =>
  preset.unit === "mm" ? value * DOTS_PER_MM : value;

/**
 * Build label props for a paper size in dots. The printhead covers the middle `printheadDots` of the
 * label, so the design area is the paper clamped to that (rounded down to whole bytes), and it starts
 * printing a little after the front edge.
 */
export const labelPropsForPreset = (preset: LabelPreset, printheadDots: number): LabelProps => {
  const paperW = Math.max(DOTS_PER_MM, Math.round(presetDots(preset, preset.width)));
  const paperH = Math.max(DOTS_PER_MM, Math.round(presetDots(preset, preset.height)));

  let sizeW = paperW;
  let sizeH = paperH;
  if (preset.printDirection === "left") {
    sizeH = Math.min(paperH, printheadDots);
    sizeH = Math.max(8, sizeH - (sizeH % 8));
  } else {
    sizeW = Math.min(paperW, printheadDots);
    sizeW = Math.max(8, sizeW - (sizeW % 8));
  }

  const props: LabelProps = {
    printer: printerOf(preset),
    printDirection: preset.printDirection,
    size: { width: sizeW, height: sizeH },
    shape: preset.shape ?? "rect",
    split: preset.split ?? "none",
    splitParts: preset.splitParts ?? 2,
    tailPos: preset.tailPos ?? "right",
    tailLength: Math.floor(presetDots(preset, preset.tailLength ?? 0)),
    mirror: preset.mirror ?? "none",
  };
  if (preset.printer === undefined) delete props.printer;
  if (preset.autoLength) props.autoLength = true;

  if (paperW !== sizeW || paperH !== sizeH) {
    props.paper = { width: paperW, height: paperH };
  }

  return withPrintStartMargin(props);
};

/** Default canvas dimensions: a 40×14 mm label */
export const DEFAULT_LABEL_PROPS: LabelProps = {
  printDirection: "left",
  size: {
    width: 320 - PRINT_START_MARGIN,
    height: 96,
  },
  paper: {
    width: 320,
    height: 112,
  },
};

/** Object movement snapping, in label pixels (printer dots): 2 dots = 0.25 mm */
export const GRID_SIZE: number = 2;

/** Rotation handle snapping in degrees when the user hasn't picked one, 0 = free */
export const DEFAULT_ROTATION_SNAP = 15;

/** Choices for rotation snapping */
export const ROTATION_SNAP_STEPS = [0, 1, 5, 15, 45, 90];

/** With free rotation the handle still sticks to multiples of 90° within this many degrees */
export const ROTATION_STICKY_RIGHT_ANGLE = 3;

/** Newly created Fabric object dimensions */
export const OBJECT_SIZE_DEFAULTS = {
  width: 64,
  height: 64,
};

/** Newly created Fabric object common properties */
export const OBJECT_DEFAULTS = {
  snapAngle: 10,
  top: 10,
  left: 10,
};

/** Newly created Fabric vector object properties */
export const OBJECT_DEFAULTS_VECTOR = {
  ...OBJECT_DEFAULTS,
  fill: "transparent",
  stroke: "black",
  strokeWidth: 3,
  strokeUniform: true,
};

/** Newly created Fabric text object properties */
export const OBJECT_DEFAULTS_TEXT = {
  ...OBJECT_DEFAULTS,
  fill: "black",
  fontFamily: "Noto Sans Variable",
  textAlign: "center" as CanvasTextAlign,
  originX: "center" as fabric.TOriginX,
  originY: "center" as fabric.TOriginY,
  lineHeight: 1,
};

/** Scale image to this height when making a label thumbnail */
export const THUMBNAIL_HEIGHT = 48;

/** Generate thumbnail in jpeg format with this quality */
export const THUMBNAIL_QUALITY = 0.7;

export const APP_CONFIG_DEFAULTS: AppConfig = {
  fitMode: "stretch",
  iconListMode: "both"
};

export const CSV_DEFAULT = "var1,var2\n123,456\n777,888";
