import * as fabric from "fabric";
import { DEFAULT_LABEL_PROPS, MXW01_TAIL, feedMargins, printerOf } from "$/defaults";
import type { LabelProps } from "$/types";

type LabelBounds = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
};
type FoldSegment = { start: number; end: number };
type FoldInfo = {
  axis: "vertical" | "horizontal" | "none";
  points: number[];
  segments: FoldSegment[];
};
type MirrorInfo = { pos: fabric.Point; flip: boolean };

// Selection frame and handles in the app's accent (theme.scss --accent) instead of Fabric's default blue
const SELECTION_COLOR = "#ff5a36";
Object.assign(fabric.InteractiveFabricObject.ownDefaults, {
  borderColor: SELECTION_COLOR,
  cornerColor: SELECTION_COLOR,
});
Object.assign(fabric.Canvas.ownDefaults, { selectionColor: "rgba(255, 90, 54, 0.15)", selectionBorderColor: SELECTION_COLOR });

export class CustomCanvas extends fabric.Canvas {
  private labelProps: LabelProps = DEFAULT_LABEL_PROPS;
  private readonly SEPARATOR_LINE_WIDTH = 2;
  private readonly ROUND_RADIUS = 10;
  private readonly TAIL_WIDTH = 40;
  private readonly GRAY = "#CFCFCF";
  private readonly MIRROR_GHOST_COLOR = "rgba(0, 0, 0, 0.3)";
  private customBackground: boolean = true;
  private transparentBackground: boolean = false;
  private highlightMirror: boolean = true;
  private editorChrome: boolean = false;
  private userZoomed: boolean = false;
  private readonly FIT_PADDING = 28;
  private readonly MIN_VISIBLE = 48;
  private readonly OUTSIDE_DIM = "rgba(22, 24, 25, 0.6)";
  /** Auto length: room after the end of the piece */
  private readonly FREE_ROOM_FADE = "rgba(22, 24, 25, 0.3)";
  private readonly FEED_MARK_COLOR = "#e85454";
  private readonly FEED_MARK_WIDTH = 3;

  constructor(
    el?: string | HTMLCanvasElement,
    options?: fabric.TOptions<fabric.CanvasOptions>,
  ) {
    super(el, options);
    this.setupZoom();
    this.preserveObjectStacking = true;
  }

  private setupZoom() {
    this.on("mouse:wheel", (opt) => {
      const event = opt.e as WheelEvent;
      event.preventDefault();
      this.zoomAt(this.getViewportPoint(event), Math.pow(0.998, event.deltaY));
    });
    this.on("mouse:down:before", (opt) => {
      const event = opt.e as MouseEvent;
      if (event.button == 1) {
        event.preventDefault();
        this.fitLabel();
      }
    });
  }

  /**
   * Editor mode: the canvas covers the whole workspace and the label sits inside it, so selection handles
   * stay usable at the label edges and the view can be zoomed and panned. Exports only ever contain the label.
   */
  enableEditorChrome() {
    this.editorChrome = true;
    this.controlsAboveOverlay = true;
  }

  getLabelProps(): LabelProps {
    return this.labelProps;
  }

  getLabelSize(): { width: number; height: number } {
    return this.labelProps.size;
  }

  /**
   * The physical label in label coordinates; bigger than the design area where the printer can't reach. Across the
   * label that's both sides of the printhead; along it, the paper before printing starts (front edge) and, on
   * printers that feed after a print, after it.
   */
  private paperRect(): { x: number; y: number; width: number; height: number } {
    const { width: W, height: H } = this.labelProps.size;
    const paper = this.labelProps.paper ?? this.labelProps.size;
    const alongX = this.labelProps.printDirection === "left";
    const extra = alongX ? paper.width - W : paper.height - H;
    const { tail } = feedMargins(this.labelProps);
    const lead = extra >= tail ? extra - tail : extra;
    return {
      x: alongX ? -lead : (W - paper.width) / 2,
      y: alongX ? (H - paper.height) / 2 : -lead,
      width: paper.width,
      height: paper.height,
    };
  }

  /** Center of the label (not of the canvas element), used by Fabric's centerObject* helpers */
  override getCenterPoint(): fabric.Point {
    return new fabric.Point(this.labelProps.size.width / 2, this.labelProps.size.height / 2);
  }

