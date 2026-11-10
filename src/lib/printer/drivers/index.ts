import { d11sDriver } from "./d11s";
import { mxw01Driver } from "./mxw01";
import type { PrinterDriver, PrinterDriverId } from "./types";

export const DRIVERS: PrinterDriver[] = [d11sDriver, mxw01Driver];

export const driverById = (id: PrinterDriverId): PrinterDriver => DRIVERS.find((d) => d.id === id) ?? d11sDriver;

export const driverForName = (name: string | undefined): PrinterDriver | undefined =>
  name ? DRIVERS.find((d) => d.namePrefixes.some((p) => name.startsWith(p))) : undefined;

export const driverForServices = (uuids: string[]): PrinterDriver | undefined => {
  const set = new Set(uuids.map((u) => u.toLowerCase()));
  return DRIVERS.find((d) => set.has(d.serviceUuid));
};

export const ALL_NAME_PREFIXES = DRIVERS.flatMap((d) => d.namePrefixes);
export const ALL_SERVICE_UUIDS = DRIVERS.map((d) => d.serviceUuid);

export { d11sDriver, mxw01Driver };
export type { PrinterDriver, PrinterDriverId, DriverIO, RasterFormat } from "./types";
