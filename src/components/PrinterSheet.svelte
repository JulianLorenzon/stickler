<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { SoundSettingsItemType, Utils } from "$/lib/printer";
  import {
    printerClient,
    connectedPrinterName,
    connectionState,
    heartbeatData,
    printerInfo,
    printerMeta,
    rfidInfo,
    ribbonRfidInfo,
    refreshRfidInfo,
    lastPrinter,
  } from "$/stores";
  import { tr } from "$/utils/i18n";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import FirmwareUpdater from "$/components/basic/FirmwareUpdater.svelte";
  import BatteryIndicator from "$/components/basic/BatteryIndicator.svelte";
  import {
    connectNative,
    connectWebBluetooth,
    signalLevel,
    startScan,
    stopScan,
    type FoundPrinter,
  } from "$/utils/printer_connection";
  import type { MaterialIcon } from "material-icons";

  let { show = $bindable() }: { show: boolean } = $props();

  const transports = Utils.getAvailableTransports();

  let isScanning = $state(false);
  let found = $state<FoundPrinter[]>([]);
  let connectingId = $state<string | undefined>();
  let modalRef: AppModal;

  const connected = $derived($connectionState === "connected");
  const connecting = $derived($connectionState === "connecting");

  const scan = async () => {
    found = [];
    isScanning = await startScan(
      (p) => {
        const idx = found.findIndex((d) => d.deviceId === p.deviceId);
        if (idx === -1) {
          found = [...found, p];
        } else if (found[idx].rssi !== p.rssi) {
          found[idx] = p;
        }
      },
      () => (isScanning = false),
    );
  };

  const onStopScan = async () => {
    await stopScan();
    isScanning = false;
  };

  const connectTo = async (p: FoundPrinter) => {
    await onStopScan();
    connectingId = p.deviceId;
    const ok = await connectNative(p);
    connectingId = undefined;
    if (ok) modalRef.hide();
  };

  const connectWeb = async () => {
    await connectWebBluetooth();
    if ($connectionState === "connected") modalRef.hide();
  };

  const disconnect = () => {
    $printerClient.disconnect();
  };

  const forget = () => {
    lastPrinter.set(null);
  };

  const toggleAutoConnect = (e: Event) => {
    if ($lastPrinter) {
      lastPrinter.set({ ...$lastPrinter, autoConnect: (e.currentTarget as HTMLInputElement).checked });
    }
  };

  const signalIcon = (rssi?: number): MaterialIcon => {
    const lvl = signalLevel(rssi);
    if (lvl >= 3) return "signal_cellular_alt";
    if (lvl === 2) return "signal_cellular_alt_2_bar";
    return "signal_cellular_alt_1_bar";
  };

  const sortedFound = $derived([...found].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)));

  onMount(() => {
    if (transports.capacitorBle && $connectionState === "disconnected") {
      scan();
    }
  });

  onDestroy(() => {
    stopScan();
  });
</script>

