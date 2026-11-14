import { get } from "svelte/store";
import { z } from "zod";
import { PrinterIdSchema, type PrinterId } from "$/types";
import { writablePersisted } from "$/utils/persistence";
import { builtInDotModel, type DotModel } from "$/utils/print_sim";

/**
 * Dot corrections measured on this phone from the grey test, several per printer so they can be compared, and which
 * one the printer uses. None in use = the built-in correction.
 */

const unit = z.number().min(0).max(1);

const DotModelSchema = z.object({ base: unit, orth: unit, diag: unit, spillOrth: unit, spillDiag: unit });

const CalibrationSchema = z.object({
  id: z.string(),
  /** When it was measured (ms); 0 for one kept from before the list existed */
  date: z.number(),
  model: DotModelSchema,
  /** Fit error of the model on the measured patches (0-1 darkness) */
  rms: z.number().optional(),
  /** Size of the rows read, in dots */
  size: z.object({ width: z.number(), height: z.number() }).optional(),
  /** Measured darkness of the 10..90% patches relative to the solid one, per row in GREY_TEST_MODES order */
  measured: z.array(z.array(z.number())).optional(),
  source: z.enum(["camera", "photo"]).optional(),
});
export type Calibration = z.infer<typeof CalibrationSchema>;

const PrinterCalibrationsSchema = z.object({
  saved: z.array(CalibrationSchema),
  /** Id of the one in use; missing = built-in */
  active: z.string().optional(),
});
type PrinterCalibrations = z.infer<typeof PrinterCalibrationsSchema>;

const AllSchema = z.partialRecord(PrinterIdSchema, PrinterCalibrationsSchema);
type All = z.infer<typeof AllSchema>;

/** Kept per printer; the oldest one not in use goes when there are more */
export const MAX_CALIBRATIONS = 8;

/** The single model per printer of the first version ("dot_models"), as the first entry of the list, in use */
const fromSingleModels = (): All => {
  const all: All = {};
  try {
    const old = JSON.parse(localStorage.getItem("dot_models") ?? "{}");
    for (const printer of PrinterIdSchema.options) {
      const model = DotModelSchema.safeParse(old?.[printer]);
      if (model.success) all[printer] = { saved: [{ id: "first", date: 0, model: model.data }], active: "first" };
    }
  } catch {
    // Nothing to keep
  }
  return all;
};

export const calibrations = writablePersisted<All>("dot_calibrations", AllSchema, fromSingleModels());

const forPrinter = (all: All, printer: PrinterId): PrinterCalibrations => all[printer] ?? { saved: [] };

/** The calibration `printer` uses, or undefined for the built-in correction */
export const activeCalibration = (printer: PrinterId, all: All = get(calibrations)): Calibration | undefined => {
  const p = forPrinter(all, printer);
  return p.saved.find((c) => c.id === p.active);
};

/** Saved calibrations of `printer`, newest first */
export const savedCalibrations = (printer: PrinterId, all: All = get(calibrations)): Calibration[] =>
  [...forPrinter(all, printer).saved].sort((a, b) => b.date - a.date);

/** Keeps a measured calibration, and uses it from now on with `use` */
export const saveCalibration = (printer: PrinterId, entry: Omit<Calibration, "id">, use: boolean): Calibration => {
  const saved: Calibration = { ...entry, id: `${entry.date}-${Math.random().toString(36).slice(2, 6)}` };
  calibrations.update((all) => {
    const p = forPrinter(all, printer);
    const active = use ? saved.id : p.active;
    let list = [...p.saved, saved];
    while (list.length > MAX_CALIBRATIONS) {
      const oldest = list.filter((c) => c.id !== active).sort((a, b) => a.date - b.date)[0];
      list = list.filter((c) => c !== oldest);
    }
    return { ...all, [printer]: { saved: list, active } };
  });
  return saved;
};

/** Uses a saved calibration, or the built-in correction with no id */
export const useCalibration = (printer: PrinterId, id?: string) =>
  calibrations.update((all) => ({ ...all, [printer]: { ...forPrinter(all, printer), active: id } }));

/** Forgets a saved calibration; the built-in correction takes over if it was in use */
export const deleteCalibration = (printer: PrinterId, id: string) =>
  calibrations.update((all) => {
    const p = forPrinter(all, printer);
    return {
      ...all,
      [printer]: { saved: p.saved.filter((c) => c.id !== id), active: p.active === id ? undefined : p.active },
    };
  });

/**
 * The model `printer` corrects for: the calibration in use on this phone (Calibration page), else the built-in one.
 * Here and not in print_sim, which stays free of app state for the tools in tools/dot-gain.
 */
export const dotModelFor = (printer: PrinterId): DotModel | undefined => activeCalibration(printer)?.model ?? builtInDotModel(printer);
