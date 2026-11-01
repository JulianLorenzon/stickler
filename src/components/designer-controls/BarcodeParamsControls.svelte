<script lang="ts">
  import { Barcode, type BarcodeCoding } from "$/fabric-object/barcode";
  import { tr } from "$/utils/i18n";
  import { BARCODE_FORMATS } from "$/utils/barcode";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import NumberStepper from "$/components/basic/NumberStepper.svelte";

  interface Props {
    selectedBarcode: Barcode;
    editRevision: number;
    valueUpdated: () => void;
  }

  let { selectedBarcode, editRevision, valueUpdated }: Props = $props();

  // Fabric objects aren't reactive, editRevision changes whenever the selection is edited
  const state = $derived.by(() => {
    void editRevision;
    return {
      encoding: selectedBarcode.encoding,
      text: selectedBarcode.text,
      scale: selectedBarcode.scaleFactor,
      fontSize: selectedBarcode.fontSize,
      printText: selectedBarcode.printText,
      invalid: selectedBarcode.isInvalid(),
    };
  });

  const format = $derived(BARCODE_FORMATS.find((f) => f.value === state.encoding) ?? BARCODE_FORMATS[0]);

  const setEncoding = (encoding: BarcodeCoding) => {
    selectedBarcode.set("encoding", encoding);
    // Keep the content if it fits the new format, otherwise start from an example
    if (selectedBarcode.isInvalid()) {
      const example = BARCODE_FORMATS.find((f) => f.value === encoding)?.example ?? "";
      selectedBarcode.set("text", example);
    }
    valueUpdated();
  };
</script>

<input type="hidden" value={editRevision}>

<div class="input-group input-group-sm flex-nowrap format">
  <span class="input-group-text" title={$tr("params.barcode.encoding")}><MdIcon icon="view_week" /></span>
  <select
    class="form-select"
    value={state.encoding}
    onchange={(e) => setEncoding(e.currentTarget.value as BarcodeCoding)}>
    {#each BARCODE_FORMATS as f (f.value)}
      <option value={f.value}>{f.label}</option>
    {/each}
  </select>
</div>

<div class="content" class:invalid={state.invalid}>
  <input
    class="form-control form-control-sm"
    value={state.text}
    placeholder={format.hint}
    title={format.hint}
    oninput={(e) => {
      selectedBarcode.set("text", e.currentTarget.value);
      valueUpdated();
    }} />
  <span class="content-hint">{state.invalid ? `⚠ ${format.hint}` : format.hint}</span>
</div>

<NumberStepper
  icon="settings_ethernet"
  title={$tr("params.barcode.scale")}
  value={state.scale}
  step={1}
  min={1}
  max={10}
  onChange={(v) => {
    selectedBarcode.set("scaleFactor", v);
    valueUpdated();
  }} />

<button
  class="btn btn-sm {state.printText ? 'btn-secondary' : ''}"
  title={$tr("params.barcode.enable_caption")}
  onclick={() => {
    selectedBarcode.set("printText", !selectedBarcode.printText);
    valueUpdated();
  }}>
  123
</button>

{#if state.printText}
  <NumberStepper
    icon="format_size"
    title={$tr("params.barcode.font_size")}
    value={state.fontSize}
    step={1}
    min={4}
    max={60}
    onChange={(v) => {
      selectedBarcode.set("fontSize", v);
      valueUpdated();
    }} />
{/if}

<style>
  .format {
    width: fit-content;
  }

  .content {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 12rem;
  }

  .content-hint {
    margin-top: 0.125rem;
    overflow: hidden;
    font-size: 0.6875rem;
    color: var(--ink-tertiary);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .content.invalid input {
    border-color: var(--bs-danger);
  }

  .content.invalid .content-hint {
    color: var(--bs-danger);
  }
</style>
