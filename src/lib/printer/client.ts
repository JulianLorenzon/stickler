import { Capacitor } from "@capacitor/core";
import { CLIENT_DEFAULTS } from "./constants";
import { TypedEventEmitter } from "./emitter";
import { Utils } from "./utils";
import { ImageEncoder } from "./image_encoder";
import type { PrintTaskOptions } from "./print_task";
import {
  ALL_NAME_PREFIXES,
  ALL_SERVICE_UUIDS,
  driverForName,
  driverForServices,
  type DriverIO,
  type PrinterDriver,
} from "./drivers";
import type {
  ConnectionInfo,
  EncodedImage,
  HeartbeatData,
  PrintDirection,
  PrinterInfo,
  PrinterModelMeta,
  PrintProgressEvent,
  Packet,
} from "./types";

interface ClientEventMap {
  connect: { info: ConnectionInfo };
  disconnect: void;
  printerinfofetched: { info: PrinterInfo };
  heartbeat: { data: HeartbeatData };
  heartbeatfailed: { failedAttempts: number };
  printprogress: PrintProgressEvent;
  packetsent: { packet: Packet };
  packetreceived: { packet: Packet };
}

function makePacket(data: readonly number[] | number[] | Uint8Array): Packet {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const cmd = bytes.length >= 2 ? (bytes[0] << 8) | bytes[1] : bytes[0] ?? 0;
  return {
    command: cmd,
    toBytes: () => bytes,
  };
}

/** Picks the driver for a device: by Bluetooth name, else by the services it offers */
export type DriverPicker = (deviceName: string | undefined, serviceUuids: () => Promise<string[]>) => Promise<PrinterDriver>;

const pickDriver: DriverPicker = async (deviceName, serviceUuids) => {
  const driver = driverForName(deviceName) ?? driverForServices(await serviceUuids());
  if (!driver) throw new Error(`Unsupported printer${deviceName ? ` (${deviceName})` : ""}`);
  return driver;
};

export abstract class PrinterClient extends TypedEventEmitter<ClientEventMap> {
  private notifyBuf: number[] = [];
  private notifyResolve: (() => void) | null = null;
  private notifyListeners = new Set<(data: Uint8Array) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatFailCount = 0;
  /** Pause after each chunk of print data */
  private packetIntervalMs: number = CLIENT_DEFAULTS.packetIntervalMs;
  private info: PrinterInfo = {};
  private _connected = false;
  /** Set while connecting, before the connection is up */
  protected driver: PrinterDriver | undefined;

  private readonly io: DriverIO = {
    sendCommand: (data, wait, timeout) => this.sendCommand(data, wait, timeout),
    sendData: (data) => this.sendChunked(data),
    onNotify: (listener) => {
      this.notifyListeners.add(listener);
      return () => this.notifyListeners.delete(listener);
    },
    emitProgress: (e) => this.emit("printprogress", e),
  };

  readonly abstraction = {
    newPrintTask: (opts: PrintTaskOptions) => {
      return this.requireDriver().newPrintTask(this.io, opts);
    },

    printerReset: async () => {
      await this.requireDriver().factoryReset?.(this.io);
    },
  };

  /** Run printer commands with the heartbeat paused, so its replies don't mix with theirs */
  private async withoutHeartbeat<T>(fn: () => Promise<T>): Promise<T> {
    const wasRunning = this.heartbeatTimer !== undefined;
    this.stopHeartbeat();
    try {
      return await fn();
    } finally {
      if (wasRunning && this._connected) this.startHeartbeat();
    }
  }

  /** Auto power off in minutes; undefined if the printer can't tell */
  async getAutoOff(): Promise<number | undefined> {
    const autoOff = this.requireDriver().autoOff;
    if (!autoOff) return undefined;
    return this.withoutHeartbeat(() => autoOff.get(this.io));
  }

  async setAutoOff(minutes: number): Promise<boolean> {
    const autoOff = this.requireDriver().autoOff;
    if (!autoOff) return false;
    return this.withoutHeartbeat(() => autoOff.set(this.io, minutes));
  }

  private requireDriver(): PrinterDriver {
    if (!this.driver) throw new Error("Not connected");
    return this.driver;
  }

