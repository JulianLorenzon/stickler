/** Fichero D11s and other AiYin/LuckPrinter D11 rebrands */
import { AbstractPrintTask, type PrintTaskOptions } from "../print_task";
import { Utils } from "../utils";
import type { EncodedImage, PrinterInfo } from "../types";
import type { DriverIO, PrinterDriver } from "./types";

export const D11S_PRINTHEAD_PX = 96;
const BYTES_PER_ROW = D11S_PRINTHEAD_PX / 8;

const CMD = {
  getModel: [0x10, 0xff, 0x20, 0xf0],
  getFirmware: [0x10, 0xff, 0x20, 0xf1],
  getSerial: [0x10, 0xff, 0x20, 0xf2],
  getBattery: [0x10, 0xff, 0x50, 0xf1],
  getStatus: [0x10, 0xff, 0x40],
  getShutdownTime: [0x10, 0xff, 0x13],
  setDensity: (level: number) => [0x10, 0xff, 0x10, 0x00, level],
  setPaperType: (type: number) => [0x10, 0xff, 0x84, type],
  setShutdownTime: (mins: number) => [0x10, 0xff, 0x12, (mins >> 8) & 0xff, mins & 0xff],
  enablePrinter: [0x10, 0xff, 0xfe, 0x01],
  stopPrint: [0x10, 0xff, 0xfe, 0x45],
  formFeed: [0x1d, 0x0c],
  factoryReset: [0x10, 0xff, 0x04],
} as const;

const decodeText = (buf: Uint8Array): string => new TextDecoder().decode(buf).trim();

const parseStatusByte = (byte: number): string => {
  const flags: string[] = [];
  if (byte & 0x01) flags.push("printing");
  if (byte & 0x02) flags.push("cover open");
  if (byte & 0x04) flags.push("no paper");
  if (byte & 0x08) flags.push("low battery");
  if (byte & 0x10 || byte & 0x40) flags.push("overheated");
  if (byte & 0x20) flags.push("charging");
  return flags.length ? flags.join(", ") : "ready";
};

export class D11sPrintTask extends AbstractPrintTask {
  constructor(
    private io: DriverIO,
    private opts: PrintTaskOptions,
  ) {
    super();
  }

  async printInit(): Promise<void> {
    const statusResp = await this.io.sendCommand(CMD.getStatus, true);
    if (statusResp.length > 0) {
      const sb = statusResp[statusResp.length - 1];
      if (sb & 0x02) throw new Error("Cover is open");
      if (sb & 0x04) throw new Error("No paper loaded");
      if (sb & 0x50) throw new Error("Printer overheated");
    }

    await this.io.sendCommand(CMD.setDensity(this.opts.density), true);
    await Utils.sleep(100);
  }

  async printPage(image: EncodedImage, quantity: number): Promise<void> {
    const paperTypeMap: Record<number, number> = { 1: 0, 2: 1, 3: 2 };
    const paperByte = paperTypeMap[this.opts.labelType] ?? 0;

    for (let copy = 0; copy < quantity; copy++) {
      if (this.cancelled) return;

      await this.io.sendCommand(CMD.setPaperType(paperByte), true);
      await Utils.sleep(50);

      // Wake up (12 null bytes)
      await this.io.sendCommand(new Array(12).fill(0));
      await Utils.sleep(50);

      await this.io.sendCommand(Array.from(CMD.enablePrinter));
      await Utils.sleep(50);

      // Raster header: GS v 0 mode xL xH yL yH
      const yL = image.rows & 0xff;
      const yH = (image.rows >> 8) & 0xff;
      const header = new Uint8Array([0x1d, 0x76, 0x30, 0x00, BYTES_PER_ROW, 0x00, yL, yH]);

      const payload = new Uint8Array(header.length + image.rowsData.length);
      payload.set(header, 0);
      payload.set(image.rowsData, header.length);

      await this.io.sendData(payload);
      await Utils.sleep(500);

      await this.io.sendCommand(Array.from(CMD.formFeed));
      await Utils.sleep(300);

      this.io.emitProgress({ page: copy + 1, pagePrintProgress: 100, pageFeedProgress: 0 });

      // Stop print and wait for response
      await this.io.sendCommand(Array.from(CMD.stopPrint), true, 60000);

      this.io.emitProgress({ page: copy + 1, pagePrintProgress: 100, pageFeedProgress: 100 });
    }
  }

  async waitForFinished(): Promise<void> {
    // Already waited during printPage for each copy's stop response
  }

  async printEnd(): Promise<void> {}
}

export const d11sDriver: PrinterDriver = {
  id: "d11s",
  displayName: "Fichero D11s",
  namePrefixes: ["FICHERO", "D11s_"],
  serviceUuid: "000018f0-0000-1000-8000-00805f9b34fb",
  writeCharUuid: "00002af1-0000-1000-8000-00805f9b34fb",
  notifyCharUuid: "00002af0-0000-1000-8000-00805f9b34fb",
  chunkSize: 200,
  raster: { printheadPx: D11S_PRINTHEAD_PX, msbFirst: true },

  async fetchInfo(io) {
    const info: PrinterInfo = {};

    info.modelId = decodeText(await io.sendCommand(CMD.getModel, true));
    info.firmware = decodeText(await io.sendCommand(CMD.getFirmware, true));
    info.serial = decodeText(await io.sendCommand(CMD.getSerial, true));

    let r = await io.sendCommand(CMD.getBattery, true);
    if (r.length >= 2) {
      info.battery = r[r.length - 1];
      info.charging = r[r.length - 2] !== 0;
    }

    r = await io.sendCommand(CMD.getStatus, true);
    if (r.length > 0) {
      info.status = parseStatusByte(r[r.length - 1]);
    }
    return info;
  },

  async heartbeat(io) {
    const r = await io.sendCommand(CMD.getBattery, true);
    if (r.length < 2) return null;
    return { chargeLevel: r[r.length - 1], charging: r[r.length - 2] !== 0 };
  },

  meta(info) {
    return {
      model: info.modelId ?? "D11s",
      driver: "d11s",
      printheadPixels: D11S_PRINTHEAD_PX,
      printDirection: "left",
      densityMin: 0,
      densityMax: 2,
      densityDefault: 2,
      paperTypes: [1, 2, 3], // LabelType values
    };
  },

  newPrintTask: (io, opts) => new D11sPrintTask(io, opts),

  async factoryReset(io) {
    await io.sendCommand(CMD.factoryReset, true);
  },

  autoOff: {
    async get(io) {
      const r = await io.sendCommand(CMD.getShutdownTime, true);
      return r.length >= 2 ? (r[r.length - 2] << 8) | r[r.length - 1] : undefined;
    },
    async set(io, minutes) {
      const r = await io.sendCommand(CMD.setShutdownTime(minutes), true, 3000);
      return decodeText(r).endsWith("OK");
    },
    min: 1,
    max: 480,
  },
};
