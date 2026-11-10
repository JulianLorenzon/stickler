<script lang="ts">
  import { onMount } from "svelte";
  import { derived } from "svelte/store";
  import { appConfig, connectionState, printerClient, printerMeta } from "$/stores";
  import {
    copyImageData,
    threshold,
    atkinson,
    invert,
    bayer,
    blueNoiseDither,
    floydSteinberg,
    smartProcess,
    tone,
    werness,
    applyCurve,
  } from "$/utils/post_process";
  import { D11S_DOT_MODEL, dotModelFor, simulatePrint } from "$/utils/print_sim";
  import * as fabric from "fabric";
  import {
    type EncodedImage,
    LabelType,
    type PrintProgressEvent,
    type PrintTaskName,
    AbstractPrintTask,
    Utils,
    driverById,
  } from "$/lib/printer";
  import type { LabelProps, PostProcessType, FabricJson, PreviewProps, PreviewPropsOffset, PrinterId } from "$/types";
  import { dotGainCurveFor, hasLabelGaps as testHasLabelGaps, withOffset } from "$/utils/test_prints";
  import ParamLockButton from "$/components/basic/ParamLockButton.svelte";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import { canvasPreprocess } from "$/utils/canvas_preprocess";
  import { type DSVRowArray, csvParse } from "d3-dsv";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { Toasts } from "$/utils/toasts";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import { FileUtils } from "$/utils/file_utils";
  import AppModal from "$/components/basic/AppModal.svelte";
  import { printerOf } from "$/defaults";

  interface Props {
    labelProps: LabelProps;
    canvasCallback: () => FabricJson;
    printNow?: boolean;
    csvData: string;
    csvEnabled: boolean;
    show: boolean;
  }

  let { labelProps, canvasCallback, printNow = false, csvData, csvEnabled, show = $bindable() }: Props = $props();

  /** What the dialog shows: the bitmap or the simulated print */
  let previewCanvas: HTMLCanvasElement;
  /** The processed 1-bit label, without the offset; this is what gets printed */
  const processedCanvas = document.createElement("canvas");
  let printState = $state<"idle" | "sending" | "printing">("idle");
  let printProgress = $state<number>(0); // todo: more progress data
  // D11s: 0 = light, 1 = medium, 2 = dark
  const densityMin = $derived($printerMeta?.densityMin ?? 0);
  const densityMax = $derived($printerMeta?.densityMax ?? 2);
  let density = $state<number>($printerMeta?.densityDefault ?? 2);
  let speed = $state<0 | 1>(1);
  let quantity = $state<number>(1);
  // Auto: text and codes thresholded, photos dithered with Atkinson, which printed them best on the D11s (2026-10-31)
  let postProcessType = $state<PostProcessType>("smart");
  let postProcessInvert = $state<boolean>(false);
  /** Modes that keep the average grey, where the slider shifts the greys instead of setting a threshold */
  const usesTone = $derived(["floyd", "bluenoise", "werness"].includes(postProcessType));
  // The official app thresholds labels at 128 (50% grey), which keeps strokes at the font's real weight
  let thresholdValue = $state<number>(128);
  /** Correct dithered greys for dot gain (see print_sim.ts); not for plain threshold, which has no greys */
  let dotGain = $state<boolean>(true);
  const dithers = $derived(postProcessType !== "threshold");
  const previewMode = $derived($appConfig.previewMode ?? "bitmap");
  /** The printer prints go to: the connected one, or the label's printer while there is none */
  const targetPrinter = $derived<PrinterId>($printerMeta?.driver ?? printerOf(labelProps));
  /** Dot gain model of that printer; without one there is no correction */
  const dotModel = $derived(dotModelFor(targetPrinter));
  /** The offset matters where the print has to land on a label between gaps */
  const hasLabelGaps = $derived(testHasLabelGaps($printerMeta ?? driverById(targetPrinter).meta({})));
  let originalImage: ImageData;
  /** For "smart" mode: the visible parts of photos on a transparent background */
  let photoLayer: ImageData | undefined;
  let printTaskName = $state<PrintTaskName>("B1");
  let labelType = $state<LabelType>(LabelType.WithGaps);
  // eslint-disable-next-line no-undef
  let statusTimer: NodeJS.Timeout | undefined = undefined;
  let error = $state<string>("");
  let detectedPrintTaskName: PrintTaskName | undefined = $printerClient?.getPrintTaskType();
  let csvParsed: DSVRowArray<string>;
  let page = $state<number>(0);
  let pagesTotal = $state<number>(1);
  let offset = $state<PreviewPropsOffset>({ x: 0, y: 0, offsetType: "inner" });
  let offsetWarning = $state<string>("");
  let currentPrintTask: AbstractPrintTask | undefined;

  let savedProps = $state<PreviewProps>({});

  let modalRef: AppModal;

  const disconnected = derived(connectionState, ($connectionState) => $connectionState !== "connected");

  const labelTypeTranslationKey = (labelType: string): TranslationKey =>
    `preview.label_type.${labelType}` as TranslationKey;

  const endPrint = async () => {
    clearInterval(statusTimer);

    if (!$disconnected && printState !== "idle") {
      if (currentPrintTask !== undefined) {
        await currentPrintTask.printEnd();
      } else {
        console.warn("Print task undefined, falling back to PrintEnd command");
        await $printerClient.abstraction.printEnd();
      }


      $printerClient.startHeartbeat();
    }

    printState = "idle";
    printProgress = 0;
  };

  const onPrintOnSystemPrinter = async () => {
    const sources: string[] = [];

    for (let curPage = 0; curPage < pagesTotal; curPage++) {
      page = curPage;
      await generatePreviewData(page);
      sources.push(processedCanvas.toDataURL("image/png"));
    }

    FileUtils.printImageUrls(sources);
  };

  /** Send one image to the printer and wait until it's out. Returns false if sending failed */
  const printImage = async (canvas: HTMLCanvasElement, copies: number): Promise<boolean> => {
    $printerClient.stopHeartbeat();

    currentPrintTask = $printerClient.abstraction.newPrintTask(printTaskName, {
      totalPages: copies,
      density,
      speed,
      labelType,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8_000,
    });

    try {
      const encoded: EncodedImage = $printerClient.encodeCanvas(canvas, labelProps.printDirection);
      await currentPrintTask.printInit();
      await currentPrintTask.printPage(encoded, copies);
    } catch (e) {
      error = `${e}`;
      console.error(e);
      return false;
    }

    printState = "printing";

    const listener = (e: PrintProgressEvent) => {
      printProgress = Math.floor((e.page / copies) * ((e.pagePrintProgress + e.pageFeedProgress) / 2));
    };

    $printerClient.on("printprogress", listener);

    try {
      await currentPrintTask.waitForFinished();
    } catch (e) {
      error = `${e}`;
      console.error(e);
    }

    $printerClient.off("printprogress", listener);

    await endPrint();
    return true;
  };

  const pageDelay = async (index: number, total: number) => {
    if ($appConfig.pageDelay !== undefined && $appConfig.pageDelay > 0 && index < total - 1) {
      await Utils.sleep($appConfig.pageDelay);
    }
  };

  /** Print, but ask first when the preview warns (label for another printer, wider than the print head) */
  const onPrintClicked = () => {
    const warning = offsetWarning.trim();
    if (warning && !confirm(`${warning}\n\n${$tr("preview.warning.confirm")}`)) return;
    onPrint();
  };

  const onPrint = async () => {
    printState = "sending";
    error = "";

    // do it in a stupid way (multi-page print not finished yet)
    for (let curPage = 0; curPage < pagesTotal; curPage++) {
      page = curPage;
      console.log("Printing page", page);

      await generatePreviewData(page);

      if (!(await printImage(withOffset(processedCanvas, offset), quantity))) {
        return;
      }

      await pageDelay(curPage, pagesTotal);
    }

    printState = "idle";
    $printerClient.startHeartbeat();

    if (printNow && !error) {
      modalRef.hide();
    }
  };

  /** The dot gain correction for a mode, or undefined when it's off, the mode doesn't dither or the printer has no model */
  const curveFor = (mode: PostProcessType): Uint8ClampedArray | undefined =>
    dotGain ? dotGainCurveFor(targetPrinter, mode, thresholdValue) : undefined;

  /**
   * "Auto length": leave out the blank (white) rows or columns at the end along the paper feed, so the preview
   * shows what gets printed. Space before the content stays, as in the designer. A blank image stays as it is.
   */
  const trimBlankEnds = (img: ImageData, along: "rows" | "cols"): ImageData => {
    const { width: w, height: h, data } = img;
    const isBlank = (i: number): boolean => {
      const n = along === "rows" ? w : h;
      for (let j = 0; j < n; j++) {
        const p = along === "rows" ? (i * w + j) * 4 : (j * w + i) * 4;
        if (data[p] < 128) return false;
      }
      return true;
    };
    const len = along === "rows" ? h : w;
    const first = 0;
    let last = len - 1;
    while (last >= 0 && isBlank(last)) last--;
    if (last < 0) return img;
    const [x, y, cw, ch] = along === "rows" ? [0, first, w, last - first + 1] : [first, 0, last - first + 1, h];
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.putImageData(img, 0, 0);
    return ctx.getImageData(x, y, cw, ch);
  };

  const updatePreview = () => {
    let iData: ImageData = copyImageData(originalImage);
    const curve = curveFor(postProcessType);
    const corrected = (i: ImageData) => (curve ? applyCurve(i, curve) : i);

    if (postProcessType === "smart") {
      iData = smartProcess(iData, photoLayer ? copyImageData(photoLayer) : undefined, thresholdValue, curve);
    } else if (postProcessType === "floyd") {
      iData = floydSteinberg(corrected(tone(iData, thresholdValue)), 128);
    } else if (postProcessType === "threshold") {
      iData = threshold(iData, thresholdValue);
    } else if (postProcessType === "dither") {
      iData = atkinson(corrected(iData), thresholdValue);
    } else if (postProcessType === "bayer") {
      iData = bayer(corrected(iData), thresholdValue);
    } else if (postProcessType === "bluenoise") {
      iData = blueNoiseDither(corrected(tone(iData, thresholdValue)));
    } else if (postProcessType === "werness") {
      iData = werness(corrected(tone(iData, thresholdValue)));
    }

    // Trim before inverting: the free room after the content is white until then, inverted it would print black
    if (labelProps.autoLength) {
      iData = trimBlankEnds(iData, labelProps.printDirection === "top" ? "rows" : "cols");
    }

    if (postProcessInvert) {
      iData = invert(iData);
    }

    processedCanvas.width = iData.width;
    processedCanvas.height = iData.height;
    processedCanvas.getContext("2d")!.putImageData(iData, 0, 0);
    showPreview(iData);

    offsetWarning = "";

    if ($printerMeta !== undefined && printerOf(labelProps) !== $printerMeta.driver) {
      offsetWarning += `${$tr("params.label.warning.printer")} ${driverById(printerOf(labelProps)).displayName}\n`;
    }

    if ($printerMeta !== undefined) {
      const printHeight = iData.height + (offset.offsetType === "outer" ? Math.abs(offset.y) : 0);
      const printWidth = iData.width + (offset.offsetType === "outer" ? Math.abs(offset.x) : 0);
      const headSize = labelProps.printDirection == "left" ? printHeight : printWidth;
      if (headSize > $printerMeta.printheadPixels) {
        offsetWarning += $tr("params.label.warning.width") + " ";
        offsetWarning += `(${headSize} > ${$printerMeta.printheadPixels})`;
        offsetWarning += "\n";
      }
    }
  };

  /** Bitmap: exactly what goes to the printer, offset included. Paper: the simulated print, where it should land */
  const showPreview = (iData: ImageData) => {
    const shown = previewMode === "paper" ? null : withOffset(processedCanvas, offset);
    previewCanvas.width = shown?.width ?? iData.width;
    previewCanvas.height = shown?.height ?? iData.height;
    const ctx = previewCanvas.getContext("2d")!;
    if (shown) ctx.drawImage(shown, 0, 0);
    // No model yet for this printer: the D11s one is the best guess for the simulation
    else ctx.putImageData(simulatePrint(iData, dotModel ?? D11S_DOT_MODEL), 0, 0);
  };

  const setPreviewMode = (mode: "bitmap" | "paper") => {
    $appConfig.previewMode = mode;
    updatePreview();
  };

  const toggleSavedProp = (key: string, value: any) => {
    const keyObj = key as keyof typeof savedProps;
    savedProps[keyObj] = savedProps[keyObj] === undefined ? value : undefined;
    try {
      LocalStoragePersistence.savePreviewProps(savedProps);
    } catch (e) {
      Toasts.zodErrors(e, "Preview parameters save error:");
    }
  };

  const updateSavedProp = (key: string, value: any, refreshPreview: boolean = false) => {
    const keyObj = key as keyof typeof savedProps;

    if (savedProps[keyObj] !== undefined) {
      savedProps[keyObj] = value;
      try {
        LocalStoragePersistence.savePreviewProps(savedProps);
      } catch (e) {
        Toasts.zodErrors(e, "Preview parameters save error:");
      }
    }

    if (refreshPreview) {
      updatePreview();
    }
  };

  const loadProps = () => {
    try {
      const saved = LocalStoragePersistence.loadSavedPreviewProps();
      if (saved === null) {
        return;
      }
      savedProps = saved;
      if (saved.postProcess !== undefined) postProcessType = saved.postProcess;
      if (saved.postProcessInvert !== undefined) postProcessInvert = saved.postProcessInvert;
      if (saved.threshold !== undefined) thresholdValue = saved.threshold;
      if (saved.quantity !== undefined) quantity = saved.quantity;
      if (saved.density !== undefined) density = Math.min(Math.max(saved.density, densityMin), densityMax);
      if (saved.speed !== undefined) speed = saved.speed;
      if (saved.labelType !== undefined) labelType = saved.labelType;
      if (saved.printTaskName !== undefined) printTaskName = saved.printTaskName;
      if (saved.offset !== undefined) offset = saved.offset;
      if (saved.dotGain !== undefined) dotGain = saved.dotGain;
    } catch (e) {
      Toasts.zodErrors(e, "Preview parameters load error:");
    }
  };

  const pageDown = () => {
    if (!csvEnabled) {
      page = 0;
      return;
    }
    page = Math.max(0, Math.min(csvParsed.length - 1, page - 1));
    generatePreviewData(page);
  };

  const pageUp = () => {
    if (!csvEnabled) {
      page = 0;
      return;
    }
    page = Math.min(csvParsed.length - 1, page + 1);
    generatePreviewData(page);
  };

  const generatePreviewData = async (page: number): Promise<void> => {
    const fabricTempCanvas = new CustomCanvas(undefined, {
      width: labelProps.size.width,
      height: labelProps.size.height,
    });

    fabricTempCanvas.setCustomBackground(false);
    fabricTempCanvas.setHighlightMirror(false);

    fabricTempCanvas.setLabelProps(labelProps);

    await fabricTempCanvas.loadFromJSON(canvasCallback());

    let variables = {};

    if (csvEnabled) {
      if (page >= 0 && page < csvParsed.length) {
        variables = csvParsed[page];
      } else {
        console.warn(`Page ${page} is out of csv bounds (csv length is ${csvParsed.length})`);
      }
    }

    console.log("Page variables:", variables);

    canvasPreprocess(fabricTempCanvas, variables);

    await fabricTempCanvas.createMirroredObjects();

    fabricTempCanvas.requestRenderAll();

    const renderToImageData = (): ImageData => {
      const el = fabricTempCanvas.toCanvasElement();
      return el.getContext("2d")!.getImageData(0, 0, el.width, el.height);
    };

    originalImage = renderToImageData();

    // "smart" mode needs to know which pixels show a photo on top. Render a photo-only layer where
    // objects stacked above a photo erase it and objects below are hidden; its alpha is that mask.
    const objects = fabricTempCanvas.getObjects();
    const isPhoto = (o: fabric.FabricObject) => o instanceof fabric.FabricImage;
    const firstPhoto = objects.findIndex(isPhoto);
    if (firstPhoto !== -1) {
      objects.forEach((o, idx) => {
        if (isPhoto(o)) return;
        if (idx < firstPhoto) o.set({ visible: false });
        else o.set({ globalCompositeOperation: "destination-out" });
      });
      fabricTempCanvas.setTransparentBackground(true);
      photoLayer = renderToImageData();
    } else {
      photoLayer = undefined;
    }

    updatePreview();

    fabricTempCanvas.dispose();
  };

  const densityLabel = (d: number): string => {
    if (densityMax - densityMin === 2) {
      return [$tr("preview.density.light"), $tr("preview.density.medium"), $tr("preview.density.dark")][d - densityMin];
    }
    return `${d}`;
  };

  const setDensity = (d: number) => {
    density = d;
    updateSavedProp("density", density);
  };

  const setQuantity = (q: number) => {
    quantity = Math.max(1, Math.floor(q) || 1);
    updateSavedProp("quantity", quantity);
  };

  const isNative = Utils.getAvailableTransports().capacitorBle;

  const onModalClose = () => {
    endPrint();
  };

  onMount(async () => {
    if (csvEnabled) {
      const parseResult = csvParse(csvData);
      const spread: DSVRowArray<string> = Object.assign([], { columns: parseResult.columns });

      for (let row of parseResult) {
        for (const k of Object.keys(row)) {
          row[k] = row[k].replaceAll("\\n", "\n");
        }

        let times = 1;
        
        if ("$times" in row && row["$times"] !== "") {
          try {
            times = parseInt(row["$times"]);
          } catch (e) {
            console.warn("$times parse error", e);
          }
        }

        if (times < 0) {
          times = 0;
        }

        for (let i = 0; i < times; i++) {
          spread.push(row);
        }
      }

      csvParsed = spread;
      pagesTotal = csvParsed.length;
    }

    if (detectedPrintTaskName !== undefined) {
      console.log(`Detected print task version: ${detectedPrintTaskName}`);
      printTaskName = detectedPrintTaskName;
    }

    loadProps();

    await generatePreviewData(page);

    if (printNow && !$disconnected && printState === "idle") {
      onPrintClicked();
    }
  });
