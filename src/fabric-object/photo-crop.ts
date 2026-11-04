import * as fabric from "fabric";

/**
 * Photos can be turned and cropped to an oval, without changing the photo itself.
 *
 * `photoAngle` turns the photo (degrees, clockwise) around its center. cropX/cropY/width/height then describe the
 * crop in the turned photo: coordinates in the box around it, so at 0° they mean what they always mean in Fabric.
 * `cropShape` "ellipse" shows the oval inside that crop. The object's box stays the crop, so selecting, aligning and
 * fitting all work on what is shown.
 */
export type CropShape = "rect" | "ellipse";

export interface PhotoCropProps {
  photoAngle?: number;
  cropShape?: CropShape;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RAD = Math.PI / 180;

/** Size of the box around a photo turned by `deg` */
export const turnedSize = (iw: number, ih: number, deg: number) => {
  const c = Math.abs(Math.cos(deg * RAD));
  const s = Math.abs(Math.sin(deg * RAD));
  return { w: iw * c + ih * s, h: iw * s + ih * c };
};

/** Where a point of the turned box lies on the photo itself */
export const toPhoto = (x: number, y: number, iw: number, ih: number, deg: number) => {
  const box = turnedSize(iw, ih, deg);
  const dx = x - box.w / 2;
  const dy = y - box.h / 2;
  const c = Math.cos(-deg * RAD);
  const s = Math.sin(-deg * RAD);
  return { x: dx * c - dy * s + iw / 2, y: dx * s + dy * c + ih / 2 };
};

/** Where a point of the photo lies in the box around the photo turned by `deg` */
export const fromPhoto = (x: number, y: number, iw: number, ih: number, deg: number) => {
  const box = turnedSize(iw, ih, deg);
  const dx = x - iw / 2;
  const dy = y - ih / 2;
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: dx * c - dy * s + box.w / 2, y: dx * s + dy * c + box.h / 2 };
};

/** Whether the whole rect (in the turned box) shows photo, no empty corners. Half a pixel of slack for rounding */
export const insidePhoto = (r: Rect, iw: number, ih: number, deg: number) => {
  const e = 0.5;
  for (const [x, y] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ]) {
    const p = toPhoto(x, y, iw, ih, deg);
    if (p.x < -e || p.y < -e || p.x > iw + e || p.y > ih + e) return false;
  }
  return true;
};

export const photoCrop = (img: fabric.FabricImage) => img as fabric.FabricImage & PhotoCropProps;

/** Draw turned or oval photos; plain ones keep Fabric's own drawing */
export const installPhotoCrop = () => {
  fabric.FabricImage.customProperties = ["photoAngle", "cropShape"];

  const proto = fabric.FabricImage.prototype as unknown as {
    _renderFill: (this: fabric.FabricImage, ctx: CanvasRenderingContext2D) => void;
  };
  const renderFill = proto._renderFill;

  proto._renderFill = function (ctx) {
    const { photoAngle = 0, cropShape = "rect" } = photoCrop(this);
    const el = this.getElement() as HTMLImageElement | HTMLCanvasElement | undefined;
    if (!el || (!photoAngle && cropShape !== "ellipse")) {
      renderFill.call(this, ctx);
      return;
    }

    const iw = (el as HTMLImageElement).naturalWidth || el.width;
    const ih = (el as HTMLImageElement).naturalHeight || el.height;
    const w = this.width;
    const h = this.height;
    const box = turnedSize(iw, ih, photoAngle);

    ctx.save();
    ctx.beginPath();
    if (cropShape === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    // The object's center is the crop's center; move to the photo's center and turn it there
    ctx.translate(box.w / 2 - this.cropX - w / 2, box.h / 2 - this.cropY - h / 2);
    ctx.rotate(photoAngle * RAD);
    ctx.drawImage(el, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  };
};
