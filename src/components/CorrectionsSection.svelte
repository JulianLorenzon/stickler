<script lang="ts" module>
  import type { DotModel } from "$/utils/print_sim";
  import type { Calibration } from "$/utils/calibrations";
  import type { TranslationKey } from "$/utils/i18n";

  /** A correction to print a check with and measure that print against */
  export interface CheckTarget {
    label: string;
    model: DotModel;
    /** Printed on the check, after "corrected": which correction it was */
    note: string;
  }

  /** How a saved correction is called: when it was measured (`long` with year), or earlier for ones from before dates */
  export const correctionName = (saved: Calibration | undefined, locale: string, t: (key: TranslationKey) => string) => {
    if (!saved) return t("calibration.list.builtin");
    if (!saved.date) return t("calibration.list.earlier");
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(saved.date);
  };
</script>

<script lang="ts">
  import type { PrinterId } from "$/types";
  import { DOTS_PER_MM } from "$/defaults";
  import { locale, tr } from "$/utils/i18n";
  import { builtInDotModel } from "$/utils/print_sim";
  import {
    activeCalibration,
    calibrations,
    deleteCalibration,
    savedCalibrations,
    useCalibration,
  } from "$/utils/calibrations";
  import { Toasts } from "$/utils/toasts";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import CorrectionChart, { type ChartCorrection } from "$/components/CorrectionChart.svelte";

  /**
   * The corrections of a printer, the built-in one and those kept on this phone, as a list. Tapping one opens it:
   * its curve against the one in use, its five numbers, a check print with it, use it or delete it.
   */
  let {
    printer,
    modeIndex = $bindable(0),
    open = $bindable(),
    connected,
    printing,
    measuring,
    canCamera,
    onCheck,
  }: {
    printer: PrinterId;
    modeIndex?: number;
    open?: string;
    connected: boolean;
    /** A check print is being sent */
    printing: boolean;
    measuring: boolean;
    canCamera: boolean;
    onCheck: (target: CheckTarget, how: "print" | "camera" | "photo") => void;
  } = $props();

  const BUILT_IN = "builtin";

  interface Entry {
    id: string;
    model: DotModel;
    saved?: Calibration;
  }

  const builtIn = $derived(builtInDotModel(printer));
  const active = $derived(activeCalibration(printer, $calibrations));
  const activeId = $derived(active?.id ?? BUILT_IN);
  const entries = $derived<Entry[]>([
    ...(builtIn ? [{ id: BUILT_IN, model: builtIn }] : []),
    ...savedCalibrations(printer, $calibrations).map((c) => ({ id: c.id, model: c.model, saved: c })),
  ]);

  const name = (e: Entry) => correctionName(e.saved, $locale, $tr);

  const target = (e: Entry): CheckTarget => ({
    label: name(e),
    model: e.model,
    note: !e.saved ? "built-in" : e.saved.date ? new Intl.DateTimeFormat($locale, { day: "numeric", month: "short" }).format(e.saved.date) : "earlier",
  });

  const mm = (dots: number) => Number((dots / DOTS_PER_MM).toFixed(1));
  const details = (e: Entry): string => {
    if (e.id === BUILT_IN) return $tr("calibration.list.builtin.about");
    const parts: string[] = [];
    if (e.saved?.size) parts.push(`${mm(e.saved.size.width)} × ${mm(e.saved.size.height)} mm`);
    if (e.saved?.source) parts.push($tr(e.saved.source === "camera" ? "calibration.list.camera" : "calibration.list.photo"));
    if (e.saved?.rms !== undefined) parts.push(`${$tr("calibration.list.error")} ${e.saved.rms.toFixed(3)}`);
    return parts.join(" · ");
  };

  /** The open entry against the built-in correction and the one in use */
  const chartFor = (e: Entry): ChartCorrection[] => {
    const list: ChartCorrection[] = [];
    if (builtIn) list.push({ id: BUILT_IN, label: $tr("calibration.list.builtin"), role: "builtin", model: builtIn });
    const inUse = entries.find((x) => x.id === activeId);
    if (inUse && inUse.id !== BUILT_IN) {
      list.push({ id: inUse.id, label: $tr("calibration.list.in_use"), role: "in_use", model: inUse.model, measured: inUse.id === e.id ? e.saved?.measured : undefined });
    }
    if (e.id !== BUILT_IN && e.id !== activeId) {
      list.push({ id: e.id, label: name(e), role: "other", model: e.model, measured: e.saved?.measured });
    }
    return list;
  };

  const NUMBERS: { key: keyof DotModel; label: TranslationKey }[] = [
    { key: "base", label: "calibration.model.base" },
    { key: "orth", label: "calibration.model.orth" },
    { key: "diag", label: "calibration.model.diag" },
    { key: "spillOrth", label: "calibration.model.spill_orth" },
    { key: "spillDiag", label: "calibration.model.spill_diag" },
  ];

  const use = (e: Entry) => {
    useCalibration(printer, e.id === BUILT_IN ? undefined : e.id);
    Toasts.message($tr(e.id === BUILT_IN ? "calibration.list.used.builtin" : "calibration.list.used"));
  };

  const remove = (e: Entry) => {
    if (!e.saved || !confirm(`${$tr("calibration.list.delete.confirm")} ${name(e)}?`)) return;
    deleteCalibration(printer, e.saved.id);
    if (open === e.id) open = undefined;
  };
