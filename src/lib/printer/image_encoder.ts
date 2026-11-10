import type { RasterFormat } from "./drivers/types";
import { d11sDriver } from "./drivers/d11s";
import type { EncodedImage, PrintDirection } from "./types";

export class ImageEncoder {
  static encodeCanvas(
    canvas: HTMLCanvasElement,
    direction: PrintDirection,
    format: RasterFormat = d11sDriver.raster,
  ): EncodedImage {
    let source = canvas;

    if (direction === "left") {
      source = ImageEncoder.rotateCW90(canvas);
    }

    const rowsData = ImageEncoder.canvasToRaster(source, format);
    return {
      cols: format.printheadPx / 8,
      rows: source.height,
      rowsData,
    };
  }

  private static rotateCW90(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const rotated = document.createElement("canvas");
    rotated.width = canvas.height;
    rotated.height = canvas.width;
    const ctx = rotated.getContext("2d")!;
    ctx.translate(rotated.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, 0, 0);
    return rotated;
  }

  private static canvasToRaster(canvas: HTMLCanvasElement, format: RasterFormat): Uint8Array {
    const bytesPerRow = format.printheadPx / 8;
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    const rows = canvas.height;
    const out = new Uint8Array(rows * bytesPerRow);

    // The printhead is centered on the label: center the image on it too,
    // padding narrower images and cropping wider ones evenly on both sides
    const shift = Math.floor((canvas.width - format.printheadPx) / 2);

    for (let y = 0; y < rows; y++) {
      for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byteIdx * 8 + bit + shift;
          if (x >= 0 && x < canvas.width) {
            const i = (y * canvas.width + x) * 4;
            if (px[i] === 0) {
              byte |= format.msbFirst ? 0x80 >> bit : 1 << bit;
            }
          }
        }
        out[y * bytesPerRow + byteIdx] = byte;
      }
    }

    return out;
  }
}
