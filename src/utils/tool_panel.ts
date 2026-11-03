/**
 * Gestures for the bottom tool panel: swiping its header sideways scrolls the tool row below it (with momentum),
 * dragging the header up or down expands or collapses the panel.
 */

/** Movement in px before a drag picks its axis; below this it stays a tap */
const SLOP = 8;
/** Vertical drag in px that expands or collapses the panel */
const EXPAND_DISTANCE = 24;
/** Fraction of the glide speed kept per 16 ms frame */
const FRICTION = 0.95;

interface PanelDragOptions {
  /** The row to scroll; looked up on every drag, it changes with the selection */
  row: () => HTMLElement | null | undefined;
  onExpand: (expand: boolean) => void;
}

export const panelDrag = (node: HTMLElement, options: PanelDragOptions) => {
  let opts = options;
  let pointerId: number | undefined;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  let axis: "x" | "y" | undefined;
  let row: HTMLElement | null | undefined;
  /** Recent [time, x] samples for the release speed */
  let samples: [number, number][] = [];
  let glideFrame = 0;

  const stopGlide = () => {
    cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  };

  const glide = (el: HTMLElement, speed: number) => {
    let last = performance.now();
    // scrollLeft may round to whole pixels, keep the exact position here
    let pos = el.scrollLeft;
    const max = el.scrollWidth - el.clientWidth;
    const step = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      pos = Math.min(Math.max(pos - speed * dt, 0), max);
      el.scrollLeft = pos;
      speed *= Math.pow(FRICTION, dt / 16);
      // stop when slow or at either end
      if (Math.abs(speed) < 0.02 || pos === 0 || pos === max) {
        glideFrame = 0;
        return;
      }
      glideFrame = requestAnimationFrame(step);
    };
    glideFrame = requestAnimationFrame(step);
  };

  /** A drag ends with a click on the button it started on; swallow it */
  const swallowClick = () => {
    const block = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", block, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", block, { capture: true }), 0);
  };

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) return;
    stopGlide();
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    axis = undefined;
    row = opts.row();
    startScroll = row?.scrollLeft ?? 0;
    samples = [[e.timeStamp, e.clientX]];
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (axis === undefined) {
      if (Math.hypot(dx, dy) < SLOP) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      node.setPointerCapture(e.pointerId);
    }

    if (axis === "x" && row) {
      row.scrollLeft = startScroll - dx;
      samples.push([e.timeStamp, e.clientX]);
      const cutoff = e.timeStamp - 100;
      while (samples.length > 2 && samples[0][0] < cutoff) samples.shift();
    }
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = undefined;
    if (axis === undefined) return;

    swallowClick();

    if (axis === "x" && row && e.type === "pointerup") {
      const [t0, x0] = samples[0];
      const dt = e.timeStamp - t0;
      // a finger that stopped before lifting doesn't glide
      if (dt > 0 && e.timeStamp - samples[samples.length - 1][0] < 60) {
        glide(row, (e.clientX - x0) / dt);
      }
    } else if (axis === "y") {
      const dy = e.clientY - startY;
      if (dy <= -EXPAND_DISTANCE) opts.onExpand(true);
      else if (dy >= EXPAND_DISTANCE) opts.onExpand(false);
    }
  };

  node.addEventListener("pointerdown", onDown);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp);
  node.addEventListener("pointercancel", onUp);

  return {
    update(newOptions: PanelDragOptions) {
      opts = newOptions;
    },
    destroy() {
      stopGlide();
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
    },
  };
};

/** Reports whether a horizontally scrolling row has more content to the left and to the right */
export const scrollEdges = (node: HTMLElement, onChange: (more: { start: boolean; end: boolean }) => void) => {
  let cb = onChange;
  const check = () => {
    const max = node.scrollWidth - node.clientWidth;
    cb({ start: node.scrollLeft > 1, end: node.scrollLeft < max - 1 });
  };

  const resize = new ResizeObserver(check);
  resize.observe(node);
  // tools come and go with the selection, their widths change with values
  const mutations = new MutationObserver(() => requestAnimationFrame(check));
  mutations.observe(node, { childList: true, subtree: true, characterData: true });
  node.addEventListener("scroll", check, { passive: true });
  check();

  return {
    update(newOnChange: typeof onChange) {
      cb = newOnChange;
    },
    destroy() {
      resize.disconnect();
      mutations.disconnect();
      node.removeEventListener("scroll", check);
      cb({ start: false, end: false });
    },
  };
};

/**
 * Run a change that resizes the tool row (expanding or collapsing the panel) as a soft animation: the row grows or
 * shrinks to its new height and the tools, already in their new layout, fade in. Instant with reduced motion.
 */
export const animateRowResize = async (row: HTMLElement | null | undefined, change: () => Promise<void> | void) => {
  if (!row || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await change();
    return;
  }

  // Mid-animation this is the animated height, so a quick second tap reverses smoothly from where it is
  const from = row.getBoundingClientRect().height;
  row.getAnimations().forEach((a) => a.cancel());
  await change();
  const to = row.getBoundingClientRect().height;
  if (Math.abs(to - from) < 1) return;

  const overflow = row.style.overflow;
  row.style.overflow = "hidden";
  const resize = row.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: 280,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  });
  row.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, delay: 40, easing: "ease-out", fill: "backwards" });
  const restore = () => {
    row.style.overflow = overflow;
  };
  resize.finished.then(restore, restore);
};
