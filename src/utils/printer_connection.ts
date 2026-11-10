import { get } from "svelte/store";
import { Utils, driverForName } from "$/lib/printer";
import type { KnownPrinter } from "$/types";
import {
  automation,
  autoReconnect,
  connectedDeviceId,
  connectionState,
  initClient,
  knownPrinters,
  printerClient,
  printerMeta,
} from "$/stores";
import { Toasts } from "$/utils/toasts";

export type FoundPrinter = { deviceId: string; name: string; rssi?: number };

const isPrinterName = (name: string): boolean => driverForName(name) !== undefined;

const loadBle = () => import("@capacitor-community/bluetooth-le");

/** Native only: request permissions and make sure the Bluetooth adapter is turned on. */
const ensureBleReady = async (): Promise<void> => {
  const { BleClient } = await loadBle();
  // BLUETOOTH_SCAN is declared with neverForLocation, so Android 12+ won't ask for location access
  await BleClient.initialize({ androidNeverForLocation: true });

  if (!(await BleClient.isEnabled())) {
    // Shows the system "Turn on Bluetooth?" dialog, rejects if the user declines
    await BleClient.requestEnable();
  }
};

/** Web Bluetooth: shows the browser device chooser. Must be called from a user gesture. */
export const connectWebBluetooth = async (): Promise<void> => {
  initClient();
  connectionState.set("connecting");

  try {
    await get(printerClient).connect();
  } catch (e) {
    connectionState.set("disconnected");
    Toasts.error(e);
  }
};

/** Native BLE: connect to a known device id (MAC address on Android). */
export const connectNative = async (printer: FoundPrinter, opts: { silent?: boolean } = {}): Promise<boolean> => {
  try {
    await ensureBleReady();
  } catch (e) {
    if (!opts.silent) Toasts.error(e);
    return false;
  }

  initClient();
  connectionState.set("connecting");

  try {
    await get(printerClient).connect({ deviceId: printer.deviceId, deviceName: printer.name });
  } catch (e) {
    connectionState.set("disconnected");
    if (!opts.silent) Toasts.error(e);
    return false;
  }

  connectedDeviceId.set(printer.deviceId);
  rememberPrinter(printer);
  return true;
};

/** Add or update a printer in the known printers list, as the most recently used */
const rememberPrinter = (printer: FoundPrinter) => {
  const list = get(knownPrinters);
  const prev = list.find((p) => p.deviceId === printer.deviceId);
  // Automatic connects only know the address; keep the real name from before
  const name = printer.name && printer.name !== printer.deviceId ? printer.name : (prev?.name ?? printer.name);
  knownPrinters.set([
    { deviceId: printer.deviceId, name, driver: get(printerMeta)?.driver ?? prev?.driver, lastUsed: Date.now() },
    ...list.filter((p) => p.deviceId !== printer.deviceId),
  ]);
};

export const forgetPrinter = (deviceId: string) => {
  knownPrinters.set(get(knownPrinters).filter((p) => p.deviceId !== deviceId));
};

/** Known printers, most recently used first */
export const knownByRecency = (list: KnownPrinter[]): KnownPrinter[] => [...list].sort((a, b) => b.lastUsed - a.lastUsed);

let scanStopTimer: ReturnType<typeof setTimeout> | undefined;
let scanning = false;

/**
 * Native BLE: scan for supported printers. `onFound` is called for every new device and for RSSI updates
 * of already seen ones. Scan stops automatically after `durationMs`, then `onStopped` is called.
 */
export const startScan = async (
  onFound: (printer: FoundPrinter) => void,
  onStopped: () => void,
  durationMs: number = 12_000,
  opts: { silent?: boolean } = {},
): Promise<boolean> => {
  if (scanning) await stopScan();

  try {
    await ensureBleReady();
  } catch (e) {
    if (!opts.silent) Toasts.error(e);
    return false;
  }

  const { BleClient } = await loadBle();

  try {
    await BleClient.requestLEScan({ allowDuplicates: true }, (result) => {
      const name = result.device.name ?? result.localName ?? "";
      if (!isPrinterName(name)) return;
      onFound({ deviceId: result.device.deviceId, name, rssi: result.rssi });
    });
  } catch (e) {
    if (!opts.silent) Toasts.error(e);
    return false;
  }

  scanning = true;
  scanStopTimer = setTimeout(async () => {
    await stopScan();
    onStopped();
  }, durationMs);

  return true;
};

export const stopScan = async (): Promise<void> => {
  clearTimeout(scanStopTimer);
  if (!scanning) return;
  scanning = false;
  const { BleClient } = await loadBle();
  await BleClient.stopLEScan().catch(() => {});
};

/** How long the app-start scan looks for known printers */
const AUTO_CONNECT_SCAN_MS = 4000;

/**
 * Native only: on app start, silently connect to a known printer. With one known printer, connect to it directly;
 * with several, scan briefly and take the most recently used one that is switched on. Only known addresses are used.
 */
export const autoConnectOnLaunch = async (): Promise<void> => {
  if (!Utils.getAvailableTransports().capacitorBle || get(connectionState) !== "disconnected") return;

  const auto = get(automation);
  if (auto?.autoConnect && auto.autoConnectDeviceId) {
    await connectNative({ deviceId: auto.autoConnectDeviceId, name: auto.autoConnectDeviceId }, { silent: true });
    return;
  }

  const known = knownByRecency(get(knownPrinters));
  if (!get(autoReconnect) || known.length === 0) return;
  if (known.length === 1) {
    await connectNative(known[0], { silent: true });
    return;
  }

  const seen = new Set<string>();
  const pick = await new Promise<KnownPrinter | undefined>((resolve) => {
    let done = false;
    const finish = (p: KnownPrinter | undefined) => {
      if (done) return;
      done = true;
      resolve(p);
    };
    // In case another scan (the printer sheet) takes over and this one never reports its end
    setTimeout(() => finish(known.find((k) => seen.has(k.deviceId))), AUTO_CONNECT_SCAN_MS + 1000);
    startScan(
      (found) => {
        if (!known.some((k) => k.deviceId === found.deviceId)) return;
        seen.add(found.deviceId);
        // The most recently used one: no need to wait for the others
        if (found.deviceId === known[0].deviceId) finish(known[0]);
      },
      () => finish(known.find((k) => seen.has(k.deviceId))),
      AUTO_CONNECT_SCAN_MS,
      { silent: true },
    ).then((ok) => {
      if (!ok) finish(undefined);
    });
  });
  if (pick) await stopScan();
  if (pick && get(connectionState) === "disconnected") await connectNative(pick, { silent: true });
};

/** Signal strength 0..3 for display */
export const signalLevel = (rssi?: number): number => {
  if (rssi === undefined) return 0;
  if (rssi >= -60) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -90) return 1;
  return 0;
};
