<script lang="ts">
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import CalibrationSection from "$/components/CalibrationSection.svelte";
  import { connectedPrinterName, connectionState, printerMeta, printerSheetOpen } from "$/stores";
  import { tr } from "$/utils/i18n";

  /** The calibration test prints, opened from the app menu. They need a connected printer. */
  let { show = $bindable() }: { show: boolean } = $props();
</script>

<AppModal title={$tr("calibration.title")} variant="fullscreen" bind:show>
  {#if $connectionState === "connected" && $printerMeta}
    <div class="printer-line">
      <span class="status-dot ok"></span>
      <span class="text-truncate">{$printerMeta.model || $connectedPrinterName}</span>
    </div>
    <CalibrationSection meta={$printerMeta} />
  {:else}
    <div class="no-printer">
      <div class="avatar"><MdIcon icon="print" /></div>
      <p class="text-secondary">{$tr("calibration.no_printer")}</p>
      <!-- The printer sheet opens over this page and closes itself once a printer is connected -->
      <button
        class="btn btn-primary btn-lg w-100"
        disabled={$connectionState === "connecting"}
        onclick={() => ($printerSheetOpen = true)}>
        {#if $connectionState === "connecting"}
          <span class="spinner-border spinner-border-sm"></span>
          {$tr("connector.status.connecting")}
        {:else}
          <MdIcon icon="bluetooth" />
          {$tr("connector.connect")}
        {/if}
      </button>
    </div>
  {/if}
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

  .no-printer {
    text-align: center;
    padding: 2rem 0.5rem;
  }

  .avatar {
    width: 4rem;
    height: 4rem;
    margin: 0 auto 1rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.4rem;
    background: var(--accent-subtle);
    color: var(--accent);
  }
</style>
