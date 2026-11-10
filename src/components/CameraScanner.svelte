<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import type { WorkerReply, ZxingResult } from "$/utils/scan_worker";
  import { readCodeFromImage } from "$/utils/code_scanner";

  type Props = {
    /** Called once: the code read, undefined if the user closed the scanner, or the error if the camera failed */
    onDone: (result: ZxingResult | undefined, error?: unknown) => void;
  };
  let { onDone }: Props = $props();

  let video: HTMLVideoElement;
  let frame: HTMLDivElement;
  let stream: MediaStream | undefined;
  let track: MediaStreamTrack | undefined;
  let worker: Worker | undefined;
  let stopped = false;

  let ready = $state(false);
  let playing = $state(false);
  let found = $state(false);
  let torchSupported = $state(false);
  let torchOn = $state(false);
  let zoomRange = $state<{ min: number; max: number; step: number } | undefined>();
  let zoom = $state(1);
  /** Reading a picture picked with "From image", and what came of it */
  let readingImage = $state(false);
  let imageMessage = $state("");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  /** The part of the video to decode: the viewfinder plus a margin, in video pixels (shown with object-fit: cover) */
  const cropRect = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(video.clientWidth / vw, video.clientHeight / vh);
    const offX = (vw * scale - video.clientWidth) / 2;
    const offY = (vh * scale - video.clientHeight) / 2;
    const f = frame.getBoundingClientRect();
    const v = video.getBoundingClientRect();
    const marginX = f.width * 0.15;
    const marginY = f.height * 0.25;
    const x = Math.max(0, (f.left - v.left - marginX + offX) / scale);
    const y = Math.max(0, (f.top - v.top - marginY + offY) / scale);
    const w = Math.min(vw - x, (f.width + 2 * marginX) / scale);
    const h = Math.min(vh - y, (f.height + 2 * marginY) / scale);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  };

  /** Send the current frame to the worker; its reply asks for the next one, so frames never queue up */
  const grabFrame = () => {
    if (stopped) return;
    if (video.readyState < 2 || video.videoWidth === 0) {
      requestAnimationFrame(grabFrame);
      return;
    }
    const { x, y, w, h } = cropRect();
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    worker!.postMessage(img, [img.data.buffer]);
  };

  const stop = () => {
    stopped = true;
    worker?.terminate();
    stream?.getTracks().forEach((t) => t.stop());
  };

  let finished = false;
  const finish = (result?: ZxingResult, error?: unknown) => {
    if (finished) return;
    finished = true;
    stop();
    onDone(result, error);
  };

  // The Android back button closes the scanner (index.ts sends "app:back" when no modal or menu is open)
  const onBack = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    finish();
  };

  onMount(async () => {
    window.addEventListener("app:back", onBack, { capture: true });

    worker = new Worker(new URL("../utils/scan_worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const result = e.data.result;
      if (result) {
        // Show the green frame for a moment so the user sees it worked
        found = true;
        setTimeout(() => finish(result), 250);
      } else {
        requestAnimationFrame(grabFrame);
      }
    };

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

    // Torch, zoom and focus mode aren't in TypeScript's DOM types yet
    track = stream.getVideoTracks()[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caps = (track.getCapabilities?.() ?? {}) as any;
    torchSupported = caps.torch === true;
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      zoomRange = { min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zoom = (track.getSettings() as any).zoom ?? caps.zoom.min;
    }
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] }).catch(() => {});
    }

    video.srcObject = stream;
    await video.play().catch(() => {});
    ready = true;
    grabFrame();
  });

  onDestroy(() => {
    window.removeEventListener("app:back", onBack, { capture: true });
    stop();
  });

  const toggleTorch = async () => {
    torchOn = !torchOn;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await track?.applyConstraints({ advanced: [{ torch: torchOn } as any] });
    } catch {
      torchOn = !torchOn;
    }
  };

  /** Read a code from a picture instead, e.g. a screenshot of Android's Wi-Fi share QR code */
  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      readingImage = true;
      imageMessage = "";
      try {
        const result = await readCodeFromImage(file);
        if (result) {
          found = true;
          setTimeout(() => finish(result), 250);
          return;
        }
        imageMessage = $tr("editor.scan.image.none");
      } catch (e) {
        console.error(e);
        imageMessage = $tr("editor.scan.image.failed");
      } finally {
        readingImage = false;
      }
    };
    input.click();
  };

  const onZoom = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    track?.applyConstraints({ advanced: [{ zoom } as any] }).catch(() => {});
  };
</script>

<div class="scanner" role="dialog" aria-modal="true" aria-label={$tr("editor.scan.title")}>
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

  <div class="shade">
    <div class="frame" class:found bind:this={frame}></div>
  </div>

  <div class="top">
    <button class="round" onclick={() => finish()} aria-label={$tr("editor.scan.close")}>
      <MdIcon icon="close" />
    </button>
    {#if torchSupported}
      <button class="round" class:on={torchOn} onclick={toggleTorch} aria-label={$tr("editor.scan.flashlight")}>
        <MdIcon icon={torchOn ? "flashlight_on" : "flashlight_off"} />
      </button>
    {/if}
  </div>

  <div class="bottom">
    <div class="status">
      {#if readingImage}
        {$tr("editor.scan.image.reading")}
      {:else if imageMessage}
        {imageMessage}
      {:else}
        {ready ? $tr("editor.scan.hint") : $tr("editor.scan.starting")}
      {/if}
    </div>
    {#if zoomRange}
      <div class="zoom">
        <MdIcon icon="zoom_out" />
        <input
          type="range"
          min={zoomRange.min}
          max={zoomRange.max}
          step={zoomRange.step}
          bind:value={zoom}
          oninput={onZoom}
          aria-label={$tr("editor.scan.zoom")} />
        <MdIcon icon="zoom_in" />
      </div>
    {/if}
    <button class="from-image" onclick={pickImage} disabled={readingImage}>
      <MdIcon icon="image" />
      {$tr("editor.scan.image")}
    </button>
  </div>
</div>

<style>
  .scanner {
    position: fixed;
    inset: 0;
    z-index: 3000;
    background: #000;
    color: #fff;
  }

  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    visibility: hidden;
  }

  video.playing {
    visibility: visible;
  }

  .shade {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  /* Wide enough for barcodes, tall enough for QR codes; the shadow dims everything around it */
  .frame {
    width: min(80vw, 420px);
    height: min(55vw, 290px);
    border-radius: 16px;
    border: 3px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5);
    transition: border-color 0.15s;
  }

  .frame.found {
    border-color: #4cd964;
  }

  .top {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 12px);
    left: 12px;
    right: 12px;
    display: flex;
    justify-content: space-between;
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

  .round.on {
    background: #fff;
    color: #000;
  }

  .bottom {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(env(safe-area-inset-bottom) + 24px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 0 24px;
  }

  .from-image {
    min-height: 48px;
    padding: 0 20px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.6);
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .from-image:disabled {
    opacity: 0.6;
  }

  .status {
    background: rgba(0, 0, 0, 0.55);
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 15px;
    text-align: center;
  }

  .zoom {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(100%, 360px);
  }

  .zoom input {
    flex: 1;
    accent-color: var(--accent);
  }
</style>
