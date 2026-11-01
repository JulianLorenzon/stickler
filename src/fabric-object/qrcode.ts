import QRCodeFactory from "qrcode-generator";
import * as fabric from "fabric";
import { OBJECT_DEFAULTS_TEXT, OBJECT_SIZE_DEFAULTS } from "$/defaults";
import { Range } from "$/types";
import { qrTextToBytes } from "$/utils/qr_text";

// Byte mode reads this when data is added; the library default garbles text past Latin-1
QRCodeFactory.stringToBytes = qrTextToBytes;

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";
export type Mode = "Numeric" | "Alphanumeric" | "Byte" /* Default */ | "Kanji";

export type QrVersion = Range<41>; // 0-40, 0 is automatic

export const qrCodeDefaultValues: Partial<fabric.TClassProperties<QRCode>> = {
  text: "Text",
  ecl: "M",
  stroke: "#000000",
  fill: "#ffffff",
  mode: "Byte",
  qrVersion: 0,
  ...OBJECT_SIZE_DEFAULTS,
};

interface UniqueQRCodeProps {
  text: string;
  ecl: ErrorCorrectionLevel;
  mode: Mode;
  qrVersion: QrVersion;
}
export interface QRCodeProps
  extends fabric.FabricObjectProps,
    UniqueQRCodeProps {}
export interface SerializedQRCodeProps
  extends fabric.SerializedObjectProps,
    UniqueQRCodeProps {}
const QRCODE_PROPS = ["text", "ecl", "size", "mode", "qrVersion"] as const;

export class QRCode<
    Props extends fabric.TOptions<QRCodeProps> = Partial<QRCodeProps>,
    SProps extends SerializedQRCodeProps = SerializedQRCodeProps,
    EventSpec extends fabric.ObjectEvents = fabric.ObjectEvents,
  >
  extends fabric.FabricObject<Props, SProps, EventSpec>
  implements QRCodeProps
{
  static override readonly type = "QRCode";

  /**
   * QRCode text
   * @type string
   * @default "Text"
   */
  declare text: string;

  /**
   * Error Correction Level
   * @type ErrorCorrectionLevel
   * @default "M"
   */
  declare ecl: ErrorCorrectionLevel;

  /**
   * Mode
   * @type Mode
   * @default "M"
   */
  declare mode: Mode;

  /**
   * Version
   * @type Mode
   * @default "M"
   */
  declare qrVersion: QrVersion;

  constructor(options?: Props) {
    super();
    Object.assign(this, qrCodeDefaultValues);
    this.setOptions(options);
    this.lockScalingFlip = true;
    this.setControlsVisibility({
      ml: false,
      mt: false,
      mr: false,
      mb: false,
      tl: false,
      tr: false,
      bl: false,
    });
  }

  override _set(key: string, value: any): this {
    super._set(key, value);
    if (key === "text" || key === "ecl") {
      this.dirty = true;
    }

    return this;
  }

  renderError(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "black";
    ctx.translate(-this.width / 2, -this.height / 2); // make top-left origin
    ctx.translate(-0.5, -0.5); // blurry rendering fix
    ctx.fillRect(0, 0, this.width + 1, this.height + 1);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.font = `16px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
    ctx.fillText("ERR", 0, 0);
    ctx.restore();
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    if (!this.text) {
      this.renderError(ctx);
      super._render(ctx);
      return;
    }

    const qr = QRCodeFactory(this.qrVersion, this.ecl);

    try {
      qr.addData(this.text, this.mode);
      qr.make();
    } catch (e) {
      console.error(e);
      this.renderError(ctx);
      super._render(ctx);
      return;
    }

    // Fill the whole box. Module edges are rounded to whole label pixels (printer dots), so the code can be any
    // size: modules differ by at most one dot instead of the size jumping in whole-dot-per-module steps
    const count = qr.getModuleCount();
    const size = Math.min(this.width, this.height);

    if (size < count) {
      this.renderError(ctx);
      super._render(ctx);
      return;
    }

    const edge = (i: number) => Math.round((i * size) / count);

    ctx.save();
    ctx.translate(-this.width / 2, -this.height / 2); // make top-left origin
    ctx.translate(-0.5, -0.5); // the 1px stroke offsets the box by half a pixel
    // Light modules are painted too, so the code stays readable on top of a photo
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, edge(count), edge(count));
    ctx.fillStyle = "black";
    for (let row = 0; row < count; row++) {
      const y = edge(row);
      const h = edge(row + 1) - y;
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          const x = edge(col);
          ctx.fillRect(x, y, edge(col + 1) - x, h);
        }
      }
    }
    ctx.restore();

    super._render(ctx);
  }

  override toObject(propertiesToInclude: any[] = []) {
    return super.toObject([...QRCODE_PROPS, ...propertiesToInclude]);
  }
}

fabric.classRegistry.setClass(QRCode, "QRCode");

export default QRCode;
