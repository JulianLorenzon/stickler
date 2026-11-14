<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import { GREY_TEST_MODES, readGreyLabels, readGreyStrip, type RowReading, type StripReading } from "$/utils/grey_strip";
  import { rowPicture, stackPictures, strokeQuads, type StripCapture } from "$/utils/strip_camera";

  type Props = {
    /** Width and height of a printed row, dots */
    width: number;
    rowHeight: number;
    /** Rows in one piece: all of them on a roll, 1 when every row is a label of its own */
    together: number;
    /** Called once: the test as read, undefined if the user closed the camera, or the error if the camera failed */
    onDone: (result: StripCapture | undefined, error?: unknown) => void;
  };

  let { width, rowHeight, together, onDone }: Props = $props();

  /**
   * Our own camera instead of the phone's camera app: video frames come without HDR, sharpening or scene modes, which
   * shift greys, and several frames can be put together. The resolution is plenty: the patches are averaged anyway.
   * Rows are read as they come into view, in any order and any way up, so labels can be shown one after another.
   */
  const MODES = GREY_TEST_MODES.length;
  /** Steady frames wanted of every row */
  const FRAMES = 16;
  /** Frames are read at up to this many pixels on the long side: full HD as it comes */
  const SIDE = 1920;
  /**
   * Frame pixels per printer dot below which a row is too small in the picture. The greys read the same down to
   * 0.8 (tools/dot-gain), but the boxes sit more surely with a little more.
   */
  const MIN_SCALE = 1;
  /** The outline shows the print at this part of the frame's short side: where to hold it, not a requirement */
  const guideWidth = () => (together > 1 ? 0.55 : 0.8);
  /**
   * Camera zoom, where the phone has it: the print fills the outline from twice as far away, where every phone
   * focuses and the phone's shadow isn't on the paper
   */
  const ZOOM = 2;
  /** A frame only counts when the row moved slower than this since the frame before (dots per second; 8 dots = 1 mm) */
  const MAX_SPEED = 100;

  let video: HTMLVideoElement;
  let boxes: HTMLCanvasElement;
  let stream: MediaStream | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let playing = $state(false);
  let status = $state<"starting" | "search" | "closer" | "hold" | "next" | "corrected">("starting");
  /** Steady frames collected of every row */
  let counts = $state<number[]>(Array(MODES).fill(0));

  /** Width of a row as the frames are read: the one asked for until the labels turn out to be another size */
  // svelte-ignore state_referenced_locally
  let rowWidth = width;
  const work = document.createElement("canvas");
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  /** Per row: the readings collected, its picture from the last of them, and where it was in the frame before */
  let good: RowReading[][] = Array.from({ length: MODES }, () => []);
  const pictures: (HTMLCanvasElement | undefined)[] = Array(MODES).fill(undefined);
  const before: ({ at: [number, number]; time: number } | undefined)[] = Array(MODES).fill(undefined);
  let marks: boolean | undefined;

  /** Where to hold the print, about: the outline of a piece with its rows of patches, in the middle of the frame */
  const drawGuide = (ctx: CanvasRenderingContext2D, w: number, h: number, counting: boolean) => {
    const gw = guideWidth() * Math.min(w, h);
    const gh = (gw * together * rowHeight) / width;
    const x = (w - gw) / 2, y = (h - gh) / 2;
    ctx.lineWidth = Math.max(2, w / 300);
    ctx.strokeStyle = counting ? "#4cd964" : "rgba(255, 255, 255, 0.85)";
    ctx.setLineDash([ctx.lineWidth * 5, ctx.lineWidth * 3]);
    ctx.strokeRect(x, y, gw, gh);
    ctx.setLineDash([]);
    if (counting) return;
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    for (let r = 0; r < together; r++) ctx.fillRect(x + gw * 0.02, y + (gh / together) * (r + 0.24), gw * 0.96, (gh / together) * 0.56);
  };

  const drawBoxes = (reading: StripReading | undefined, counting: boolean) => {
    const ctx = boxes.getContext("2d")!;
    boxes.width = work.width;
    boxes.height = work.height;
    drawGuide(ctx, boxes.width, boxes.height, counting);
    if (!reading) return;
    ctx.lineWidth = Math.max(2, boxes.width / 400);
    for (const row of reading.rows) {
      strokeQuads(ctx, row.paperBoxes, "#2a9df4");
      strokeQuads(ctx, row.patchBoxes, "#e53935");
    }
  };

  const median = (values: number[]) => {
    const s = [...values].sort((a, b) => a - b);
    return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };

  let finished = false;
  const finish = (result?: StripCapture, error?: unknown) => {
    if (finished) return;
    finished = true;
    stop();
    onDone(result, error);
  };

  /** Read the current frame; enough steady ones of every row make the result */
  const analyse = () => {
    if (stopped) return;
    if (video.readyState < 2 || video.videoWidth === 0) {
      timer = setTimeout(analyse, 100);
      return;
    }
    const scale = Math.min(1, SIDE / Math.max(video.videoWidth, video.videoHeight));
    work.width = Math.round(video.videoWidth * scale);
    work.height = Math.round(video.videoHeight * scale);
    wctx.drawImage(video, 0, 0, work.width, work.height);
    // Labels can be another size than the one asked for; a roll is as wide as the print head
    const frame = wctx.getImageData(0, 0, work.width, work.height);
    const reading = together === 1 ? readGreyLabels(frame, rowWidth, rowHeight) : readGreyStrip(frame, rowWidth, rowHeight);
    const now = performance.now();

    if (typeof reading === "string") {
      status = "search";
      before.fill(undefined);
      drawBoxes(undefined, false);
    } else if (reading.corrected) {
      // Printed with dot correction: that says how well a correction works, not what the printer does
      status = "corrected";
      drawBoxes(reading, false);
    } else {
      if (marks !== reading.marks || rowWidth !== reading.width) {
        // Another kind of print than before, or labels of another size than thought: start over
        good = good.map(() => []);
        marks = reading.marks;
        rowWidth = reading.width;
      }
      let counted = false, tooSmall = false;
      for (const row of reading.rows) {
        if (row.scale < MIN_SCALE) {
          tooSmall = true;
          continue;
        }
        // Blurred frames read too grey: a row only counts when it barely moved since the frame before
        const at = row.patchBoxes[row.patchBoxes.length - 1][0];
        const was = before[row.mode];
        const steady = was !== undefined && Math.hypot(at[0] - was.at[0], at[1] - was.at[1]) / row.scale / ((now - was.time) / 1000) < MAX_SPEED;
        before[row.mode] = { at, time: now };
        if (!steady) continue;
        counted = true;
        if (good[row.mode].length < FRAMES) {
          good[row.mode].push(row);
          pictures[row.mode] = rowPicture(work, row, rowWidth, rowHeight);
        }
      }
      for (let m = 0; m < MODES; m++) if (!reading.rows.some((r) => r.mode === m)) before[m] = undefined;
      // With a label each, the ones in view can be done while others haven't been shown yet
      const inViewDone = reading.rows.every((r) => good[r.mode].length >= FRAMES);
      status = !counted && tooSmall ? "closer" : inViewDone && together === 1 ? "next" : "hold";
      drawBoxes(reading, counted);
      counts = good.map((g) => g.length);
      if (good.every((g) => g.length >= FRAMES)) {
        finish({
          measured: good.map((g) => g[0].measured.map((_, i) => median(g.map((r) => r.measured[i])))),
          marks: reading.marks,
          width: rowWidth,
          overlay: stackPictures(pictures.filter((p) => p !== undefined)),
          paperEvenness: median(good.flat().map((r) => r.paperEvenness)),
        });
        return;
      }
    }
    timer = setTimeout(analyse, 60);
  };

  // The Android back button closes the camera (index.ts sends "app:back" when no modal or menu is open)
  const onBack = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    finish();
  };

  onMount(async () => {
    window.addEventListener("app:back", onBack, { capture: true });
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      finish(undefined, e);
      return;
    }
    if (stopped) {
      // Closed while the permission prompt was up
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const track = stream.getVideoTracks()[0];
    // Zoom and focus mode aren't in TypeScript's DOM types yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caps = (track.getCapabilities?.() ?? {}) as any;
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] }).catch(() => {});
    }
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const zoom = Math.max(caps.zoom.min, Math.min(caps.zoom.max, ZOOM));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      track.applyConstraints({ advanced: [{ zoom } as any] }).catch(() => {});
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    status = "search";
    analyse();
  });

  onDestroy(() => {
    window.removeEventListener("app:back", onBack, { capture: true });
    stop();
  });
