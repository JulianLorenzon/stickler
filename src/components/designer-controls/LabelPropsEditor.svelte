<script lang="ts">
  import Dropdown from "bootstrap/js/dist/dropdown";
  import {
    ExportedLabelTemplateSchema,
    LabelPresetSchema,
    type LabelPreset,
    type LabelProps,
    type LabelShape,
    type LabelSplit,
    type MirrorType,
    type PrinterId,
    type TailPosition,
  } from "$/types";
  import { connectionState, designPrinter, printerMeta } from "$/stores";
  import { tr } from "$/utils/i18n";
  import { DOTS_PER_MM, MXW01_AUTO_LENGTH, ROLLS, printerOf, withPrintStartMargin } from "$/defaults";
  import { onMount } from "svelte";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { DRIVERS, driverById, type PrintDirection } from "$/lib/printer";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { Toasts } from "$/utils/toasts";
  import { FileUtils } from "$/utils/file_utils";
  import { z } from "zod";

  interface Props {
    labelProps: LabelProps;
    onChange: (newProps: LabelProps) => void;
  }

  let { labelProps, onChange }: Props = $props();

  const tailPositions: TailPosition[] = ["right", "bottom", "left", "top"];
  const printDirections: PrintDirection[] = ["left", "top"];
  const labelShapes: LabelShape[] = ["rect", "rounded_rect", "circle"];
  const labelSplits: LabelSplit[] = ["none", "vertical", "horizontal"];
  const mirrorTypes: MirrorType[] = ["none", "flip", "copy"];

  /** Presets that earlier versions saved together with the user's own, they are replaced by D11S_ROLLS */
  const OLD_DEFAULT_TITLES = new Set([
    "22×12 mm",
    "30×12 mm",
    "40×12 mm",
    "30×14 mm",
    "40×14 mm",
    "50×14 mm",
    "75×14 mm",
    "30×15 mm",
    "50×15 mm",
  ]);

  let toggleEl: HTMLButtonElement;
  let userPresets = $state<LabelPreset[]>([]);
  let customOpen = $state<boolean>(false);

  // Custom size form, in mm
  let title = $state<string>("");
  let width = $state<number>(0);
  let height = $state<number>(0);
  let printDirection = $state<PrintDirection>("left");
  let shape = $state<LabelShape>("rect");
  let split = $state<LabelSplit>("none");
  let splitParts = $state<number>(2);
  let tailLength = $state<number>(0);
  let tailPos = $state<TailPosition>("right");
  let mirror = $state<MirrorType>("none");
  let autoLength = $state<boolean>(false);

  let connected = $derived($connectionState === "connected" && $printerMeta !== undefined);
  /** Printer the sizes are for: the connected one, else the last one used or picked here */
  let printer = $derived<PrinterId>(connected && $printerMeta ? $printerMeta.driver : $designPrinter);
  let continuous = $derived(printer === "mxw01");

  const printheadDots = (): number => driverById(printer).raster.printheadPx;
  const mm = (dots: number): number => Math.round((dots / DOTS_PER_MM) * 10) / 10;

  /** Old presets may be in px or use another dot density; the D11s is always 8 dots/mm */
  const presetDots = (preset: LabelPreset, value: number): number =>
    preset.unit === "mm" ? value * DOTS_PER_MM : value;

  /** The physical label, not the printable area */
  const paperDots = (props: LabelProps) => props.paper ?? props.size;

  let sizeLabel = $derived.by<string>(() => {
    const paper = paperDots(labelProps);
    if (labelProps.autoLength) {
      const auto = $tr("params.label.auto");
      return labelProps.printDirection === "top" ? `${mm(paper.width)} mm × ${auto}` : `${auto} × ${mm(paper.height)} mm`;
    }
    return `${mm(paper.width)}×${mm(paper.height)} mm`;
  });

  let error = $derived.by<string>(() => {
    let error = "";

    if (connected && $printerMeta !== undefined && printerOf(labelProps) !== $printerMeta.driver) {
      return `${$tr("params.label.warning.printer")} ${driverById(printerOf(labelProps)).displayName}`;
    }

    // Wide rolls can be printed both ways round
    if ($printerMeta !== undefined && $printerMeta.driver === "d11s" && $printerMeta.printDirection !== labelProps.printDirection) {
      error += $tr("params.label.warning.direction") + " ";
      if ($printerMeta.printDirection == "left") {
        error += $tr("params.label.direction.left");
      } else {
        error += $tr("params.label.direction.top");
      }
    }

    return error;
  });

  /** What the printer can't reach on a label of the size typed in the custom form */
  let customAcross = $derived<number>(printDirection === "left" ? height : width);
  let printableMm = $derived<number>(mm(printheadDots()));

  /**
   * Build label props for a paper size in dots. The printhead covers the middle `printheadDots` of the
   * label, so the design area is the paper clamped to that (rounded down to whole bytes), and it starts
   * printing a little after the front edge.
   */
  const makeLabelProps = (preset: LabelPreset): LabelProps => {
    const paperW = Math.max(DOTS_PER_MM, Math.round(presetDots(preset, preset.width)));
    const paperH = Math.max(DOTS_PER_MM, Math.round(presetDots(preset, preset.height)));
    const head = printheadDots();

    let sizeW = paperW;
    let sizeH = paperH;
    if (preset.printDirection === "left") {
      sizeH = Math.min(paperH, head);
      sizeH = Math.max(8, sizeH - (sizeH % 8));
    } else {
      sizeW = Math.min(paperW, head);
      sizeW = Math.max(8, sizeW - (sizeW % 8));
    }

    const props: LabelProps = {
      printer: printerOf(preset),
      printDirection: preset.printDirection,
      size: { width: sizeW, height: sizeH },
      shape: preset.shape ?? "rect",
      split: preset.split ?? "none",
      splitParts: preset.splitParts ?? 2,
      tailPos: preset.tailPos ?? "right",
      tailLength: Math.floor(presetDots(preset, preset.tailLength ?? 0)),
      mirror: preset.mirror ?? "none",
    };
    if (preset.printer === undefined) delete props.printer;
    if (preset.autoLength) props.autoLength = true;

    if (paperW !== sizeW || paperH !== sizeH) {
      props.paper = { width: paperW, height: paperH };
    }

    return withPrintStartMargin(props);
  };

  const isActive = (preset: LabelPreset): boolean => {
    const target = makeLabelProps(preset);
    const a = paperDots(target);
    const b = paperDots(labelProps);
    return (
      a.width === b.width &&
      a.height === b.height &&
      target.printDirection === labelProps.printDirection &&
      printerOf(target) === printerOf(labelProps) &&
      !!target.autoLength === !!labelProps.autoLength &&
      (target.shape ?? "rect") === (labelProps.shape ?? "rect") &&
      (target.split ?? "none") === (labelProps.split ?? "none")
    );
  };

  const presetTitle = (preset: LabelPreset): string => {
    if (preset.title) return preset.title;
    if (preset.autoLength) return $tr("params.label.auto_length");
    return `${mm(presetDots(preset, preset.width))}×${mm(presetDots(preset, preset.height))} mm`;
  };

  /** Mini label drawing, scaled to fit a 64×28 px box */
  const thumbStyle = (preset: LabelPreset): string => {
    const w = presetDots(preset, preset.width);
    const h = presetDots(preset, preset.height);
    const scale = Math.min(64 / w, 28 / h);
    return `width: ${Math.round(w * scale)}px; height: ${Math.round(h * scale)}px;`;
  };

  const closeMenu = () => Dropdown.getOrCreateInstance(toggleEl).hide();

  const applyPreset = (preset: LabelPreset) => {
    onChange(makeLabelProps(preset));
    closeMenu();
  };

  const formPreset = (): LabelPreset => ({
    ...(printer === "d11s" ? {} : { printer }),
    ...(continuous && autoLength ? { autoLength: true } : {}),
    dpmm: DOTS_PER_MM,
    unit: "mm",
    printDirection,
    width,
    height,
    title: title.trim() || undefined,
    shape,
    split,
    splitParts,
    tailPos,
    tailLength,
    mirror,
  });

  const onApplyCustom = () => {
    onChange(makeLabelProps(formPreset()));
    closeMenu();
  };

  const saveUserPresets = (presets: LabelPreset[]) => {
    try {
      LocalStoragePersistence.saveLabelPresets(presets);
      userPresets = presets;
    } catch (e) {
      Toasts.zodErrors(e, "Presets save error:");
    }
  };

  const onSavePreset = () => {
    saveUserPresets([...userPresets, formPreset()]);
  };

  const onDeletePreset = (idx: number) => {
    if (!confirm(`${$tr("params.label.delete_size")} ${presetTitle(userPresets[idx])}?`)) {
      return;
    }
    const result = [...userPresets];
    result.splice(idx, 1);
    saveUserPresets(result);
  };

  /** Prefill the custom form with the current label */
  const fillWithCurrentParams = () => {
    // A label for the other printer is no useful start: take that printer's first roll instead
    if (printerOf(labelProps) !== printer) {
      const roll = ROLLS[printer][0];
      width = roll.width;
      height = roll.height;
      printDirection = roll.printDirection;
      shape = "rect";
      split = "none";
      splitParts = 2;
      tailPos = "right";
      tailLength = 0;
      mirror = "none";
      autoLength = false;
      return;
    }
    const paper = paperDots(labelProps);
    width = mm(paper.width);
    height = mm(paper.height);
    printDirection = labelProps.printDirection;
    shape = labelProps.shape ?? "rect";
    split = labelProps.split ?? "none";
    splitParts = labelProps.splitParts ?? 2;
    tailPos = labelProps.tailPos ?? "right";
    tailLength = mm(labelProps.tailLength ?? 0);
    mirror = labelProps.mirror ?? "none";
    autoLength = labelProps.autoLength ?? false;
  };

  /** The user's sizes for this printer, with their index in the saved list */
  let visibleUserPresets = $derived(
    userPresets.map((preset, idx) => ({ preset, idx })).filter(({ preset }) => printerOf(preset) === printer),
  );

  let rolls = $derived<LabelPreset[]>(continuous ? [...ROLLS[printer], MXW01_AUTO_LENGTH] : ROLLS[printer]);

  const toggleCustom = () => {
    customOpen = !customOpen;
    if (customOpen) fillWithCurrentParams();
  };

  const onFlip = () => {
    const widthTmp = width;
    width = height;
    height = widthTmp;
    printDirection = printDirection === "top" ? "left" : "top";
  };

  /** Imports label sizes (presets), replacing the saved ones. Checks the file before asking */
  const onImportClicked = async () => {
    const rawData = JSON.parse(await FileUtils.pickAndReadSingleTextFile("json"));

    // A label file picked here by mistake: say where it goes instead of a schema error
    if (ExportedLabelTemplateSchema.safeParse(rawData).success) {
      Toasts.error($tr("params.label.import.is_label"));
      return;
    }

    const presets = z.array(LabelPresetSchema).safeParse(rawData);
    if (!presets.success) {
      Toasts.zodErrors(presets.error, "Presets load error:");
      return;
    }

    if (!confirm($tr("params.label.warning.import"))) {
      return;
    }

    saveUserPresets(presets.data);
  };

  const onExportClicked = () => {
    try {
      FileUtils.saveLabelPresetsAsJson(userPresets);
    } catch (e) {
      Toasts.zodErrors(e, "Presets save error:");
    }
  };

  onMount(() => {
    try {
      const saved = LocalStoragePersistence.loadLabelPresets() ?? [];
      userPresets = saved.filter((p) => !OLD_DEFAULT_TITLES.has(p.title ?? ""));
    } catch (e) {
      Toasts.zodErrors(e, "Presets load error:");
    }
  });

  $effect(() => {
    if (shape === "circle" && split !== "none") split = "none";
  });

  $effect(() => {
    if (split === "none" || tailLength < 0) tailLength = 0;
  });

  $effect(() => {
    if (mirror === "flip" && splitParts !== 2) mirror = "copy";
  });