</script>

<AppModal title={$tr("preview.title")} variant="fullscreen" onClose={onModalClose} bind:show bind:this={modalRef}>
  <div class="preview-stage">
    {#if pagesTotal > 1}
      <button disabled={printState !== "idle" || page === 0} class="btn icon-btn" onclick={pageDown}>
        <MdIcon icon="chevron_left" />
      </button>
    {/if}

    <canvas
      class="print-start-{labelProps.printDirection}"
      class:paper={previewMode === "paper"}
      bind:this={previewCanvas}></canvas>

    {#if pagesTotal > 1}
      <button disabled={printState !== "idle" || page >= pagesTotal - 1} class="btn icon-btn" onclick={pageUp}>
        <MdIcon icon="chevron_right" />
      </button>
    {/if}
  </div>

  <div class="view-toggle">
    <div class="btn-group" role="group">
      <button
        class="btn btn-sm {previewMode === 'bitmap' ? 'btn-primary' : 'btn-secondary'}"
        onclick={() => setPreviewMode("bitmap")}>
        <MdIcon icon="grid_on" />
        {$tr("preview.view.bitmap")}
      </button>
      <button
        class="btn btn-sm {previewMode === 'paper' ? 'btn-primary' : 'btn-secondary'}"
        onclick={() => setPreviewMode("paper")}>
        <MdIcon icon="receipt" />
        {$tr("preview.view.paper")}
      </button>
    </div>
    <span class="small text-secondary">
      {previewMode === "paper" ? $tr("preview.view.paper.hint") : $tr("preview.view.bitmap.hint")}
    </span>
  </div>

  {#if pagesTotal > 1}
    <div class="text-center small text-secondary mb-2">{page + 1} / {pagesTotal}</div>
  {/if}

  {#if printState !== "idle"}
    <div class="print-status">
      <div class="d-flex justify-content-between small mb-1">
        <span>{printState === "sending" ? $tr("preview.status.sending") : $tr("preview.status.printing")}</span>
        {#if printState === "printing"}<span>{printProgress}%</span>{/if}
      </div>
      <div class="progress" role="progressbar" style="height: 6px">
        <div
          class="progress-bar"
          class:progress-bar-striped={printState === "sending"}
          class:progress-bar-animated={printState === "sending"}
          style="width: {printState === 'sending' ? 100 : printProgress}%">
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="alert alert-danger py-2 small" role="alert">{error}</div>
  {/if}

  {#if offsetWarning}
    <div class="alert alert-warning py-2 small warning-lines" role="alert">{offsetWarning.trim()}</div>
  {/if}

  <div class="settings">
    <div class="setting">
      <span class="setting-label">{$tr("preview.copies")}</span>
      <div class="stepper">
        <button class="btn btn-secondary" disabled={quantity <= 1} onclick={() => setQuantity(quantity - 1)}>
          <MdIcon icon="remove" />
        </button>
        <input
          class="form-control text-center"
          type="number"
          inputmode="numeric"
          min="1"
          bind:value={quantity}
          onchange={() => setQuantity(quantity)} />
        <button class="btn btn-secondary" onclick={() => setQuantity(quantity + 1)}>
          <MdIcon icon="add" />
        </button>
      </div>
      <ParamLockButton propName="quantity" value={quantity} savedValue={savedProps.quantity} onClick={toggleSavedProp} />
    </div>


    <!-- Printers with one kind of paper (MXW01: continuous roll) don't need the choice -->
    {#if $printerMeta === undefined || $printerMeta.paperTypes.length > 1}
    <div class="setting">
      <span class="setting-label">{$tr("preview.label_type")}</span>
      <select class="form-select" bind:value={labelType} onchange={() => updateSavedProp("labelType", labelType)}>
        {#each Object.values(LabelType) as lt (lt)}
          {#if typeof lt !== "string"}
            <option value={lt}>
              {$tr(labelTypeTranslationKey(LabelType[lt]))}
            </option>
          {/if}
        {/each}
      </select>
      <ParamLockButton
        propName="labelType"
        value={labelType}
        savedValue={savedProps.labelType}
        onClick={toggleSavedProp} />
    </div>
    {/if}

    <div class="setting">
      <span class="setting-label">{$tr("preview.postprocess")}</span>
      <div class="d-flex gap-1 flex-grow-1 min-w-0">
        <select
          class="form-select"
          bind:value={postProcessType}
          onchange={() => updateSavedProp("postProcess", postProcessType, true)}>
          <option value="smart">{$tr("preview.postprocess.smart")}</option>
          <option value="threshold">{$tr("preview.postprocess.threshold")}</option>
          <option value="floyd">{$tr("preview.postprocess.floyd")}</option>
          <option value="dither">{$tr("preview.postprocess.atkinson")}</option>
          <option value="bayer">{$tr("preview.postprocess.bayer")}</option>
          <option value="bluenoise">{$tr("preview.postprocess.bluenoise")}</option>
          <option value="werness">{$tr("preview.postprocess.werness")}</option>
        </select>
        <button
          class="btn {postProcessInvert ? 'btn-primary' : 'btn-secondary'}"
          title={$tr("preview.invert")}
          aria-label={$tr("preview.invert")}
          onclick={() => {
            postProcessInvert = !postProcessInvert;
            updatePreview();
          }}>
          <MdIcon icon="invert_colors" />
        </button>
      </div>
      <ParamLockButton
        propName="postProcess"
        value={postProcessType}
        savedValue={savedProps.postProcess}
        onClick={toggleSavedProp} />
    </div>

    <div class="setting">
      <span class="setting-label">{usesTone ? $tr("preview.tone") : $tr("preview.threshold")}</span>
      <div class="d-flex align-items-center gap-2 flex-grow-1">
        <input
          type="range"
          class="form-range"
          min="1"
          max="255"
          bind:value={thresholdValue}
          oninput={() => updatePreview()}
          onchange={() => updateSavedProp("threshold", thresholdValue, true)} />
        <span class="value">{thresholdValue}</span>
      </div>
      <ParamLockButton
        propName="threshold"
        value={thresholdValue}
        savedValue={savedProps.threshold}
        onClick={toggleSavedProp} />
    </div>
    {#if usesTone}
      <div class="setting-hint">{$tr("preview.tone.hint")}</div>
    {:else if postProcessType === "smart"}
      <div class="setting-hint">{$tr("preview.threshold.smart_hint")}</div>
    {/if}

    {#if dithers && dotModel}
      <div class="setting">
        <span class="setting-label">{$tr("preview.dotgain")}</span>
        <div class="form-check form-switch flex-grow-1 m-0">
          <input
            class="form-check-input"
            type="checkbox"
            role="switch"
            aria-label={$tr("preview.dotgain")}
            bind:checked={dotGain}
            onchange={() => updateSavedProp("dotGain", dotGain, true)} />
        </div>
        <ParamLockButton propName="dotGain" value={dotGain} savedValue={savedProps.dotGain} onClick={toggleSavedProp} />
      </div>
      <div class="setting-hint">{$tr("preview.dotgain.hint")}</div>
    {/if}

    <p class="lock-hint">
      <MdIcon icon="lock" class="text-warning" />
      <span>{$tr("preview.lock.hint")}</span>
    </p>

    <details class="advanced">
      <summary>{$tr("preview.advanced")}</summary>

      <section class="group">
        <h3 class="group-title">{$tr("preview.group.position")}</h3>
        <div class="setting">
          <span class="setting-label">{$tr("preview.offset")}</span>
          <div class="input-group flex-nowrap flex-grow-1">
            <span class="input-group-text">X</span>
            <input
              class="form-control"
              type="number"
              step="1"
              inputmode="numeric"
              bind:value={offset.x}
              onchange={() => updateSavedProp("offset", offset, true)} />
            <span class="input-group-text">Y</span>
            <input
              class="form-control"
              type="number"
              step="1"
              inputmode="numeric"
              bind:value={offset.y}
              onchange={() => updateSavedProp("offset", offset, true)} />
          </div>
          <ParamLockButton propName="offset" value={offset} savedValue={savedProps.offset} onClick={toggleSavedProp} />
        </div>
        <div class="setting mt-2">
          <span class="setting-label">{$tr("preview.offset.mode")}</span>
          <select
            class="form-select"
            bind:value={offset.offsetType}
            onchange={() => updateSavedProp("offset", offset, true)}>
            <option value="inner">{$tr("preview.offset.inner")}</option>
            <option value="outer">{$tr("preview.offset.outer")}</option>
          </select>
          <span class="lock-spacer"></span>
        </div>
        <div class="offset-help">
          <p>{$tr("preview.offset.help")}</p>
          {#if offset.x !== 0 || offset.y !== 0}
            <p class="offset-now">
              X {offset.x > 0 ? "+" : ""}{(offset.x / 8).toFixed(2)} mm · Y {offset.y > 0 ? "+" : ""}{(offset.y / 8).toFixed(2)} mm
            </p>
          {/if}
          {#if hasLabelGaps}
            <p>{$tr("preview.offset.calibrate_hint")}</p>
          {/if}
        </div>
      </section>

      <section class="group">
        <h3 class="group-title">{$tr("preview.group.printer")}</h3>
        <div class="setting">
          <span class="setting-label">{$tr("preview.density")}</span>
          <div class="btn-group segmented" role="group">
            {#each Array.from({ length: densityMax - densityMin + 1 }, (_, i) => densityMin + i) as d (d)}
              <button
                class="btn {density === d ? 'btn-primary' : 'btn-secondary'}"
                onclick={() => setDensity(d)}>{densityLabel(d)}</button>
            {/each}
          </div>
          <ParamLockButton propName="density" value={density} savedValue={savedProps.density} onClick={toggleSavedProp} />
        </div>
        <div class="setting-hint">{$tr("preview.density.hint")}</div>
      </section>
    </details>
  </div>

  {#snippet footer()}
    {#if !isNative}
      <button
        type="button"
        class="btn btn-secondary me-auto"
        title={$tr("preview.print.system")}
        onclick={onPrintOnSystemPrinter}>
        <MdIcon icon="print" />
      </button>
    {/if}

    {#if printState !== "idle"}
      <button type="button" class="btn btn-outline-danger" disabled={$disconnected} onclick={endPrint}>
        {$tr("preview.print.cancel")}
      </button>
    {:else}
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">{$tr("preview.close")}</button>
    {/if}

    <button
      type="button"
      class="btn btn-primary print-btn"
      disabled={$disconnected || printState !== "idle"}
      onclick={onPrintClicked}>
      {#if $disconnected}
        {$tr("preview.not_connected")}
      {:else if printState !== "idle"}
        <span class="spinner-border spinner-border-sm"></span>
        {$tr("preview.status.printing")}
      {:else}
        <MdIcon icon="print" />
        {quantity > 1 ? `${$tr("preview.print")} × ${quantity}` : $tr("preview.print")}
      {/if}
    </button>
  {/snippet}
</AppModal>

<style>
  .preview-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    margin-bottom: 0.75rem;
    border-radius: var(--radius-md);
    background-color: var(--surface-0);
    background-image: radial-gradient(var(--border-standard) 1px, transparent 1px);
    background-size: 16px 16px;
  }

  canvas {
    image-rendering: pixelated;
    min-width: 0;
    max-width: 100%;
    max-height: 40vh;
    object-fit: contain;
    box-shadow: 0 0 0 1px var(--border-emphasis), 0 6px 18px rgba(0, 0, 0, 0.45);
  }
  .warning-lines {
    white-space: pre-line;
  }

  canvas.paper {
    image-rendering: auto;
  }
  canvas.print-start-left {
    border-left: 3px solid var(--mark-feed);
  }
  canvas.print-start-top {
    border-top: 3px solid var(--mark-feed);
  }

  .print-status {
    margin-bottom: 0.75rem;
  }

  .view-toggle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    margin: -0.25rem 0 0.75rem;
    text-align: center;
  }

  .view-toggle .small {
    line-height: 1.3;
  }

  .progress-bar {
    transition: none;
  }

  .settings {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .setting {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .setting-label {
    flex: 0 0 6.5rem;
    font-size: 0.875rem;
    color: var(--ink-secondary);
  }

  .lock-spacer {
    flex: none;
    width: 2.5rem;
  }

  .offset-help {
    margin-top: 0.5rem;
    font-size: 0.8125rem;
    color: var(--ink-tertiary);
  }

  .offset-help p {
    margin: 0 0 0.375rem;
  }

  .offset-now {
    color: var(--ink-secondary);
    font-variant-numeric: tabular-nums;
  }

  .setting-hint {
    margin: -0.25rem 0 0 7rem;
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }

  .setting > :global(.param-lock-btn) {
    flex: none;
    border: none;
  }

  .setting .form-select,
  .setting .input-group {
    flex: 1;
    min-width: 0;
  }

  .stepper {
    display: flex;
    flex: 1;
    gap: 0.25rem;
  }

  .stepper input {
    min-width: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .stepper input::-webkit-inner-spin-button {
    appearance: none;
  }

  .segmented {
    flex: 1;
  }

  .segmented .btn {
    flex: 1;
    font-size: 0.875rem;
  }

  .form-range {
    flex: 1;
  }

  .value {
    min-width: 2rem;
    text-align: end;
    font-variant-numeric: tabular-nums;
    font-size: 0.875rem;
  }

  .min-w-0 {
    min-width: 0;
  }

  .lock-hint {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--ink-secondary);
    background: var(--surface-0);
    border-radius: var(--radius-md);
  }

  .advanced summary {
    color: var(--ink-secondary);
    font-size: 0.875rem;
    padding: 0.25rem 0;
    margin-bottom: 0.5rem;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--border-soft);
  }

  .group-title {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-tertiary);
  }

  .print-btn {
    min-width: 8rem;
  }

  @media (max-width: 575.98px) {
    .print-btn {
      flex: 1;
    }
  }
</style>
