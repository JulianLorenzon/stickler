import * as fabric from "fabric";
import Barcode from "$/fabric-object/barcode";
import QRCode from "$/fabric-object/qrcode";
import { CustomCanvas } from "$/fabric-object/custom_canvas";
import { DOTS_PER_MM, feedAxis } from "$/defaults";

/** Space between a new object and the content before it on an auto length label */
const AUTO_LENGTH_GAP = 2 * DOTS_PER_MM;

export class CanvasUtils {
  /** Label size in label pixels; the designer canvas element is bigger than the label */
  static labelSize(canvas: fabric.Canvas): { width: number; height: number } {
    return canvas instanceof CustomCanvas ? canvas.getLabelSize() : { width: canvas.width, height: canvas.height };
  }

  /**
   * Find the visible pixels of an object (alpha > 0 after rendering), in canvas coordinates.
   * Unlike getBoundingRect() this ignores empty space, e.g. a textbox wider than its text or the
   * line spacing above and below glyphs. Falls back to the bounding rect for invisible objects.
   */
  static visibleBounds(obj: fabric.FabricObject): { left: number; top: number; width: number; height: number } {
    const fallback = obj.getBoundingRect();
    const multiplier = 4;
    const el = obj.toCanvasElement({ multiplier, withoutShadow: true });
    const ctx = el.getContext("2d", { willReadFrequently: true });
    if (!ctx || el.width === 0 || el.height === 0) return fallback;

    const px = ctx.getImageData(0, 0, el.width, el.height).data;
    let minX = el.width;
    let minY = el.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < el.height; y++) {
      for (let x = 0; x < el.width; x++) {
        if (px[(y * el.width + x) * 4 + 3] > 32) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return fallback;

    // toCanvasElement renders the object centered in the element
    const center = obj.getCenterPoint();
    const left = center.x + (minX - el.width / 2) / multiplier;
    const top = center.y + (minY - el.height / 2) / multiplier;
    return { left, top, width: (maxX + 1 - minX) / multiplier, height: (maxY + 1 - minY) / multiplier };
  }

  static equalSpacingFillText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, printWidth: number) {
    // calculate every character width, and spacing
    const widths = [];
    for (let i = 0; i < text.length; i++) {
      const char = text.charAt(i);
      const metrics = ctx.measureText(char);
      widths.push(metrics.width);
    }
    const totalWidth = widths.reduce((a, b) => a + b, 0);
    const spacing = (printWidth - totalWidth) / (text.length - 1);

    // print every character with calculated spacing
    let offset = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charAt(i);
      ctx.fillText(char, x + offset, y);
      offset += widths[i] + spacing;
    }
  }

  static fixFabricObjectScale(obj: fabric.FabricObject) {
    const isNotScalable = obj instanceof Barcode || obj instanceof fabric.Rect || obj instanceof QRCode;

    if (isNotScalable) {
      obj.set({
        width: Math.round(obj.width * (obj.scaleX ?? 1)),
        height: Math.round(obj.height * (obj.scaleY ?? 1)),
        scaleX: 1,
        scaleY: 1,
        left: Math.round(obj.left),
        top: Math.round(obj.top),
      });

      // todo: move to QRCode maybe
      if (obj instanceof QRCode) {
        const qrMin = 24;
        const size = Math.max(obj.width, qrMin);
        obj.set({
          width: size,
          height: size,
        });
      }
    }
  }

  /**
   * The axis an "auto length" label grows along (the paper feed), or undefined for labels with a fixed size. Its
   * length there is only the content plus some free room, so placing and aligning along it can't use the label's
   * middle or end the way fixed labels do.
   */
  static autoLengthAxis(canvas: fabric.Canvas): "width" | "height" | undefined {
    if (!(canvas instanceof CustomCanvas)) return undefined;
    const props = canvas.getLabelProps();
    return props.autoLength ? feedAxis(props) : undefined;
  }

  /** Start and end of the objects other than `except` along an axis, or undefined when there are none */
  static contentSpan(
    canvas: fabric.Canvas,
    axis: "width" | "height",
    except?: fabric.FabricObject,
  ): { start: number; end: number } | undefined {
    let start = Infinity;
    let end = -Infinity;
    for (const o of canvas.getObjects()) {
      if (o === except) continue;
      const r = o.getBoundingRect();
      const [a, len] = axis === "height" ? [r.top, r.height] : [r.left, r.width];
      start = Math.min(start, a);
      end = Math.max(end, a + len);
    }
    return end > -Infinity ? { start, end } : undefined;
  }

  /** Move an object so its box starts at `pos` along an axis */
  static moveAlong(obj: fabric.FabricObject, axis: "width" | "height", pos: number) {
    obj.setCoords();
    const r = obj.getBoundingRect();
    if (axis === "height") obj.set({ top: Math.round(obj.top + pos - r.top) });
    else obj.set({ left: Math.round(obj.left + pos - r.left) });
    obj.setCoords();
  }

  /**
   * Put a newly added object where it's expected: centered on fixed size labels (or as `fixed` says), on auto length
   * labels centered across the paper and right after the content already there (at the start on an empty label),
   * like the next line of a receipt.
   */
  static placeNewObject(canvas: fabric.Canvas, obj: fabric.FabricObject, fixed?: () => void) {
    const axis = CanvasUtils.autoLengthAxis(canvas);
    if (axis === undefined) {
      if (fixed) fixed();
      else canvas.centerObject(obj);
      obj.setCoords();
      return;
    }
    if (axis === "height") canvas.centerObjectH(obj);
    else canvas.centerObjectV(obj);
    const content = CanvasUtils.contentSpan(canvas, axis, obj);
    CanvasUtils.moveAlong(obj, axis, content ? content.end + AUTO_LENGTH_GAP : 0);
  }

  /**
   * Scale a new object (image, SVG) to fit the label with a margin and place it. On auto length labels only the
   * paper's width limits it: the length grows with the content.
   */
  static fitObjectIntoCanvas(canvas: fabric.Canvas, obj: fabric.FabricObject, xMargin: number, yMarin: number) {
    const label = CanvasUtils.labelSize(canvas);
    const axis = CanvasUtils.autoLengthAxis(canvas);
    const widthRatio = axis === "width" ? Infinity : label.width / (obj.width + xMargin * 2);
    const heightRatio = axis === "height" ? Infinity : label.height / (obj.height + yMarin * 2);
    const scaleFactor = Math.min(widthRatio, heightRatio);
    obj.set({ left: xMargin, top: yMarin });
    obj.scale(scaleFactor);
    CanvasUtils.placeNewObject(canvas, obj);
  }
}