  /** Driver of the connected printer */
  getDriver(): PrinterDriver | undefined {
    return this.driver;
  }

  /** Called by subclasses whenever a BLE notification arrives from the printer */
  protected handleNotify(data: Uint8Array): void {
    this.notifyBuf.push(...data);
    for (const l of this.notifyListeners) l(data);
    if (this.notifyResolve) {
      this.notifyResolve();
      this.notifyResolve = null;
    }
  }

  /**
   * Establish the BLE connection, use `pick` to choose the driver (set `this.driver` to it) and subscribe to its
   * notify characteristic. Subclasses must call handleNotify() for each incoming notification.
   */
  protected abstract rawConnect(
    opts: { deviceId?: string; deviceName?: string } | undefined,
    pick: DriverPicker,
  ): Promise<{ deviceName?: string }>;

  /** Tear down the BLE connection */
  protected abstract rawDisconnect(): void;

  /** Write bytes to a characteristic of the driver's service */
  protected abstract rawWrite(data: Uint8Array, charUuid: string): Promise<void>;

  async connect(opts?: { deviceId?: string; deviceName?: string }): Promise<void> {
    const { deviceName } = await this.rawConnect(opts, async (name, services) => {
      this.driver = await pickDriver(name, services);
      return this.driver;
    });
    this._connected = true;
    this.emit("connect", { info: { deviceName: opts?.deviceName ?? deviceName } });
    await this.fetchPrinterInfo();
    this.startHeartbeat();
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.rawDisconnect();
    this.onDisconnected();
  }

  protected onDisconnected(): void {
    if (!this._connected) return;
    this._connected = false;
    this.stopHeartbeat();
    this.info = {};
    this.emit("disconnect", undefined as unknown as void);
  }

