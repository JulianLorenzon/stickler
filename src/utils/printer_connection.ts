import { get } from "svelte/store";
import { Utils, driverForName } from "$/lib/printer";
import { automation, connectionState, initClient, lastPrinter, printerClient } from "$/stores";
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

  const prev = get(lastPrinter);
  lastPrinter.set({
    deviceId: printer.deviceId,
    name: printer.name,
    autoConnect: prev?.deviceId === printer.deviceId ? prev.autoConnect : true,
  });

  return true;
};

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
): Promise<boolean> => {
  if (scanning) await stopScan();

  try {
    await ensureBleReady();
  } catch (e) {
    Toasts.error(e);
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
    Toasts.error(e);
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

/** Native only: silently reconnect to the last used printer on app start. */
export const autoConnectOnLaunch = async (): Promise<void> => {
  if (!Utils.getAvailableTransports().capacitorBle || get(connectionState) !== "disconnected") return;

  const auto = get(automation);
  if (auto?.autoConnect && auto.autoConnectDeviceId) {
    await connectNative({ deviceId: auto.autoConnectDeviceId, name: auto.autoConnectDeviceId }, { silent: true });
    return;
  }

  const last = get(lastPrinter);
  if (last?.autoConnect) {
    await connectNative(last, { silent: true });
  }
};

/** Signal strength 0..3 for display */
export const signalLevel = (rssi?: number): number => {
  if (rssi === undefined) return 0;
  if (rssi >= -60) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -90) return 1;
  return 0;
};
