import * as fabric from "fabric";
import Barcode from "$/fabric-object/barcode";
import QRCode from "$/fabric-object/qrcode";
import { CustomCanvas } from "$/fabric-object/custom_canvas";

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

  static fitObjectIntoCanvas(canvas: fabric.Canvas, obj: fabric.FabricObject, xMargin: number, yMarin: number) {
    const label = CanvasUtils.labelSize(canvas);
    const widthRatio = label.width / (obj.width + xMargin * 2);
    const heightRatio = label.height / (obj.height + yMarin * 2);
    const scaleFactor = Math.min(widthRatio, heightRatio);
    obj.set({ left: xMargin, top: yMarin });
    obj.scale(scaleFactor);
    canvas.centerObjectV(obj);
    canvas.centerObjectH(obj);
  }
}
