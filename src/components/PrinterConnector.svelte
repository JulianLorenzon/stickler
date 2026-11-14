<script lang="ts">
  import { onMount } from "svelte";
  import {
    connectedPrinterName,
    connectionState,
    heartbeatData,
    printerMeta,
    heartbeatFails,
    printerSheetOpen,
  } from "$/stores";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import BatteryIndicator from "$/components/basic/BatteryIndicator.svelte";
  import { autoConnectOnLaunch, watchForeground } from "$/utils/printer_connection";

  onMount(() => {
    autoConnectOnLaunch();
    return watchForeground();
  });
</script>

<button
  class="printer-chip state-{$connectionState}"
  class:warn={$connectionState === "connected" && $heartbeatFails > 0}
  onclick={() => ($printerSheetOpen = true)}>
  {#if $connectionState === "connected"}
    <span class="status-dot ok"></span>
    <span class="name">{$printerMeta?.model || $connectedPrinterName}</span>
    {#if $heartbeatData?.chargeLevel}
      <BatteryIndicator level={$heartbeatData.chargeLevel} charging={$heartbeatData.charging} />
    {/if}
  {:else if $connectionState === "connecting"}
    <span class="spinner-border spinner-border-sm"></span>
    <span class="name">{$tr("connector.status.connecting")}</span>
  {:else}
    <MdIcon icon="bluetooth" />
    <span class="name">{$tr("connector.connect")}</span>
  {/if}
</button>

<style>
  .printer-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.25rem;
    max-width: 14rem;
    padding: 0 0.875rem;
    border-radius: 999px;
    border: 1px solid var(--border-emphasis);
    background: var(--surface-2);
    color: var(--ink-primary);
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
    transition: background-color 0.15s;
  }

  .printer-chip:hover {
    background: var(--surface-3);
  }

  .printer-chip.state-disconnected {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  .printer-chip.state-disconnected:hover {
    background: var(--accent-hover);
  }

  .printer-chip.state-disconnected :global(.mdi) {
    font-size: 1.2em;
    vertical-align: 0;
  }

  .printer-chip.warn {
    border-color: rgba(var(--status-warn-rgb), 0.5);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
