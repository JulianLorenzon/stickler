<script lang="ts" module>
  import type { DotModel } from "$/utils/print_sim";

  /** A correction on the chart; its role picks the colour */
  export interface ChartCorrection {
    id: string;
    label: string;
    role: "builtin" | "in_use" | "other";
    model: DotModel;
    /** Measured patches per row (GREY_TEST_MODES order), drawn as dots */
    measured?: number[][];
  }
</script>

<script lang="ts">
  import { tr } from "$/utils/i18n";
  import { GREY_TEST_MODES } from "$/utils/grey_strip";
  import { toneCurve } from "$/utils/print_sim";
  import ToneChart, { type ToneLine } from "$/components/ToneChart.svelte";

  /** Tone curves of up to three corrections for one dither mode at a time, picked with the chips above */
  let { corrections, modeIndex = $bindable(0) }: { corrections: ChartCorrection[]; modeIndex?: number } = $props();

  /**
   * Colours by role (the first three slots of the data-viz palette's dark steps pass the colour-blindness checks
   * against the card in every pair): ours in grey, the one in use in orange, the one compared in blue
   */
  const COLOURS = { builtin: "var(--ink-secondary)", in_use: "#d95926", other: "#3987e5" };

  const mode = $derived(GREY_TEST_MODES[modeIndex] ?? GREY_TEST_MODES[0]);
  const lines = $derived<ToneLine[]>(
    corrections.map((c) => ({
      id: c.id,
      label: c.label,
      color: COLOURS[c.role],
      values: toneCurve(mode.mode, mode.dither, c.model),
      measured: c.measured?.[modeIndex],
    })),
  );
</script>

<div class="modes" role="group" aria-label={$tr("calibration.list.dither")}>
  {#each GREY_TEST_MODES as m, i (m.mode)}
    <button class="btn btn-sm {i === modeIndex ? 'btn-primary' : 'btn-outline-secondary'}" aria-pressed={i === modeIndex} onclick={() => (modeIndex = i)}>
      {m.name}
    </button>
  {/each}
</div>
<ToneChart
  {lines}
  xTitle={$tr("calibration.chart.asked")}
  yTitle={$tr("calibration.chart.printed")}
  measuredLabel={$tr("calibration.chart.legend.measured")} />
<p class="hint">{$tr("calibration.chart.hint")}</p>

<style>
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

  .hint {
    font-size: 0.8125rem;
    color: var(--ink-secondary);
    margin: 0.5rem 0 0;
  }
</style>
