<script lang="ts" module>
  export interface ToneLine {
    id: string;
    label: string;
    /** CSS colour of the line; the text next to it stays in ink colours */
    color: string;
    /** Darkness on paper (0-1) for 0, 5, .. 100% grey */
    values: number[];
    /** Measured patches (10..90%) drawn as dots on this line */
    measured?: number[];
  }
</script>

<script lang="ts">
  import { TONE_STEPS } from "$/utils/print_sim";

  /** Tone curves: grey asked for across, darkness on paper up; the diagonal is a print exactly as asked */
  let { lines, xTitle, yTitle }: { lines: ToneLine[]; xTitle: string; yTitle: string } = $props();

  const W = 320;
  const H = 228;
  const PAD = { left: 34, right: 10, top: 10, bottom: 30 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const px = (v: number) => PAD.left + v * plotW;
  const py = (v: number) => PAD.top + (1 - Math.max(0, Math.min(1, v))) * plotH;
  const TICKS = [0, 0.25, 0.5, 0.75, 1];

  const path = (values: number[]) =>
    values.map((v, i) => `${i ? "L" : "M"}${px(i / TONE_STEPS).toFixed(1)},${py(v).toFixed(1)}`).join("");

  /** Step under the finger; starts in the middle so the readout always shows values */
  let step = $state(TONE_STEPS / 2);
  let svg: SVGSVGElement;

  const pick = (e: PointerEvent) => {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    step = Math.round(Math.max(0, Math.min(1, (x - PAD.left) / plotW)) * TONE_STEPS);
  };

  const onDown = (e: PointerEvent) => {
    svg.setPointerCapture(e.pointerId);
    pick(e);
  };
  const onMove = (e: PointerEvent) => {
    if (svg.hasPointerCapture(e.pointerId)) pick(e);
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="tone-chart">
  <div class="readout" aria-live="polite">
    <span class="asked">{pct(step / TONE_STEPS)} →</span>
    {#each lines as line (line.id)}
      <span class="item"><span class="key" style:background={line.color}></span>{line.label} <strong>{pct(line.values[step])}</strong></span>
    {/each}
  </div>
  <svg
    bind:this={svg}
    viewBox="0 0 {W} {H}"
    role="img"
    aria-label={`${yTitle} / ${xTitle}`}
    onpointerdown={onDown}
    onpointermove={onMove}>
    {#each TICKS as t (t)}
      <line class="grid" x1={px(0)} x2={px(1)} y1={py(t)} y2={py(t)} />
      <line class="grid" x1={px(t)} x2={px(t)} y1={py(0)} y2={py(1)} />
      <text class="tick" x={PAD.left - 6} y={py(t) + 3.5} text-anchor="end">{pct(t)}</text>
      <text class="tick" x={px(t)} y={H - PAD.bottom + 13} text-anchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}>{pct(t)}</text>
    {/each}
    <text class="title" x={px(1)} y={H - 3} text-anchor="end">{xTitle}</text>
    <text class="title" x={px(0) + 4} y={PAD.top + 10}>{yTitle}</text>

    <line class="ideal" x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} />

    {#each lines as line (line.id)}
      <path d={path(line.values)} fill="none" stroke={line.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    {/each}
    {#each lines as line (line.id)}
      {#each line.measured ?? [] as v, i (i)}
        <circle class="measured" cx={px((i + 1) / 10)} cy={py(v)} r="4" fill={line.color} />
      {/each}
    {/each}

    <line class="cross" x1={px(step / TONE_STEPS)} x2={px(step / TONE_STEPS)} y1={py(0)} y2={py(1)} />
    {#each lines as line (line.id)}
      <circle class="measured" cx={px(step / TONE_STEPS)} cy={py(line.values[step])} r="3.5" fill={line.color} />
    {/each}
  </svg>
</div>

<style>
  .tone-chart {
    user-select: none;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    touch-action: none;
  }

  .readout {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    min-height: 2.75rem;
    font-size: 0.8125rem;
    color: var(--ink-secondary);
  }

  .readout strong {
    color: var(--ink-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .asked {
    color: var(--ink-primary);
    font-variant-numeric: tabular-nums;
    min-width: 3em;
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
  }

  .key {
    display: inline-block;
    width: 0.75rem;
    height: 3px;
    border-radius: 2px;
  }

  .grid {
    stroke: var(--border-standard);
    stroke-width: 1;
  }

  .ideal {
    stroke: var(--ink-tertiary);
    stroke-width: 1;
  }

  .cross {
    stroke: var(--ink-secondary);
    stroke-width: 1;
  }

  .measured {
    stroke: var(--surface-2);
    stroke-width: 2;
  }

  .tick {
    font-size: 9px;
    fill: var(--ink-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .title {
    font-size: 9.5px;
    fill: var(--ink-secondary);
  }
</style>
