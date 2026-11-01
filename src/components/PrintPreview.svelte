<script lang="ts">
  import { onMount } from "svelte";
  import { derived } from "svelte/store";
  import { appConfig, connectionState, printerClient, printerMeta, refreshRfidInfo } from "$/stores";
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
  import { dotGainCurve, simulatePrint } from "$/utils/print_sim";
  import * as fabric from "fabric";
  import {
    type EncodedImage,
    ImageEncoder,
    LabelType,
    type PrintProgressEvent,
    type PrintTaskName,
    AbstractPrintTask,
    Utils,
  } from "$/lib/printer";
  import type { LabelProps, PostProcessType, FabricJson, PreviewProps, PreviewPropsOffset } from "$/types";
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
  import { DOTS_PER_MM, OBJECT_DEFAULTS_TEXT } from "$/defaults";

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
  // Atkinson printed photos best on the D11s (2026-10-31); text and codes come out as with a plain threshold
  let postProcessType = $state<PostProcessType>("dither");
  let postProcessInvert = $state<boolean>(false);
  /** Modes that keep the average grey, where the slider shifts the greys instead of setting a threshold */
  const usesTone = $derived(["floyd", "bluenoise", "werness"].includes(postProcessType));
  // The official app thresholds labels at 128 (50% grey), which keeps strokes at the font's real weight
  let thresholdValue = $state<number>(128);
  /** Correct dithered greys for dot gain (see print_sim.ts); not for plain threshold, which has no greys */
  let dotGain = $state<boolean>(true);
  const dithers = $derived(postProcessType !== "threshold");
  const previewMode = $derived($appConfig.previewMode ?? "bitmap");
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
  /** Offset test strip: step between labels in dots, and the offsets of the last printed strip */
  const CALIBRATION_LABELS = 3;
  let calibrationStep = $state<number>(DOTS_PER_MM);
  let calibrationPrinted = $state<number[]>([]);
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

      refreshRfidInfo();

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
      const encoded: EncodedImage = ImageEncoder.encodeCanvas(canvas, labelProps.printDirection);
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

  const onPrint = async () => {
    printState = "sending";
    error = "";

    // do it in a stupid way (multi-page print not finished yet)
    for (let curPage = 0; curPage < pagesTotal; curPage++) {
      page = curPage;
      console.log("Printing page", page);

      await generatePreviewData(page);

      if (!(await printImage(makePrintCanvas(processedCanvas, offset), quantity))) {
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

  /** X offsets (dots) for the next test strip, centered on the current offset */
  const calibrationPlan = $derived(
    Array.from({ length: CALIBRATION_LABELS }, (_, i) => offset.x + (i - (CALIBRATION_LABELS - 1) / 2) * calibrationStep),
  );

  const formatMm = (dots: number): string => {
    const mm = dots / DOTS_PER_MM;
    return `${mm > 0 ? "+" : mm < 0 ? "−" : ""}${Number(Math.abs(mm).toFixed(3))}`;
  };

  /**
   * A test label for dialing in the offset: a frame on the edges of the design area, a tick every millimetre
   * from both ends and in the middle, and the offset it was printed with.
   */
  const drawCalibrationLabel = (xOffset: number, index: number): HTMLCanvasElement => {
    const { width: W, height: H } = labelProps.size;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const line = 2;
    const mm = DOTS_PER_MM;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "black";

    // Frame
    ctx.fillRect(0, 0, W, line);
    ctx.fillRect(0, H - line, W, line);
    ctx.fillRect(0, 0, line, H);
    ctx.fillRect(W - line, 0, line, H);

    // Millimetre ticks from both ends, longer every 5 mm
    const ticks = Math.min(10, Math.floor(W / mm / 3));
    for (let i = 1; i <= ticks; i++) {
      const len = i % 5 === 0 ? Math.round(H * 0.3) : Math.round(H * 0.15);
      for (const x of [i * mm, W - i * mm]) {
        ctx.fillRect(x - 1, 0, line, len);
        ctx.fillRect(x - 1, H - len, line, len);
      }
    }

    // Middle
    const mid = Math.round(H * 0.15);
    ctx.fillRect(W / 2 - 1, 0, line, mid);
    ctx.fillRect(W / 2 - 1, H - mid, line, mid);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.round(H * 0.3)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
    ctx.fillText(`${formatMm(xOffset)} mm`, W / 2, H * 0.44);
    ctx.font = `${Math.round(H * 0.13)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
    ctx.fillText(`X ${xOffset} · ${index + 1}/${CALIBRATION_LABELS}`, W / 2, H * 0.72);

    const iData = threshold(ctx.getImageData(0, 0, W, H), 128);
    ctx.putImageData(iData, 0, 0);
    return canvas;
  };

  const printCalibration = async () => {
    const values = [...calibrationPlan];
    calibrationPrinted = values;
    printState = "sending";
    error = "";

    for (let i = 0; i < values.length; i++) {
      const label = drawCalibrationLabel(values[i], i);
      if (!(await printImage(makePrintCanvas(label, { ...offset, x: values[i] }), 1))) {
        return;
      }
      await pageDelay(i, values.length);
    }

    printState = "idle";
    $printerClient.startHeartbeat();
  };

  const useCalibrationOffset = (x: number) => {
    offset.x = x;
    // An offset picked from a test strip is a calibration, so keep it for next time without asking for the lock
    if (savedProps.offset === undefined) {
      toggleSavedProp("offset", offset);
    } else {
      updateSavedProp("offset", offset);
    }
    updatePreview();
  };

  /**
   * Grey test: one label per dithering mode (Auto dithers photos with Floyd–Steinberg). Atkinson uses the threshold
   * slider, like its dot correction does
   */
  const GREY_TEST_MODES: { name: string; mode: PostProcessType; dither: (iData: ImageData) => ImageData }[] = [
    { name: "Atkinson", mode: "dither", dither: (iData) => atkinson(iData, thresholdValue) },
    { name: "Floyd–Steinberg / Auto", mode: "floyd", dither: (iData) => floydSteinberg(iData, 128) },
    { name: "Blue noise", mode: "bluenoise", dither: blueNoiseDither },
    { name: "Werness", mode: "werness", dither: werness },
  ];
  const GREY_TEST_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  /**
   * A row of grey patches from 10 to 100% ink, dithered without any tone change, with the mode name above and the
   * percentages below. Photographed next to the screen it shows how much darker each grey prints (dot gain).
   * Uses the dot gain correction when it's on, and says so on the label.
   */
  const drawGreyLabel = (mode: (typeof GREY_TEST_MODES)[number]): HTMLCanvasElement => {
    const { width: W, height: H } = labelProps.size;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, W, H);

    const margin = Math.round(DOTS_PER_MM / 2);
    const gap = 2;
    const top = Math.round(H * 0.24);
    const bottom = Math.round(H * 0.8);
    const n = GREY_TEST_LEVELS.length;
    const pw = Math.floor((W - 2 * margin - (n - 1) * gap) / n);
    const x0 = Math.round((W - n * pw - (n - 1) * gap) / 2);

    GREY_TEST_LEVELS.forEach((level, i) => {
      const v = Math.round(255 * (1 - level / 100));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x0 + i * (pw + gap), top, pw, bottom - top);
    });
    const curve = curveFor(mode.mode);
    const patches = ctx.getImageData(0, top, W, bottom - top);
    ctx.putImageData(mode.dither(curve ? applyCurve(patches, curve) : patches), 0, top);

    ctx.fillStyle = "black";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.round(H * 0.16)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
    ctx.fillText(curve ? `${mode.name} · corrected` : mode.name, x0, top / 2);
    ctx.textAlign = "center";
    ctx.font = `${Math.round(H * 0.13)}px ${OBJECT_DEFAULTS_TEXT.fontFamily}`;
    GREY_TEST_LEVELS.forEach((level, i) => ctx.fillText(`${level}`, x0 + i * (pw + gap) + pw / 2, (bottom + H) / 2));

    // Only the text rows still have grey edges
    ctx.putImageData(threshold(ctx.getImageData(0, 0, W, top), 128), 0, 0);
    ctx.putImageData(threshold(ctx.getImageData(0, bottom, W, H - bottom), 128), 0, bottom);
    return canvas;
  };

  const printGreyTest = async () => {
    printState = "sending";
    error = "";

    for (let i = 0; i < GREY_TEST_MODES.length; i++) {
      if (!(await printImage(makePrintCanvas(drawGreyLabel(GREY_TEST_MODES[i]), offset), 1))) {
        return;
      }
      await pageDelay(i, GREY_TEST_MODES.length);
    }

    printState = "idle";
    $printerClient.startHeartbeat();
  };

  /** The dot gain correction for a mode, or undefined when it's off or the mode doesn't dither */
  const curveFor = (mode: PostProcessType): Uint8ClampedArray | undefined => {
    if (!dotGain) return undefined;
    switch (mode) {
      case "smart":
      case "floyd":
        return dotGainCurve("floyd", (i) => floydSteinberg(i, 128));
      case "bluenoise":
        return dotGainCurve("bluenoise", blueNoiseDither);
      case "werness":
        return dotGainCurve("werness", werness);
      case "dither":
        return dotGainCurve(`atkinson:${thresholdValue}`, (i) => atkinson(i, thresholdValue));
      case "bayer":
        return dotGainCurve(`bayer:${thresholdValue}`, (i) => bayer(i, thresholdValue));
      default:
        return undefined;
    }
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

    if (postProcessInvert) {
      iData = invert(iData);
    }

    processedCanvas.width = iData.width;
    processedCanvas.height = iData.height;
    processedCanvas.getContext("2d")!.putImageData(iData, 0, 0);
    showPreview(iData);

    offsetWarning = "";

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

  /**
   * The processed preview shifted by the calibration offset. "inner" keeps the label size (content that moves past
   * an edge is cut off), "outer" grows the image by the offset instead.
   */
  const makePrintCanvas = (source: HTMLCanvasElement, offset: PreviewPropsOffset): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const { width, height } = source;

    if (offset.offsetType === "inner") {
      canvas.width = width;
      canvas.height = height;
    } else {
      canvas.width = width + Math.abs(offset.x);
      canvas.height = height + Math.abs(offset.y);
    }

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const x = offset.offsetType === "inner" ? offset.x : Math.max(offset.x, 0);
    const y = offset.offsetType === "inner" ? offset.y : Math.max(offset.y, 0);
    ctx.drawImage(source, x, y);
    return canvas;
  };

  /** Bitmap: exactly what goes to the printer, offset included. Paper: the simulated print, where it should land */
  const showPreview = (iData: ImageData) => {
    const shown = previewMode === "paper" ? null : makePrintCanvas(processedCanvas, offset);
    previewCanvas.width = shown?.width ?? iData.width;
    previewCanvas.height = shown?.height ?? iData.height;
    const ctx = previewCanvas.getContext("2d")!;
    if (shown) ctx.drawImage(shown, 0, 0);
    else ctx.putImageData(simulatePrint(iData), 0, 0);
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
      onPrint();
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
    <div class="alert alert-warning py-2 small" role="alert">{offsetWarning}</div>
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
          title="Invert"
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

    {#if dithers}
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
        </div>

        <div class="calibration">
          <div class="setting">
            <span class="setting-label">{$tr("preview.calibration")}</span>
            <div class="btn-group segmented" role="group">
              {#each [DOTS_PER_MM / 2, DOTS_PER_MM] as step (step)}
                <button
                  class="btn {calibrationStep === step ? 'btn-primary' : 'btn-secondary'}"
                  onclick={() => (calibrationStep = step)}>{step / DOTS_PER_MM} mm</button>
              {/each}
            </div>
            <span class="lock-spacer"></span>
          </div>
          <p class="offset-help">
            {$tr("preview.calibration.help")}
            {calibrationPlan.map((v) => formatMm(v)).join(" · ")} mm
          </p>
          <button
            class="btn btn-secondary w-100"
            disabled={$disconnected || printState !== "idle"}
            onclick={printCalibration}>
            <MdIcon icon="print" />
            {$tr("preview.calibration.print")}
          </button>

          {#if calibrationPrinted.length > 0}
            <p class="offset-help mt-2 mb-1">{$tr("preview.calibration.pick")}</p>
            <div class="calibration-values">
              {#each calibrationPrinted as v (v)}
                <button
                  class="btn btn-sm {offset.x === v ? 'btn-primary' : 'btn-secondary'}"
                  onclick={() => useCalibrationOffset(v)}>{formatMm(v)} mm</button>
              {/each}
            </div>
          {/if}
        </div>
      </section>

      <section class="group">
        <h3 class="group-title">{$tr("preview.group.grey")}</h3>
        <p class="offset-help m-0">{$tr("preview.grey.help")}</p>
        <button
          class="btn btn-secondary w-100"
          disabled={$disconnected || printState !== "idle"}
          onclick={printGreyTest}>
          <MdIcon icon="gradient" />
          {$tr("preview.grey.print")}
        </button>
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
      onclick={onPrint}>
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

  .calibration {
    margin-top: 0.25rem;
  }

  .calibration-values {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }

  .calibration-values .btn {
    padding-left: 0;
    padding-right: 0;
    font-variant-numeric: tabular-nums;
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