  /** Resize the canvas element to the workspace, keeping the current view (or refitting if never zoomed) */
  setWorkspaceSize(width: number, height: number) {
    const vpt = this.viewportTransform;
    const oldCenter = new fabric.Point(this.width / 2, this.height / 2);
    this.setDimensions({ width, height });

    // Something is being dragged: keep the view still so the object stays under the finger
    if (this._currentTransform) {
      return;
    }

    if (!this.userZoomed) {
      this.fitLabel();
      return;
    }

    vpt[4] += width / 2 - oldCenter.x;
    vpt[5] += height / 2 - oldCenter.y;
    this.setViewportTransform(this.clampPan(vpt));
  }

  /** Zoom so the whole label fits the workspace and center it */
  fitLabel() {
    const paper = this.paperRect();
    const availW = this.width - this.FIT_PADDING * 2;
    const availH = this.height - this.FIT_PADDING * 2;
    if (availW <= 0 || availH <= 0) return;

    const zoom = Math.min(availW / paper.width, availH / paper.height, 4);
    this.userZoomed = false;
    this.setViewportTransform([
      zoom,
      0,
      0,
      zoom,
      (this.width - paper.width * zoom) / 2 - paper.x * zoom,
      (this.height - paper.height * zoom) / 2 - paper.y * zoom,
    ]);
  }

  /** Smallest and largest zoom: a quarter of the fitted size up to ~1 screen pixel per 0.03 mm */
  private zoomLimits(): { min: number; max: number } {
    const { width: lw, height: lh } = this.paperRect();
    const fit = Math.min((this.width - this.FIT_PADDING * 2) / lw, (this.height - this.FIT_PADDING * 2) / lh);
    return { min: Math.max(0.1, fit / 4), max: Math.max(fit, 32) };
  }

  /** Multiply the zoom by `factor`, keeping `point` (canvas element pixels) fixed on screen */
  zoomAt(point: fabric.Point, factor: number) {
    const { min, max } = this.zoomLimits();
    const zoom = Math.min(max, Math.max(min, this.getZoom() * factor));
    this.userZoomed = true;
    this.zoomToPoint(point, zoom);
    this.setViewportTransform(this.clampPan(this.viewportTransform));
  }

  /**
   * Set zoom and pan directly from a two-finger gesture: the label point under `fromPoint` at the start
   * (with `startVpt`) ends up under `toPoint` at `startZoom * scale`.
   */
  applyGesture(startVpt: fabric.TMat2D, fromPoint: fabric.Point, toPoint: fabric.Point, scale: number) {
    const { min, max } = this.zoomLimits();
    const zoom = Math.min(max, Math.max(min, startVpt[0] * scale));
    const sceneX = (fromPoint.x - startVpt[4]) / startVpt[0];
    const sceneY = (fromPoint.y - startVpt[5]) / startVpt[3];
    this.userZoomed = true;
    this.setViewportTransform(this.clampPan([zoom, 0, 0, zoom, toPoint.x - sceneX * zoom, toPoint.y - sceneY * zoom]));
  }

  /** Keep at least a strip of the label on screen */
  private clampPan(vpt: fabric.TMat2D): fabric.TMat2D {
    const z = vpt[0];
    const lw = this.labelProps.size.width * z;
    const lh = this.labelProps.size.height * z;
    const keepX = Math.min(this.MIN_VISIBLE, lw);
    const keepY = Math.min(this.MIN_VISIBLE, lh);
    const x = Math.min(this.width - keepX, Math.max(keepX - lw, vpt[4]));
    const y = Math.min(this.height - keepY, Math.max(keepY - lh, vpt[5]));
    return [z, 0, 0, z, x, y];
  }

  /**
   * Abort a drag/scale/rotate or rubber-band selection that the first finger of a pinch started,
   * putting the object back where it was.
   */
  cancelPointerAction() {
    const transform = this._currentTransform;
    if (transform) {
      // `original` also holds the origin Fabric picked for the action (e.g. "left" for a drag), which
      // isn't the object's own origin; restoring it would shift the object
      const { left, top, scaleX, scaleY, angle, skewX, skewY, flipX, flipY } = transform.original;
      transform.target.set({ left, top, scaleX, scaleY, angle, skewX, skewY, flipX, flipY });
      transform.target.setCoords();
      this._currentTransform = null;
    }
    this._groupSelector = null;
    this.requestRenderAll();
  }

