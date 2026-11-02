<script lang="ts">
  import * as fabric from "fabric";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import type { MaterialIcon } from "$/styles/mdi_icons";
  import { appConfig } from "$/stores";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ObjectPositionControls from "$/components/designer-controls/ObjectPositionControls.svelte";
  import { CanvasUtils } from "$/utils/canvas_utils";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import NumberStepper from "$/components/basic/NumberStepper.svelte";
  import { DEFAULT_ROTATION_SNAP, ROTATION_SNAP_STEPS } from "$/defaults";


  interface Props {
    selectedObject: fabric.FabricObject;
    editRevision: number;
    valueUpdated: () => void;
  }

  let { selectedObject, editRevision, valueUpdated }: Props = $props();

  /** Angle shown as -180…180, Fabric keeps it in 0…360 */
  const angle = $derived.by(() => {
    void editRevision;
    const a = Math.round(selectedObject.angle * 10) / 10;
    return a > 180 ? a - 360 : a;
  });

  const rotationSnap = $derived($appConfig.rotationSnap ?? DEFAULT_ROTATION_SNAP);

  const setAngle = (deg: number) => {
    // rotate() turns around the center
    selectedObject.rotate(((deg % 360) + 360) % 360);
    selectedObject.setCoords();
    valueUpdated();
  };

  const setRotationSnap = (deg: number) => {
    appConfig.update((v) => ({ ...v, rotationSnap: deg }));
  };

  type Alignment = "left" | "center_h" | "right" | "top" | "center_v" | "bottom";

  const alignments: { value: Alignment; icon: MaterialIcon; label: TranslationKey }[] = [
    { value: "left", icon: "align_horizontal_left", label: "params.generic.align.left" },
    { value: "center_h", icon: "align_horizontal_center", label: "params.generic.center.horizontal" },
    { value: "right", icon: "align_horizontal_right", label: "params.generic.align.right" },
    { value: "top", icon: "align_vertical_top", label: "params.generic.align.top" },
    { value: "center_v", icon: "align_vertical_center", label: "params.generic.center.vertical" },
    { value: "bottom", icon: "align_vertical_bottom", label: "params.generic.align.bottom" },
  ];

  /**
   * Snap what is actually drawn (glyphs, strokes, rotation included) to the label edges or center,
   * not the object's box: a textbox is usually wider than its text and has room above and below the letters.
   */
  const align = (to: Alignment) => {
    const canvas = selectedObject.canvas!;
    const split = canvas instanceof CustomCanvas && (canvas.getLabelProps().split ?? "none") !== "none";

    // Split labels center within the part the object is in
    if (split && to === "center_h") {
      canvas.centerObjectH(selectedObject);
    } else if (split && to === "center_v") {
      canvas.centerObjectV(selectedObject);
    } else {
      const label = CanvasUtils.labelSize(canvas);
      const ink = CanvasUtils.visibleBounds(selectedObject);
      let dx = 0;
      let dy = 0;
      if (to === "left") dx = -ink.left;
      if (to === "center_h") dx = (label.width - ink.width) / 2 - ink.left;
      if (to === "right") dx = label.width - (ink.left + ink.width);
      if (to === "top") dy = -ink.top;
      if (to === "center_v") dy = (label.height - ink.height) / 2 - ink.top;
      if (to === "bottom") dy = label.height - (ink.top + ink.height);
      selectedObject.set({ left: selectedObject.left + dx, top: selectedObject.top + dy });
    }

    selectedObject.setCoords();
    valueUpdated();
  };

  const bringTo = (to: "top" | "bottom") => {
    if (to === "top") {
      selectedObject.canvas?.bringObjectToFront(selectedObject);
    } else if (to === "bottom") {
      selectedObject.canvas?.sendObjectToBack(selectedObject);
    }
  };

  const fit = () => {
    const canvas = selectedObject.canvas!;
    const label = CanvasUtils.labelSize(canvas);
    const imageRatio = selectedObject.width / selectedObject.height;
    const canvasRatio = label.width / label.height;

    if ($appConfig.fitMode === "ratio_min") {
      if (imageRatio > canvasRatio) {
        selectedObject.scaleToWidth(label.width);
      } else {
        selectedObject.scaleToHeight(label.height);
      }
      canvas.centerObject(selectedObject);
    } else if ($appConfig.fitMode === "ratio_max") {
      if (imageRatio > canvasRatio) {
        selectedObject.scaleToHeight(label.height);
      } else {
        selectedObject.scaleToWidth(label.width);
      }
      canvas.centerObject(selectedObject);
    } else {
      selectedObject.set({
        left: 0,
        top: 0,
        scaleX: label.width / selectedObject.width,
        scaleY: label.height / selectedObject.height,
      });
    }
    valueUpdated();
  };

  const fitModeChanged = (e: Event & { currentTarget: HTMLSelectElement }) => {
    const fitMode = e.currentTarget.value as "stretch" | "ratio_min" | "ratio_max";
    appConfig.update((v) => ({ ...v, fitMode: fitMode }));
  };
