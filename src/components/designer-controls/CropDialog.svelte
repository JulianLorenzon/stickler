<script lang="ts" module>
  export interface CropRect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
</script>

<script lang="ts">
  import * as fabric from "fabric";
  import { onMount, untrack } from "svelte";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import type { MaterialIcon } from "$/styles/mdi_icons";

  interface Props {
    show: boolean;
    image: fabric.FabricImage;
    /** Width / height of the label, for the "Label shape" preset */
    labelAspect: number;
    onApply: (rect: CropRect) => void;
  }

  let { show = $bindable(), image, labelAspect, onApply }: Props = $props();

  type Preset = "label" | "square" | "free" | "whole";

  const presets: { id: Preset; icon: MaterialIcon; label: TranslationKey }[] = [
    { id: "label", icon: "crop_landscape", label: "crop.preset.label" },
    { id: "square", icon: "crop_square", label: "crop.preset.square" },
    { id: "free", icon: "crop_free", label: "crop.preset.free" },
    { id: "whole", icon: "crop_original", label: "crop.preset.whole" },
  ];

  // The dialog is created for one image and closed afterwards, its starting values are read once
  const img = untrack(() => image);

  /** The uncropped photo (Fabric keeps it when filters replace the element) */
  const source = ((img as unknown as { _originalElement?: CanvasImageSource })._originalElement ??
    img.getElement()) as HTMLImageElement | HTMLCanvasElement;
  const iw = (source as HTMLImageElement).naturalWidth || source.width;
  const ih = (source as HTMLImageElement).naturalHeight || source.height;

  const startsWhole = img.cropX === 0 && img.cropY === 0 && img.width === iw && img.height === ih;
  let preset = $state<Preset>(startsWhole ? "whole" : "free");
  /** Crop in photo pixels */
  let rect = $state<CropRect>({ x: img.cropX ?? 0, y: img.cropY ?? 0, w: img.width, h: img.height });

  let stageW = $state(0);
  let stageH = $state(0);
  let photoCanvas = $state<HTMLCanvasElement>();

  /** Photo pixels to screen pixels, and where the photo sits on the stage */
  /** Room around the photo so the corner handles stay grabbable at its edges */
  const PAD = 16;
  const k = $derived(stageW > PAD * 2 && stageH > PAD * 2 ? Math.min((stageW - PAD * 2) / iw, (stageH - PAD * 2) / ih) : 0);
  const ox = $derived((stageW - iw * k) / 2);
  const oy = $derived((stageH - ih * k) / 2);

  const aspect = $derived(preset === "label" ? labelAspect : preset === "square" ? 1 : undefined);

  // Draw the photo at screen resolution once the stage has a size
  $effect(() => {
    if (!k || !photoCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    photoCanvas.width = Math.round(iw * k * dpr);
    photoCanvas.height = Math.round(ih * k * dpr);
    const ctx = photoCanvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, photoCanvas.width, photoCanvas.height);
  });

  /** Smallest crop side: 40 screen px, but never more than the photo */
  const minSide = () => Math.min(40 / k, iw, ih);

  /** Largest rect of the given aspect around the current center, inside the photo */
  const fitAspect = (a: number) => {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const w = Math.min(iw, ih * a);
    const h = w / a;
    rect = {
      x: Math.min(Math.max(cx - w / 2, 0), iw - w),
      y: Math.min(Math.max(cy - h / 2, 0), ih - h),
      w,
      h,
    };
  };

  const pickPreset = (p: Preset) => {
    preset = p;
    if (p === "whole") {
      rect = { x: 0, y: 0, w: iw, h: ih };
    } else if (p === "label") {
      fitAspect(labelAspect);
    } else if (p === "square") {
      fitAspect(1);
    }
  };

  // ── dragging ──

  type Corner = "tl" | "tr" | "bl" | "br";
  const corners: Corner[] = ["tl", "tr", "bl", "br"];
  let drag: { id: number; what: Corner | "move"; startX: number; startY: number; start: CropRect } | undefined;

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
      rect = {
        ...s,
        x: Math.min(Math.max(s.x + dx, 0), iw - s.w),
        y: Math.min(Math.max(s.y + dy, 0), ih - s.h),
      };
      return;
    }

    // The opposite corner stays put
    const left = drag.what === "tl" || drag.what === "bl";
    const top = drag.what === "tl" || drag.what === "tr";
    const ax = left ? s.x + s.w : s.x;
    const ay = top ? s.y + s.h : s.y;
    // Room between the fixed corner and the photo edge
    const maxW = left ? ax : iw - ax;
    const maxH = top ? ay : ih - ay;
    const min = minSide();

    let w = Math.min(Math.max((left ? -dx : dx) + s.w, min), maxW);
    let h = Math.min(Math.max((top ? -dy : dy) + s.h, min), maxH);

    if (aspect) {
      // Follow whichever side the finger moved more, then fit inside the photo
      if (w / s.w > h / s.h) h = w / aspect;
      else w = h * aspect;
      const fit = Math.min(1, maxW / w, maxH / h);
      w *= fit;
      h *= fit;
      if (w < min || h < min) {
        const grow = Math.max(min / w, min / h);
        w = Math.min(w * grow, maxW);
        h = w / aspect;
      }
    }

    rect = { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
  };

  const onPointerUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) drag = undefined;
  };

  const done = () => {
    const r = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
    };
    onApply({ ...r, w: Math.max(1, Math.min(r.w, iw - r.x)), h: Math.max(1, Math.min(r.h, ih - r.y)) });
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
          style:left="{ox}px"
          style:top="{oy}px"
          style:width="{iw * k}px"
          style:height="{ih * k}px"></canvas>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="crop-box"
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
      <div class="crop-hint">{$tr("crop.hint")}</div>
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
    grid-template-columns: repeat(4, 1fr);
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

  .crop-hint {
    width: 100%;
    text-align: center;
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }
</style>