</script>

<div class="dropdown">
  <button
    class="tool-btn"
    class:warn={error !== ""}
    title={error}
    bind:this={toggleEl}
    data-bs-toggle="dropdown"
    data-bs-auto-close="outside">
    <MdIcon icon="straighten" />
    <span>{sizeLabel}</span>
  </button>
  <div class="dropdown-menu dropdown-sheet size-menu">
    <h6 class="dropdown-header">{$tr("params.label.menu_title")}</h6>

    <div class="px-3 pb-3">
      <div class="section-title">{$tr("params.label.printer")}</div>
      <div class="printer-switch" role="group" aria-label={$tr("params.label.printer")}>
        {#each DRIVERS as d (d.id)}
          <button
            class="btn {printer === d.id ? 'btn-primary' : 'btn-outline-secondary'}"
            aria-pressed={printer === d.id}
            disabled={connected && printer !== d.id}
            onclick={() => designPrinter.set(d.id)}>{d.displayName}</button>
        {/each}
      </div>
      {#if connected}
        <div class="form-text mb-3">{$tr("params.label.printer.connected")}</div>
      {/if}

      <div class="section-title">{$tr(continuous ? "params.label.rolls.wide" : "params.label.rolls")}</div>
      <div class="roll-grid">
        {#each rolls as roll (presetTitle(roll))}
          <button class="roll-btn" class:active={isActive(roll)} onclick={() => applyPreset(roll)}>
            <span class="thumb-box">
              <span
                class="thumb"
                class:feed-top={roll.printDirection === "top"}
                class:auto={roll.autoLength}
                style={thumbStyle(roll)}></span>
            </span>
            <span>{presetTitle(roll)}</span>
          </button>
        {/each}
      </div>

      {#if visibleUserPresets.length > 0}
        <div class="section-title">{$tr("params.label.my_sizes")}</div>
        <div class="chips">
          {#each visibleUserPresets as { preset, idx } (idx)}
            <div class="chip" class:active={isActive(preset)}>
              <button class="chip-main" onclick={() => applyPreset(preset)}>{presetTitle(preset)}</button>
              <button
                class="chip-del"
                onclick={() => onDeletePreset(idx)}
                title={$tr("params.label.delete_size")}
                aria-label={$tr("params.label.delete_size")}>
                <MdIcon icon="close" />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <button class="btn btn-outline-secondary custom-toggle" onclick={toggleCustom} aria-expanded={customOpen}>
        <MdIcon icon="tune" />
        <span class="flex-grow-1 text-start">{$tr("params.label.custom")}</span>
        <MdIcon icon={customOpen ? "expand_less" : "expand_more"} />
      </button>

      {#if customOpen}
        <div class="custom-form">
          <div class="input-group flex-nowrap input-group-sm mb-1">
            <span class="input-group-text">{$tr("params.label.size")}</span>
            <input class="form-control" type="number" min="1" step="1" inputmode="decimal" bind:value={width} />
            <button class="btn btn-sm btn-secondary" onclick={onFlip} title={$tr("params.label.direction")}>
              <MdIcon icon="swap_horiz" />
            </button>
            <input class="form-control" type="number" min="1" step="1" inputmode="decimal" bind:value={height} />
            <span class="input-group-text">{$tr("params.label.mm")}</span>
          </div>
          <div class="form-text mb-2">
            {#if customAcross > printableMm}
              {$tr(continuous ? "params.label.printable_note.wide" : "params.label.printable_note")
                .replace("{printable}", String(printableMm))
                .replace("{label}", String(customAcross))}
            {:else}
              {$tr(continuous ? "params.label.size_hint.wide" : "params.label.size_hint")}
            {/if}
          </div>

          {#if continuous}
            <div class="form-check mb-2 auto-length-check">
              <input class="form-check-input" type="checkbox" id="auto-length" bind:checked={autoLength} />
              <label class="form-check-label" for="auto-length">
                {$tr("params.label.auto_length")}
                <span class="form-text d-block mt-0">{$tr("params.label.auto_length.hint")}</span>
              </label>
            </div>
          {/if}

          <div class="input-group flex-nowrap input-group-sm print-dir-switch mb-2" role="group">
            <span class="input-group-text w-100">{$tr("params.label.direction")}</span>
            {#each printDirections as v (v)}
              <input
                type="radio"
                class="btn-check"
                name="print-dir"
                id="print-dir-{v}"
                autocomplete="off"
                bind:group={printDirection}
                value={v} />
              <label class="btn btn-outline-secondary px-3" for="print-dir-{v}">
                <div class="svg-icon"></div>
              </label>
            {/each}
          </div>

          <div class="input-group flex-nowrap input-group-sm label-shape-switch mb-2" role="group">
            <span class="input-group-text w-100">{$tr("params.label.shape")}</span>
            {#each labelShapes as v (v)}
              <input
                type="radio"
                class="btn-check"
                name="label-shape"
                id="label-shape-{v}"
                autocomplete="off"
                bind:group={shape}
                value={v} />
              <label class="btn btn-outline-secondary px-3" for="label-shape-{v}">
                <div class="svg-icon"></div>
              </label>
            {/each}
          </div>

          {#if shape !== "circle"}
            <div class="input-group flex-nowrap input-group-sm label-split-switch mb-2" role="group">
              <span class="input-group-text w-100">{$tr("params.label.split")}</span>
              {#each labelSplits as v (v)}
                <input
                  type="radio"
                  class="btn-check"
                  name="label-split"
                  id="label-split-{v}"
                  autocomplete="off"
                  bind:group={split}
                  value={v} />
                <label class="btn btn-outline-secondary px-3" for="label-split-{v}">
                  <div class="svg-icon"></div>
                </label>
              {/each}
            </div>

            {#if split !== "none"}
              <div class="input-group flex-nowrap input-group-sm mb-2">
                <span class="input-group-text">{$tr("params.label.split.count")}</span>
                <input class="form-control" type="number" min="1" bind:value={splitParts} />
              </div>
            {/if}
          {/if}

          {#if split !== "none"}
            <div class="input-group flex-nowrap input-group-sm mirror-switch mb-2" role="group">
              <span class="input-group-text w-100">{$tr("params.label.mirror")}</span>
              {#each mirrorTypes as v (v)}
                <input
                  type="radio"
                  class="btn-check"
                  name="mirror"
                  id="mirror-{v}"
                  autocomplete="off"
                  bind:group={mirror}
                  value={v} />
                <label class="btn btn-outline-secondary px-3" for="mirror-{v}">
                  <div class="svg-icon"></div>
                </label>
              {/each}
            </div>

            <div class="input-group flex-nowrap input-group-sm tail-pos-switch mb-2" role="group">
              <span class="input-group-text w-100">{$tr("params.label.tail.position")}</span>
              {#each tailPositions as v (v)}
                <input
                  type="radio"
                  class="btn-check"
                  name="tail-pos"
                  id="tail-{v}"
                  autocomplete="off"
                  bind:group={tailPos}
                  value={v} />
                <label class="btn btn-outline-secondary px-3" for="tail-{v}">
                  <div class="svg-icon"></div>
                </label>
              {/each}
            </div>

            <div class="input-group flex-nowrap input-group-sm mb-2">
              <span class="input-group-text">{$tr("params.label.tail.length")}</span>
              <input class="form-control" type="number" min="1" bind:value={tailLength} />
              <span class="input-group-text">{$tr("params.label.mm")}</span>
            </div>
          {/if}

          <div class="input-group flex-nowrap input-group-sm mb-2">
            <span class="input-group-text">{$tr("params.label.label_title")}</span>
            <input class="form-control" type="text" bind:value={title} />
          </div>

          <div class="d-flex gap-2 justify-content-end flex-wrap">
            <button class="btn btn-sm btn-secondary" onclick={onSavePreset}>
              <MdIcon icon="bookmark_add" />
              {$tr("params.label.save_template")}
            </button>
            <button class="btn btn-sm btn-primary" onclick={onApplyCustom}>{$tr("params.label.apply")}</button>
          </div>

          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-sm btn-link text-secondary px-0" onclick={onImportClicked}>
              <MdIcon icon="data_object" />
              {$tr("params.label.import")}
            </button>
            <button class="btn btn-sm btn-link text-secondary px-0" onclick={onExportClicked}>
              <MdIcon icon="data_object" />
              {$tr("params.label.export")}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .dropdown-menu {
    width: 100vw;
    max-width: 450px;
  }

  .section-title {
    margin: 0.25rem 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-tertiary);
  }

  .roll-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .roll-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.25rem;
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
    border-radius: var(--radius-md);
    color: var(--ink-primary);
    font-weight: 600;
    font-size: 0.875rem;
  }

  .roll-btn.active,
  .chip.active {
    border-color: var(--bs-primary);
    box-shadow: 0 0 0 1px var(--bs-primary);
  }

  .thumb-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 28px;
  }

  .thumb {
    background: #fff;
    border-radius: 2px;
    border-left: 2px solid var(--mark-feed);
  }

  .thumb.feed-top {
    border-left: none;
    border-top: 2px solid var(--mark-feed);
  }

  .thumb.auto {
    border-bottom: 2px dashed var(--ink-tertiary);
    border-radius: 2px 2px 0 0;
  }

  .printer-switch {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .printer-switch .btn {
    min-height: 44px;
  }

  .auto-length-check .form-check-input {
    width: 1.25em;
    height: 1.25em;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .chip {
    display: flex;
    align-items: stretch;
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
    border-radius: 999px;
    overflow: hidden;
  }

  .chip-main,
  .chip-del {
    background: none;
    border: none;
    color: var(--ink-primary);
  }

  .chip-main {
    padding: 0.5rem 0.25rem 0.5rem 0.875rem;
    font-size: 0.875rem;
  }

  .chip-del {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2.5rem;
    color: var(--ink-tertiary);
  }

  .chip-del:hover,
  .chip-del:active {
    color: var(--bs-danger);
  }

  .custom-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .custom-form {
    margin-top: 0.75rem;
  }

  .svg-icon {
    height: 1.5em;
    width: 1.5em;
    background-size: cover;
  }

  .tail-pos-switch .svg-icon {
    background-image: url("../assets/tail-pos.svg");
  }
  .tail-pos-switch label[for="tail-bottom"] .svg-icon {
    transform: rotate(90deg);
  }
  .tail-pos-switch label[for="tail-left"] .svg-icon {
    transform: rotate(180deg);
  }
  .tail-pos-switch label[for="tail-top"] .svg-icon {
    transform: rotate(270deg);
  }
  .print-dir-switch .svg-icon {
    background-image: url("../assets/print-dir.svg");
  }
  .print-dir-switch label[for="print-dir-top"] .svg-icon {
    transform: rotate(90deg);
  }

  .label-shape-switch label[for="label-shape-rect"] .svg-icon {
    background-image: url("../assets/shape-rect.svg");
  }
  .label-shape-switch label[for="label-shape-rounded_rect"] .svg-icon {
    background-image: url("../assets/shape-rrect.svg");
  }
  .label-shape-switch label[for="label-shape-circle"] .svg-icon {
    background-image: url("../assets/shape-circle.svg");
  }

  .label-split-switch label[for="label-split-none"] .svg-icon {
    background-image: url("../assets/shape-rrect.svg");
  }
  .label-split-switch label[for="label-split-vertical"] .svg-icon {
    background-image: url("../assets/split-vertical.svg");
    transform: rotate(90deg);
  }
  .label-split-switch label[for="label-split-horizontal"] .svg-icon {
    background-image: url("../assets/split-vertical.svg");
  }

  .mirror-switch label[for="mirror-none"] .svg-icon {
    background-image: url("../assets/mirror-none.svg");
  }
  .mirror-switch label[for="mirror-copy"] .svg-icon {
    background-image: url("../assets/mirror-copy.svg");
  }
  .mirror-switch label[for="mirror-flip"] .svg-icon {
    background-image: url("../assets/mirror-flip.svg");
  }
</style>
