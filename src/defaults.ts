import * as fabric from "fabric";
import type { AppConfig, LabelPreset, LabelProps } from "$/types";
import { TextboxExt } from "$/fabric-object/textbox-ext";

export const configureFabric = () => {
  fabric.config.disableStyleCopyPaste = true;

  fabric.classRegistry.setClass(TextboxExt, "Textbox");

  // Downscaled photos alias badly with the default "low" smoothing, which ruins dithering
  const renderImage = fabric.FabricImage.prototype._render;
  fabric.FabricImage.prototype._render = function (ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingQuality = "high";
    renderImage.call(this, ctx);
  };

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

/** Length of the label along the paper feed, "width" or "height" of the design area */
export const feedAxis = (props: LabelProps): "width" | "height" => (props.printDirection === "left" ? "width" : "height");

/**
 * Earlier versions used the whole label length as the design area. Take the strip at the front edge the printer
 * can't reach out of it; objects keep their place relative to where the printer starts, so prints don't change.
 */
export const withPrintStartMargin = (props: LabelProps): LabelProps => {
  const axis = feedAxis(props);
  const paper = props.paper ?? props.size;
  if (props.shape === "circle" || paper[axis] !== props.size[axis] || props.size[axis] <= 2 * PRINT_START_MARGIN) {
    return props;
  }
  return {
    ...props,
    size: { ...props.size, [axis]: props.size[axis] - PRINT_START_MARGIN },
    paper: { ...paper },
  };
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
