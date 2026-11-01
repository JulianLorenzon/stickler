import * as fabric from "fabric";
import { encodeBarcode, type BarcodeCoding, type BarcodeSegment } from "$/utils/barcode";
import { OBJECT_DEFAULTS_TEXT } from "$/defaults";

export type { BarcodeCoding } from "$/utils/barcode";

export const barcodeDefaultValues: Partial<fabric.TClassProperties<Barcode>> = {
  text: "",
  encoding: "EAN13",
  printText: true,
  scaleFactor: 1,
  fontSize: 12,
  fontFamily: OBJECT_DEFAULTS_TEXT.fontFamily,
};

interface UniqueBarcodeProps {
  text: string;
  encoding: BarcodeCoding;
  printText: boolean;
  scaleFactor: number;
  fontSize: number;
  fontFamily: string;
}
export interface BarcodeProps
  extends fabric.FabricObjectProps,
    UniqueBarcodeProps {}
export interface SerializedBarcodeProps
  extends fabric.SerializedObjectProps,
    UniqueBarcodeProps {}
const BARCODE_PROPS = [
  "text",
  "encoding",
  "printText",
  "scaleFactor",
  "fontSize",
  "fontFamily",
] as const;

export class Barcode<
    Props extends fabric.TOptions<BarcodeProps> = Partial<BarcodeProps>,
    SProps extends SerializedBarcodeProps = SerializedBarcodeProps,
    EventSpec extends fabric.ObjectEvents = fabric.ObjectEvents,
  >
  extends fabric.FabricObject<Props, SProps, EventSpec>
  implements BarcodeProps
{
  static override type = "Barcode";

  /**
   * Barcode text
   * @type string
   * @default ""
   */
  declare text: string;
  /**
   * Barcode encoding
   * @type BarcodeCoding
   * @default "EAN13"
   */
  declare encoding: BarcodeCoding;
  /**
   * Print text
   * @type boolean
   * @default true
   */
  declare printText: boolean;
  /**
   * Scale factor
   * @type number
   * @default 1
   */
  declare scaleFactor: number;
  /**
   * Font size
   * @type number
   * @default 12
   */
  declare fontSize: number;
  /**
   * Font family
   * @type string
   * @default "Noto Sans Variable"
   */
  declare fontFamily: string;

  private segments: BarcodeSegment[] = [];
  private invalid: boolean = false;

  constructor(options?: Props) {
    super();
    Object.assign(this, barcodeDefaultValues);
    const { text, ...other } = options ?? {};
    this.setOptions(other); // Must be set separately because the encoding needs to be set first
    this.set("text", text);
    this.setControlsVisibility({
      tl: false,
      tr: false,
      bl: false,
      br: false,
      ml: false,
      mr: false,
      mtr: false,
    });
    this.objectCaching = false;
    this._createBandCode();
  }

  override _set(key: string, value?: any): this {
    super._set(key, value);

    if (key === "text" || key === "encoding" || key === "printText") {
      this._createBandCode();
    }

    if (!this.invalid && this.segments.length > 0 && BARCODE_PROPS.includes(key as any)) {
      const modules = this.segments.reduce((n, s) => n + s.data.length, 0);
      super.set("width", (this.scaleFactor ?? 1) * modules);
      this.setCoords();
    }

    return this;
  }

  /** True when the content can't be encoded in the chosen format */
  isInvalid(): boolean {
    return this.invalid;
  }

  _createBandCode() {
    if (this.encoding === undefined || this.text === undefined) return;
    try {
      this.segments = encodeBarcode(this.encoding, this.text, this.printText ?? true);
      this.invalid = false;
    } catch {
      this.invalid = true;
    }
  }

  _getFont(): string {
    return `bold ${this.fontSize}px ${this.fontFamily}`;
  }

  private renderInvalid(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(-this.width / 2, -this.height / 2);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold 14px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
    ctx.fillText("ERR", this.width / 2, this.height / 2);
    ctx.restore();
  }

  override _render(ctx: CanvasRenderingContext2D) {
    if (this.invalid) {
      this.renderInvalid(ctx);
      super._render(ctx);
      return;
    }

    const scale = this.scaleFactor ?? 1;
    const captionHeight = this.printText ? Math.round(this.fontSize * 1.2) : 0;
    const barHeight = this.height - captionHeight;
    // Guard bars (EAN/UPC) reach halfway into the caption
    const guardHeight = Math.min(this.height, barHeight + Math.round(captionHeight / 2));

    ctx.save();
    ctx.translate(-this.width / 2, -this.height / 2); // make top-left origin
    ctx.translate(-0.5, -0.5); // the 1px stroke offsets the box by half a pixel
    ctx.fillStyle = "black";
    ctx.font = this._getFont();
    ctx.textBaseline = "bottom";

    let x = 0;
    for (const seg of this.segments) {
      const h = seg.guard ? guardHeight : barHeight;
      let run = 0;
      for (let i = 0; i <= seg.data.length; i++) {
        if (seg.data[i] === "1") {
          run++;
        } else if (run > 0) {
          ctx.fillRect(x + (i - run) * scale, 0, run * scale, h);
          run = 0;
        }
      }

      if (this.printText && seg.text) {
        const w = seg.data.length * scale;
        ctx.textAlign = seg.textAlign ?? "center";
        const tx = seg.textAlign === "left" ? x : seg.textAlign === "right" ? x + w : x + w / 2;
        ctx.fillText(seg.text, tx, this.height);
      }

      x += seg.data.length * scale;
    }

    ctx.restore();

    super._render(ctx);
  }

  override toObject(propertiesToInclude: any[] = []) {
    return super.toObject([...BARCODE_PROPS, ...propertiesToInclude]);
  }
}

fabric.classRegistry.setClass(Barcode, "Barcode");

export default Barcode;
