import { Capacitor } from "@capacitor/core";
import {
  SERVICE_UUID,
  WRITE_CHAR_UUID,
  NOTIFY_CHAR_UUID,
  CHUNK_SIZE,
  CLIENT_DEFAULTS,
  CMD,
} from "./constants";
import { TypedEventEmitter } from "./emitter";
import { Utils } from "./utils";
import { D11sPrintTask } from "./print_task";
import type {
  ConnectionInfo,
  HeartbeatData,
  PrinterInfo,
  PrinterModelMeta,
  PrintProgressEvent,
  FirmwareProgressEvent,
  RfidInfo,
  Packet,
  LabelType,
  PrintTaskName,
} from "./types";

interface ClientEventMap {
  connect: { info: ConnectionInfo };
  disconnect: void;
  printerinfofetched: { info: PrinterInfo };
  heartbeat: { data: HeartbeatData };
  heartbeatfailed: { failedAttempts: number };
  printprogress: PrintProgressEvent;
  firmwareprogress: FirmwareProgressEvent;
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

export abstract class PrinterClient extends TypedEventEmitter<ClientEventMap> {
  private notifyBuf: number[] = [];
  private notifyResolve: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatFailCount = 0;
  /** Pause after each chunk of print data */
  private packetIntervalMs: number = CLIENT_DEFAULTS.packetIntervalMs;
  private info: PrinterInfo = {};
  private _connected = false;

  readonly abstraction = {
    newPrintTask: (
      _name: PrintTaskName,
      opts: {
        totalPages: number;
        density: number;
        speed: number;
        labelType: LabelType;
        statusPollIntervalMs: number;
        statusTimeoutMs: number;
      },
    ) => {
      return new D11sPrintTask(
        opts,
        (data, wait, timeout) => this.sendCommand(data, wait, timeout),
        (data) => this.sendChunked(data),
        (e) => this.emit("printprogress", e),
      );
    },

    printEnd: async () => {
      // No-op for D11s - stop is handled per-copy in print task
    },

    printerReset: async () => {
      await this.sendCommand(CMD.factoryReset, true);
    },

    rfidInfo: async (): Promise<RfidInfo> => {
      return {};
    },

    rfidInfo2: async (): Promise<RfidInfo> => {
      return {};
    },

    setSoundEnabled: async (_type: number, _enabled: boolean) => {
      // Not supported on D11s
    },

    firmwareUpgrade: async (_data: Uint8Array, _version: string) => {
      throw new Error("Firmware upgrade not implemented");
    },
  };

  /** Called by subclasses whenever a BLE notification arrives from the printer */
  protected handleNotify(data: Uint8Array): void {
    this.notifyBuf.push(...data);
    if (this.notifyResolve) {
      this.notifyResolve();
      this.notifyResolve = null;
    }
  }

  /**
   * Establish BLE connection.
   * Subclasses must call handleNotify() for each incoming notification.
   */
  protected abstract rawConnect(opts?: {
    deviceId?: string;
    deviceName?: string;
  }): Promise<{ deviceName?: string }>;

  /** Tear down the BLE connection */
  protected abstract rawDisconnect(): void;

  /** Write bytes to the write characteristic */
  protected abstract rawWrite(data: Uint8Array): Promise<void>;

  async connect(opts?: { deviceId?: string; deviceName?: string }): Promise<void> {
    const { deviceName } = await this.rawConnect(opts);
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

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    this.emit("packetsent", { packet: makePacket(bytes) });

    if (wait) {
      this.notifyBuf = [];
    }

    await this.rawWrite(bytes);

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

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      await this.rawWrite(chunk);
      await Utils.sleep(this.packetIntervalMs);
    }
  }

  private decodeResponse(buf: number[] | Uint8Array): string {
    return new TextDecoder().decode(new Uint8Array(buf)).trim();
  }

  async fetchPrinterInfo(): Promise<void> {
    const info: PrinterInfo = {};

    let r = await this.sendCommand(CMD.getModel, true);
    info.modelId = this.decodeResponse(r);

    r = await this.sendCommand(CMD.getFirmware, true);
    info.firmware = this.decodeResponse(r);

    r = await this.sendCommand(CMD.getSerial, true);
    info.serial = this.decodeResponse(r);

    r = await this.sendCommand(CMD.getBattery, true);
    if (r.length >= 2) {
      info.battery = r[r.length - 1];
      info.charging = r[r.length - 2] !== 0;
    }

    r = await this.sendCommand(CMD.getStatus, true);
    if (r.length > 0) {
      const sb = r[r.length - 1];
      info.status = this.parseStatusByte(sb);
    }

    this.info = info;
    this.emit("printerinfofetched", { info });
  }