</script>

<section class="block">
  <h2 class="block-title">{$tr("calibration.list.title")}</h2>
  <p class="intro">{$tr("calibration.list.intro")}</p>

  <div class="list">
    {#each entries as e (e.id)}
      <div class="entry" class:open={e.id === open}>
        <button class="entry-head" aria-expanded={e.id === open} onclick={() => (open = open === e.id ? undefined : e.id)}>
          <span class="entry-text">
            <span class="entry-name">{name(e)}</span>
            {#if details(e)}<span class="entry-details">{details(e)}</span>{/if}
          </span>
          {#if e.id === activeId}<span class="badge-in-use">{$tr("calibration.list.in_use")}</span>{/if}
          <MdIcon icon={e.id === open ? "expand_less" : "expand_more"} />
        </button>
        {#if e.id === open}
          <div class="entry-body">
            <CorrectionChart corrections={chartFor(e)} bind:modeIndex />
            <dl class="numbers">
              {#each NUMBERS as n (n.key)}
                <div>
                  <dt>{$tr(n.label)}</dt>
                  <dd>{e.model[n.key].toFixed(3)}</dd>
                </div>
              {/each}
            </dl>
            <div class="check">
              <div class="check-title">{$tr("calibration.list.check")}</div>
              <p class="check-hint">{$tr("calibration.list.check.hint")}</p>
              <div class="check-buttons">
                <button class="btn btn-secondary" disabled={printing} onclick={() => onCheck(target(e), "print")}>
                  {#if printing}<span class="spinner-border spinner-border-sm"></span>{:else}<MdIcon icon={connected ? "print" : "bluetooth"} />{/if}
                  {$tr(connected ? "calibration.list.check.print" : "calibration.list.check.connect")}
                </button>
                {#if canCamera}
                  <button class="btn btn-secondary" disabled={measuring} onclick={() => onCheck(target(e), "camera")}>
                    <MdIcon icon="photo_camera" />
                    {$tr("calibration.list.check.camera")}
                  </button>
                {/if}
                <button class="btn btn-secondary" disabled={measuring} onclick={() => onCheck(target(e), "photo")}>
                  <MdIcon icon="image" />
                  {$tr("calibration.list.check.photo")}
                </button>
              </div>
            </div>
            {#if e.id !== activeId || e.saved}
              <div class="actions">
                {#if e.id !== activeId}
                  <button class="btn btn-primary" onclick={() => use(e)}>
                    <MdIcon icon="check" />
                    {$tr("calibration.list.use")}
                  </button>
                {/if}
                {#if e.saved}
                  <button class="btn btn-secondary" onclick={() => remove(e)}>
                    <MdIcon icon="delete" />
                    {$tr("calibration.list.delete")}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</section>

<style>
  .block {
    margin-top: 2rem;
  }

  .block-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-tertiary);
    margin: 0 0 0.375rem;
  }

  .intro {
    font-size: 0.875rem;
    color: var(--ink-secondary);
    margin: 0 0 0.75rem;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .entry {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
  }

  .entry.open {
    border-color: var(--border-emphasis);
  }

  .entry-head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    min-height: 3.25rem;
    padding: 0.5rem 0.875rem;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
  }

  .entry-head :global(.material-symbols-outlined),
  .entry-head :global(i) {
    color: var(--ink-tertiary);
  }

  .entry-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .entry-name {
    font-weight: 600;
    font-size: 0.9375rem;
  }

  .entry-details {
    font-size: 0.8125rem;
    color: var(--ink-secondary);
  }

  .badge-in-use {
    flex: none;
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .entry-body {
    padding: 0 0.875rem 0.875rem;
  }

  .numbers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: 0.375rem 0.75rem;
    margin: 0.75rem 0;
  }

  .numbers dt {
    font-weight: 400;
    font-size: 0.75rem;
    color: var(--ink-secondary);
  }

  .numbers dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .check {
    margin: 0 0 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-standard);
  }

  .check-title {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .check-hint {
    font-size: 0.8125rem;
    color: var(--ink-secondary);
    margin: 0.125rem 0 0.5rem;
  }

  .check-buttons {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 0.375rem;
  }

  .check-buttons .btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    min-height: 3.25rem;
    padding: 0.25rem;
    font-size: 0.8125rem;
    line-height: 1.15;
  }

  .actions {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 0.5rem;
  }

  .actions .btn {
    min-height: 2.75rem;
  }
</style>
