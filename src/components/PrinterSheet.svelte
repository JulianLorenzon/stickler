<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Utils, driverById } from "$/lib/printer";
  import type { KnownPrinter } from "$/types";
  import {
    printerClient,
    connectedPrinterName,
    connectionState,
    heartbeatData,
    printerInfo,
    printerMeta,
    connectedDeviceId,
    knownPrinters,
    autoReconnect,
  } from "$/stores";
  import { tr } from "$/utils/i18n";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import BatteryIndicator from "$/components/basic/BatteryIndicator.svelte";
  import {
    connectNative,
    connectWebBluetooth,
    forgetPrinter,
    knownByRecency,
    signalLevel,
    startScan,
    stopScan,
    type FoundPrinter,
  } from "$/utils/printer_connection";
  import type { MaterialIcon } from "material-icons";
  import { Toasts } from "$/utils/toasts";

  let { show = $bindable() }: { show: boolean } = $props();

  const transports = Utils.getAvailableTransports();

  let isScanning = $state(false);
  let found = $state<FoundPrinter[]>([]);
  let connectingId = $state<string | undefined>();
  let modalRef: AppModal;

  const connected = $derived($connectionState === "connected");
  const connecting = $derived($connectionState === "connecting");

  /**
   * With auto-connect on and nothing connected, a known printer the scan sees gets connected without a tap: the most
   * recently used one at once, another one if that one hasn't shown up within a moment
   */
  const AUTO_PICK_WAIT_MS = 1500;
  let autoPickTimer: ReturnType<typeof setTimeout> | undefined;
  const autoPick = (p: FoundPrinter) => {
    if (!$autoReconnect || $connectionState !== "disconnected" || connectingId) return;
    const order = knownByRecency($knownPrinters);
    const rank = order.findIndex((k) => k.deviceId === p.deviceId);
    if (rank === -1) return;
    const pick = () => {
      autoPickTimer = undefined;
      if ($connectionState !== "disconnected" || connectingId) return;
      const best = order.find((k) => found.some((f) => f.deviceId === k.deviceId));
      if (best) connectTo(best, true);
    };
    if (rank === 0) {
      clearTimeout(autoPickTimer);
      pick();
    } else {
      autoPickTimer ??= setTimeout(pick, AUTO_PICK_WAIT_MS);
    }
  };

  const scan = async () => {
    found = [];
    isScanning = await startScan(
      (p) => {
        const idx = found.findIndex((d) => d.deviceId === p.deviceId);
        if (idx === -1) {
          found = [...found, p];
          autoPick(p);
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

  /**
   * Connect and close the sheet, like a tap; `silent` for automatic connects, which shouldn't show an error (the
   * printer can be gone again by then). Closing also lets "Connect & print" go on to the preview.
   */
  const connectTo = async (p: FoundPrinter, silent = false) => {
    await onStopScan();
    connectingId = p.deviceId;
    const ok = await connectNative(p, { silent });
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

  const known = $derived(knownByRecency($knownPrinters));
  /** Known printers other than the connected one */
  const others = $derived(known.filter((p) => p.deviceId !== $connectedDeviceId));

  const switchTo = async (p: KnownPrinter) => {
    $printerClient.disconnect();
    await connectTo(p);
  };

  /** "Fichero D11s · " before the address, unless the name already says it */
  const modelLabel = (p: KnownPrinter): string => {
    const model = p.driver ? driverById(p.driver).displayName : "";
    return model && model !== p.name ? `${model} · ` : "";
  };

  const onForget = (p: KnownPrinter) => {
    if (confirm(`${$tr("connector.forget")} ${p.name}?`)) forgetPrinter(p.deviceId);
  };

  const signalIcon = (rssi?: number): MaterialIcon => {
    const lvl = signalLevel(rssi);
    if (lvl >= 3) return "signal_cellular_alt";
    if (lvl === 2) return "signal_cellular_alt_2_bar";
    return "signal_cellular_alt_1_bar";
  };

  // Auto power off (printers that support it): read once per connection
  const AUTO_OFF_CHOICES = [5, 10, 20, 30, 60, 120, 240, 480];
  let autoOff = $state<number | undefined>();
  let autoOffBusy = $state(false);
  let autoOffReadFor: unknown = undefined;
  const autoOffSupported = $derived(connected && $printerClient?.getDriver()?.autoOff !== undefined);
  const autoOffChoices = $derived(
    autoOff === undefined || AUTO_OFF_CHOICES.includes(autoOff)
      ? AUTO_OFF_CHOICES
      : [...AUTO_OFF_CHOICES, autoOff].sort((a, b) => a - b),
  );

  $effect(() => {
    if (!autoOffSupported) {
      autoOff = undefined;
      autoOffReadFor = undefined;
      return;
    }
    if (!show || autoOffReadFor === $printerInfo) return;
    autoOffReadFor = $printerInfo;
    $printerClient
      .getAutoOff()
      .then((m) => (autoOff = m))
      .catch(console.error);
  });

  const formatMinutes = (m: number): string =>
    m % 60 === 0 && m >= 60
      ? $tr("connector.auto_off.hours").replace("{n}", String(m / 60))
      : $tr("connector.auto_off.minutes").replace("{n}", String(m));

  const onAutoOffChange = async (e: Event) => {
    const minutes = Number((e.currentTarget as HTMLSelectElement).value);
    const previous = autoOff;
    autoOff = minutes;
    autoOffBusy = true;
    try {
      if (!(await $printerClient.setAutoOff(minutes))) throw new Error($tr("connector.auto_off.failed"));
    } catch (err) {
      autoOff = previous;
      Toasts.error(err);
    } finally {
      autoOffBusy = false;
    }
  };

  const canReset = $derived(connected && $printerClient?.getDriver()?.factoryReset !== undefined);

  const resetPrinter = async () => {
    if (!confirm($tr("connector.tools.reset.confirm"))) return;
    try {
      await $printerClient.abstraction.printerReset();
    } catch (err) {
      Toasts.error(err);
    }
  };

  const sortedFound = $derived([...found].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)));
  /** Nearby printers that aren't in the known list (those show their signal there) */
  const nearbyNew = $derived(sortedFound.filter((f) => !$knownPrinters.some((k) => k.deviceId === f.deviceId)));

  onMount(() => {
    if (transports.capacitorBle && $connectionState === "disconnected") {
      scan();
    }
  });

  onDestroy(() => {
    clearTimeout(autoPickTimer);
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

    {#if transports.capacitorBle && known.length > 0}
      <div class="form-check form-switch mt-3">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          id="autoConnect"
          bind:checked={$autoReconnect} />
        <label class="form-check-label" for="autoConnect">{$tr("connector.autoconnect")}</label>
      </div>
    {/if}

    {#if autoOffSupported}
      <div class="auto-off mt-3">
        <label for="auto-off" class="flex-grow-1 min-w-0">
          {$tr("connector.auto_off")}
          <span class="d-block small text-secondary">{$tr("connector.auto_off.hint")}</span>
        </label>
        <select
          id="auto-off"
          class="form-select"
          value={autoOff ?? ""}
          disabled={autoOff === undefined || autoOffBusy}
          onchange={onAutoOffChange}>
          {#if autoOff === undefined}
            <option value="">…</option>
          {/if}
          {#each autoOffChoices as m (m)}
            <option value={m}>{formatMinutes(m)}</option>
          {/each}
        </select>
      </div>
    {/if}

    <button class="btn btn-outline-danger w-100 mt-3" onclick={disconnect}>
      <MdIcon icon="bluetooth_disabled" />
      {$tr("connector.disconnect")}
    </button>

    {#if transports.capacitorBle && others.length > 0}
      <div class="section-label mt-3">{$tr("connector.known.other")}</div>
      <div class="device-list">
        {#each others as p (p.deviceId)}
          <div class="known-row">
            <div class="device-row flex-grow-1">
              <MdIcon icon="print" class="text-secondary" />
              <span class="flex-grow-1 text-start min-w-0">
                <span class="d-block text-truncate">{p.name}</span>
                <span class="d-block small text-secondary text-truncate">{modelLabel(p)}{p.deviceId}</span>
              </span>
            </div>
            <button class="btn btn-link switch-btn" disabled={connectingId !== undefined} onclick={() => switchTo(p)}>
              {#if connectingId === p.deviceId}
                <span class="spinner-border spinner-border-sm"></span>
              {:else}
                {$tr("connector.switch")}
              {/if}
            </button>
          </div>
        {/each}
      </div>
    {/if}

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

      </div>

      <div class="kv-title">{$tr("connector.details.tools")}</div>
      <div class="d-flex flex-wrap gap-1">
        <button class="btn btn-sm btn-secondary" onclick={() => $printerClient.fetchPrinterInfo()}>
          <MdIcon icon="refresh" /> {$tr("connector.tools.fetch_info")}
        </button>
        {#if canReset}
          <button class="btn btn-sm btn-outline-danger" onclick={resetPrinter}>
            <MdIcon icon="restart_alt" /> {$tr("connector.tools.reset")}
          </button>
        {/if}
      </div>
    </details>
  {:else if transports.capacitorBle}
    {#if known.length > 0}
      <div class="section-label">{$tr("connector.known")}</div>
      <div class="device-list">
        {#each known as p (p.deviceId)}
          {@const nearby = found.find((f) => f.deviceId === p.deviceId)}
          <div class="known-row">
            <button class="device-row flex-grow-1" disabled={connecting} onclick={() => connectTo(p)}>
              <MdIcon icon="print" class="text-secondary" />
              <span class="flex-grow-1 text-start min-w-0">
                <span class="d-block text-truncate">{p.name}</span>
                <span class="d-block small text-secondary text-truncate">
                  {modelLabel(p)}{p.deviceId}
                </span>
              </span>
              {#if connectingId === p.deviceId}
                <span class="spinner-border spinner-border-sm text-primary"></span>
              {:else if nearby}
                <MdIcon icon={signalIcon(nearby.rssi)} class="signal signal-{signalLevel(nearby.rssi)}" />
              {/if}
            </button>
            <button
              class="btn btn-link text-secondary forget-btn"
              onclick={() => onForget(p)}
              title={$tr("connector.forget")}
              aria-label={`${$tr("connector.forget")} ${p.name}`}>
              <MdIcon icon="close" />
            </button>
          </div>
        {/each}
      </div>
      <div class="form-check form-switch mt-2">
        <input
          class="form-check-input"
          type="checkbox"
          role="switch"
          id="autoConnect"
          bind:checked={$autoReconnect} />
        <label class="form-check-label small" for="autoConnect">{$tr("connector.autoconnect")}</label>
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
      {#each nearbyNew as device (device.deviceId)}
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
          {#if found.length > 0}
            {$tr("connector.scan.only_known")}
          {:else if isScanning}
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
  .known-row {
    display: flex;
    align-items: stretch;
    background: var(--surface-2);
  }

  .known-row + .known-row {
    border-top: 1px solid var(--border-standard);
  }

  .switch-btn {
    text-decoration: none;
    min-width: 5.5rem;
    font-weight: 600;
  }

  .forget-btn {
    text-decoration: none;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .auto-off {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .auto-off .form-select {
    width: auto;
    min-height: 44px;
  }

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
