export enum LabelType {
  WithGaps = 1,
  Black = 2,
  Continuous = 3,
}

export type PrintDirection = "left" | "top";

export interface PrinterInfo {
  modelId?: string;
  firmware?: string;
  serial?: string;
  battery?: number;
  charging?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface PrinterModelMeta {
  model: string;
  /** Which printer family driver handles it */
  driver: "d11s" | "mxw01";
  printheadPixels: number;
  printDirection: PrintDirection;
  densityMin: number;
  densityMax: number;
  densityDefault: number;
  paperTypes: LabelType[];
}

export interface HeartbeatData {
  chargeLevel?: number;
  charging?: boolean;
  statusByte?: number;
}

export interface AvailableTransports {
  webBluetooth: boolean;
  capacitorBle: boolean;
}

export interface ConnectionInfo {
  deviceName?: string;
}

export interface EncodedImage {
  cols: number;
  rows: number;
  rowsData: Uint8Array;
}

export interface PrintProgressEvent {
  page: number;
  pagePrintProgress: number;
  pageFeedProgress: number;
}

export interface Packet {
  command: number;
  toBytes(): Uint8Array;
}

export const printTaskNames = ["B1", "D110M_V4"] as const;
export type PrintTaskName = (typeof printTaskNames)[number];
