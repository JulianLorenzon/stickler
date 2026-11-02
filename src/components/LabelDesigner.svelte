<script lang="ts">
  import Dropdown from "bootstrap/js/dist/dropdown";
  import * as fabric from "fabric";
  import { onDestroy, onMount, tick } from "svelte";
  import { Barcode } from "$/fabric-object/barcode";
  import { QRCode } from "$/fabric-object/qrcode";
  import { iconCodepoints, type MaterialIcon } from "$/styles/mdi_icons";
  import { appConfig, automation, connectionState, csvData, loadedFonts, printerSheetOpen } from "$/stores";
  import {
    type ExportedLabelTemplate,
    type FabricJson,
    type LabelProps,
    type MoveDirection,
    type OjectType,
  } from "$/types";
  import { FileUtils } from "$/utils/file_utils";
  import { tr } from "$/utils/i18n";
  import { LabelDesignerObjectHelper } from "$/utils/label_designer_object_helper";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { Toasts } from "$/utils/toasts";
  import { UndoRedo, type UndoState } from "$/utils/undo_redo";
  import BarcodeParamsPanel from "$/components/designer-controls/BarcodeParamsControls.svelte";
  import CsvControl from "$/components/designer-controls/CsvControl.svelte";
  import GenericObjectParamsControls from "$/components/designer-controls/GenericObjectParamsControls.svelte";
  import LabelPropsEditor from "$/components/designer-controls/LabelPropsEditor.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import AddObjectBar from "$/components/designer-controls/AddObjectBar.svelte";
  import PrintPreview from "$/components/PrintPreview.svelte";
  import QrCodeParamsPanel from "$/components/designer-controls/QRCodeParamsControls.svelte";
  import TextParamsControls from "$/components/designer-controls/TextParamsControls.svelte";
  import VariableInsertControl from "$/components/designer-controls/VariableInsertControl.svelte";
  import {
    DEFAULT_LABEL_PROPS,
    DEFAULT_ROTATION_SNAP,
    GRID_SIZE,
    ROTATION_STICKY_RIGHT_ANGLE,
    withPrintStartMargin,
  } from "$/defaults";
  import { LabelDesignerUtils } from "$/utils/label_designer_utils";
  import SavedLabelsMenu from "$/components/designer-controls/SavedLabelsMenu.svelte";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import VectorParamsControls from "$/components/designer-controls/VectorParamsControls.svelte";
  import { CanvasUtils } from "$/utils/canvas_utils";
  import { codeScannerAvailable, scanCode, type ScanResult } from "$/utils/code_scanner";

  let htmlCanvas: HTMLCanvasElement;
  let workspaceEl: HTMLDivElement;

  let fabricCanvas = $state<CustomCanvas>();
  let labelProps = $state<LabelProps>(DEFAULT_LABEL_PROPS);
  let previewOpened = $state<boolean>(false);
  let selectedObject = $state<fabric.FabricObject | undefined>(undefined);
  let selectedCount = $state<number>(0);
  let editRevision = $state<number>(0);
  let printNow = $state<boolean>(false);
  let csvEnabled = $state<boolean>(false);
  let previewAfterConnect = false;
  let unsubscribeConnection: (() => void) | undefined;
  let detachPinchZoom: (() => void) | undefined;
  let undoState = $state<UndoState>({ undoDisabled: false, redoDisabled: false });

  const undo = new UndoRedo();

  const discardSelection = () => {
    fabricCanvas!.discardActiveObject();
    fabricCanvas!.requestRenderAll();
    selectedObject = undefined;
    selectedCount = 0;
    editRevision = 0;
  };

  const loadLabelData = async (data: ExportedLabelTemplate) => {
    undo.paused = true;
    onUpdateLabelProps(data.label);
    if (data.csv) {
      $csvData = data.csv;
      csvEnabled = true;
    }
    await FileUtils.loadCanvasState(fabricCanvas!, data.canvas);
    undo.paused = false;
  };

  undo.onLabelUpdate = loadLabelData;
  undo.onStateUpdate = (state: UndoState) => {
    undoState = state;
  };

  const deleteSelected = () => {
    LabelDesignerUtils.deleteSelection(fabricCanvas!);
    discardSelection();
  };

  const cloneSelected = () => {
    LabelDesignerUtils.cloneSelection(fabricCanvas!).then(() => undo.push(fabricCanvas!, labelProps));
  };

  const moveSelected = (direction: MoveDirection, ctrl?: boolean) => {
    LabelDesignerUtils.moveSelection(fabricCanvas!, direction, ctrl);
    undo.push(fabricCanvas!, labelProps);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const key: string = e.key.toLowerCase();
    // windows and linux users are used to ctrl, mac users use cmd
    const cmdOrCtrl = e.metaKey || e.ctrlKey;

    // Esc
    if (key === "escape") {
      discardSelection();
      return;
    }

    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    // Arrows
    if (key.startsWith("arrow")) {
      moveSelected(key.slice("arrow".length) as MoveDirection, cmdOrCtrl);
      return;
    }

    if (e.repeat) {
      return;
    }

    // Ctrl + D
    if (cmdOrCtrl && key === "d") {
      e.preventDefault();
      cloneSelected();
      return;
    }

    // Ctrl + Y, Ctrl + Shift + Z
    if ((cmdOrCtrl && key === "y") || (cmdOrCtrl && e.shiftKey && key === "z")) {
      e.preventDefault();
      if (!undoState.redoDisabled) {
        undo.redo();
      }
      return;
    }

    // Ctrl + Z
    if (cmdOrCtrl && key === "z") {
      e.preventDefault();
      if (!undoState.undoDisabled) {
        undo.undo();
      }
      return;
    }

    // Del
    if (key === "delete" || key === "backspace") {
      deleteSelected();
      return;
    }
  };

  const onUpdateLabelProps = (newProps: LabelProps) => {
    labelProps = withPrintStartMargin(newProps);
    fabricCanvas!.setLabelProps(labelProps);
    fabricCanvas!.fitLabel();
    try {
      LocalStoragePersistence.saveLastLabelProps(labelProps);
      undo.push(fabricCanvas!, labelProps);
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters save error:");
    }
  };

  const exportCurrentLabel = (): ExportedLabelTemplate => {
    return FileUtils.makeExportedLabel(fabricCanvas!, labelProps, csvEnabled);
  };

  const onLoadRequested = (label: ExportedLabelTemplate) => {
    loadLabelData(label).then(() => undo.push(fabricCanvas!, labelProps));
  };

  const onObjectPicked = (objectType: OjectType) => {
    const obj = LabelDesignerObjectHelper.addObject(fabricCanvas!, objectType);
    if (obj !== undefined) {
      fabricCanvas!.setActiveObject(obj);
      undo.push(fabricCanvas!, labelProps);
    }
  };

  /** Scan a QR code or barcode with the camera and add a copy of it */
  const onScan = async () => {
    let result: ScanResult | undefined;
    try {
      result = await scanCode();
    } catch (e) {
      // getUserMedia errors
      const name = (e as { name?: string }).name;
      if (name === "NotAllowedError") Toasts.error($tr("editor.scan.no_permission"));
      else if (name === "NotFoundError" || name === "OverconstrainedError") Toasts.error($tr("editor.scan.no_camera"));
      else Toasts.error(e);
      return;
    }
    if (result === undefined) return;

    const { obj, converted } = LabelDesignerObjectHelper.addScannedCode(fabricCanvas!, result);
    if (converted) {
      Toasts.message($tr("editor.scan.converted"));
    }
    fabricCanvas!.setActiveObject(obj);
    fabricCanvas!.requestRenderAll();
    undo.push(fabricCanvas!, labelProps);
  };

  const onIconPicked = (i: MaterialIcon) => {
    // todo: icon is not vertically centered
    LabelDesignerObjectHelper.addStaticText(fabricCanvas!, String.fromCodePoint(iconCodepoints[i]), {
      fontFamily: "Material Icons",
      fontSize: 100,
    });
    undo.push(fabricCanvas!, labelProps);
  };

  const onSvgIconPicked = (i: string) => {
    LabelDesignerObjectHelper.addSvg(fabricCanvas!, i);
    undo.push(fabricCanvas!, labelProps);
  };

  const openPreview = () => {
    printNow = false;
    previewOpened = true;
  };

  const openPreviewAndPrint = () => {
    printNow = true;
    previewOpened = true;
  };

  const onPrintClicked = () => {
    if ($connectionState === "connected") {
      openPreviewAndPrint();
      return;
    }
    // Ask to connect first, then show the preview so the user can confirm settings
    previewAfterConnect = true;
    $printerSheetOpen = true;
  };

  /** The canvas covers the whole workspace, the label is drawn inside it */
  const resizeCanvas = () => {
    if (!fabricCanvas || !workspaceEl) return;
    const { clientWidth, clientHeight } = workspaceEl;
    if (clientWidth <= 0 || clientHeight <= 0) return;
    fabricCanvas.setWorkspaceSize(clientWidth, clientHeight);
  };

  const selectionTitle = (): string => {
    if (selectedCount > 1) return `${selectedCount} ${$tr("editor.selection.multiple")}`;
    if (selectedObject instanceof QRCode) return $tr("editor.objectpicker.qrcode");
    if (selectedObject instanceof Barcode) return $tr("editor.objectpicker.barcode");
    if (selectedObject instanceof fabric.IText) return $tr("editor.objectpicker.text");
    if (selectedObject instanceof fabric.FabricImage) return $tr("editor.objectpicker.image");
    if (selectedObject instanceof fabric.Line) return $tr("editor.objectpicker.line");
    if (selectedObject instanceof fabric.Circle) return $tr("editor.objectpicker.circle");
    if (selectedObject instanceof fabric.Rect) return $tr("editor.objectpicker.rectangle");
    return $tr("editor.selection.object");
  };

  /** Android back button: drop the selection before leaving the app */
  const onAppBack = (e: Event) => {
    if (selectedCount > 0 && !e.defaultPrevented) {
      e.preventDefault();
      discardSelection();
    }
  };

  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  const controlValueUpdated = () => {
    if (selectedObject) {
      selectedObject.setCoords();
      selectedObject.dirty = true;
      // Holding a stepper button or typing changes the value many times; keep that as one undo step
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => undo.push(fabricCanvas!, labelProps), 400);
    }
    fabricCanvas!.requestRenderAll();

    // trigger reactivity for controls
    editRevision++;
  };

  const getCanvasForPreview = (): FabricJson => {
    return fabricCanvas!.toJSON();
  };

  const onCsvPlaceholderPicked = (name: string) => {
    const obj = LabelDesignerObjectHelper.addText(fabricCanvas!, `{${name}}`, {
      textAlign: "left",
      originX: "left",
      originY: "top",
    });
    fabricCanvas!.setActiveObject(obj);
    undo.push(fabricCanvas!, labelProps);
  };

  const onPaste = async (event: ClipboardEvent) => {
    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    const openedDropdowns = document.querySelectorAll(".dropdown-menu.show");
    if (openedDropdowns.length > 0) {
      return;
    }

    if (event.clipboardData != null) {
      event.preventDefault();
      const obj = await LabelDesignerObjectHelper.addObjectFromClipboard(fabricCanvas!, event.clipboardData);

      if (obj !== undefined) {
        fabricCanvas!.setActiveObject(obj);
        undo.push(fabricCanvas!, labelProps);
      }
    }
  };

  const clearCanvas = () => {
    if (!confirm($tr("editor.clear.confirm"))) {
      return;
    }
    undo.push(fabricCanvas!, labelProps);
    fabricCanvas!.clear();
  };

  const loadDefaultLabel = async () => {
    try {
      const urlTemplate = await FileUtils.readLabelFromUrl();

      if (urlTemplate !== null && confirm($tr("params.saved_labels.load.url.warn"))) {
        onLoadRequested(urlTemplate);
        Toasts.message($tr("params.saved_labels.load.url.loaded"));
        return;
      }
    } catch (e) {
      Toasts.error(e);
    }

    try {
      const defaultTemplate = LocalStoragePersistence.loadDefaultTemplate();

      if (defaultTemplate !== null) {
        onLoadRequested(defaultTemplate);
        return;
      }
    } catch (e) {
      Toasts.error(e);
    }

    LabelDesignerObjectHelper.addText(fabricCanvas!, $tr("editor.default_text"));
  };

  const renderOnFontsChanged = () => {
    fabricCanvas?.forEachObject((o) => {
      if (o instanceof fabric.FabricText) {
        // Re-measure, the text may have been laid out with a fallback font
        o.initDimensions();
        o.setCoords();
        o.dirty = true;
      }
    });
    fabricCanvas?.requestRenderAll();
  };

  onMount(async () => {
    try {
      const savedLabelProps = LocalStoragePersistence.loadLastLabelProps();
      if (savedLabelProps !== null) {
        // Earlier versions only stored the 12 mm printable area of the 14 mm Fichero labels
        if (savedLabelProps.paper === undefined && savedLabelProps.printDirection === "left" && savedLabelProps.size.height === 96) {
          savedLabelProps.paper = { width: savedLabelProps.size.width, height: 112 };
        }
        labelProps = withPrintStartMargin(savedLabelProps);
      }
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters load error:");
    }

    fabricCanvas = new CustomCanvas(htmlCanvas, {
      width: workspaceEl.clientWidth,
      height: workspaceEl.clientHeight,
    });
    fabricCanvas.enableEditorChrome();
    fabricCanvas.setLabelProps(labelProps);

    resizeCanvas();
    new ResizeObserver(() => resizeCanvas()).observe(workspaceEl);
    detachPinchZoom = fabricCanvas.attachPinchZoom();

    window.addEventListener("app:back", onAppBack);

    unsubscribeConnection = connectionState.subscribe((st) => {
      if (st === "connected" && previewAfterConnect) {
        previewAfterConnect = false;
        // Wait until the printer sheet has closed so two modals don't animate at once
        const unsubscribeSheet = printerSheetOpen.subscribe((open) => {
          if (!open) {
            tick().then(() => unsubscribeSheet());
            openPreview();
          }
        });
      } else if (st === "disconnected" && !$printerSheetOpen) {
        previewAfterConnect = false;
      }
    });

    await loadDefaultLabel();

    undo.push(fabricCanvas, labelProps);

    // force close dropdowns on touch devices
    fabricCanvas.on("mouse:down", (): void => {
      const dropdowns = document.querySelectorAll("[data-bs-toggle='dropdown']");
      dropdowns.forEach((el) => new Dropdown(el).hide());
    });

    fabricCanvas.on("object:moving", (e): void => {
      if (e.target && e.target.left !== undefined && e.target.top !== undefined) {
        e.target.set({
          left: Math.round(e.target.left / GRID_SIZE) * GRID_SIZE,
          top: Math.round(e.target.top / GRID_SIZE) * GRID_SIZE,
        });
      }
    });

    // Rotation handle: snap to the chosen step, or rotate freely but stick to right angles
    fabricCanvas.on("before:transform", (e): void => {
      const snap = $appConfig.rotationSnap ?? DEFAULT_ROTATION_SNAP;
      e.transform.target.set(
        snap > 0
          ? { snapAngle: snap, snapThreshold: undefined }
          : { snapAngle: 90, snapThreshold: ROTATION_STICKY_RIGHT_ANGLE },
      );
    });

    fabricCanvas.on("object:modified", (): void => {
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("text:changed", () => {
      editRevision++;
    });

    fabricCanvas.on("object:removed", (): void => {
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("selection:created", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:updated", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:cleared", (): void => {
      selectedObject = undefined;
      selectedCount = 0;
      editRevision++;
    });

    fabricCanvas.on("dragover", (e): void => {
      e.e.preventDefault();
    });

    fabricCanvas.on("drop:after", async (e): Promise<void> => {
      const dragEvt = e.e as DragEvent;
      dragEvt.preventDefault();

      let dropped = false;

      if (dragEvt.dataTransfer?.files) {
        for (const file of dragEvt.dataTransfer.files) {
          try {
            await LabelDesignerObjectHelper.addImageFile(fabricCanvas!, file);
            dropped = true;
          } catch (e) {
            Toasts.error(e);
          }
        }

        if (dropped) {
          undo.push(fabricCanvas!, labelProps);
        }
      }
    });

    fabricCanvas.on("object:scaling", (e): void => {
      if (!e.target) {
        return;
      }

      CanvasUtils.fixFabricObjectScale(e.target);
    });

    // userFonts.subscribe((e) => {console.log(e); renderOnFontsChanged();});

    if ($automation !== undefined) {
      if ($automation.startPrint !== undefined) {
        if ($automation.startPrint === "immediately") {
          openPreview();
        } else if ($automation.startPrint === "after_connect") {
          const unsubscribe = connectionState.subscribe((st) => {
            if (st === "connected") {
              tick().then(() => unsubscribe());
              openPreviewAndPrint();
            }
          });
        }
      }
    }
  });

  onDestroy(() => {
    window.removeEventListener("app:back", onAppBack);
    unsubscribeConnection?.();
    detachPinchZoom?.();
    fabricCanvas!.dispose();
  });

  $effect(() => {
    fabricCanvas?.setLabelProps(labelProps);
  });

  $effect(() => {
    if (!previewOpened) {
      printNow = false;
    }
  });

  $effect(() => {
    if ($loadedFonts) {
      renderOnFontsChanged();
    }
  });
</script>

<svelte:window onkeydown={onKeyDown} onpaste={onPaste} />

<div class="designer">
  <div class="doc-bar tool-row">
    <LabelPropsEditor {labelProps} onChange={onUpdateLabelProps} />

    <SavedLabelsMenu
      canvas={fabricCanvas!}
      onRequestLabelTemplate={exportCurrentLabel}
      {onLoadRequested}
      {csvEnabled} />

    <CsvControl bind:enabled={csvEnabled} onPlaceholderPicked={onCsvPlaceholderPicked} />

    <span class="tool-sep"></span>

    <button class="tool-btn" disabled={undoState.undoDisabled} onclick={() => undo.undo()} title={$tr("editor.undo")}>
      <MdIcon icon="undo" />
      <span>{$tr("editor.undo")}</span>
    </button>

    <button class="tool-btn" disabled={undoState.redoDisabled} onclick={() => undo.redo()} title={$tr("editor.redo")}>
      <MdIcon icon="redo" />
      <span>{$tr("editor.redo")}</span>
    </button>

    <button class="tool-btn" onclick={clearCanvas} title={$tr("editor.clear")}>
      <MdIcon icon="delete_sweep" />
      <span>{$tr("editor.toolbar.clear")}</span>
    </button>
  </div>

  <div class="workspace" bind:this={workspaceEl}>
    <canvas bind:this={htmlCanvas}></canvas>
    <button class="btn fit-btn" onclick={() => fabricCanvas?.fitLabel()} title={$tr("editor.zoom.fit")}>
      <MdIcon icon="fit_screen" />
    </button>
  </div>

  <div class="panel">
    {#if selectedCount > 0}
      <div class="panel-head">
        <span class="panel-title">{selectionTitle()}</span>
        <button class="btn icon-btn text-danger" onclick={deleteSelected} title={$tr("editor.delete")}>
          <MdIcon icon="delete" />
        </button>
        <button class="btn icon-btn" onclick={cloneSelected} title={$tr("editor.clone")}>
          <MdIcon icon="content_copy" />
        </button>
        <button class="btn icon-btn" onclick={discardSelection} title={$tr("editor.selection.done")}>
          <MdIcon icon="check" />
        </button>
      </div>

      <div class="tool-row props-row">
        {#if selectedObject instanceof fabric.IText}
          <TextParamsControls
            part="size"
            selectedText={selectedObject}
            {editRevision}
            valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof Barcode}
          <BarcodeParamsPanel selectedBarcode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof QRCode}
          <QrCodeParamsPanel selectedQRCode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject && selectedCount === 1}
          <GenericObjectParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject}
          <VectorParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof fabric.IText}
          <TextParamsControls
            part="style"
            selectedText={selectedObject}
            {editRevision}
            valueUpdated={controlValueUpdated} />
        {/if}

        {#if selectedObject instanceof fabric.IText || selectedObject instanceof QRCode || (selectedObject instanceof Barcode && selectedObject.encoding === "CODE128B")}
          <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
        {/if}
      </div>
    {:else}
      <div class="panel-head">
        <span class="panel-title">{$tr("editor.objectpicker.title")}</span>
      </div>
      <div class="tool-row">
        <AddObjectBar
          onSubmit={onObjectPicked}
          {onIconPicked}
          {onSvgIconPicked}
          onScan={codeScannerAvailable() ? onScan : undefined} />
      </div>
    {/if}
  </div>

  <div class="action-bar">
    <button class="btn btn-secondary btn-lg action-preview" onclick={openPreview}>
      <MdIcon icon="visibility" />
      <span>{$tr("editor.preview")}</span>
    </button>
    <button class="btn btn-primary btn-lg action-print" onclick={onPrintClicked}>
      <MdIcon icon="print" />
      {$connectionState === "connected" ? $tr("editor.print") : $tr("editor.connect_and_print")}
    </button>
  </div>

  {#if previewOpened}
    <PrintPreview
      bind:show={previewOpened}
      canvasCallback={getCanvasForPreview}
      {labelProps}
      {printNow}
      {csvEnabled}
      csvData={$csvData.data} />
  {/if}
</div>

<style>
  .designer {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .doc-bar {
    border-bottom: 1px solid var(--border-soft);
  }

  .workspace {
    position: relative;
    flex: 1 1 0;
    min-height: 160px;
    overflow: hidden;
    background-color: var(--surface-0);
    background-image: radial-gradient(var(--border-standard) 1px, transparent 1px);
    background-size: 16px 16px;
  }

  .workspace :global(.canvas-container) {
    position: absolute !important;
    inset: 0;
  }

  .fit-btn {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
    color: var(--ink-secondary);
    opacity: 0.85;
  }

  .panel {
    background: var(--surface-1);
    border-top: 1px solid var(--border-standard);
    padding-top: 0.375rem;
  }

  /* Same height with and without a selection, so selecting doesn't resize the canvas under the finger */
  .panel-head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    height: 2.5rem;
    padding: 0 0.5rem 0 1rem;
  }

  .panel-title {
    flex: 1;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-tertiary);
  }

  .panel > :global(.tool-row) {
    height: 4.25rem;
  }

  .action-bar {
    display: flex;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    padding-bottom: calc(0.625rem + env(safe-area-inset-bottom));
    background: var(--surface-1);
    border-top: 1px solid var(--border-soft);
  }

  .action-bar .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: var(--radius-md);
    font-size: 1rem;
    font-weight: 600;
    min-height: 3rem;
  }

  .action-preview {
    flex: 0 0 auto;
  }

  .action-print {
    flex: 1;
  }

  @media (max-width: 420px) {
    .action-preview span {
      display: none;
    }
  }

  @media (min-width: 768px) {
    .action-bar {
      justify-content: center;
    }
    .action-print {
      flex: 0 1 20rem;
    }
  }
</style>