  /**
   * Two-finger pinch to zoom and pan on touch screens. Fabric only tracks the first finger, so while two
   * fingers are down their move events are swallowed before Fabric sees them. Returns a cleanup function.
   */
  attachPinchZoom(): () => void {
    type Gesture = { vpt: fabric.TMat2D; mid: fabric.Point; dist: number };
    let gesture: Gesture | undefined;

    const toCanvasPoint = (t: Touch) => {
      const r = this.upperCanvasEl.getBoundingClientRect();
      return new fabric.Point(t.clientX - r.left, t.clientY - r.top);
    };
    const measure = (e: TouchEvent) => {
      const a = toCanvasPoint(e.touches[0]);
      const b = toCanvasPoint(e.touches[1]);
      return { mid: a.midPointFrom(b), dist: Math.max(1, a.distanceFrom(b)) };
    };
    const onCanvas = (t: Touch) => this.wrapperEl.contains(t.target as Node);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !onCanvas(e.touches[0]) || !onCanvas(e.touches[1])) return;
      if (gesture === undefined) this.cancelPointerAction();
      // (Re)start from the current view, also when a finger is put back down mid-gesture
      gesture = { vpt: [...this.viewportTransform] as fabric.TMat2D, ...measure(e) };
    };
    const onMove = (e: TouchEvent) => {
      if (gesture === undefined) return;
      e.stopPropagation();
      e.preventDefault();
      if (e.touches.length < 2) return;
      const { mid, dist } = measure(e);
      this.applyGesture(gesture.vpt, gesture.mid, mid, dist / gesture.dist);
    };
    const onEnd = (e: TouchEvent) => {
      if (gesture !== undefined && e.touches.length === 0) gesture = undefined;
    };

    const opts = { capture: true, passive: false };
    window.addEventListener("touchstart", onStart, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("touchend", onEnd, opts);
    window.addEventListener("touchcancel", onEnd, opts);

    return () => {
      window.removeEventListener("touchstart", onStart, opts);
      window.removeEventListener("touchmove", onMove, opts);
      window.removeEventListener("touchend", onEnd, opts);
      window.removeEventListener("touchcancel", onEnd, opts);
    };
  }

  /** Render exports (thumbnails, PNG, preview) without editor decorations */
  override toCanvasElement(...args: Parameters<fabric.Canvas["toCanvasElement"]>): HTMLCanvasElement {
    const chrome = this.editorChrome;
    this.editorChrome = false;
    try {
      return super.toCanvasElement(...args);
    } finally {
      this.editorChrome = chrome;
    }
  }

  /** PNG/JPEG data URL of just the label area at `multiplier` label pixels per pixel, regardless of the view */
  labelToDataURL(options: { multiplier: number; format: "png" | "jpeg"; quality?: number }): string {
    const vpt = this.viewportTransform;
    this.viewportTransform = [1, 0, 0, 1, 0, 0];
    try {
      return this.toDataURL({
        ...options,
        left: 0,
        top: 0,
        width: this.labelProps.size.width,
        height: this.labelProps.size.height,
      });
    } finally {
      this.viewportTransform = vpt;
    }
  }

  setLabelProps(value: LabelProps) {
    this.labelProps = value;
    this.requestRenderAll();
  }

  /** Skip the background entirely, used to render a layer whose alpha marks its pixels */
  setTransparentBackground(value: boolean) {
    this.transparentBackground = value;
  }

  setCustomBackground(value: boolean) {
    this.customBackground = value;
  }

  setHighlightMirror(value: boolean) {
    this.highlightMirror = value;
  }

  /** Get label bounds without tail */
  getLabelBounds(): LabelBounds {
    let endX = this.labelProps.size.width;
    let endY = this.labelProps.size.height;
    let startX = 0;
    let startY = 0;

    if (this.labelProps.tailPos === "right") {
      endX -= this.labelProps.tailLength ?? 0;
    } else if (this.labelProps.tailPos === "bottom") {
      endY -= this.labelProps.tailLength ?? 0;
    } else if (this.labelProps.tailPos === "left") {
      startX += this.labelProps.tailLength ?? 0;
    } else if (this.labelProps.tailPos === "top") {
      startY += this.labelProps.tailLength ?? 0;
    }

    const width = endX - startX;
    const height = endY - startY;

    return { startX, startY, endX, endY, width, height };
  }

  /** Get fold line position for splitted labels */
  getFoldInfo(): FoldInfo {
    const bb = this.getLabelBounds();
    const points: number[] = [];
    const segments: FoldSegment[] = [];
    const splitParts = this.labelProps.splitParts ?? 2;

    if (splitParts < 2) {
      return { axis: "none", points, segments };
    }

    if (this.labelProps.split === "horizontal") {
      const segmentHeight = bb.height / splitParts;
      let lastY: number = bb.startY;

      for (let i = 1; i < splitParts; i++) {
        const y =
          bb.startY + segmentHeight * i - this.SEPARATOR_LINE_WIDTH / 2 + 1;
        points.push(y);
        segments.push({ start: lastY, end: y });
        lastY = y;
      }

      segments.push({ start: lastY, end: bb.endY });

      return { axis: "horizontal", points, segments };
    } else if (this.labelProps.split === "vertical") {
      const segmentWidth = bb.width / splitParts;
      let lastX: number = bb.startX;

      for (let i = 1; i < splitParts; i++) {
        const x =
          bb.startX + segmentWidth * i - this.SEPARATOR_LINE_WIDTH / 2 + 1;
        points.push(x);
        segments.push({ start: lastX, end: x });
        lastX = x;
      }

      segments.push({ start: lastX, end: bb.endX });

      return { axis: "vertical", points, segments };
    }

    return { axis: "none", points, segments };
  }

  override _renderBackground(ctx: CanvasRenderingContext2D) {
    if (this.transparentBackground) {
      return;
    }

    const { width: W, height: H } = this.labelProps.size;
    const v = this.viewportTransform;

    ctx.save();
    // Background is drawn in label coordinates, so it follows zoom and pan like the objects do
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    ctx.fillStyle = "white";

    // Drop shadow behind plain labels (rounded, split and tailed shapes have parts that aren't white)
    const plainShape = this.labelProps.shape !== "rounded_rect" && !this.labelProps.tailLength;
    if (this.editorChrome && plainShape) {
      // The whole label, including the strips the printhead can't reach (dimmed by the overlay)
      const paper = this.paperRect();
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = "white";
      ctx.beginPath();
      if (this.labelProps.shape === "circle") {
        ctx.arc(W / 2, H / 2, Math.min(paper.width, paper.height) / 2, 0, 2 * Math.PI);
      } else {
        ctx.rect(paper.x, paper.y, paper.width, paper.height);
      }
      ctx.fill();
      ctx.restore();
    }

    // Draw simple white background and exit
    if (!this.customBackground) {
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return;
    }

    // Disable further actions for circle labels, just render
    if (this.labelProps.shape === "circle") {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, H / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
      return;
    }

    let roundRadius = this.ROUND_RADIUS;
    const bb = this.getLabelBounds();
    const fold = this.getFoldInfo();

    if (this.labelProps.shape !== "rounded_rect") {
      roundRadius = 0;
    }

    // Draw tail
    ctx.fillStyle = this.GRAY;

    ctx.beginPath();
    if (
      this.labelProps.tailLength !== undefined &&
      this.labelProps.tailLength > 0
    ) {
      if (this.labelProps.tailPos === "right") {
        ctx.rect(
          bb.endX - roundRadius,
          bb.endY / 2 - this.TAIL_WIDTH / 2,
          W - bb.endX + roundRadius,
          this.TAIL_WIDTH,
        );
      } else if (this.labelProps.tailPos === "bottom") {
        ctx.rect(
          bb.endX / 2 - this.TAIL_WIDTH / 2,
          bb.endY - roundRadius,
          this.TAIL_WIDTH,
          H - bb.endY + roundRadius,
        );
      } else if (this.labelProps.tailPos === "left") {
        ctx.rect(
          0,
          bb.endY / 2 - this.TAIL_WIDTH / 2,
          bb.startX + roundRadius,
          this.TAIL_WIDTH,
        );
      } else if (this.labelProps.tailPos === "top") {
        ctx.rect(
          bb.endX / 2 - this.TAIL_WIDTH / 2,
          0,
          this.TAIL_WIDTH,
          bb.startY + roundRadius,
        );
      }
    }
    ctx.fill();

    // Draw label(s)
    ctx.fillStyle = "white";

    ctx.beginPath();

    const splitParts = this.labelProps.splitParts ?? 2;

    if (this.labelProps.shape === "rounded_rect") {
      if (this.labelProps.split === "horizontal") {
        const segmentHeight = bb.height / splitParts;
        ctx.roundRect(
          bb.startX,
          bb.startY,
          bb.width,
          segmentHeight,
          roundRadius,
        ); // First part
        fold.points.forEach((y) =>
          ctx.roundRect(bb.startX, y, bb.width, segmentHeight, roundRadius),
        ); // Other parts
      } else if (this.labelProps.split === "vertical") {
        const segmentWidth = bb.width / splitParts;
        ctx.roundRect(
          bb.startX,
          bb.startY,
          segmentWidth,
          bb.height,
          roundRadius,
        ); // First part
        fold.points.forEach((x) =>
          ctx.roundRect(x, bb.startY, segmentWidth, bb.height, roundRadius),
        ); // Other parts
      } else {
        ctx.roundRect(0, 0, W, H, roundRadius);
      }
    } else {
      ctx.rect(bb.startX, bb.startY, bb.width, bb.height);
    }

    ctx.fill();

    // Draw separator

    ctx.strokeStyle = this.GRAY;
    ctx.lineWidth = this.SEPARATOR_LINE_WIDTH;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();

    if (fold.axis === "horizontal") {
      fold.points.forEach((x) => {
        ctx.moveTo(bb.startX + roundRadius, x);
        ctx.lineTo(bb.endX - roundRadius, x);
      });
    } else if (fold.axis === "vertical") {
      fold.points.forEach((y) => {
        ctx.moveTo(y, bb.startY + roundRadius);
        ctx.lineTo(y, bb.endY - roundRadius);
      });
    }

    ctx.stroke();

    ctx.restore();
  }
  /** Editor only: fade object parts outside the label (they won't print) and mark the edge that feeds first */
  override _renderOverlay(ctx: CanvasRenderingContext2D) {
    super._renderOverlay(ctx);
    if (!this.editorChrome) return;

    const v = this.viewportTransform;
    const { width: W, height: H } = this.labelProps.size;
    const x = v[4];
    const y = v[5];
    const w = W * v[0];
    const h = H * v[3];

    ctx.save();
    ctx.fillStyle = this.OUTSIDE_DIM;
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    if (this.labelProps.shape === "circle") {
      ctx.moveTo(x + w / 2 + h / 2, y + h / 2);
      ctx.arc(x + w / 2, y + h / 2, h / 2, 0, 2 * Math.PI);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill("evenodd");

    const paper = this.paperRect();
    const px = x + paper.x * v[0];
    const py = y + paper.y * v[3];
    const pw = paper.width * v[0];
    const ph = paper.height * v[3];
    ctx.fillStyle = this.FEED_MARK_COLOR;
    if (this.labelProps.printDirection === "left") {
      ctx.fillRect(px - this.FEED_MARK_WIDTH, py, this.FEED_MARK_WIDTH, ph);
    } else {
      ctx.fillRect(px, py - this.FEED_MARK_WIDTH, pw, this.FEED_MARK_WIDTH);
    }

    if (this.labelProps.autoLength && this.editorChrome) this.drawTearLine(ctx, px, py, pw, ph);
    ctx.restore();
  }

  /**
   * Auto length: where the piece will end (the printer's own feed after the last content), with the free room
   * after it faded. In screen coordinates, inside the overlay's save/restore.
   */
  private drawTearLine(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number) {
    const v = this.viewportTransform;
    const alongX = this.labelProps.printDirection === "left";
    let end = 0;
    for (const o of this.getObjects()) {
      const r = o.getBoundingRect();
      end = Math.max(end, alongX ? r.left + r.width : r.top + r.height);
    }
    const tail = printerOf(this.labelProps) === "mxw01" ? MXW01_TAIL : 0;
    const scale = alongX ? v[0] : v[3];
    const origin = alongX ? v[4] : v[5];
    const tear = Math.min(origin + (end + tail) * scale, alongX ? px + pw : py + ph);

    // Fade only the design area after the tear line: it's still room to work in, unlike the grey strips
    const { width: W, height: H } = this.labelProps.size;
    const dx = v[4];
    const dy = v[5];
    ctx.fillStyle = this.FREE_ROOM_FADE;
    if (alongX) ctx.fillRect(tear, dy, dx + W * v[0] - tear, H * v[3]);
    else ctx.fillRect(dx, tear, W * v[0], dy + H * v[3] - tear);

    ctx.strokeStyle = this.FEED_MARK_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    if (alongX) {
      ctx.moveTo(tear, py);
      ctx.lineTo(tear, py + ph);
    } else {
      ctx.moveTo(px, tear);
      ctx.lineTo(px + pw, tear);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  override _renderObjects(
    ctx: CanvasRenderingContext2D,
    objects: fabric.FabricObject[],
  ) {
    super._renderObjects(ctx, objects);

    if (!this.highlightMirror || this.getActiveObjects().length > 1) {
      return;
    }

    ctx.save();

    objects.forEach((obj) => {
      const infos = this.getMirroredObjectCoords(obj);
      infos.forEach((info) => {
        const bbox = obj.getBoundingRect();
        ctx.fillStyle = this.MIRROR_GHOST_COLOR;
        ctx.fillRect(
          info.pos.x - bbox.width / 2,
          info.pos.y - bbox.height / 2,
          bbox.width,
          bbox.height,
        );
        ctx.restore();
      });
    });
    ctx.restore();
  }

  /**
   * Return new object positions (origin is center) if object needs mirroring
   **/
  getMirroredObjectCoords(obj: fabric.FabricObject): MirrorInfo[] {
    const fold = this.getFoldInfo();
    const result: MirrorInfo[] = [];

    if (
      fold.axis === "none" ||
      !(this.labelProps.mirror === "flip" || this.labelProps.mirror === "copy")
    ) {
      return result;
    }

    const bounds = this.getLabelBounds();

    if (fold.axis === "vertical") {
      if (this.labelProps.mirror === "copy") {
        fold.points.forEach((x) => {
          const pos = obj.getPointByOrigin("center", "center");
          pos.setX(x + (pos.x - bounds.startX));
          result.push({ pos, flip: false });
        });
      } else if (
        this.labelProps.mirror === "flip" &&
        fold.points.length === 1
      ) {
        // Half split only supported
        const axisX = fold.points[0];
        const pos = obj.getPointByOrigin("center", "center");
        pos.setX(axisX + (axisX - pos.x));
        pos.setY(bounds.startY + bounds.endY - pos.y);
        result.push({ pos, flip: true });
      }
    } else if (fold.axis === "horizontal") {
      if (this.labelProps.mirror === "copy") {
        fold.points.forEach((y) => {
          const pos = obj.getPointByOrigin("center", "center");
          pos.setY(y + (pos.y - bounds.startY));
          result.push({ pos, flip: false });
        });
      } else if (
        this.labelProps.mirror === "flip" &&
        fold.points.length === 1
      ) {
        // Half split only supported
        const axisY = fold.points[0];
        const pos = obj.getPointByOrigin("center", "center");
        pos.setY(axisY + (axisY - pos.y));
        pos.setX(bounds.startX + bounds.endX - pos.x);
        result.push({ pos, flip: true });
      }
    }

    return result;
  }

  /** Clone mirrored objects and add them to canvas */
  async createMirroredObjects() {
    const objects = this.getObjects();
    for (const obj of objects) {
      const infos = this.getMirroredObjectCoords(obj);

      for (const info of infos) {
        const newObj = await obj.clone();
        newObj.setPositionByOrigin(info.pos, "center", "center");
        if (info.flip) {
          newObj.centeredRotation = true;
          newObj.rotate((newObj.angle + 180) % 360);
        }
        this.add(newObj);
      }
    }
  }

  /** Centers object horizontally in the canvas or label part */
  override centerObjectH(object: fabric.FabricObject): void {
    if ((this.labelProps.split ?? "none") !== "none") {
      const pos = object.getPointByOrigin("center", "center");
      const bounds = this.getLabelBounds();
      const fold = this.getFoldInfo();
      let centerX = bounds.startX + bounds.width / 2;

      if (fold.axis !== "horizontal") {
        fold.segments.forEach((seg) => {
          if (pos.x >= seg.start && pos.x <= seg.end) {
            centerX = seg.start + (seg.end - seg.start) / 2;
          }
        });
      }
      pos.setX(centerX);

      object.setPositionByOrigin(pos, "center", "center");
      return;
    }

    super.centerObjectH(object);
  }

  /** Centers object vertically in the canvas or label part */
  override centerObjectV(object: fabric.FabricObject): void {
    if ((this.labelProps.split ?? "none") !== "none") {
      const pos = object.getPointByOrigin("center", "center");
      const bounds = this.getLabelBounds();
      const fold = this.getFoldInfo();
      let centerY = bounds.startY + bounds.height / 2;

      if (fold.axis !== "vertical") {
        fold.segments.forEach((seg) => {
          if (pos.y >= seg.start && pos.y <= seg.end) {
            centerY = seg.start + (seg.end - seg.start) / 2;
          }
        });
      }

      pos.setY(centerY);
      object.setPositionByOrigin(pos, "center", "center");
      return;
    }

    super.centerObjectV(object);
  }
}
