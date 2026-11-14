<script lang="ts">
  import { untrack } from "svelte";
  import type { PrinterModelMeta } from "$/lib/printer";
  import { appConfig, printerClient, printerSheetOpen } from "$/stores";
  import type { PreviewProps, PreviewPropsOffset } from "$/types";
  import { DOTS_PER_MM, ROLLS, labelPropsForPreset, printerOf } from "$/defaults";
  import { locale, tr } from "$/utils/i18n";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { fitDotModel, GREY_TEST_MODES, readGreyLabels, readGreyStrip, type DotFit } from "$/utils/grey_strip";
  import { builtInDotModel, D11S_DOT_MODEL } from "$/utils/print_sim";
  import { activeCalibration, calibrations, saveCalibration } from "$/utils/calibrations";
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
    type TestLabel,
    type TestPrintOptions,
  } from "$/utils/test_prints";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import CorrectionsSection, { correctionName, type CheckTarget } from "$/components/CorrectionsSection.svelte";
  import CorrectionChart, { type ChartCorrection } from "$/components/CorrectionChart.svelte";
  import CheckSheet, { type CheckResult } from "$/components/CheckSheet.svelte";

  /**
   * Calibration of a printer as steps: test prints (when it's connected), measuring them and the corrections kept on
   * this phone
   */
  let { meta, connected }: { meta: PrinterModelMeta; connected: boolean } = $props();

  const printer = $derived(meta.driver);
  const gaps = $derived(hasLabelGaps(meta));
  /** A check print measured in step 2 is taken to be printed with the correction in use */
  const inUseTarget = (): CheckTarget | undefined => {
    const active = activeCalibration(printer, $calibrations);
    const model = active?.model ?? builtInDotModel(printer);
    return model && { label: correctionName(active, $locale, $tr), model, note: "" };
  };

  /** The test print being sent, so its button shows the spinner */
  let busy = $state<"grey" | "corrected" | "offset" | undefined>();
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

  const designerLabel = $derived(testLabelFor(printer, meta, LocalStoragePersistence.loadLastLabelProps()));

  /** A label size to print the grey test on: the design area in dots and the piece of paper it's on */
  interface SizeOption {
    width: number;
    height: number;
    paper: { width: number; height: number };
  }

  /**
   * Label sizes to print the grey test on (labels with gaps): the rolls sold for the printer and the user's own sizes,
   * and the label open in the designer if it's none of those
   */
  const sizeOptions = $derived.by((): SizeOption[] => {
    if (!gaps) return [];
    let presets = ROLLS[printer];
    try {
      presets = [...presets, ...(LocalStoragePersistence.loadLabelPresets() ?? [])];
    } catch {
      // Unreadable sizes: the rolls are enough
    }
    const options: SizeOption[] = presets
      .filter(
        (p) =>
          printerOf(p) === printer &&
          p.printDirection === meta.printDirection &&
          !p.autoLength &&
          (p.shape ?? "rect") !== "circle" &&
          (p.split ?? "none") === "none",
      )
      .map((p) => labelPropsForPreset(p, meta.printheadPixels))
      .map((lp) => ({ ...lp.size, paper: lp.paper ?? lp.size }));
    const designer = LocalStoragePersistence.loadLastLabelProps();
    if (designer && printerOf(designer) === printer && designer.printDirection === meta.printDirection) {
      options.push({ ...designer.size, paper: designer.paper ?? designer.size });
    }
    const unique = options.filter(
      (o, i) => options.findIndex((p) => p.width === o.width && p.height === o.height) === i && o.width >= 16 * DOTS_PER_MM,
    );
    return unique.sort((a, b) => a.paper.width - b.paper.width || a.paper.height - b.paper.height);
  });

  /** The label size picked for the grey test: the designer's to begin with */
  let size = $state<{ width: number; height: number }>(untrack(() => ({ width: designerLabel.width, height: designerLabel.height })));
  const sizeText = (o: SizeOption) => `${Number((o.paper.width / DOTS_PER_MM).toFixed(1))}×${Number((o.paper.height / DOTS_PER_MM).toFixed(1))}`;

  /** The grey test's label: the size picked here on labels with gaps; a roll as wide as the head */
  const testLabel = (): TestLabel => (gaps ? { ...size, direction: designerLabel.direction } : designerLabel);

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

  const printPages = async (what: NonNullable<typeof busy>, pages: HTMLCanvasElement[], opts: TestPrintOptions) => {
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

  /** The grey test, or with `check` a check print: the same corrected with it, its row titles saying which one */
  const printGreyTest = (check?: CheckTarget) => {
    if (!connected) return connect();
    const label = testLabel();
    const pages = greyTestPages(printer, meta, label, check && { model: check.model, note: `corrected ${check.note}` });
    if (gaps) rememberPrinted(label);
    // The offset is for labels; a strip on a roll prints as it is
    return printPages(check ? "corrected" : "grey", gaps ? pages.map((p) => withOffset(p, offset)) : pages, printOptions(label));
  };

  const connect = () => ($printerSheetOpen = true);


  /** The dither the chart shows: the print preview's when it's one on the grey test */
  const modeOfPreview = (): number => {
    const mode = loadPreviewProps().postProcess;
    const i = GREY_TEST_MODES.findIndex((m) => m.mode === (mode === "smart" ? "dither" : mode));
    return Math.max(0, i);
  };
  let modeIndex = $state(modeOfPreview());

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
  interface MeasuredResult {
    overlay: string;
    fit: DotFit;
    uneven: boolean;
    measured: number[][];
    size: { width: number; height: number };
    source: "camera" | "photo";
  }
  let photoResult = $state<MeasuredResult | undefined>();
  /** A measured check print (printed with correction), shown on its own sheet */
  let checkResult = $state<CheckResult | undefined>();
  let checkShown = $state(false);
  /** The saved correction opened in the list below */
  let openEntry = $state<string | undefined>();

  /** The new measurement against the built-in correction and the one in use */
  const resultChart = $derived.by((): ChartCorrection[] => {
    if (!photoResult) return [];
    const list: ChartCorrection[] = [];
    const builtIn = builtInDotModel(printer);
    if (builtIn) list.push({ id: "builtin", label: $tr("calibration.list.builtin"), role: "builtin", model: builtIn });
    const active = activeCalibration(printer, $calibrations);
    if (active) list.push({ id: active.id, label: $tr("calibration.list.in_use"), role: "in_use", model: active.model });
    list.push({ id: "new", label: $tr("calibration.list.new"), role: "other", model: photoResult.fit.model, measured: photoResult.measured });
    return list;
  });

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
  /** Width of the grey test on a roll, mm */
  const rollWidth = $derived(`${Number((rowSize().width / DOTS_PER_MM).toFixed(1))}`);

  /**
   * A measured grey test: printed without correction, fit this printer's dot model to it and show what came of it;
   * printed with correction (a check print), say how close its greys came to where they should be
   */
  const showFit = (
    check: CheckTarget | undefined,
    source: MeasuredResult["source"],
    corrected: boolean,
    measured: number[][],
    marks: boolean,
    width: number,
    height: number,
    overlay: string,
    paperEvenness: number,
  ) => {
    // A check print gets its own sheet and leaves a result still to be decided in step 3 as it is
    if (corrected) {
      checkResult = { overlay, measured, label: check?.label };
      checkShown = true;
      return;
    }
    if (fromList) Toasts.message($tr("calibration.check.plain"));
    const fit = fitDotModel([{ measured, marks }], width, height, builtInDotModel(printer) ?? D11S_DOT_MODEL);
    photoResult = { overlay, fit, uneven: paperEvenness < 0.75, measured, size: { width, height }, source };
  };

  /** Read the grey test with our own camera screen, which measures as soon as the strip is in view */
  /** Measuring a check from the list below: what goes wrong is said in a toast, step 2 is out of sight */
  let fromList = false;
  const say = (text: string) => (fromList ? Toasts.message(text) : (photoMessage = text));
  const start = (check?: CheckTarget) => {
    photoMessage = "";
    fromList = check !== undefined;
    return check ?? inUseTarget();
  };

  const measureWithCamera = async (from?: CheckTarget) => {
    const check = start(from);
    try {
      const { width, height } = readSize();
      const capture = await captureGreyStrip(width, height, gaps ? 1 : GREY_TEST_MODES.length);
      if (capture) {
        const c = capture;
        showFit(check, "camera", c.corrected, c.measured, c.marks, c.width, height, c.overlay, c.paperEvenness);
      }
    } catch (e) {
      console.error(e);
      say($tr((e as Error)?.name === "NotAllowedError" ? "editor.scan.no_permission" : "editor.scan.no_camera"));
    }
  };

  /** The same from a photo taken earlier or with the phone's camera app */
  const measurePhoto = async (file: Blob, check: CheckTarget | undefined) => {
    measuring = true;
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
        say($tr("calibration.auto.not_found"));
        return;
      }
      if (!reading.complete) {
        say($tr("calibration.auto.partial"));
        return;
      }
      const { width } = reading;
      const overlay = stackPictures(reading.rows.map((row) => rowPicture(canvas, row, width, height)));
      showFit(check, "photo", reading.corrected, reading.measured, reading.marks, width, height, overlay, reading.paperEvenness);
    } catch (e) {
      console.error(e);
      say($tr("calibration.auto.failed"));
    } finally {
      measuring = false;
    }
  };

  const pickPhoto = (from?: CheckTarget) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) measurePhoto(file, start(from));
    };
    input.click();
  };

  /** A check of a correction in the list: print it, or measure the print */
  const onCheck = (target: CheckTarget, how: "print" | "camera" | "photo") => {
    if (how === "print") printGreyTest(target);
    else if (how === "camera") measureWithCamera(target);
    else pickPhoto(target);
  };

  /** Keeps the measured correction in the list below, and uses it from now on with `use` */
  const keepMeasured = (use: boolean) => {
    if (!photoResult) return;
    try {
      const { fit, measured, size, source } = photoResult;
      const saved = saveCalibration(printer, { date: Date.now(), model: fit.model, rms: fit.rms, measured, size, source }, use);
      photoResult = undefined;
      openEntry = use ? undefined : saved.id;
      Toasts.message($tr(use ? "calibration.auto.saved" : "calibration.auto.kept"));
    } catch (e) {
      Toasts.error(e);
    }
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
    {#if gaps}
      <p class="hint">{$tr("calibration.grey.what.labels")}</p>
      {#if sizeOptions.length > 0}
        <div class="sizes" role="group" aria-label={$tr("calibration.size")}>
          <span class="sizes-title">{$tr("calibration.size")}</span>
          {#each sizeOptions as o (`${o.width}x${o.height}`)}
            {@const on = o.width === size.width && o.height === size.height}
            <button class="btn btn-sm {on ? 'btn-primary' : 'btn-outline-secondary'}" aria-pressed={on} onclick={() => (size = { width: o.width, height: o.height })}>
              {sizeText(o)} mm
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="hint">{$tr("calibration.grey.what").replace("{width}", rollWidth)}</p>
    {/if}

    {#if connected}
      <button class="btn btn-primary w-100" disabled={busy !== undefined} onclick={() => printGreyTest()}>
        {#if busy === "grey"}<span class="spinner-border spinner-border-sm"></span>{:else}<MdIcon icon="print" />{/if}
        {$tr("calibration.grey.print_plain")}
      </button>
      <p class="hint mt-2 mb-0">{$tr("calibration.grey.buttons.hint")}</p>
    {:else}
      <button class="btn btn-primary w-100" onclick={connect}>
        <MdIcon icon="bluetooth" />
        {$tr("calibration.connect")}
      </button>
    {/if}
  </div>

  <div class="step">
    <div class="step-head"><span class="num">2</span>{$tr("calibration.step.measure")}</div>
    <p class="hint">{$tr(gaps ? "calibration.measure.help.labels" : "calibration.measure.help")}</p>
    {#if stripCameraAvailable()}
      <button class="btn btn-secondary w-100 mb-2" disabled={measuring} onclick={() => measureWithCamera()}>
        <MdIcon icon="photo_camera" />
        {$tr("calibration.auto.camera")}
      </button>
    {/if}
    <button class="btn btn-secondary w-100" disabled={measuring} onclick={() => pickPhoto()}>
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
      {@const doubtful = photoResult.uneven || photoResult.fit.rms > 0.07}
      <p class="hint">
        {$tr("calibration.auto.error")}
        <strong>{photoResult.fit.rms.toFixed(3)}</strong>
      </p>
      {#if photoResult.uneven}<p class="message">{$tr("calibration.auto.uneven")}</p>{/if}
      {#if photoResult.fit.rms > 0.07}<p class="message">{$tr("calibration.auto.poor")}</p>{/if}
      <details class="boxes" open={doubtful}>
        <summary><MdIcon icon="chevron_right" />{$tr("calibration.result.boxes")}</summary>
        <img class="overlay" src={photoResult.overlay} alt="" />
      </details>
      <CorrectionChart corrections={resultChart} bind:modeIndex />
      <div class="result-actions">
        <button class="btn btn-primary use" onclick={() => keepMeasured(true)}>
          <MdIcon icon="check" />
          {$tr("calibration.auto.use")}
        </button>
        <button class="btn btn-secondary" onclick={() => keepMeasured(false)}>
          <MdIcon icon="bookmark_add" />
          {$tr("calibration.auto.keep")}
        </button>
        <button class="btn btn-secondary" onclick={() => (photoResult = undefined)}>
          <MdIcon icon="close" />
          {$tr("calibration.auto.discard")}
        </button>
      </div>
    {:else}
      <p class="hint mb-0">{$tr("calibration.result.empty")}</p>
    {/if}
  </div>
</section>

<CorrectionsSection
  {printer}
  bind:modeIndex
  bind:open={openEntry}
  {connected}
  printing={busy === "corrected"}
  {measuring}
  canCamera={stripCameraAvailable()}
  {onCheck} />

{#if checkShown && checkResult}
  <CheckSheet result={checkResult} bind:show={checkShown} bind:modeIndex />
{/if}

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
      {#if connected}
        <button class="btn btn-secondary w-100" disabled={busy !== undefined} onclick={printOffsetStrip}>
          {#if busy === "offset"}
            <span class="spinner-border spinner-border-sm"></span>
          {:else}
            <MdIcon icon="print" />
          {/if}
          {$tr("preview.calibration.print")}
        </button>
      {:else}
        <button class="btn btn-secondary w-100" onclick={connect}>
          <MdIcon icon="bluetooth" />
          {$tr("calibration.connect")}
        </button>
      {/if}
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

  .sizes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  .sizes-title {
    font-size: 0.875rem;
    margin-right: 0.25rem;
  }

  .sizes .btn {
    min-width: 4.5rem;
    font-variant-numeric: tabular-nums;
  }

  /* Print to measure and print to check side by side */
  /* Use it across the card, keep and discard side by side under it */
  .result-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .result-actions .use {
    grid-column: 1 / -1;
  }

  .boxes {
    margin-bottom: 0.5rem;
  }

  .boxes summary {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    font-size: 0.875rem;
    color: var(--ink-secondary);
  }

  .boxes summary {
    gap: 0.25rem;
    list-style: none;
  }

  .boxes summary::-webkit-details-marker {
    display: none;
  }

  .boxes summary :global(*) {
    transition: transform 0.15s;
  }

  .boxes[open] summary :global(:first-child) {
    transform: rotate(90deg);
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
