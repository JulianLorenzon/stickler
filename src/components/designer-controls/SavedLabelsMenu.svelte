<script lang="ts">
  import { tr } from "$/utils/i18n";
  import { onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import SavedLabelsBrowser from "$/components/designer-controls/SavedLabelsBrowser.svelte";
  import { ExportedLabelTemplateSchema, type ExportedLabelTemplate } from "$/types";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { Toasts } from "$/utils/toasts";
  import Dropdown from "bootstrap/js/dist/dropdown";
  import { FileUtils } from "$/utils/file_utils";
  import * as fabric from "fabric";
  interface Props {
    onRequestLabelTemplate: () => ExportedLabelTemplate;
    onLoadRequested: (label: ExportedLabelTemplate) => void;
    canvas: fabric.Canvas;
    csvEnabled: boolean;
  }

  let { onRequestLabelTemplate, onLoadRequested, canvas, csvEnabled }: Props = $props();

  let toggleRef: HTMLButtonElement;
  let savedLabels = $state<ExportedLabelTemplate[]>([]);
  /** The saved label that's open on the canvas: "Update" saves onto it. -1 for none */
  let selectedIndex = $state<number>(-1);
  let usedSpace = $state<number>(0);
  /** Import, export, PNG and link, behind the ⋮ button */
  let moreOpen = $state<boolean>(false);

  const loadDefault = (): ExportedLabelTemplate | null => {
    try {
      return LocalStoragePersistence.loadDefaultTemplate();
    } catch {
      return null;
    }
  };
  /** The start label, a copy of a saved label (or of a canvas, from older versions) */
  let defaultTemplate = $state<ExportedLabelTemplate | null>(loadDefault());

  const isDefault = (label: ExportedLabelTemplate): boolean =>
    defaultTemplate !== null &&
    label.timestamp === defaultTemplate.timestamp &&
    (label.title ?? "") === (defaultTemplate.title ?? "");

  /** A start label that matches no saved label (made with the old "Make default"): it still needs a way out */
  const orphanDefault = $derived(defaultTemplate !== null && !savedLabels.some(isDefault));

  const selectedTitle = $derived(
    selectedIndex === -1 ? "" : savedLabels[selectedIndex]?.title || $tr("params.saved_labels.untitled"),
  );

  const calcUsedSpace = () => {
    usedSpace = LocalStoragePersistence.usedSpace();
  };

  const closeMenu = () => Dropdown.getOrCreateInstance(toggleRef).hide();

  const setDefault = (label: ExportedLabelTemplate | undefined) => {
    try {
      LocalStoragePersistence.saveDefaultTemplate(label && { ...label, id: undefined, thumbnailBase64: undefined });
      defaultTemplate = loadDefault();
    } catch (e) {
      Toasts.zodErrors(e, "Default label save error:");
    }
    calcUsedSpace();
  };

  /** Returns whether it worked */
  const saveLabels = (labels: ExportedLabelTemplate[]): boolean => {
    const { zodErrors, otherErrors } = LocalStoragePersistence.saveLabels(labels);
    zodErrors.forEach((e) => Toasts.zodErrors(e, "Label save error"));
    otherErrors.forEach((e) => Toasts.error(e));

    const ok = zodErrors.length === 0 && otherErrors.length === 0;
    if (ok) {
      savedLabels = labels;
    }

    calcUsedSpace();
    return ok;
  };

  /** A tap opens the label and leaves it selected, so "Update" saves the edits back onto it */
  const onOpen = (index: number) => {
    const label = savedLabels[index];
    if (label === undefined) return;

    // Only ask when there's something on the canvas to lose
    if (canvas.getObjects().length > 0) {
      let message = $tr("editor.warning.load");
      if (label.csv) {
        message += "\n" + $tr("editor.warning.load.csv");
      }
      if (!confirm(message)) {
        return;
      }
    }

    selectedIndex = index;
    onLoadRequested(label);
    closeMenu();
  };

  const onExportSaved = (idx: number) => {
    try {
      FileUtils.saveLabelAsJson(savedLabels[idx]);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onDelete = (idx: number) => {
    const wasDefault = isDefault(savedLabels[idx]);
    const result = [...savedLabels];
    result.splice(idx, 1);
    if (!saveLabels(result)) return;

    if (wasDefault) setDefault(undefined);
    if (selectedIndex === idx) selectedIndex = -1;
    else if (selectedIndex > idx) selectedIndex--;
  };

  const onToggleDefault = (idx: number) => {
    const label = savedLabels[idx];
    setDefault(isDefault(label) ? undefined : label);
  };

  const onSaveNewClicked = () => {
    const name = prompt($tr("params.saved_labels.title_prompt"), selectedIndex === -1 ? "" : selectedTitle);
    if (name === null) return;

    const label = onRequestLabelTemplate();
    label.title = name.trim() || undefined;
    if (saveLabels([...savedLabels, label])) {
      selectedIndex = savedLabels.length - 1;
      Toasts.message($tr("params.saved_labels.saved"));
      closeMenu();
    }
  };

  const onUpdateClicked = () => {
    const old = savedLabels[selectedIndex];
    if (old === undefined) return;

    // After Clear, Update would save an empty label over the saved one
    if (canvas.getObjects().length === 0 && !confirm($tr("params.saved_labels.update.empty_confirm"))) {
      return;
    }

    const label = onRequestLabelTemplate();
    label.title = old.title;
    const result = [...savedLabels];
    result[selectedIndex] = label;

    if (saveLabels(result)) {
      // Keep the start label in step with the label it was made from
      if (isDefault(old)) setDefault(label);
      Toasts.message($tr("params.saved_labels.saved"));
      closeMenu();
    }
  };

  const onImportClicked = async () => {
    const contents = await FileUtils.pickAndReadSingleTextFile("json");
    const rawData = JSON.parse(contents);

    try {
      const label = ExportedLabelTemplateSchema.parse(rawData);

      if (canvas.getObjects().length > 0) {
        let message = $tr("editor.warning.load");
        if (label.csv) {
          message += "\n" + $tr("editor.warning.load.csv");
        }
        if (!confirm(message)) {
          return;
        }
      }

      onLoadRequested(label);
      // An imported label isn't one of the saved ones until it's saved
      selectedIndex = -1;
      moreOpen = false;
      closeMenu();
    } catch (e) {
      Toasts.zodErrors(e, "Canvas load error:");
    }
  };

  const onExportClicked = () => {
    try {
      const label = onRequestLabelTemplate();
      if (selectedIndex !== -1 && savedLabels[selectedIndex]?.title) {
        label.title = savedLabels[selectedIndex].title!.replaceAll(/[\\/:*?"<>|]/g, "_");
      }
      FileUtils.saveLabelAsJson(label);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onExportPngClicked = () => {
    try {
      FileUtils.saveCanvasAsPng(canvas);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onExportUrlClicked = async () => {
    try {
      const label = onRequestLabelTemplate();
      const url = await FileUtils.makeLabelUrl(label);

      if (url.length > 2000 && !confirm($tr("params.saved_labels.save.url.warn"))) {
        return;
      }

      navigator.clipboard.writeText(url);
      Toasts.message($tr("params.saved_labels.save.url.copied"));
    } catch (e) {
      Toasts.error(e);
    }
  };

  onMount(() => {
    savedLabels = LocalStoragePersistence.loadLabels();
    // The app started with the start label: it's the open one, so "Update" saves onto it
    selectedIndex = savedLabels.findIndex(isDefault);
    calcUsedSpace();
  });
</script>

<div class="dropdown">
  <button class="tool-btn" data-bs-toggle="dropdown" data-bs-auto-close="outside" bind:this={toggleRef}>
    <MdIcon icon="folder_open" />
    <span>{$tr("editor.toolbar.saved")}</span>
  </button>
  <div class="saved-labels dropdown-menu dropdown-sheet">
    <div class="head">
      <h6 class="head-title">{$tr("params.saved_labels.menu_title")}</h6>
      <span class="used">{usedSpace} {$tr("params.saved_labels.kb_used")}</span>
      <button
        class="head-more"
        class:active={moreOpen}
        onclick={() => (moreOpen = !moreOpen)}
        aria-expanded={moreOpen}
        aria-label={$tr("main.menu")}
        title={$tr("main.menu")}>
        <MdIcon icon="more_vert" />
      </button>
    </div>

    {#if moreOpen}
      <div class="more">
        <button class="btn btn-secondary" onclick={onImportClicked}>
          <MdIcon icon="upload_file" />
          {$tr("params.saved_labels.load.json")}
        </button>
        <button class="btn btn-secondary" onclick={onExportClicked}>
          <MdIcon icon="download" />
          {$tr("params.saved_labels.save.json")}
        </button>
        <button class="btn btn-secondary" onclick={onExportPngClicked}>
          <MdIcon icon="image" />
          PNG
        </button>
        <button class="btn btn-secondary" onclick={onExportUrlClicked}>
          <MdIcon icon="link" />
          {$tr("params.saved_labels.save.url")}
        </button>
      </div>
    {/if}

    {#if csvEnabled}
      <p class="csv-note text-warning">{$tr("params.saved_labels.save.withcsv")}</p>
    {/if}

    <div class="list">
      <SavedLabelsBrowser
        labels={savedLabels}
        {selectedIndex}
        {isDefault}
        {onOpen}
        onExport={onExportSaved}
        {onDelete}
        {onToggleDefault} />
    </div>

    <p class="hint">
      {#if orphanDefault}
        {$tr("params.saved_labels.default.orphan")}
        <button class="btn btn-link p-0 align-baseline" onclick={() => setDefault(undefined)}>
          {$tr("params.saved_labels.default.remove")}
        </button>
      {:else}
        {$tr("params.saved_labels.default.hint")}
      {/if}
    </p>

    <div class="actions">
      <button class="btn btn-secondary" onclick={onSaveNewClicked}>
        <MdIcon icon="add" />
        {$tr("params.saved_labels.save.new")}
      </button>
      {#if selectedIndex !== -1}
        <button class="btn btn-primary update-btn" onclick={onUpdateClicked}>
          <MdIcon icon="save" />
          <span class="update-text">{$tr("params.saved_labels.update")} “{selectedTitle}”</span>
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .saved-labels.dropdown-menu {
    width: 100vw;
    max-width: 450px;
    padding: 0.5rem 0.75rem 0.75rem;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
  }

  .head-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--ink-primary);
  }

  .used {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }

  .head-more {
    width: 2.75rem;
    height: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 50%;
    color: var(--ink-secondary);
    font-size: 1.25rem;
  }

  .head-more.active,
  .head-more:active {
    background: var(--surface-2);
  }

  .more {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .more .btn,
  .actions .btn {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
  }

  .csv-note {
    font-size: 0.8125rem;
    margin-bottom: 0.5rem;
  }

  .hint {
    margin: 0.5rem 0 0.75rem;
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }

  .hint .btn-link {
    font-size: inherit;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .actions .btn {
    flex: none;
  }

  .actions .update-btn {
    flex: 1 1 0;
    min-width: 0;
  }

  .update-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
