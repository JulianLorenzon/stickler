<script lang="ts" module>
  /** A measured check print: a grey test printed with the correction in use */
  export interface CheckResult {
    /** Measured patches per row (GREY_TEST_MODES order), 0-1 darkness */
    measured: number[][];
    /** Every row with the measured boxes drawn in, as a data URL */
    overlay: string;
    /** The correction it was printed with, when known */
    label?: string;
  }
</script>

<script lang="ts">
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ToneChart from "$/components/ToneChart.svelte";
  import { checkError, GREY_TEST_LEVELS, GREY_TEST_MODES } from "$/utils/grey_strip";
  import { tr } from "$/utils/i18n";
  import { TONE_STEPS } from "$/utils/print_sim";

  /**
   * The answer to a check print, on its own sheet so it doesn't read as a new correction: does the correction print
   * each grey as asked? One verdict, how much lighter or darker per dither, and the measured greys against where they
   * should land. Nothing to decide or save.
   */
  let { result, show = $bindable(), modeIndex = $bindable(0) }: { result: CheckResult; show: boolean; modeIndex?: number } =
    $props();

  /**
   * How much lighter or darker on average still counts as asked, over all rows and for one row. Two photos of the
   * same MXW01 strip differed by 0.03 on average and up to 0.06 in a row, so a check can't tell less than that.
   */
  const ALL_OK = 0.04;
  const ROW_OK = 0.07;

  const ASKED = GREY_TEST_LEVELS.slice(0, -1).map((l) => l / 100);
  const error = $derived(checkError(result.measured, result.measured.map(() => ASKED)));
  /** The row furthest off */
  const worst = $derived(error.bias.reduce((w, b, i) => (Math.abs(b) > Math.abs(error.bias[w]) ? i : w), 0));
  const verdict = $derived.by(() => {
    const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
    if (Math.abs(error.biasAll) > ALL_OK) {
      return $tr(error.biasAll < 0 ? "calibration.check.off.lighter" : "calibration.check.off.darker").replace("{n}", pct(error.biasAll));
    }
    const b = error.bias[worst];
    if (Math.abs(b) > ROW_OK) {
      return $tr(b < 0 ? "calibration.check.row.lighter" : "calibration.check.row.darker")
        .replace("{mode}", GREY_TEST_MODES[worst].name)
        .replace("{n}", pct(b));
    }
    return $tr("calibration.check.good");
  });
  const good = $derived(Math.abs(error.biasAll) <= ALL_OK && Math.abs(error.bias[worst]) <= ROW_OK);
  /** Signed percent: + darker than asked, − lighter */
  const signed = (v: number) => {
    const n = Math.round(v * 100);
    return n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : "0%";
  };
  const DIAGONAL = Array.from({ length: TONE_STEPS + 1 }, (_, i) => i / TONE_STEPS);
  const MEASURED_COLOUR = "#d95926";
</script>

<AppModal title={$tr("calibration.check.title")} variant="sheet" bind:show>
  {#if result.label}<p class="printed-with">{$tr("calibration.check.printed_with").replace("{name}", result.label)}</p>{/if}
  <div class="verdict" class:good>
    <MdIcon icon={good ? "check_circle" : "error"} />
    <p>{verdict}</p>
  </div>

  <div class="modes" role="group" aria-label={$tr("calibration.list.dither")}>
    {#each GREY_TEST_MODES as m, i (m.mode)}
      <button class="btn btn-sm {i === modeIndex ? 'btn-primary' : 'btn-outline-secondary'}" aria-pressed={i === modeIndex} onclick={() => (modeIndex = i)}>
        <span>{m.name}</span>
        <span class="off" class:far={Math.abs(error.bias[i] ?? 0) > ROW_OK}>{signed(error.bias[i] ?? 0)}</span>
      </button>
    {/each}
  </div>
  <ToneChart
    readout={false}
    lines={[
      {
        id: "should",
        label: $tr("calibration.check.should"),
        color: "var(--ink-secondary)",
        values: DIAGONAL,
        measured: result.measured[modeIndex],
        dotColor: MEASURED_COLOUR,
      },
    ]}
    xTitle={$tr("calibration.chart.asked")}
    yTitle={$tr("calibration.chart.printed")} />
  <div class="legend">
    <span class="item"><span class="key-line"></span>{$tr("calibration.check.should")}</span>
    <span class="item"><span class="key-dot" style:background={MEASURED_COLOUR}></span>{$tr("calibration.chart.legend.measured")}</span>
  </div>
  <p class="hint">{$tr("calibration.check.hint")}</p>

  <details class="boxes">
    <summary><MdIcon icon="chevron_right" />{$tr("calibration.result.boxes")}</summary>
    <img class="overlay" src={result.overlay} alt="" />
  </details>

  {#snippet footer()}
    <button class="btn btn-primary w-100" data-bs-dismiss="modal">{$tr("calibration.check.done")}</button>
  {/snippet}
</AppModal>

<style>
  .verdict {
    display: flex;
    gap: 0.625rem;
    align-items: flex-start;
    padding: 0.75rem 0.875rem;
    margin-bottom: 0.75rem;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border-standard);
  }

  .verdict p {
    margin: 0;
  }

  .verdict :global(.mdi) {
    font-size: 1.5rem;
  }

  .verdict :global(.mdi) {
    color: var(--ink-secondary);
    flex: none;
  }

  .verdict.good :global(.mdi) {
    color: var(--accent);
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .modes .btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 2.75rem;
    padding: 0.125rem;
    font-size: 0.75rem;
    line-height: 1.15;
  }

  .off {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }

  .off.far {
    font-weight: 700;
    opacity: 1;
  }

  .printed-with {
    font-size: 0.875rem;
    color: var(--ink-secondary);
    margin: 0 0 0.5rem;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    font-size: 0.8125rem;
    color: var(--ink-secondary);
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .key-line {
    width: 0.75rem;
    height: 3px;
    border-radius: 2px;
    background: var(--ink-secondary);
  }

  .key-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
  }

  .hint {
    font-size: 0.8125rem;
    color: var(--ink-secondary);
    margin: 0.5rem 0 0.75rem;
  }

  .boxes summary {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.75rem;
    color: var(--ink-secondary);
    font-size: 0.875rem;
    list-style: none;
    cursor: pointer;
  }

  .boxes summary::-webkit-details-marker {
    display: none;
  }

  .boxes summary :global(.mdi) {
    transition: transform 0.15s;
  }

  .boxes[open] summary :global(.mdi) {
    transform: rotate(90deg);
  }

  .overlay {
    display: block;
    width: 100%;
    border-radius: var(--radius-sm);
  }
</style>
