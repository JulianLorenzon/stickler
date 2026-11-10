/**
 * MXW01 cat printer (57 mm roll, 384 dots). Protocol as documented by dave9123/MXW01-catprinter (MIT) and checked
 * on a real printer: frames `22 21 cmd 00 lenLo lenHi payload crc8 FF` to AE01, replies on AE02, print data on AE03.
 */
import { AbstractPrintTask, type PrintTaskOptions } from "../print_task";
import { LabelType, type EncodedImage, type PrinterInfo } from "../types";
import type { DriverIO, PrinterDriver } from "./types";

export const MXW01_PRINTHEAD_PX = 384;
const BYTES_PER_ROW = MXW01_PRINTHEAD_PX / 8;
/** The printer seems to need at least this many lines per job */
const MIN_LINES = 90;
/** Heat per density step (light, medium, dark); 0x5D is what the official app is reported to use */
const INTENSITY = [0x48, 0x5d, 0x78];

const enum Cmd {
  Status = 0xa1,
  Intensity = 0xa2,
  PrintRequest = 0xa9,
  PrintComplete = 0xaa,
  Battery = 0xab,
  Flush = 0xad,
  PrintType = 0xb0,
  Version = 0xb1,
}

/** CRC-8, polynomial 0x07, init 0 */
export const crc8 = (data: Uint8Array): number => {
  let c = 0;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
};

export const frame = (cmd: number, payload: number[] | Uint8Array = [0x00]): Uint8Array => {
  const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const out = new Uint8Array(p.length + 8);
  out.set([0x22, 0x21, cmd, 0x00, p.length & 0xff, p.length >> 8]);
  out.set(p, 6);
  out[6 + p.length] = crc8(p);
  out[7 + p.length] = 0xff;
  return out;
};

/** Payload of a reply frame for `cmd`, or null if `buf` isn't one */
const replyPayload = (buf: Uint8Array, cmd: number): Uint8Array | null => {
  if (buf.length < 6 || buf[0] !== 0x22 || buf[1] !== 0x21 || buf[2] !== cmd) return null;
  const len = buf[4] | (buf[5] << 8);
  return buf.slice(6, 6 + len);
};

/** Send a command and wait for its reply frame */
const request = async (io: DriverIO, cmd: number, payload?: number[], timeout = 3000): Promise<Uint8Array | null> => {
  const r = await io.sendCommand(frame(cmd, payload), true, timeout);
  return replyPayload(r, cmd);
};

/** Wait until a frame for `cmd` arrives; subscribe before sending whatever triggers it */
const waitFrame = (io: DriverIO, cmd: number, timeout: number) => {
  let unsub = () => {};
  const promise = new Promise<Uint8Array | null>((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeout);
    unsub = io.onNotify((data) => {
      const p = replyPayload(data, cmd);
      if (p) {
        clearTimeout(timer);
        unsub();
        resolve(p);
      }
    });
  });
  return { promise, cancel: () => unsub() };
};

interface Status {
  ok: boolean;
  battery?: number;
  error?: string;
}

/** Status payload: [3] battery, [6] 0 = OK, [7] error code (byte indices of the payload) */
const parseStatus = (p: Uint8Array | null): Status => {
  if (!p || p.length < 7) return { ok: false, error: "No answer from the printer" };
  const battery = p[3];
  if (p[6] === 0) return { ok: true, battery };
  const code = p[7];
  const error =
    code === 1 || code === 9
      ? "No paper loaded"
      : code === 4
        ? "Printer overheated"
        : code === 8
          ? "Battery too low"
          : `Printer error ${code ?? "?"}`;
  return { ok: false, battery, error };
};

class Mxw01PrintTask extends AbstractPrintTask {
  constructor(
    private io: DriverIO,
    private opts: PrintTaskOptions,
  ) {
    super();
  }

  async printInit(): Promise<void> {
    const level = INTENSITY[Math.min(Math.max(this.opts.density, 0), INTENSITY.length - 1)];
    await this.io.sendCommand(frame(Cmd.Intensity, [level]));
  }

  async printPage(image: EncodedImage, quantity: number): Promise<void> {
    let lines = image.rows;
    let data = image.rowsData;
    if (lines < MIN_LINES) {
      data = new Uint8Array(MIN_LINES * BYTES_PER_ROW);
      data.set(image.rowsData);
      lines = MIN_LINES;
    }

    for (let copy = 0; copy < quantity; copy++) {
      const status = parseStatus(await request(this.io, Cmd.Status));
      if (!status.ok) throw new Error(status.error);

      const r = await request(this.io, Cmd.PrintRequest, [lines & 0xff, lines >> 8, 0x30, 0x00]);
      if (!r || r[0] !== 0) throw new Error("The printer refused the print job");

      await this.io.sendData(data);
      this.io.emitProgress({ page: copy + 1, pagePrintProgress: 100, pageFeedProgress: 0 });

      // About 7 s for 220 lines in the test; be generous
      const done = waitFrame(this.io, Cmd.PrintComplete, 15_000 + lines * 60);
      await this.io.sendCommand(frame(Cmd.Flush));
      if (!(await done.promise)) throw new Error("The printer didn't report the print as finished");

      this.io.emitProgress({ page: copy + 1, pagePrintProgress: 100, pageFeedProgress: 100 });
    }
  }

  async waitForFinished(): Promise<void> {}

  async printEnd(): Promise<void> {}
}

export const mxw01Driver: PrinterDriver = {
  id: "mxw01",
  displayName: "MXW01",
  namePrefixes: ["MXW01"],
  serviceUuid: "0000ae30-0000-1000-8000-00805f9b34fb",
  writeCharUuid: "0000ae01-0000-1000-8000-00805f9b34fb",
  dataCharUuid: "0000ae03-0000-1000-8000-00805f9b34fb",
  notifyCharUuid: "0000ae02-0000-1000-8000-00805f9b34fb",
  chunkSize: 180,
  raster: { printheadPx: MXW01_PRINTHEAD_PX, msbFirst: false },

  async fetchInfo(io) {
    const info: PrinterInfo = { modelId: "MXW01" };
    const version = await request(io, Cmd.Version);
    if (version) {
      const end = version.indexOf(0);
      info.firmware = new TextDecoder().decode(end >= 0 ? version.slice(0, end) : version).trim();
    }
    const status = parseStatus(await request(io, Cmd.Status));
    if (status.battery !== undefined) info.battery = status.battery;
    info.status = status.ok ? "ready" : (status.error ?? "error");
    return info;
  },

  async heartbeat(io) {
    const status = parseStatus(await request(io, Cmd.Status));
    if (status.battery === undefined) return null;
    return { chargeLevel: status.battery };
  },

  meta(info) {
    return {
      model: info.modelId ?? "MXW01",
      driver: "mxw01",
      printheadPixels: MXW01_PRINTHEAD_PX,
      printDirection: "top",
      densityMin: 0,
      densityMax: 2,
      densityDefault: 1,
      paperTypes: [LabelType.Continuous],
    };
  },

  newPrintTask: (io, opts) => new Mxw01PrintTask(io, opts),
};
