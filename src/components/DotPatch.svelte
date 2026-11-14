<script lang="ts">
  import type { GREY_TEST_MODES } from "$/utils/grey_strip";
  import { applyCurve } from "$/utils/post_process";

  /**
   * A grey as the dots sent to the printer, enlarged (`dots` x `rows`): dithered with `mode`, after the correction `curve`
   * if given.
   * Ink on paper colours, one square per dot.
   */
  let {
    mode,
    curve,
    darkness = 0.5,
    dots = 32,
    rows = 16,
  }: { mode: (typeof GREY_TEST_MODES)[number]; curve?: Uint8ClampedArray; darkness?: number; dots?: number; rows?: number } = $props();

  const PAPER = [244, 240, 234];
  const INK = [59, 42, 40];

  let canvas: HTMLCanvasElement;

  /** The fraction of dots burnt, for the caption */
  let coverage = $state(0);

  $effect(() => {
    const grey = Math.round(255 * (1 - darkness));
    // Dithered bigger than shown, then the middle cut out: error diffusion starts oddly at the edges
    const big = 2 * dots;
    const image = new ImageData(big, 2 * rows);
    for (let p = 0; p < image.data.length; p += 4) image.data.fill(grey, p, p + 3), (image.data[p + 3] = 255);
    const dithered = mode.dither(curve ? applyCurve(image, curve) : image);

    const out = new ImageData(dots, rows);
    const [offX, offY] = [Math.floor(dots / 2), Math.floor(rows / 2)];
    let burnt = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < dots; x++) {
        const on = dithered.data[((y + offY) * big + x + offX) * 4] < 128;
        burnt += on ? 1 : 0;
        const colour = on ? INK : PAPER;
        out.data.set([...colour, 255], (y * dots + x) * 4);
      }
    }
    coverage = burnt / (dots * rows);
    canvas.width = dots;
    canvas.height = rows;
    canvas.getContext("2d")!.putImageData(out, 0, 0);
  });
</script>

<div class="dot-patch">
  <canvas bind:this={canvas}></canvas>
  <span class="coverage">{Math.round(coverage * 100)}%</span>
</div>

<style>
  .dot-patch {
    position: relative;
  }

  canvas {
    display: block;
    width: 100%;
    height: auto;
    image-rendering: pixelated;
    border-radius: var(--radius-sm);
  }

  /* Share of dots burnt, in the corner of the patch */
  .coverage {
    position: absolute;
    right: 0.25rem;
    bottom: 0.25rem;
    padding: 0 0.3rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    background: var(--surface-1);
    color: var(--ink-primary);
  }
</style>
