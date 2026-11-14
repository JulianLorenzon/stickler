<script lang="ts">
  import type { PrinterModelMeta } from "$/lib/printer";
  import { appConfig, printerClient } from "$/stores";
  import type { PreviewProps, PreviewPropsOffset } from "$/types";
  import { DOTS_PER_MM } from "$/defaults";
  import { tr } from "$/utils/i18n";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { fitDotModel, GREY_TEST_MODES, readGreyLabels, readGreyStrip, type DotFit } from "$/utils/grey_strip";
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

  /** Test prints for the connected printer, as steps on the calibration page */
  let { meta }: { meta: PrinterModelMeta } = $props();

  const printer = $derived(meta.driver);
  const gaps = $derived(hasLabelGaps(meta));
  /** Bumped when a correction measured here is saved or dropped, since the models live outside Svelte */
  let modelVersion = $state(0);
  const hasModel = $derived(modelVersion >= 0 && dotModelFor(printer) !== undefined);
  const hasOwnModel = $derived(modelVersion >= 0 && ownDotModel(printer) !== undefined);

  /** The test print being sent, so its button shows the spinner */
  let busy = $state<"grey" | "offset" | undefined>();
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

  /**
   * The label size the grey test was last printed on, per printer: what a photo of it is read as, whatever label is
   * open in the designer by then
   */
  const PRINTED_KEY = "grey_test_size";
  const printedSizes = (): Record<string, { width: number; height: number }> => {
    try {
      return JSON.parse(localStorage.getItem(PRINTED_KEY) ?? "{}") ?? {};
    } catch {
      return {};
    }
  };
  const rememberPrinted = ({ width, height }: { width: number; height: number }) => {
    try {
      localStorage.setItem(PRINTED_KEY, JSON.stringify({ ...printedSizes(), [printer]: { width, height } }));
    } catch {
      // Without storage a photo is read as the label that's open
    }
  };

  const pageDelay = async (index: number, total: number) => {
    const delay = $appConfig.pageDelay;
    if (delay !== undefined && delay > 0 && index < total - 1) await Utils.sleep(delay);
  };

  const printPages = async (what: "grey" | "offset", pages: HTMLCanvasElement[], opts: TestPrintOptions) => {
    busy = what;
    try {
      for (let i = 0; i < pages.length; i++) {
        await printTestImage($printerClient, pages[i], opts);
        await pageDelay(i, pages.length);
      }
    } catch (e) {
      console.error(e);
      Toasts.error(e);
    } finally {
      busy = undefined;
    }
  };

  const printGreyTest = () => {
    const label = testLabel();
    const pages = greyTestPages(printer, meta, label, corrected && hasModel);
    if (gaps) rememberPrinted(label);
    // The offset is for labels; a strip on a roll prints as it is
    return printPages("grey", gaps ? pages.map((p) => withOffset(p, offset)) : pages, printOptions(label));
  };

  const printOffsetStrip = () => {
    const label = testLabel();
    const values = [...plan];
    offsetsPrinted = values;
    const pages = values.map((x, i) => withOffset(drawOffsetLabel(label.width, label.height, x, i), { ...offset, x }));
    return printPages("offset", pages, printOptions(label));
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
  /** The rows of the grey test to look for in a photo: as last printed from this phone, else as it prints now */
  const readSize = () => {
    const printed = gaps ? printedSizes()[printer] : undefined;
    return printed && printed.width > 0 && printed.height > 0 ? { width: printed.width, height: printed.height } : rowSize();
  };
  const paperText = $derived.by(() => {
    const { width, height } = rowSize();
    return `${Number((width / DOTS_PER_MM).toFixed(1))} × ${Number((height / DOTS_PER_MM).toFixed(1))} mm`;
  });

  /** Fit this printer's dot model to a measured grey test (printed without correction) and show what came of it */
  const showFit = (measured: number[][], marks: boolean, width: number, height: number, overlay: string, paperEvenness: number) => {
    const fit = fitDotModel([{ measured, marks }], width, height, builtInDotModel(printer) ?? D11S_DOT_MODEL);
    photoResult = { overlay, fit, uneven: paperEvenness < 0.75 };
  };

  /** Read the grey test with our own camera screen, which measures as soon as the strip is in view */
  const measureWithCamera = async () => {
    photoMessage = "";
    photoResult = undefined;
    try {
      const { width, height } = readSize();
      const capture = await captureGreyStrip(width, height, gaps ? 1 : GREY_TEST_MODES.length);
      if (capture) showFit(capture.measured, capture.marks, capture.width, height, capture.overlay, capture.paperEvenness);
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

      const { width: asked, height } = readSize();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Labels can be another size than the one asked for; a roll is as wide as the print head
      const reading = gaps ? readGreyLabels(pixels, asked, height) : readGreyStrip(pixels, asked, height);
      if (typeof reading === "string") {
        photoMessage = $tr("calibration.auto.not_found");
        return;
      }
      if (reading.corrected || !reading.complete) {
        photoMessage = $tr(reading.corrected ? "calibration.auto.corrected" : "calibration.auto.partial");
        return;
      }
      const { width } = reading;
      const overlay = stackPictures(reading.rows.map((row) => rowPicture(canvas, row, width, height)));
      showFit(reading.measured, reading.marks, width, height, overlay, reading.paperEvenness);
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

<section class="block">
  <h2 class="block-title">{$tr("calibration.dots.title")}</h2>
  <p class="intro">{$tr("calibration.dots.intro")}</p>

  <div class="step">
    <div class="step-head"><span class="num">1</span>{$tr("calibration.step.print")}</div>
    <p class="hint">
      {$tr(gaps ? "calibration.grey.what.labels" : "calibration.grey.what")}
      {$tr("calibration.auto.paper")} <strong>{paperText}</strong>
    </p>
    {#if hasModel}
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" role="switch" id="grey-corrected" bind:checked={corrected} />
        <label class="form-check-label" for="grey-corrected">{$tr("calibration.grey.corrected")}</label>
      </div>
      <p class="hint">{$tr("calibration.grey.corrected.hint")}</p>
    {:else}
      <p class="hint">{$tr("calibration.grey.no_model")}</p>
    {/if}
    <button class="btn btn-secondary w-100" disabled={busy !== undefined} onclick={printGreyTest}>
      {#if busy === "grey"}
        <span class="spinner-border spinner-border-sm"></span>
      {:else}
        <MdIcon icon="gradient" />
      {/if}
      {$tr("preview.grey.print")}
    </button>
  </div>

  <div class="step">
    <div class="step-head"><span class="num">2</span>{$tr("calibration.step.measure")}</div>
    <p class="hint">{$tr(gaps ? "calibration.measure.help.labels" : "calibration.measure.help")}</p>
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
      <p class="message mt-2 mb-0">{photoMessage}</p>
    {/if}
  </div>

  <div class="step">
    <div class="step-head"><span class="num">3</span>{$tr("calibration.step.result")}</div>
    {#if photoResult}
      <img class="overlay" src={photoResult.overlay} alt="" />
      <p class="hint mt-2">
        {$tr("calibration.auto.error")}
        <strong>{photoResult.fit.rms.toFixed(3)}</strong>
      </p>
      {#if photoResult.uneven}<p class="message">{$tr("calibration.auto.uneven")}</p>{/if}
      {#if photoResult.fit.rms > 0.07}<p class="message">{$tr("calibration.auto.poor")}</p>{/if}
      <button class="btn btn-primary w-100" onclick={useMeasured}>
        <MdIcon icon="check" />
        {$tr("calibration.auto.use")}
      </button>
    {:else if !hasOwnModel}
      <p class="hint mb-0">{$tr("calibration.result.empty")}</p>
    {/if}
    {#if hasOwnModel}
      <p class="hint" class:mt-3={photoResult !== undefined}>{$tr("calibration.auto.own")}</p>
      <button class="btn btn-secondary w-100" onclick={dropMeasured}>
        <MdIcon icon="restart_alt" />
        {$tr("calibration.auto.reset")}
      </button>
    {/if}
  </div>
</section>

{#if gaps}
  <section class="block">
    <h2 class="block-title">{$tr("calibration.offset.title")}</h2>
    <p class="intro">{$tr("calibration.offset.intro")}</p>

    <div class="step">
      <div class="step-head"><span class="num">1</span>{$tr("calibration.offset.step.print")}</div>
      <div class="step-size">
        <span>{$tr("calibration.offset.step_size")}</span>
        <div class="btn-group" role="group">
          {#each [DOTS_PER_MM / 2, DOTS_PER_MM] as step (step)}
            <button
              class="btn {offsetStep === step ? 'btn-primary' : 'btn-secondary'}"
              onclick={() => (offsetStep = step)}>{step / DOTS_PER_MM} mm</button>
          {/each}
        </div>
      </div>
      <p class="hint">
        {$tr("calibration.offset.strip")}
        <strong>{plan.map((v) => formatMm(v)).join(" · ")} mm</strong>
      </p>
      <button class="btn btn-secondary w-100" disabled={busy !== undefined} onclick={printOffsetStrip}>
        {#if busy === "offset"}
          <span class="spinner-border spinner-border-sm"></span>
        {:else}
          <MdIcon icon="print" />
        {/if}
        {$tr("preview.calibration.print")}
      </button>
    </div>

    <div class="step">
      <div class="step-head"><span class="num">2</span>{$tr("calibration.offset.step.pick")}</div>
      {#if offsetsPrinted.length > 0}
        <p class="hint">{$tr("calibration.offset.pick")}</p>
        <div class="values">
          {#each offsetsPrinted as v (v)}
            <button class="btn {offset.x === v ? 'btn-primary' : 'btn-secondary'}" onclick={() => useOffset(v)}>
              {formatMm(v)} mm
            </button>
          {/each}
        </div>
      {:else}
        <p class="hint mb-0">{$tr("calibration.offset.pick.empty")}</p>
      {/if}
    </div>
  </section>
{/if}

<style>
  .block {
    margin-top: 1rem;
  }

  .block + .block {
    margin-top: 2rem;
  }

  .block-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-tertiary);
    margin: 0 0 0.375rem;
  }

  .intro {
    font-size: 0.875rem;
    color: var(--ink-secondary);
    margin: 0 0 0.75rem;
  }

  /* A numbered step: a card like the printer card in the printer sheet */
  .step {
    padding: 0.875rem;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
  }

  .step + .step {
    margin-top: 0.5rem;
  }

  .step-head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .num {
    flex: none;
    width: 1.625rem;
    height: 1.625rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.8125rem;
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .hint {
    font-size: 0.8125rem;
    color: var(--ink-secondary);
    margin: 0 0 0.5rem;
  }

  .hint strong {
    color: var(--ink-primary);
    font-weight: 600;
    white-space: nowrap;
  }

  /* Something went wrong or may be off: stands out from the hints */
  .message {
    font-size: 0.8125rem;
    color: var(--status-warn);
    margin: 0 0 0.5rem;
  }

  .form-switch {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0;
  }

  .btn {
    min-height: 2.75rem;
  }

  .overlay {
    display: block;
    width: 100%;
    border-radius: var(--radius-sm);
  }

  .step-size {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
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
