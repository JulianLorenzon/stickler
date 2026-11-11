// Records every byte the printer code writes for a fixed scenario, to check refactors don't change it.
import { PrinterClient, ImageEncoder, LabelType } from "../../src/lib/printer";

const log: string[] = [];
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Fake transport: logs writes and answers each one with a canned notification */
export class FakeClient extends PrinterClient {
  reply: (data: Uint8Array) => number[] | null = () => [0x00];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async rawConnect(opts?: { deviceId?: string; deviceName?: string }, pick?: any) {
    log.push(`connect ${opts?.deviceName}`);
    if (pick) await pick(opts?.deviceName, async () => []);
    return { deviceName: opts?.deviceName };
  }
  protected rawDisconnect() { log.push("disconnect"); }
  protected async rawWrite(data: Uint8Array, charUuid?: string) {
    // The D11s has one write characteristic; only name others
    log.push(`w ${hex(data)}${charUuid && !charUuid.startsWith("00002af1") ? ` @${charUuid.slice(4, 8)}` : ""}`);
    const r = this.reply(data);
    if (r) setTimeout(() => this.handleNotify(new Uint8Array(r)), 1);
  }
}

/** Minimal canvas: getImageData over a generated pattern */
const fakeCanvas = (w: number, h: number) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (x * 7 + y * 13 + ((x * y) % 5)) % 3 === 0 ? 0 : 255;
    data.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3); data[(y * w + x) * 4 + 3] = 255;
  }
  return { width: w, height: h, getContext: () => ({ getImageData: () => ({ data, width: w, height: h }) }) } as unknown as HTMLCanvasElement;
};

export async function run(): Promise<string> {
  for (const [w, h] of [[96, 40], [120, 33], [80, 17]]) {
    const e = ImageEncoder.encodeCanvas(fakeCanvas(w, h), "top");
    log.push(`enc ${w}x${h} cols=${e.cols} rows=${e.rows} ${hex(e.rowsData)}`);
  }
  const c = new FakeClient();
  c.reply = (d) => (d[0] === 0x10 && d[2] === 0x20 ? Array.from(new TextEncoder().encode(" D11s_X ")) : d[0] === 0x10 && d[2] === 0x50 ? [0x01, 0x55] : [0x00]);
  c.on("printerinfofetched", (e) => log.push(`info ${JSON.stringify(e.info)}`));
  await c.connect({ deviceId: "AA", deviceName: "D11s_1234" });
  c.stopHeartbeat();
  log.push(`meta ${JSON.stringify(c.getModelMetadata())}`);
  const enc = ImageEncoder.encodeCanvas(fakeCanvas(96, 25), "top");
  for (const labelType of [LabelType.WithGaps, LabelType.Continuous]) {
    const t = c.abstraction.newPrintTask({ totalPages: 2, density: 1, speed: 0, labelType, statusPollIntervalMs: 100, statusTimeoutMs: 1000 });
    c.on("printprogress", (e) => log.push(`progress ${JSON.stringify(e)}`));
    await t.printInit(); await t.printPage(enc, 2); await t.waitForFinished(); await t.printEnd();
    c.off?.("printprogress", undefined as never);
  }
  c.disconnect();
  return log.join("\n") + "\n";
}

/** MXW01 scenario with the replies a real MXW01 gave; `rgba` = 2-byte LE width, height, then RGBA pixels */
export async function runMxw01(rgba: Uint8Array): Promise<string> {
  log.length = 0;
  const w = rgba[0] | (rgba[1] << 8), h = rgba[2] | (rgba[3] << 8);
  const data = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset + 4, w * h * 4);
  const canvas = { width: w, height: h, getContext: () => ({ getImageData: () => ({ data, width: w, height: h }) }) } as unknown as HTMLCanvasElement;
  const fromHex = (s: string) => s.split(" ").map((x) => parseInt(x, 16));
  const c = new FakeClient();
  c.reply = (d) => {
    if (d[0] !== 0x22) return null;
    switch (d[2]) {
      case 0xa1: return fromHex("22 21 a1 03 0a 00 00 00 00 5c 10 00 00 00 78 01 00");
      case 0xb1: return fromHex("22 21 b1 00 09 00 31 2e 39 2e 33 2e 31 2e 32 00");
      case 0xa9: return fromHex("22 21 a9 00 01 00 00 00");
      case 0xad: return fromHex("22 21 aa 00 03 00 00 38 38 00");
      default: return null;
    }
  };
  c.on("printerinfofetched", (e) => log.push(`info ${JSON.stringify(e.info)}`));
  await c.connect({ deviceId: "BB", deviceName: "MXW01" });
  c.stopHeartbeat();
  log.push(`meta ${JSON.stringify(c.getModelMetadata())}`);
  const enc = c.encodeCanvas(canvas, "top");
  const t = c.abstraction.newPrintTask({ totalPages: 1, density: 1, speed: 0, labelType: LabelType.Continuous, statusPollIntervalMs: 100, statusTimeoutMs: 1000 });
  await t.printInit(); await t.printPage(enc, 1); await t.waitForFinished(); await t.printEnd();
  c.disconnect();
  return log.join("\n") + "\n";
}
