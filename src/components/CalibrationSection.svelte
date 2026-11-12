<script lang="ts">
  import type { PrinterModelMeta } from "$/lib/printer";
  import { appConfig, printerClient } from "$/stores";
  import type { PreviewProps, PreviewPropsOffset } from "$/types";
  import { DOTS_PER_MM } from "$/defaults";
  import { tr } from "$/utils/i18n";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { fitDotModel, GREY_TEST_MODES, readGreyStrip, type DotFit } from "$/utils/grey_strip";
  import { builtInDotModel, D11S_DOT_MODEL, dotModelFor, ownDotModel, setOwnDotModel } from "$/utils/print_sim";
  import { captureGreyStrip, rowPicture, stackPictures, stripCameraAvailable } from "$/utils/strip_camera";
  import { Toasts } from "$/utils/toasts";
  import { Utils } from "$/lib/printer";
  import {
    drawOffsetLabel,
    formatMm,
    GREY_ROW,
    greyTestPages,
    hasLabelGaps,
    offsetPlan,
    printTestImage,
    testLabelFor,
    withOffset,
    type TestPrintOptions,
  } from "$/utils/test_prints";
  import MdIcon from "$/components/basic/MdIcon.svelte";

  /** Test prints for the connected printer, shown in the printer sheet */
  let { meta }: { meta: PrinterModelMeta } = $props();

  const printer = $derived(meta.driver);
  const gaps = $derived(hasLabelGaps(meta));
  /** Bumped when a correction measured here is saved or dropped, since the models live outside Svelte */
  let modelVersion = $state(0);
  const hasModel = $derived(modelVersion >= 0 && dotModelFor(printer) !== undefined);
  const hasOwnModel = $derived(modelVersion >= 0 && ownDotModel(printer) !== undefined);

  let busy = $state(false);
  let corrected = $state(false);
  let offsetStep = $state<number>(DOTS_PER_MM);
  /** Offsets of the last printed strip, to pick from */
  let offsetsPrinted = $state<number[]>([]);

  const loadPreviewProps = (): PreviewProps => {
    try {
      return LocalStoragePersistence.loadSavedPreviewProps() ?? {};
    } catch {
      return {};
    }
  };

  let offset = $state<PreviewPropsOffset>(loadPreviewProps().offset ?? { x: 0, y: 0, offsetType: "inner" });
  const plan = $derived(offsetPlan(offset.x, offsetStep));

  /** Print settings: what the print preview keeps for next time, else the printer's defaults */
  const printOptions = (label: { direction: TestPrintOptions["direction"] }): TestPrintOptions => {
    const saved = loadPreviewProps();
    return {
      direction: label.direction,
      density: saved.density ?? meta.densityDefault,
      labelType: saved.labelType !== undefined && meta.paperTypes.includes(saved.labelType) ? saved.labelType : meta.paperTypes[0],
    };
  };

  const testLabel = () => testLabelFor(printer, meta, LocalStoragePersistence.loadLastLabelProps());

  const pageDelay = async (index: number, total: number) => {
    const delay = $appConfig.pageDelay;
    if (delay !== undefined && delay > 0 && index < total - 1) await Utils.sleep(delay);
  };

  const printPages = async (pages: HTMLCanvasElement[], opts: TestPrintOptions) => {
    busy = true;
    try {
      for (let i = 0; i < pages.length; i++) {
        await printTestImage($printerClient, pages[i], opts);
        await pageDelay(i, pages.length);
      }
    } catch (e) {
      console.error(e);
      Toasts.error(e);
    } finally {
      busy = false;
    }
  };

  const printGreyTest = () => {
    const label = testLabel();
    const pages = greyTestPages(printer, meta, label, corrected && hasModel);
    // The offset is for labels; a strip on a roll prints as it is
    return printPages(gaps ? pages.map((p) => withOffset(p, offset)) : pages, printOptions(label));
  };

  const printOffsetStrip = () => {
    const label = testLabel();
    const values = [...plan];
    offsetsPrinted = values;
    const pages = values.map((x, i) => withOffset(drawOffsetLabel(label.width, label.height, x, i), { ...offset, x }));
    return printPages(pages, printOptions(label));
  };

  /** Photos are scaled down to this many pixels on the long side before measuring; the patches are averaged anyway */
  const PHOTO_SIDE = 2400;

  let measuring = $state(false);
  let photoMessage = $state("");
  /** The photo with the measured boxes drawn in, and the model fitted to it */
  let photoResult = $state<{ overlay: string; fit: DotFit; uneven: boolean } | undefined>();

  /**
   * The rows of the grey test as it prints now: the label that's open in the designer (labels with gaps, a row on
   * each), or the roll's width and row height. The printer can't say what's loaded, so this is what a photo is
   * read as too.
   */
  const rowSize = () => {
    const label = testLabel();
    return { width: label.width, height: gaps ? label.height : GREY_ROW };
  };
  const paperText = $derived.by(() => {
    const { width, height } = rowSize();
    return `${Number((width / DOTS_PER_MM).toFixed(1))} × ${Number((height / DOTS_PER_MM).toFixed(1))} mm`;
  });

  /** Fit this printer's dot model to a measured grey test (printed without correction) and show what came of it */
  const showFit = (measured: number[][], marks: boolean, overlay: string, paperEvenness: number) => {
    const { width, height } = rowSize();
    const fit = fitDotModel([{ measured, marks }], width, height, builtInDotModel(printer) ?? D11S_DOT_MODEL);
    photoResult = { overlay, fit, uneven: paperEvenness < 0.75 };
  };

  /** Read the grey test with our own camera screen, which measures as soon as the strip is in view */
  const measureWithCamera = async () => {
    photoMessage = "";
    photoResult = undefined;
    try {
      const { width, height } = rowSize();
      const capture = await captureGreyStrip(width, height, gaps ? 1 : GREY_TEST_MODES.length);
      if (capture) showFit(capture.measured, capture.marks, capture.overlay, capture.paperEvenness);
    } catch (e) {
      console.error(e);
      photoMessage = $tr((e as Error)?.name === "NotAllowedError" ? "editor.scan.no_permission" : "editor.scan.no_camera");
    }
  };

  /** The same from a photo taken earlier or with the phone's camera app */
  const measurePhoto = async (file: Blob) => {
    measuring = true;
    photoMessage = "";
    photoResult = undefined;
    try {
      // createImageBitmap turns the photo upright (EXIF)
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      const { width, height } = rowSize();
      const reading = readGreyStrip(ctx.getImageData(0, 0, canvas.width, canvas.height), width, height);
      if (typeof reading === "string") {
        photoMessage = $tr("calibration.auto.not_found");
        return;
      }
      if (reading.corrected || !reading.complete) {
        photoMessage = $tr(reading.corrected ? "calibration.auto.corrected" : "calibration.auto.partial");
        return;
      }
      const overlay = stackPictures(reading.rows.map((row) => rowPicture(canvas, row, width, height)));
      showFit(reading.measured, reading.marks, overlay, reading.paperEvenness);
    } catch (e) {
      console.error(e);
      photoMessage = $tr("calibration.auto.failed");
    } finally {
      measuring = false;
    }
  };

  const pickPhoto = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) measurePhoto(file);
    };
    input.click();
  };

  const useMeasured = () => {
    if (!photoResult) return;
    try {
      setOwnDotModel(printer, photoResult.fit.model);
      modelVersion++;
      photoResult = undefined;
      Toasts.message($tr("calibration.auto.saved"));
    } catch (e) {
      Toasts.error(e);
    }
  };

  const dropMeasured = () => {
    setOwnDotModel(printer);
    modelVersion++;
  };

  /** An offset picked from a test strip is a calibration: the print preview uses it from now on */
  const useOffset = (x: number) => {
    offset = { ...offset, x };
    try {
      LocalStoragePersistence.savePreviewProps({ ...loadPreviewProps(), offset });
      Toasts.message($tr("calibration.offset.saved"));
    } catch (e) {
      Toasts.error(e);
    }
  };