  private parseStatusByte(byte: number): string {
    const flags: string[] = [];
    if (byte & 0x01) flags.push("printing");
    if (byte & 0x02) flags.push("cover open");
    if (byte & 0x04) flags.push("no paper");
    if (byte & 0x08) flags.push("low battery");
    if (byte & 0x10 || byte & 0x40) flags.push("overheated");
    if (byte & 0x20) flags.push("charging");
    return flags.length ? flags.join(", ") : "ready";
  }

  getModelMetadata(): PrinterModelMeta {
    return {
      model: this.info.modelId ?? "D11s",
      printheadPixels: 96,
      printDirection: "left" as const,
      densityMin: 0,
      densityMax: 2,
      densityDefault: 2,
      paperTypes: [1, 2, 3], // LabelType values
    };
  }

  getPrintTaskType(): PrintTaskName {
    return "B1";
  }

  setPacketInterval(ms: number): void {
    this.packetIntervalMs = ms;
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatFailCount = 0;

    this.heartbeatTimer = setInterval(async () => {
      try {
        const r = await this.sendCommand(CMD.getBattery, true);
        if (r.length >= 2) {
          const data: HeartbeatData = {
            chargeLevel: r[r.length - 1],
            charging: r[r.length - 2] !== 0,
          };
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
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;

  protected async rawConnect(_opts?: {
    deviceId?: string;
    deviceName?: string;
  }): Promise<{ deviceName?: string }> {
    let device: BluetoothDevice;

    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "FICHERO" }, { namePrefix: "D11s_" }],
        optionalServices: [SERVICE_UUID],
      });
    } catch {
      throw new Error("No device selected");
    }

    device.addEventListener("gattserverdisconnected", () => this.onDisconnected());

    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.writeChar = await service.getCharacteristic(WRITE_CHAR_UUID);
    this.notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);
    await this.notifyChar.startNotifications();
    this.notifyChar.addEventListener("characteristicvaluechanged", (e: Event) => {
      const target = e.target as BluetoothRemoteGATTCharacteristic;
      this.handleNotify(new Uint8Array(target.value!.buffer));
    });

    this.device = device;
    return { deviceName: device.name };
  }

  protected rawDisconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.writeChar = null;
    this.notifyChar = null;
  }

  protected async rawWrite(data: Uint8Array): Promise<void> {
    if (!this.writeChar) throw new Error("Not connected");
    await this.writeChar.writeValueWithoutResponse(data);
  }
}

// ---------------------------------------------------------------------------
// Capacitor BLE implementation (Android / iOS native)
// ---------------------------------------------------------------------------

export class CapBleClient extends PrinterClient {
  private deviceId: string | null = null;

  protected async rawConnect(opts?: {
    deviceId?: string;
    deviceName?: string;
  }): Promise<{ deviceName?: string }> {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");

    if (!opts?.deviceId) {
      throw new Error("Device ID is required for native Bluetooth. Use the scan UI to select a device.");
    }

    // Same as the scan's initialize: without the flag the plugin asks for fine location on Android 12+, which the
    // manifest only declares up to Android 11, so connecting would fail
    await BleClient.initialize({ androidNeverForLocation: true });

    this.deviceId = opts.deviceId;

    await BleClient.connect(opts.deviceId, () => this.onDisconnected());

    await BleClient.startNotifications(
      opts.deviceId,
      SERVICE_UUID,
      NOTIFY_CHAR_UUID,
      (value: DataView) => this.handleNotify(new Uint8Array(value.buffer)),
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

  protected async rawWrite(data: Uint8Array): Promise<void> {
    if (!this.deviceId) throw new Error("Not connected");
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    await BleClient.writeWithoutResponse(
      this.deviceId,
      SERVICE_UUID,
      WRITE_CHAR_UUID,
      new DataView(data.buffer, data.byteOffset, data.byteLength),
    );
  }
}

// ---------------------------------------------------------------------------
// Backwards-compat alias + factory
// ---------------------------------------------------------------------------

export class BluetoothClient extends WebBleClient {}

export function instantiateClient(_type?: string): PrinterClient {
  if (Capacitor.isNativePlatform()) {
    return new CapBleClient();
  }
  return new WebBleClient();
}
