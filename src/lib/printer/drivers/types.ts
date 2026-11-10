import type { AbstractPrintTask, PrintTaskOptions } from "../print_task";
import type { HeartbeatData, PrinterInfo, PrinterModelMeta, PrintProgressEvent } from "../types";

/** Ways a driver can talk to the connected printer; the client fills these in */
export interface DriverIO {
  /** Write to the command characteristic. With `wait`, collects the next notification(s) and returns them */
  sendCommand(data: readonly number[] | number[] | Uint8Array, wait?: boolean, timeout?: number): Promise<Uint8Array>;
  /** Write print data in chunks (to the data characteristic when the printer has one) */
  sendData(data: Uint8Array): Promise<void>;
  /** Get every notification as it arrives; returns an unsubscribe function */
  onNotify(listener: (data: Uint8Array) => void): () => void;
  emitProgress(event: PrintProgressEvent): void;
}

/** How rows of pixels are packed into bytes */
export interface RasterFormat {
  /** Dots across the print head; the image is centered on it */
  printheadPx: number;
  /** Leftmost pixel in bit 7 (D11s) or bit 0 (MXW01) */
  msbFirst: boolean;
}

/** Everything that differs between printer families */
export interface PrinterDriver {
  id: PrinterDriverId;
  /** Shown in the UI */
  displayName: string;
  /** Bluetooth names this driver handles (prefix match) */
  namePrefixes: string[];
  serviceUuid: string;
  /** Commands */
  writeCharUuid: string;
  /** Print data, if different from the command characteristic */
  dataCharUuid?: string;
  notifyCharUuid: string;
  /** Bytes per write of print data */
  chunkSize: number;
  raster: RasterFormat;
  fetchInfo(io: DriverIO): Promise<PrinterInfo>;
  /** Called every few seconds while idle; null if there was no answer */
  heartbeat(io: DriverIO): Promise<HeartbeatData | null>;
  meta(info: PrinterInfo): PrinterModelMeta;
  newPrintTask(io: DriverIO, opts: PrintTaskOptions): AbstractPrintTask;
  factoryReset?(io: DriverIO): Promise<void>;
  /** Idle time before the printer switches itself off, if it can be read and changed */
  autoOff?: {
    /** Minutes, or undefined if there was no answer */
    get(io: DriverIO): Promise<number | undefined>;
    /** Returns false if the printer didn't confirm */
    set(io: DriverIO, minutes: number): Promise<boolean>;
    /** Allowed range in minutes */
    min: number;
    max: number;
  };
}

export type PrinterDriverId = "d11s" | "mxw01";
