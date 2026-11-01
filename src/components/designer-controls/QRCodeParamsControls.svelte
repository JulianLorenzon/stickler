<script lang="ts">
  import { QRCode } from "$/fabric-object/qrcode";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import NumberStepper from "$/components/basic/NumberStepper.svelte";
  import { DOTS_PER_MM } from "$/defaults";

  interface Props {
    selectedQRCode: QRCode;
    editRevision: number;
    valueUpdated: () => void;
  }

  let { selectedQRCode, editRevision, valueUpdated }: Props = $props();

  const sizeMm = $derived.by(() => {
    void editRevision;
    return selectedQRCode.width / DOTS_PER_MM;
  });

  /** Resize around the center, so a centered code stays centered */
  const setSize = (mm: number) => {
    const size = Math.round(mm * DOTS_PER_MM);
    const center = selectedQRCode.getCenterPoint();
    selectedQRCode.set({ width: size, height: size });
    selectedQRCode.setPositionByOrigin(center, "center", "center");
    selectedQRCode.set({ left: Math.round(selectedQRCode.left), top: Math.round(selectedQRCode.top) });
    valueUpdated();
  };
</script>

<input type="hidden" value={editRevision}>

<NumberStepper
  icon="open_in_full"
  title={$tr("params.qrcode.size")}
  value={sizeMm}
  step={0.5}
  min={3}
  max={100}
  decimals={1}
  unit="mm"
  onChange={setSize} />

<div class="input-group input-group-sm flex-nowrap">
  <span class="input-group-text" title={$tr("params.qrcode.ecl")}>
    <MdIcon icon="auto_fix_high" />
  </span>
  <select
    class="form-select"
    value={selectedQRCode.ecl}
    onchange={(e) => {
      selectedQRCode?.set("ecl", e.currentTarget.value);
      valueUpdated();
    }}>
    <option value="L">Level L</option>
    <option value="M">Level M</option>
    <option value="Q">Level Q</option>
    <option value="H">Level H</option>
  </select>
</div>

<div class="input-group input-group-sm flex-nowrap">
  <span class="input-group-text" title={$tr("params.qrcode.mode")}>
    <MdIcon icon="abc" />
  </span>
  <select
    class="form-select"
    value={selectedQRCode.mode}
    onchange={(e) => {
      selectedQRCode?.set("mode", e.currentTarget.value);
      valueUpdated();
    }}>
    <option value="Byte">Byte</option>
    <option value="Numeric">Numeric</option>
    <option value="Alphanumeric">Alphanumeric</option>
    <option value="Kanji">Kanji</option>
  </select>
</div>

<div class="input-group input-group-sm flex-nowrap">
  <span class="input-group-text" title={$tr("params.qrcode.version")}>
    <MdIcon icon="123" />
  </span>
  <select
    class="form-select"
    value={selectedQRCode.qrVersion}
    onchange={(e) => {
      selectedQRCode?.set("qrVersion", parseInt(e.currentTarget.value));
      valueUpdated();
    }}>
    <option value={0}>Auto</option>
    {#each { length: 40 }, i (i)}
      <option value={i + 1}>{i + 1}</option>
    {/each}
  </select>
</div>

<textarea
  class="qrcode-content form-control"
  value={selectedQRCode.text}
  oninput={(e) => {
    selectedQRCode?.set("text", e.currentTarget.value);
    valueUpdated();
  }}></textarea>

<style>
  .input-group {
    width: fit-content;
  }

  .qrcode-content {
    flex: none;
    width: 12rem;
    height: 3.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.875rem;
    resize: none;
  }
</style>
