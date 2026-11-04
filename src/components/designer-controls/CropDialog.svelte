<script lang="ts" module>
  import type { CropShape, Rect } from "$/fabric-object/photo-crop";

  export interface CropResult extends Rect {
    /** Degrees the photo is turned, clockwise */
    angle: number;
    shape: CropShape;
  }
</script>

<script lang="ts">
  import * as fabric from "fabric";
  import { onMount, untrack } from "svelte";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import type { MaterialIcon } from "$/styles/mdi_icons";
  import { cropFits, fromPhoto, photoCrop, toPhoto, turnedSize } from "$/fabric-object/photo-crop";

  interface Props {
    show: boolean;
    image: fabric.FabricImage;
    /** Width / height of the label as the photo sees it, for the "Label shape" preset */
    labelAspect: number;
    onApply: (result: CropResult) => void;
  }

  let { show = $bindable(), image, labelAspect, onApply }: Props = $props();

  type Preset = "label" | "square" | "circle" | "free" | "whole";

  const presets: { id: Preset; icon: MaterialIcon; label: TranslationKey }[] = [
    { id: "label", icon: "crop_landscape", label: "crop.preset.label" },
    { id: "square", icon: "crop_square", label: "crop.preset.square" },
    { id: "circle", icon: "circle", label: "crop.preset.circle" },
    { id: "free", icon: "crop_free", label: "crop.preset.free" },
    { id: "whole", icon: "crop_original", label: "crop.preset.whole" },
  ];

  // The dialog is created for one image and closed afterwards, its starting values are read once
  const img = untrack(() => image);
  const start = photoCrop(img);

  /** The uncropped photo (Fabric keeps it when filters replace the element) */
  const source = ((img as unknown as { _originalElement?: CanvasImageSource })._originalElement ??
    img.getElement()) as HTMLImageElement | HTMLCanvasElement;
  const iw = (source as HTMLImageElement).naturalWidth || source.width;
  const ih = (source as HTMLImageElement).naturalHeight || source.height;

  /** The photo's turn: quarter turns plus straightening (-45…45) */
  const startAngle = start.photoAngle ?? 0;
  let quarter = $state((((Math.round(startAngle / 90) * 90) % 360) + 360) % 360);
  let straighten = $state(startAngle - Math.round(startAngle / 90) * 90);
  const angle = $derived(quarter + straighten);

  let shape = $state<CropShape>(start.cropShape ?? "rect");
  const startsWhole = !startAngle && img.cropX === 0 && img.cropY === 0 && img.width === iw && img.height === ih;
  let preset = $state<Preset>(start.cropShape === "ellipse" ? "circle" : startsWhole ? "whole" : "free");
  /** Crop in photo pixels, in the box around the turned photo */
  let rect = $state<Rect>({ x: img.cropX ?? 0, y: img.cropY ?? 0, w: img.width, h: img.height });

  let stageW = $state(0);
  let stageH = $state(0);
  let photoCanvas = $state<HTMLCanvasElement>();

  /** Room around the photo so the corner handles stay grabbable at its edges */
  const PAD = 16;
  const box = $derived(turnedSize(iw, ih, angle));
  /** Photo pixels to screen pixels, and where the turned photo's box sits on the stage */
  const k = $derived(
    stageW > PAD * 2 && stageH > PAD * 2 ? Math.min((stageW - PAD * 2) / box.w, (stageH - PAD * 2) / box.h) : 0,
  );
  const ox = $derived((stageW - box.w * k) / 2);
  const oy = $derived((stageH - box.h * k) / 2);

  const aspect = $derived(preset === "label" ? labelAspect : preset === "square" ? 1 : undefined);

  // Draw the photo once, big enough for any turn; turning and zooming happen in CSS
  $effect(() => {
    if (!stageW || !stageH || !photoCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(1, (Math.max(stageW, stageH) * dpr) / Math.max(iw, ih));
    photoCanvas.width = Math.round(iw * scale);
    photoCanvas.height = Math.round(ih * scale);
    const ctx = photoCanvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, photoCanvas.width, photoCanvas.height);
  });

  // ── fitting the box inside the turned photo ──

  /** A circle only needs the circle itself on the photo, the corners of its box may stick out */
  const fits = (r: Rect) => cropFits(r, shape, iw, ih, angle);

  const lerp = (a: Rect, b: Rect, t: number): Rect => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  });

  /** As far from `from` (which fits) towards `to` as still fits */
  const furthest = (from: Rect, to: Rect) => {
    if (fits(to)) return to;
    if (!fits(from)) return from;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (fits(lerp(from, to, mid))) lo = mid;
      else hi = mid;
    }
    return lerp(from, to, lo);
  };

  /** A rect of size w × h around the center point, shrunk until it fits */
  const around = (cx: number, cy: number, w: number, h: number) => {
    const full = { x: cx - w / 2, y: cy - h / 2, w, h };
    return furthest({ x: cx, y: cy, w: 0, h: 0 }, full);
  };

  /** The rect of `from`'s size closest to `to` that fits, sliding along edges: x then y, or y then x */
  const push = (from: Rect, to: Rect) => {
    const dist = (r: Rect) => Math.hypot(r.x - to.x, r.y - to.y);
    const xFirst = furthest(from, { ...from, x: to.x });
    const a = furthest(xFirst, { ...xFirst, y: to.y });
    const yFirst = furthest(from, { ...from, y: to.y });
    const b = furthest(yFirst, { ...yFirst, x: to.x });
    return dist(a) <= dist(b) ? a : b;
  };

  /** Largest rect of the given aspect, as close to the current center as it fits */
  const fitAspect = (a: number) => {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const w = Math.min(box.w, box.h * a);
    // The biggest one sits in the middle of the photo, then it slides towards where the box was
    const middle = around(box.w / 2, box.h / 2, w, w / a);
    rect = furthest(middle, { ...middle, x: cx - middle.w / 2, y: cy - middle.h / 2 });
  };

  const fitWhole = () => {
    if (straighten === 0) rect = { x: 0, y: 0, w: box.w, h: box.h };
    else fitAspect(quarter % 180 === 0 ? iw / ih : ih / iw);
  };

  const pickPreset = (p: Preset) => {
    preset = p;
    shape = p === "circle" ? "ellipse" : "rect";
    if (p === "whole") fitWhole();
    else if (p === "label") fitAspect(labelAspect);
    else if (p === "square" || p === "circle") fitAspect(1);
    // Coming from a circle, the box's corners may be off the photo
    else if (!fits(rect)) rect = around(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h);
  };

  // ── turning ──

  /** The box as it was before the slider moved, so sliding back brings it back */
  let turnFrom: { cx: number; cy: number; w: number; h: number } | undefined;

  const rememberBox = () => {
    const c = toPhoto(rect.x + rect.w / 2, rect.y + rect.h / 2, iw, ih, angle);
    turnFrom = { cx: c.x, cy: c.y, w: rect.w, h: rect.h };
  };

  /** Keep the same spot of the photo in the middle of the box, shrink the box if it no longer fits */
  const placeAfterTurn = () => {
    if (!turnFrom) return;
    const c = fromPhoto(turnFrom.cx, turnFrom.cy, iw, ih, angle);
    rect = around(c.x, c.y, turnFrom.w, turnFrom.h);
  };

  const setStraighten = (deg: number) => {
    if (!turnFrom) rememberBox();
    // Snap to straight
    straighten = Math.abs(deg) < 1 ? 0 : deg;
    placeAfterTurn();
    if (preset === "whole") fitWhole();
  };

  const onSlider = (e: Event & { currentTarget: HTMLInputElement }) => setStraighten(Number(e.currentTarget.value));
  const sliderDone = () => (turnFrom = undefined);

  const resetStraighten = () => {
    setStraighten(0);
    turnFrom = undefined;
  };

  const turnLeft = () => {
    rememberBox();
    // The box turns with the photo
    turnFrom = { ...turnFrom!, w: turnFrom!.h, h: turnFrom!.w };
    quarter = (quarter + 270) % 360;
    placeAfterTurn();
    turnFrom = undefined;
    if (preset === "whole") fitWhole();
    else if (preset === "label") fitAspect(labelAspect);
  };

  const angleText = $derived(`${straighten < 0 ? "−" : ""}${Math.abs(straighten)}°`);

  // ── dragging ──

  type Corner = "tl" | "tr" | "bl" | "br";
  const corners: Corner[] = ["tl", "tr", "bl", "br"];
  let drag: { id: number; what: Corner | "move"; startX: number; startY: number; start: Rect } | undefined;

  /** Smallest crop side: 40 screen px, but never more than the photo */
  const minSide = () => Math.min(40 / k, iw, ih);

  const onPointerDown = (e: PointerEvent, what: Corner | "move") => {
    if (drag || !e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, what, startX: e.clientX, startY: e.clientY, start: { ...rect } };
    // "Whole photo" stops being true as soon as the box changes
    if (preset === "whole") preset = "free";
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.startX) / k;
    const dy = (e.clientY - drag.startY) / k;
    const s = drag.start;

    if (drag.what === "move") {
      // One direction at a time, so the box slides along an edge instead of stopping at it
      const moved = furthest(s, { ...s, x: s.x + dx });
      rect = furthest(moved, { ...moved, y: moved.y + dy });
      return;
    }

    // The opposite corner stays put
    const left = drag.what === "tl" || drag.what === "bl";
    const top = drag.what === "tl" || drag.what === "tr";
    const ax = left ? s.x + s.w : s.x;
    const ay = top ? s.y + s.h : s.y;
    const min = minSide();
    const at = (w: number, h: number): Rect => ({ x: left ? ax - w : ax, y: top ? ay - h : ay, w, h });

    let w = Math.max((left ? -dx : dx) + s.w, min);
    let h = Math.max((top ? -dy : dy) + s.h, min);
    let locked = aspect;

    if (preset === "circle" && Math.abs(w / h - 1) < 0.08) locked = 1;
    if (locked) {
      // Follow whichever side the finger moved more
      if (w / s.w > h / s.h) h = w / locked;
      else w = h * locked;
      if (w < min || h < min) {
        const grow = Math.max(min / w, min / h);
        w *= grow;
        h *= grow;
      }
    }

    if (locked || preset === "circle") {
      // Grow as far as the photo has room for (the middle has the most), and where the opposite corner would leave
      // the photo, push the box away from that edge instead of stopping
      let size = around(box.w / 2, box.h / 2, w, h);
      if (!locked) {
        // An oval keeps its shape free: each side stops at the photo on its own
        const middle = (ww: number, hh: number) => ({ x: box.w / 2 - ww / 2, y: box.h / 2 - hh / 2, w: ww, h: hh });
        size = furthest(size, middle(w, size.h));
        size = furthest(size, middle(size.w, h));
      }
      const want = at(size.w, size.h);
      rect = fits(want) ? want : push(size, want);
    } else {
      const wide = furthest(s, at(w, s.h));
      rect = furthest(wide, at(wide.w, h));
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) drag = undefined;
  };

  const done = () => {
    let r = rect;
    // Straight crops on whole pixels, like before
    if (straighten === 0) {
      const x = Math.max(0, Math.round(r.x));
      const y = Math.max(0, Math.round(r.y));
      r = { x, y, w: Math.max(1, Math.min(Math.round(r.w), Math.round(box.w) - x)), h: Math.max(1, Math.min(Math.round(r.h), Math.round(box.h) - y)) };
    }
    onApply({ ...r, angle: ((angle % 360) + 360) % 360, shape });
    // Let the modal animate out, it sets show = false when it's gone
    modalRef?.hide();
  };

  // The panel the Crop button lives in scrolls; move the dialog to <body> so nothing clips it
  let wrapper: HTMLDivElement;
  let modalRef = $state<AppModal>();
  onMount(() => {
    document.body.appendChild(wrapper);
  });