</script>

<input type="hidden" value={editRevision}>

<button class="btn btn-sm btn-secondary" onclick={() => align("center_h")} title={$tr("params.generic.center.horizontal")}>
  <MdIcon icon="align_horizontal_center" />
</button>
<button class="btn btn-sm btn-secondary" onclick={() => align("center_v")} title={$tr("params.generic.center.vertical")}>
  <MdIcon icon="align_vertical_center" />
</button>

<div class="dropdown">
  <button
    class="btn btn-sm btn-secondary dropdown-toggle"
    type="button"
    data-bs-toggle="dropdown"
    title={$tr("params.generic.align")}>
    <MdIcon icon="align_horizontal_left" />
  </button>
  <div class="dropdown-menu p-2">
    <div class="align-grid">
      {#each alignments as a (a.value)}
        <button class="btn btn-sm btn-secondary align-btn" onclick={() => align(a.value)}>
          <MdIcon icon={a.icon} />
          <span>{$tr(a.label)}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<ObjectPositionControls {selectedObject} />

<div class="dropdown">
  <button
    class="btn btn-sm btn-secondary dropdown-toggle"
    type="button"
    data-bs-toggle="dropdown"
    data-bs-auto-close="outside"
    title={$tr("params.generic.rotation")}>
    <MdIcon icon="rotate_right" />
    {#if angle !== 0}<span class="angle-badge">{angle}°</span>{/if}
  </button>
  <div class="dropdown-menu rotation-menu p-2">
    <div class="rotation-row">
      <NumberStepper
        value={angle}
        step={1}
        min={-180}
        max={180}
        decimals={angle % 1 === 0 ? 0 : 1}
        unit="°"
        title={$tr("params.generic.rotation")}
        onChange={setAngle} />
    </div>
    <div class="rotation-row">
      <button class="btn btn-sm btn-secondary" onclick={() => setAngle(angle - 90)} title="-90°">
        <MdIcon icon="rotate_left" />
      </button>
      <button class="btn btn-sm btn-secondary flex-grow-1" onclick={() => setAngle(0)}>0°</button>
      <button class="btn btn-sm btn-secondary" onclick={() => setAngle(angle + 90)} title="+90°">
        <MdIcon icon="rotate_right" />
      </button>
    </div>
    <div class="rotation-snap-title">{$tr("params.generic.rotation.snap")}</div>
    <div class="rotation-snap">
      {#each ROTATION_SNAP_STEPS as step (step)}
        <button
          class="btn btn-sm {rotationSnap === step ? 'btn-primary' : 'btn-secondary'}"
          onclick={() => setRotationSnap(step)}>
          {step === 0 ? $tr("params.generic.rotation.free") : `${step}°`}
        </button>
      {/each}
    </div>
  </div>
</div>

<div class="dropdown">
  <button
    class="btn btn-sm btn-secondary dropdown-toggle"
    type="button"
    data-bs-toggle="dropdown"
    title={$tr("params.generic.arrange")}>
    <MdIcon icon="segment" />
  </button>
  <div class="dropdown-menu arrangement p-2">
    <button class="btn btn-sm" onclick={() => bringTo("top")}>
      {$tr("params.generic.arrange.top")}
    </button>
    <button class="btn btn-sm" onclick={() => bringTo("bottom")}>
      {$tr("params.generic.arrange.bottom")}
    </button>
  </div>
</div>

{#if selectedObject instanceof fabric.FabricImage}
  <div class="btn-group btn-group-sm">
    <button type="button" class="btn btn-secondary" onclick={fit} title={$tr("params.generic.fit")}>
      <MdIcon icon="fit_screen" />
    </button>
    <button
      aria-label={$tr("params.generic.fit.mode")}
      type="button"
      class="btn btn-secondary dropdown-toggle dropdown-toggle-split px-1"
      data-bs-toggle="dropdown"></button>
    <div class="dropdown-menu p-1">
      <select class="form-select form-select-sm" value={$appConfig.fitMode ?? "stretch"} onchange={fitModeChanged}>
        <option value="stretch">{$tr("params.generic.fit.mode.stretch")}</option>
        <option value="ratio_min">{$tr("params.generic.fit.mode.ratio_min")}</option>
        <option value="ratio_max">{$tr("params.generic.fit.mode.ratio_max")}</option>
      </select>
    </div>
  </div>
{/if}

<style>
  .align-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }

  .align-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
    min-width: 5.5rem;
    padding: 0.5rem 0.25rem;
    font-size: 0.6875rem;
    line-height: 1.15;
    white-space: normal;
  }

  .align-btn :global(.mdi) {
    vertical-align: 0;
  }

  .angle-badge {
    margin-left: 0.125rem;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .rotation-menu {
    min-width: 13rem;
  }

  .rotation-row {
    display: flex;
    justify-content: center;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .rotation-snap-title {
    margin-bottom: 0.25rem;
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }

  .rotation-snap {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }

  .dropdown-menu.arrangement {
    text-align: center;
  }
</style>