<AppModal title={$tr("connector.sheet.title")} variant="sheet" bind:show bind:this={modalRef}>
  {#if connected}
    <div class="printer-card">
      <div class="printer-avatar connected"><MdIcon icon="print" /></div>
      <div class="flex-grow-1 min-w-0">
        <div class="fw-semibold text-truncate">{$printerMeta?.model || $connectedPrinterName}</div>
        <div class="small text-secondary text-truncate">
          <span class="status-dot ok"></span>
          {$tr("connector.status.connected")} · {$connectedPrinterName}
        </div>
      </div>
      {#if $heartbeatData?.chargeLevel}
        <BatteryIndicator level={$heartbeatData.chargeLevel} charging={$heartbeatData.charging} showPercent />
      {/if}
    </div>

    {#if transports.capacitorBle && $lastPrinter}
      <div class="form-check form-switch mt-3">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          id="autoConnect"
          checked={$lastPrinter.autoConnect}
          onchange={toggleAutoConnect} />
        <label class="form-check-label" for="autoConnect">{$tr("connector.autoconnect")}</label>
      </div>
    {/if}

    <button class="btn btn-outline-danger w-100 mt-3" onclick={disconnect}>
      <MdIcon icon="bluetooth_disabled" />
      {$tr("connector.disconnect")}
    </button>

    <details class="advanced mt-3">
      <summary>{$tr("connector.details")}</summary>

      <div class="kv-groups">
        {#if $printerInfo && Object.keys($printerInfo).length > 0}
          <div class="kv-title">{$tr("connector.details.info")}</div>
          <dl class="kv">
            {#each Object.entries($printerInfo) as [key, value] (key)}
              <dt>{key}</dt>
              <dd>{value ?? "-"}</dd>
            {/each}
          </dl>
        {/if}

        {#if $heartbeatData}
          <div class="kv-title">{$tr("connector.details.status")}</div>
          <dl class="kv">
            {#each Object.entries($heartbeatData) as [key, value] (key)}
              <dt>{key}</dt>
              <dd>{value ?? "-"}</dd>
            {/each}
          </dl>
        {/if}

        {#if $printerMeta}
          <div class="kv-title">{$tr("connector.details.model")}</div>
          <dl class="kv">
            {#each Object.entries($printerMeta) as [key, value] (key)}
              <dt>{key}</dt>
              <dd>{value ?? "-"}</dd>
            {/each}
          </dl>
        {/if}

        {#if $rfidInfo || $ribbonRfidInfo}
          <div class="kv-title d-flex align-items-center">
            RFID
            <button class="btn btn-sm btn-link ms-auto p-0" onclick={refreshRfidInfo}>
              <MdIcon icon="refresh" />
            </button>
          </div>
          <dl class="kv">
            {#each Object.entries($rfidInfo ?? {}) as [key, value] (key)}
              <dt>{key}</dt>
              <dd>{value ?? "-"}</dd>
            {/each}
            {#each Object.entries($ribbonRfidInfo ?? {}) as [key, value] (key)}
              <dt>ribbon.{key}</dt>
              <dd>{value ?? "-"}</dd>
            {/each}
          </dl>
        {/if}
      </div>

      <div class="kv-title">{$tr("connector.details.tools")}</div>
      <div class="d-flex flex-wrap gap-1">
        <button class="btn btn-sm btn-secondary" onclick={() => $printerClient.fetchPrinterInfo()}>
          <MdIcon icon="refresh" /> {$tr("connector.tools.fetch_info")}
        </button>
        <button
          class="btn btn-sm btn-secondary"
          onclick={async () => {
            await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.BluetoothConnectionSound, true);
            await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.PowerSound, true);
          }}>
          <MdIcon icon="volume_up" /> {$tr("connector.tools.sound_on")}
        </button>
        <button
          class="btn btn-sm btn-secondary"
          onclick={async () => {
            await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.BluetoothConnectionSound, false);
            await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.PowerSound, false);
          }}>
          <MdIcon icon="volume_off" /> {$tr("connector.tools.sound_off")}
        </button>
        <button class="btn btn-sm btn-secondary" onclick={() => $printerClient.startHeartbeat()}>
          {$tr("connector.tools.heartbeat_on")}
        </button>
        <button class="btn btn-sm btn-secondary" onclick={() => $printerClient.stopHeartbeat()}>
          {$tr("connector.tools.heartbeat_off")}
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick={() => $printerClient.abstraction.printerReset()}>
          <MdIcon icon="restart_alt" /> {$tr("connector.tools.reset")}
        </button>
      </div>

      <div class="mt-3"><FirmwareUpdater /></div>
    </details>
  {:else if transports.capacitorBle}
    {#if $lastPrinter}
      <div class="section-label">{$tr("connector.last_used")}</div>
      <div class="printer-card">
        <div class="printer-avatar"><MdIcon icon="print" /></div>
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold text-truncate">{$lastPrinter.name}</div>
          <div class="small text-secondary text-truncate">{$lastPrinter.deviceId}</div>
        </div>
        <button
          class="btn btn-primary"
          disabled={connecting}
          onclick={() => $lastPrinter && connectTo($lastPrinter)}>
          {#if connectingId === $lastPrinter.deviceId}
            <span class="spinner-border spinner-border-sm"></span>
          {:else}
            {$tr("connector.connect")}
          {/if}
        </button>
      </div>
      <div class="d-flex align-items-center mt-2 gap-2">
        <div class="form-check form-switch mb-0">
          <input
            class="form-check-input"
            type="checkbox"
            role="switch"
            id="autoConnect"
            checked={$lastPrinter.autoConnect}
            onchange={toggleAutoConnect} />
          <label class="form-check-label small" for="autoConnect">{$tr("connector.autoconnect")}</label>
        </div>
        <button class="btn btn-sm btn-link text-secondary ms-auto" onclick={forget}>
          {$tr("connector.forget")}
        </button>
      </div>
    {/if}

    <div class="section-label d-flex align-items-center mt-3">
      <span>{$tr("connector.nearby")}</span>
      {#if isScanning}
        <span class="spinner-border spinner-border-sm ms-2 text-primary"></span>
        <button class="btn btn-sm btn-link ms-auto" onclick={onStopScan}>{$tr("connector.scan.stop")}</button>
      {:else}
        <button class="btn btn-sm btn-link ms-auto" onclick={scan}>
          <MdIcon icon="refresh" />
          {$tr("connector.scan")}
        </button>
      {/if}
    </div>

    <div class="device-list">
      {#each sortedFound as device (device.deviceId)}
        <button class="device-row" disabled={connecting} onclick={() => connectTo(device)}>
          <MdIcon icon="print" class="text-secondary" />
          <span class="flex-grow-1 text-start text-truncate">{device.name}</span>
          {#if connectingId === device.deviceId}
            <span class="spinner-border spinner-border-sm text-primary"></span>
          {:else}
            <MdIcon icon={signalIcon(device.rssi)} class="signal signal-{signalLevel(device.rssi)}" />
          {/if}
        </button>
      {:else}
        <div class="empty-state">
          {#if isScanning}
            {$tr("connector.scan.searching")}
          {:else}
            {$tr("connector.scan.none")}
          {/if}
          <div class="small text-secondary mt-1">{$tr("connector.scan.hint")}</div>
        </div>
      {/each}
    </div>
  {:else if transports.webBluetooth}
    <div class="text-center py-2">
      <div class="printer-avatar mx-auto mb-3 big"><MdIcon icon="bluetooth_searching" /></div>
      <p class="text-secondary">{$tr("connector.web.hint")}</p>
      <button class="btn btn-primary btn-lg w-100" disabled={connecting} onclick={connectWeb}>
        {#if connecting}
          <span class="spinner-border spinner-border-sm"></span>
        {:else}
          <MdIcon icon="bluetooth" />
        {/if}
        {$tr("connector.web.search")}
      </button>
    </div>
  {:else}
    <div class="text-center py-2">
      <div class="printer-avatar mx-auto mb-3 big"><MdIcon icon="bluetooth_disabled" /></div>
      <p class="text-secondary mb-0">{$tr("browser_warning.lines.first")}</p>
    </div>
  {/if}
</AppModal>

<style>
  .printer-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
  }

  .printer-avatar {
    flex: none;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--surface-3);
    color: var(--ink-secondary);
  }

  .printer-avatar.connected {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .printer-avatar.big {
    width: 4rem;
    height: 4rem;
    font-size: 1.4rem;
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .min-w-0 {
    min-width: 0;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-tertiary);
    margin-bottom: 0.5rem;
  }

  .section-label .btn-link {
    text-transform: none;
    letter-spacing: normal;
    text-decoration: none;
  }

  .device-list {
    border-radius: var(--radius-md);
    border: 1px solid var(--border-standard);
    overflow: hidden;
  }

  .device-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.25rem;
    padding: 0.5rem 0.875rem;
    border: none;
    background: var(--surface-2);
    color: var(--ink-primary);
  }

  .device-row + .device-row {
    border-top: 1px solid var(--border-standard);
  }

  .device-row:active,
  .device-row:hover {
    background: var(--surface-3);
  }

  .device-row :global(.signal-0),
  .device-row :global(.signal-1) {
    color: var(--status-warn);
  }

  .device-row :global(.signal-2),
  .device-row :global(.signal-3) {
    color: var(--status-ok);
  }

  .empty-state {
    padding: 1.5rem 1rem;
    text-align: center;
    color: var(--ink-secondary);
  }

  .advanced summary {
    color: var(--ink-secondary);
    cursor: pointer;
    padding: 0.25rem 0;
  }

  .kv-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-tertiary);
    margin: 0.75rem 0 0.25rem;
  }

  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.125rem 0.75rem;
    font-size: 0.85rem;
    margin: 0;
  }

  .kv dt {
    font-weight: normal;
    color: var(--ink-secondary);
  }

  .kv dd {
    margin: 0;
    text-align: end;
    font-variant-numeric: tabular-nums;
    word-break: break-all;
  }
</style>