</script>

<div bind:this={wrapper}>
  <AppModal title={$tr("crop.title")} variant="fullscreen" bind:show bind:this={modalRef}>
    <div class="crop-stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
      {#if k}
        <canvas
          bind:this={photoCanvas}
          class="crop-photo"
          style:left="{stageW / 2 - (iw * k) / 2}px"
          style:top="{stageH / 2 - (ih * k) / 2}px"
          style:width="{iw * k}px"
          style:height="{ih * k}px"
          style:transform={angle ? `rotate(${angle}deg)` : undefined}></canvas>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="crop-box"
          class:round={shape === "ellipse"}
          style:left="{ox + rect.x * k}px"
          style:top="{oy + rect.y * k}px"
          style:width="{rect.w * k}px"
          style:height="{rect.h * k}px"
          onpointerdown={(e) => onPointerDown(e, "move")}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}>
          <div class="crop-grid"></div>
          {#each corners as c (c)}
            <div
              class="crop-handle {c}"
              onpointerdown={(e) => onPointerDown(e, c)}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
              onpointercancel={onPointerUp}>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#snippet footer()}
      <div class="crop-turn">
        <button class="btn btn-secondary turn-btn" onclick={turnLeft} title={$tr("crop.turn")}>
          <MdIcon icon="rotate_90_degrees_ccw" />
        </button>
        <div class="straighten">
          <input
            type="range"
            class="form-range"
            min="-45"
            max="45"
            step="0.5"
            value={straighten}
            aria-label={$tr("crop.straighten")}
            oninput={onSlider}
            onchange={sliderDone} />
        </div>
        <button
          class="btn btn-secondary angle-btn"
          class:straight={straighten === 0}
          onclick={resetStraighten}
          title={$tr("crop.straighten.reset")}>
          {angleText}
        </button>
      </div>
      <div class="crop-presets">
        {#each presets as p (p.id)}
          <button
            class="btn {preset === p.id ? 'btn-primary' : 'btn-secondary'}"
            onclick={() => pickPreset(p.id)}>
            <MdIcon icon={p.icon} />
            <span>{$tr(p.label)}</span>
          </button>
        {/each}
      </div>
      <div class="crop-hint">{$tr(shape === "ellipse" ? "crop.hint.circle" : "crop.hint")}</div>
      <button class="btn btn-primary btn-lg w-100" onclick={done}>{$tr("editor.selection.done")}</button>
    {/snippet}
  </AppModal>
</div>

<style>
  .crop-stage {
    position: relative;
    height: min(60vh, 32rem);
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }

  /* On phones the dialog is full screen: the photo takes all the room the presets leave */
  @media (max-width: 575.98px) {
    .crop-stage {
      height: 100%;
      min-height: 12rem;
    }

    :global(.modal-fullscreen-sm-down .modal-body:has(.crop-stage)) {
      display: flex;
      flex-direction: column;
    }

    .crop-stage {
      flex: 1;
    }
  }

  .crop-photo {
    position: absolute;
    display: block;
  }

  /* Oval crop: the box's corners show what Free would keep, dimmed */
  .crop-box.round {
    border-radius: 50%;
    outline: none;
    box-shadow:
      0 0 0 2px #fff,
      0 0 0 200vmax rgba(0, 0, 0, 0.6);
  }

  .crop-box.round::after {
    content: "";
    position: absolute;
    inset: 0;
    outline: 1px dashed rgba(255, 255, 255, 0.5);
    pointer-events: none;
  }

  .crop-box.round .crop-grid {
    border-radius: 50%;
  }

  .crop-box {
    position: absolute;
    outline: 2px solid #fff;
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.6);
    cursor: move;
    touch-action: none;
  }

  /* Rule-of-thirds lines */
  .crop-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.67% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.67% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.67% + 0.5px), transparent calc(66.67% + 0.5px)),
      linear-gradient(0deg, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.67% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.67% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.67% + 0.5px), transparent calc(66.67% + 0.5px));
  }

  /* 44 px touch target, the visible corner is drawn by ::before */
  .crop-handle {
    position: absolute;
    width: 2.75rem;
    height: 2.75rem;
    touch-action: none;
  }

  .crop-handle::before {
    content: "";
    position: absolute;
    width: 1.5rem;
    height: 1.5rem;
    border: 0 solid var(--accent);
  }

  .crop-handle.tl {
    left: -1.375rem;
    top: -1.375rem;
    cursor: nwse-resize;
  }
  .crop-handle.tr {
    right: -1.375rem;
    top: -1.375rem;
    cursor: nesw-resize;
  }
  .crop-handle.bl {
    left: -1.375rem;
    bottom: -1.375rem;
    cursor: nesw-resize;
  }
  .crop-handle.br {
    right: -1.375rem;
    bottom: -1.375rem;
    cursor: nwse-resize;
  }

  .crop-handle.tl::before {
    left: calc(1.375rem - 4px);
    top: calc(1.375rem - 4px);
    border-left-width: 5px;
    border-top-width: 5px;
  }
  .crop-handle.tr::before {
    right: calc(1.375rem - 4px);
    top: calc(1.375rem - 4px);
    border-right-width: 5px;
    border-top-width: 5px;
  }
  .crop-handle.bl::before {
    left: calc(1.375rem - 4px);
    bottom: calc(1.375rem - 4px);
    border-left-width: 5px;
    border-bottom-width: 5px;
  }
  .crop-handle.br::before {
    right: calc(1.375rem - 4px);
    bottom: calc(1.375rem - 4px);
    border-right-width: 5px;
    border-bottom-width: 5px;
  }

  .crop-presets {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    width: 100%;
  }

  .crop-presets .btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
    min-height: 3.25rem;
    padding: 0.375rem 0.25rem;
    font-size: 0.75rem;
    line-height: 1.15;
  }

  .crop-presets .btn :global(.mdi) {
    vertical-align: 0;
  }

  .crop-turn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .turn-btn {
    flex: none;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
  }

  .angle-btn {
    flex: none;
    min-width: 3.75rem;
    height: 2.75rem;
    font-variant-numeric: tabular-nums;
  }

  /* Nothing to reset: just the readout */
  .angle-btn.straight {
    color: var(--ink-tertiary);
  }

  /* A tick every 5°, a longer one at 0 */
  .straighten {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    height: 2.75rem;
  }

  .straighten::before {
    content: "";
    position: absolute;
    left: calc(0.5rem - 0.5px);
    right: calc(0.5rem - 0.5px);
    top: 50%;
    height: 0.75rem;
    margin-top: -0.375rem;
    background: linear-gradient(90deg, var(--ink-tertiary) 0 1px, transparent 1px) 0 0 / calc((100% - 1px) / 18) 100% repeat-x;
    opacity: 0.5;
    pointer-events: none;
  }

  .straighten::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 2px;
    height: 1.25rem;
    margin: -0.625rem 0 0 -1px;
    background: var(--ink-primary);
    pointer-events: none;
  }

  .straighten .form-range {
    position: relative;
    z-index: 1;
    height: 2.75rem;
  }

  .straighten .form-range::-webkit-slider-runnable-track {
    background: transparent;
  }

  .crop-hint {
    width: 100%;
    text-align: center;
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }
</style>