</script>

<div class="calibration">
  <div class="title">{$tr("preview.group.grey")}</div>
  <p class="hint">{$tr(gaps ? "preview.grey.help" : "preview.grey.help.strip")}</p>
  {#if hasModel}
    <div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" role="switch" id="grey-corrected" bind:checked={corrected} />
      <label class="form-check-label" for="grey-corrected">{$tr("calibration.grey.corrected")}</label>
    </div>
  {:else}
    <p class="hint">{$tr("preview.grey.no_model")}</p>
  {/if}
  <button class="btn btn-secondary w-100" disabled={busy} onclick={printGreyTest}>
    <MdIcon icon="gradient" />
    {$tr("preview.grey.print")}
  </button>

  <div class="title mt-3">{$tr("calibration.auto.title")}</div>
  <p class="hint">
    {$tr(gaps ? "calibration.auto.help.labels" : "calibration.auto.help")}
    <br />{$tr("calibration.auto.paper")} <strong>{paperText}</strong>
  </p>
  {#if stripCameraAvailable()}
    <button class="btn btn-secondary w-100 mb-2" disabled={measuring} onclick={measureWithCamera}>
      <MdIcon icon="photo_camera" />
      {$tr("calibration.auto.camera")}
    </button>
  {/if}
  <button class="btn btn-secondary w-100" disabled={measuring} onclick={pickPhoto}>
    <MdIcon icon="image" />
    {$tr("calibration.auto.pick")}
  </button>
  {#if measuring}
    <p class="hint mt-2 mb-0"><span class="spinner-border spinner-border-sm"></span> {$tr("calibration.auto.reading")}</p>
  {/if}
  {#if photoMessage}
    <p class="hint mt-2 mb-0">{photoMessage}</p>
  {/if}
  {#if photoResult}
    <img class="overlay mt-2" src={photoResult.overlay} alt="" />
    <p class="hint mt-2">
      {$tr("calibration.auto.error")}
      <strong>{photoResult.fit.rms.toFixed(3)}</strong>
      {#if photoResult.uneven}<br />{$tr("calibration.auto.uneven")}{/if}
      {#if photoResult.fit.rms > 0.07}<br />{$tr("calibration.auto.poor")}{/if}
    </p>
    <button class="btn btn-primary w-100" onclick={useMeasured}>
      <MdIcon icon="check" />
      {$tr("calibration.auto.use")}
    </button>
  {/if}
  {#if hasOwnModel}
    <p class="hint mt-2">{$tr("calibration.auto.own")}</p>
    <button class="btn btn-secondary w-100" onclick={dropMeasured}>
      <MdIcon icon="restart_alt" />
      {$tr("calibration.auto.reset")}
    </button>
  {/if}

  {#if gaps}
    <div class="title mt-3">{$tr("preview.calibration")}</div>
    <div class="step">
      <span>{$tr("calibration.offset.step")}</span>
      <div class="btn-group" role="group">
        {#each [DOTS_PER_MM / 2, DOTS_PER_MM] as step (step)}
          <button
            class="btn {offsetStep === step ? 'btn-primary' : 'btn-secondary'}"
            onclick={() => (offsetStep = step)}>{step / DOTS_PER_MM} mm</button>
        {/each}
      </div>
    </div>
    <p class="hint">
      {$tr("preview.calibration.help")}
      {plan.map((v) => formatMm(v)).join(" · ")} mm
    </p>
    <button class="btn btn-secondary w-100" disabled={busy} onclick={printOffsetStrip}>
      <MdIcon icon="print" />
      {$tr("preview.calibration.print")}
    </button>

    {#if offsetsPrinted.length > 0}
      <p class="hint mt-2 mb-1">{$tr("preview.calibration.pick")}</p>
      <div class="values">
        {#each offsetsPrinted as v (v)}
          <button class="btn {offset.x === v ? 'btn-primary' : 'btn-secondary'}" onclick={() => useOffset(v)}>
            {formatMm(v)} mm
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  {#if busy}
    <p class="hint mt-2 mb-0"><span class="spinner-border spinner-border-sm"></span> {$tr("calibration.printing")}</p>
  {/if}
</div>

<style>
  .calibration {
    padding-top: 0.25rem;
  }

  .title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-tertiary);
    margin-bottom: 0.25rem;
  }

  .hint {
    font-size: 0.8125rem;
    color: var(--ink-tertiary);
    margin: 0 0 0.5rem;
  }

  .overlay {
    display: block;
    width: 100%;
    border-radius: 0.375rem;
  }

  .step {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .step .btn,
  .values .btn {
    min-height: 2.75rem;
  }

  .values {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }

  .values .btn {
    padding-left: 0;
    padding-right: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
