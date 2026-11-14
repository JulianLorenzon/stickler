<script lang="ts" module>
  import type { DotModel } from "$/utils/print_sim";

  /** A measurement not saved yet, shown with the saved ones to compare */
  export interface PendingCalibration {
    model: DotModel;
    rms: number;
    measured: number[][];
  }
</script>

<script lang="ts">
  import type { PrinterId } from "$/types";
  import { DOTS_PER_MM } from "$/defaults";
  import { locale, tr, type TranslationKey } from "$/utils/i18n";
  import { GREY_TEST_MODES } from "$/utils/grey_strip";
  import { builtInDotModel, toneCurve } from "$/utils/print_sim";
  import {
    activeCalibration,
    calibrations,
    deleteCalibration,
    savedCalibrations,
    useCalibration,
    type Calibration,
  } from "$/utils/calibrations";
  import { Toasts } from "$/utils/toasts";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ToneChart, { type ToneLine } from "$/components/ToneChart.svelte";

  /**
   * The corrections of a printer: the built-in one, those measured on this phone and a new measurement, as tone curves
   * to compare and as a list to pick the one in use from
   */
  let {
    printer,
    modeIndex = $bindable(0),
    picked = $bindable(),
    pending,
  }: { printer: PrinterId; modeIndex?: number; picked?: string; pending?: PendingCalibration } = $props();

  /**
   * Line colours by role, at most three on the chart at once (the first three slots of the data-viz palette's dark
   * steps pass the colour-blindness checks against the card in every pair): ours in grey, the one in use in orange,
   * the one looked at in blue
   */
  const BUILT_IN_COLOUR = "var(--ink-secondary)";
  const IN_USE_COLOUR = "#d95926";
  const OTHER_COLOUR = "#3987e5";

  const BUILT_IN = "builtin";
  const NEW = "new";

  interface Entry {
    id: string;
    model: DotModel;
    saved?: Calibration;
    rms?: number;
    measured?: number[][];
  }

  const builtIn = $derived(builtInDotModel(printer));
  const active = $derived(activeCalibration(printer, $calibrations));
  const activeId = $derived(active?.id ?? BUILT_IN);
  const entries = $derived<Entry[]>([
    ...(pending ? [{ id: NEW, ...pending }] : []),
    ...(builtIn ? [{ id: BUILT_IN, model: builtIn }] : []),
    ...savedCalibrations(printer, $calibrations).map((c) => ({ id: c.id, model: c.model, saved: c, rms: c.rms, measured: c.measured })),
  ]);

  /** The entry looked at (`picked`): a new measurement as soon as there is one, else the one in use */
  $effect(() => {
    if (pending) picked = NEW;
  });
  const selected = $derived(entries.find((e) => e.id === picked) ?? entries.find((e) => e.id === activeId) ?? entries[0]);

  const dateText = (date: number, long = false) =>
    new Intl.DateTimeFormat($locale, long ? { dateStyle: "medium", timeStyle: "short" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);

  const name = (e: Entry) => {
    if (e.id === NEW) return $tr("calibration.list.new");
    if (e.id === BUILT_IN) return $tr("calibration.list.builtin");
    return e.saved?.date ? dateText(e.saved.date) : $tr("calibration.list.earlier");
  };

  const mm = (dots: number) => Number((dots / DOTS_PER_MM).toFixed(1));
  const details = (e: Entry): string => {
    if (e.id === BUILT_IN) return $tr("calibration.list.builtin.about");
    const parts: string[] = [];
    if (e.saved?.size) parts.push(`${mm(e.saved.size.width)} × ${mm(e.saved.size.height)} mm`);
    if (e.saved?.source) parts.push($tr(e.saved.source === "camera" ? "calibration.list.camera" : "calibration.list.photo"));
    if (e.rms !== undefined) parts.push(`${$tr("calibration.list.error")} ${e.rms.toFixed(3)}`);
    return parts.join(" · ");
  };

  const colourOf = (e: Entry): string | undefined => {
    if (e.id === BUILT_IN) return BUILT_IN_COLOUR;
    if (e.id === activeId) return IN_USE_COLOUR;
    if (e.id === selected?.id) return OTHER_COLOUR;
    return undefined;
  };

  const mode = $derived(GREY_TEST_MODES[modeIndex] ?? GREY_TEST_MODES[0]);
  const curve = (m: DotModel) => toneCurve(`${mode.mode}`, mode.dither, m);

  const lines = $derived<ToneLine[]>(
    entries
      .filter((e) => colourOf(e) !== undefined)
      // Built-in at the back, the one looked at in front
      .sort((a, b) => Number(a.id === selected?.id) - Number(b.id === selected?.id) || Number(b.id === BUILT_IN) - Number(a.id === BUILT_IN))
      .map((e) => ({
        id: e.id,
        label: name(e),
        color: colourOf(e)!,
        values: curve(e.model),
        measured: e.id === selected?.id ? e.measured?.[modeIndex] : undefined,
      })),
  );

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
    if (picked === e.id) picked = undefined;
  };