  private waitForNotify(timeout = 2000): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.notifyResolve = null;
        resolve();
      }, timeout);
      this.notifyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async sendCommand(
    data: readonly number[] | number[] | Uint8Array,
    wait = false,
    timeout = 2000,
  ): Promise<Uint8Array> {
    if (!this._connected) throw new Error("Not connected");
    const driver = this.requireDriver();

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    this.emit("packetsent", { packet: makePacket(bytes) });

    if (wait) {
      this.notifyBuf = [];
    }

    await this.rawWrite(bytes, driver.writeCharUuid);

    if (wait) {
      await this.waitForNotify(timeout);
      await Utils.sleep(50);
    }

    const response = new Uint8Array(this.notifyBuf);

    if (wait && response.length > 0) {
      this.emit("packetreceived", { packet: makePacket(response) });
    }

    return response;
  }

  async sendChunked(data: Uint8Array): Promise<void> {
    if (!this._connected) throw new Error("Not connected");
    const driver = this.requireDriver();
    const charUuid = driver.dataCharUuid ?? driver.writeCharUuid;

    for (let i = 0; i < data.length; i += driver.chunkSize) {
      const chunk = data.slice(i, i + driver.chunkSize);
      await this.rawWrite(chunk, charUuid);
      await Utils.sleep(this.packetIntervalMs);
    }
  }

  async fetchPrinterInfo(): Promise<void> {
    const info = await this.requireDriver().fetchInfo(this.io);
    this.info = info;
    this.emit("printerinfofetched", { info });
  }

  getModelMetadata(): PrinterModelMeta {
    return this.requireDriver().meta(this.info);
  }

  /** Turn a black-and-white canvas into the connected printer's raster format */
  encodeCanvas(canvas: HTMLCanvasElement, direction: PrintDirection): EncodedImage {
    return ImageEncoder.encodeCanvas(canvas, direction, this.requireDriver().raster);
  }

  setPacketInterval(ms: number): void {
    this.packetIntervalMs = ms;
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatFailCount = 0;

    this.heartbeatTimer = setInterval(async () => {
      try {
        const data = await this.requireDriver().heartbeat(this.io);
        if (data) {
          this.heartbeatFailCount = 0;
          this.emit("heartbeat", { data });
        }
      } catch {
        this.heartbeatFailCount++;
        this.emit("heartbeatfailed", { failedAttempts: this.heartbeatFailCount });
      }
    }, 5000);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Web Bluetooth implementation
// ---------------------------------------------------------------------------

export class WebBleClient extends PrinterClient {
  private device: BluetoothDevice | null = null;
  private service: BluetoothRemoteGATTService | null = null;
  private chars = new Map<string, BluetoothRemoteGATTCharacteristic>();

  protected async rawConnect(
    _opts: { deviceId?: string; deviceName?: string } | undefined,
    pick: DriverPicker,
  ): Promise<{ deviceName?: string }> {
    let device: BluetoothDevice;

    try {
      device = await navigator.bluetooth.requestDevice({
        filters: ALL_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
        optionalServices: ALL_SERVICE_UUIDS,
      });
    } catch {
      throw new Error("No device selected");
    }

    device.addEventListener("gattserverdisconnected", () => this.onDisconnected());

    const server = await device.gatt!.connect();
    const driver = await pick(device.name, async () => (await server.getPrimaryServices()).map((s) => s.uuid));
    this.service = await server.getPrimaryService(driver.serviceUuid);
    const notifyChar = await this.getChar(driver.notifyCharUuid);
    await notifyChar.startNotifications();
    notifyChar.addEventListener("characteristicvaluechanged", (e: Event) => {
      const target = e.target as BluetoothRemoteGATTCharacteristic;
      const v = target.value!;
      this.handleNotify(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
    });

    this.device = device;
    return { deviceName: device.name };
  }

  private async getChar(uuid: string): Promise<BluetoothRemoteGATTCharacteristic> {
    let c = this.chars.get(uuid);
    if (!c) {
      if (!this.service) throw new Error("Not connected");
      c = await this.service.getCharacteristic(uuid);
      this.chars.set(uuid, c);
    }
    return c;
  }

  protected rawDisconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.service = null;
    this.chars.clear();
  }

  protected async rawWrite(data: Uint8Array, charUuid: string): Promise<void> {
    const c = await this.getChar(charUuid);
    await c.writeValueWithoutResponse(data);
  }
}

// ---------------------------------------------------------------------------
// Capacitor BLE implementation (Android / iOS native)
// ---------------------------------------------------------------------------

export class CapBleClient extends PrinterClient {
  private deviceId: string | null = null;

  protected async rawConnect(
    opts: { deviceId?: string; deviceName?: string } | undefined,
    pick: DriverPicker,
  ): Promise<{ deviceName?: string }> {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");

    if (!opts?.deviceId) {
      throw new Error("Device ID is required for native Bluetooth. Use the scan UI to select a device.");
    }

    // Same as the scan's initialize: without the flag the plugin asks for fine location on Android 12+, which the
    // manifest only declares up to Android 11, so connecting would fail
    await BleClient.initialize({ androidNeverForLocation: true });

    const deviceId = opts.deviceId;
    await BleClient.connect(deviceId, () => this.onDisconnected());

    let driver: PrinterDriver;
    try {
      driver = await pick(opts.deviceName, async () => (await BleClient.getServices(deviceId)).map((s) => s.uuid));
    } catch (e) {
      await BleClient.disconnect(deviceId).catch(() => {});
      throw e;
    }
    this.deviceId = deviceId;

    await BleClient.startNotifications(deviceId, driver.serviceUuid, driver.notifyCharUuid, (value: DataView) =>
      this.handleNotify(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()),
    );

    return { deviceName: opts.deviceName };
  }

  protected rawDisconnect(): void {
    if (this.deviceId) {
      const id = this.deviceId;
      this.deviceId = null;
      import("@capacitor-community/bluetooth-le").then(({ BleClient }) => {
        BleClient.disconnect(id).catch(() => {});
      });
    }
  }

  protected async rawWrite(data: Uint8Array, charUuid: string): Promise<void> {
    if (!this.deviceId || !this.driver) throw new Error("Not connected");
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    await BleClient.writeWithoutResponse(
      this.deviceId,
      this.driver.serviceUuid,
      charUuid,
      new DataView(data.buffer, data.byteOffset, data.byteLength),
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function instantiateClient(): PrinterClient {
  if (Capacitor.isNativePlatform()) {
    return new CapBleClient();
  }
  return new WebBleClient();
}
