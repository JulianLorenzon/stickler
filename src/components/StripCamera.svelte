<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import { readGreyStrip, type StripReading } from "$/utils/grey_strip";
  import { stripOverlay, strokeQuads, type StripCapture } from "$/utils/strip_camera";

  type Props = {
    /** Width and row height of the printed strip, dots */
    width: number;
    rowHeight: number;
    /** Called once: the strip as read, undefined if the user closed the camera, or the error if the camera failed */
    onDone: (result: StripCapture | undefined, error?: unknown) => void;
  };

  let { width, rowHeight, onDone }: Props = $props();

  /**
   * Our own camera instead of the phone's camera app: video frames come without HDR, sharpening or scene modes, which
   * shift greys, and several frames can be put together. The resolution is plenty: the patches are averaged anyway.
   */
  const FRAMES = 16;
  /** Frames are read at up to this many pixels on the long side: full HD as it comes */
  const SIDE = 1920;
  /**
   * Frame pixels per printer dot below which the strip is too small in the picture. The greys read the same down to
   * 0.8 (tools/dot-gain), but the boxes sit more surely with a little more; at 1 the print is over a third of the
   * frame's width.
   */
  const MIN_SCALE = 1;
  /** The outline shows the print at this part of the frame's short side: where to hold it, not a requirement */
  const GUIDE_WIDTH = 0.55;
  /**
   * Camera zoom, where the phone has it: the print fills the outline from twice as far away, where every phone
   * focuses and the phone's shadow isn't on the paper
   */
  const ZOOM = 2;
  /** A frame only counts when the strip moved slower than this since the frame before (dots per second; 8 dots = 1 mm) */
  const MAX_SPEED = 100;

  let video: HTMLVideoElement;
  let boxes: HTMLCanvasElement;
  let stream: MediaStream | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let playing = $state(false);
  let status = $state<"starting" | "search" | "closer" | "hold">("starting");
  let count = $state(0);

  const work = document.createElement("canvas");
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  let good: StripReading[] = [];
  let lastGood = 0;
  /** Where the strip was in the frame before, and when, to tell a steady hand from a moving one */
  let before: { marks: [number, number][]; at: number } | undefined;

  /** Where to hold the print, about: its outline with the four rows of patches, in the middle of the frame */
  const drawGuide = (ctx: CanvasRenderingContext2D, w: number, h: number, counting: boolean) => {
    const rows = 4;
    const gw = GUIDE_WIDTH * Math.min(w, h);
    const gh = (gw * rows * rowHeight) / width;
    const x = (w - gw) / 2, y = (h - gh) / 2;
    ctx.lineWidth = Math.max(2, w / 300);
    ctx.strokeStyle = counting ? "#4cd964" : "rgba(255, 255, 255, 0.85)";
    ctx.setLineDash([ctx.lineWidth * 5, ctx.lineWidth * 3]);
    ctx.strokeRect(x, y, gw, gh);
    ctx.setLineDash([]);
    if (counting) return;
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    for (let r = 0; r < rows; r++) ctx.fillRect(x + gw * 0.02, y + (gh / rows) * (r + 0.24), gw * 0.96, (gh / rows) * 0.56);
  };

  /** Middle of the first and the last row's solid patch */
  const marksOf = (reading: StripReading): [number, number][] =>
    [reading.patchBoxes[9], reading.patchBoxes[reading.patchBoxes.length - 1]].map((q) => [
      (q[0][0] + q[2][0]) / 2,
      (q[0][1] + q[2][1]) / 2,
    ]);

  const drawBoxes = (canvas: HTMLCanvasElement, reading: StripReading | undefined, live: boolean, counting = false) => {
    const ctx = canvas.getContext("2d")!;
    if (live) {
      canvas.width = work.width;
      canvas.height = work.height;
      drawGuide(ctx, canvas.width, canvas.height, counting);
    }
    if (!reading) return;
    ctx.lineWidth = Math.max(2, canvas.width / 400);
    strokeQuads(ctx, reading.paperBoxes, "#2a9df4");
    strokeQuads(ctx, reading.patchBoxes, "#e53935");
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

  /** Read the current frame; enough good ones in a row make the result */
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
    const reading = readGreyStrip(wctx.getImageData(0, 0, work.width, work.height), width, rowHeight);
    const now = performance.now();

    if (typeof reading === "string") {
      // A missed frame or two (focus hunting, a shaky hand) doesn't throw away what's collected
      if (now - lastGood > 1500) good = [];
      before = undefined;
      status = good.length > 0 ? "hold" : "search";
      drawBoxes(boxes, undefined, true);
    } else if (reading.scale < MIN_SCALE) {
      good = [];
      before = undefined;
      status = "closer";
      drawBoxes(boxes, reading, true);
    } else {
      // Blurred frames read too grey: only frames where the strip barely moved since the one before count
      const marks = marksOf(reading);
      const steady =
        before !== undefined &&
        Math.max(...marks.map((m, i) => Math.hypot(m[0] - before!.marks[i][0], m[1] - before!.marks[i][1]))) /
          reading.scale / ((now - before.at) / 1000) < MAX_SPEED;
      before = { marks, at: now };
      // (and a strip is the same kind in every frame)
      if (good.length > 0 && good[0].marks !== reading.marks) good = [];
      if (steady) good.push(reading);
      lastGood = now;
      status = "hold";
      drawBoxes(boxes, reading, true, steady);
      if (good.length >= FRAMES) {
        finish({
          measured: reading.measured.map((row, r) => row.map((_, i) => median(good.map((g) => g.measured[r][i])))),
          marks: reading.marks,
          overlay: stripOverlay(work, reading),
          paperEvenness: median(good.map((g) => g.paperEvenness)),
        });
        return;
      }
    }
    count = good.length;
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
      {:else if status === "hold"}
        {$tr("calibration.auto.cam.hold")} {count}/{FRAMES}
      {:else}
        {$tr("calibration.auto.cam.hint")}
      {/if}
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
    justify-content: center;
    padding: 0 24px;
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