</script>

<div class="camera" role="dialog" aria-modal="true" aria-label={$tr("calibration.auto.camera")}>
  <!-- Hidden until frames arrive: before that the Android WebView draws a grey box with a play button. The
       transparent 1×1 poster replaces that box in case it's painted anyway -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={video}
    class:playing
    playsinline
    muted
    poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    onplaying={() => (playing = true)}></video>
  <!-- The boxes being measured, over the whole frame (both are fitted into the screen the same way) -->
  <canvas bind:this={boxes}></canvas>

  <div class="top">
    <button class="round" onclick={() => finish()} aria-label={$tr("editor.scan.close")}>
      <MdIcon icon="close" />
    </button>
  </div>

  <div class="bottom">
    <div class="status">
      {#if status === "starting"}
        {$tr("editor.scan.starting")}
      {:else if status === "closer"}
        {$tr("calibration.auto.cam.closer")}
      {:else if status === "corrected"}
        {$tr("calibration.auto.corrected")}
      {:else if status === "hold"}
        {$tr("calibration.auto.cam.hold")}
      {:else if status === "next" || (together === 1 && counts.some((c) => c >= FRAMES))}
        {$tr("calibration.auto.cam.next")}
      {:else}
        {$tr(together === 1 ? "calibration.auto.cam.hint.labels" : "calibration.auto.cam.hint")}
      {/if}
    </div>
    <!-- How far every row is: on a roll they fill together, with a label each one after another -->
    <div class="rows" aria-hidden="true">
      {#each counts as c, i (i)}
        <div class="row" class:done={c >= FRAMES}><div style:width="{(100 * Math.min(c, FRAMES)) / FRAMES}%"></div></div>
      {/each}
    </div>
  </div>
</div>

<style>
  .camera {
    position: fixed;
    inset: 0;
    z-index: 3000;
    background: #000;
    color: #fff;
  }

  video,
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  video {
    visibility: hidden;
  }

  video.playing {
    visibility: visible;
  }

  canvas {
    pointer-events: none;
  }

  .top {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 12px);
    left: 12px;
  }

  .round {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .bottom {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(env(safe-area-inset-bottom) + 24px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 0 24px;
  }

  .rows {
    display: flex;
    gap: 6px;
    width: min(100%, 300px);
  }

  .row {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.3);
    overflow: hidden;
  }

  .row > div {
    height: 100%;
    background: #fff;
  }

  .row.done > div {
    background: #4cd964;
  }

  .status {
    background: rgba(0, 0, 0, 0.55);
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 15px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