</script>

<section class="block">
  <h2 class="block-title">{$tr("calibration.list.title")}</h2>
  <p class="intro">{$tr("calibration.list.intro")}</p>

  <div class="card-box">
    <div class="modes" role="group" aria-label={$tr("calibration.list.dither")}>
      {#each GREY_TEST_MODES as m, i (m.mode)}
        <button class="btn btn-sm {i === modeIndex ? 'btn-primary' : 'btn-outline-secondary'}" aria-pressed={i === modeIndex} onclick={() => (modeIndex = i)}>
          {m.name}
        </button>
      {/each}
    </div>
    <ToneChart {lines} xTitle={$tr("calibration.chart.asked")} yTitle={$tr("calibration.chart.printed")} />
    <p class="hint mt-2 mb-0">{$tr("calibration.chart.hint")}</p>
  </div>

  <div class="list">
    {#each entries as e (e.id)}
      {@const colour = colourOf(e)}
      <div class="entry" class:selected={e.id === selected?.id}>
        <button class="entry-head" aria-expanded={e.id === selected?.id} onclick={() => (picked = e.id)}>
          <span class="key" style:background={colour ?? "transparent"}></span>
          <span class="entry-text">
            <span class="entry-name">{name(e)}</span>
            {#if details(e)}<span class="entry-details">{details(e)}</span>{/if}
          </span>
          {#if e.id === activeId}
            <span class="badge-in-use">{$tr("calibration.list.in_use")}</span>
          {:else if e.id === NEW}
            <span class="badge-new">{$tr("calibration.list.not_saved")}</span>
          {/if}
        </button>
        {#if e.id === selected?.id}
          <div class="entry-body">
            {#if e.saved?.date}
              <p class="hint mb-2">{$tr("calibration.list.measured")} {dateText(e.saved.date, true)}</p>
            {/if}
            <dl class="numbers">
              {#each NUMBERS as n (n.key)}
                <div>
                  <dt>{$tr(n.label)}</dt>
                  <dd>{e.model[n.key].toFixed(3)}</dd>
                </div>
              {/each}
            </dl>
            {#if e.id === NEW}
              <p class="hint mb-0">{$tr("calibration.list.new.hint")}</p>
            {:else}
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

  .hint {
    font-size: 0.8125rem;
    color: var(--ink-secondary);
  }

  .card-box,
  .entry {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
  }

  .card-box {
    padding: 0.875rem;
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .modes .btn {
    min-height: 2.75rem;
    padding-left: 0.125rem;
    padding-right: 0.125rem;
    font-size: 0.75rem;
    line-height: 1.1;
  }

  .list {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .entry.selected {
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

  .key {
    flex: none;
    width: 1rem;
    height: 3px;
    border-radius: 2px;
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

  .badge-in-use,
  .badge-new {
    flex: none;
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
  }

  .badge-in-use {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .badge-new {
    border: 1px solid var(--border-emphasis);
    color: var(--ink-secondary);
  }

  .entry-body {
    padding: 0 0.875rem 0.875rem;
  }

  .numbers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: 0.375rem 0.75rem;
    margin: 0 0 0.75rem;
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
