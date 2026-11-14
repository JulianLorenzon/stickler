<script lang="ts">
  import AppModal from "$/components/basic/AppModal.svelte";
  import CalibrationSection from "$/components/CalibrationSection.svelte";
  import { DRIVERS, driverById, type PrinterModelMeta } from "$/lib/printer";
  import { connectedPrinterName, connectionState, designPrinter, printerMeta } from "$/stores";
  import { tr } from "$/utils/i18n";

  /**
   * The calibration of a printer, opened from the app menu: the connected one, else the last one used, which can be
   * switched. Measuring and the saved corrections work without a printer; only the test prints need one.
   */
  let { show = $bindable() }: { show: boolean } = $props();

  const connected = $derived($connectionState === "connected" && $printerMeta !== undefined);
  const meta = $derived<PrinterModelMeta>(connected ? $printerMeta! : driverById($designPrinter).meta({}));
</script>

<AppModal title={$tr("calibration.title")} variant="fullscreen" bind:show>
  {#if connected}
    <div class="printer-line">
      <span class="status-dot ok"></span>
      <span class="text-truncate">{meta.model || $connectedPrinterName}</span>
    </div>
  {:else}
    <div class="printer-switch" role="group" aria-label={$tr("params.label.printer")}>
      {#each DRIVERS as d (d.id)}
        <button
          class="btn {meta.driver === d.id ? 'btn-primary' : 'btn-outline-secondary'}"
          aria-pressed={meta.driver === d.id}
          onclick={() => designPrinter.set(d.id)}>{d.displayName}</button>
      {/each}
    </div>
    <p class="offline">{$tr("calibration.offline")}</p>
  {/if}
  {#key meta.driver}
    <CalibrationSection {meta} {connected} />
  {/key}
</AppModal>

<style>
  .printer-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--ink-secondary);
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
  }

  .printer-switch {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 0.25rem;
  }

  .printer-switch .btn {
    min-height: 2.75rem;
  }

  .offline {
    font-size: 0.8125rem;
    color: var(--ink-secondary);
    margin: 0.5rem 0 0;
  }
</style>
