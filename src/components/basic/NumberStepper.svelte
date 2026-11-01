<script lang="ts">
  import { onDestroy } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import type { MaterialIcon } from "$/styles/mdi_icons";

  interface Props {
    value: number;
    step: number;
    min?: number;
    max?: number;
    /** Decimals shown in the field */
    decimals?: number;
    icon?: MaterialIcon;
    iconClass?: string;
    unit?: string;
    title?: string;
    onChange: (value: number) => void;
  }

  let { value, step, min = -Infinity, max = Infinity, decimals = 0, icon, iconClass, unit, title, onChange }: Props =
    $props();

  const HOLD_DELAY_MS = 400;
  const REPEAT_MS = 70;

  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  // Set once a press has started repeating
  let held = false;
  // Shown value; follows `value` but also updates right away while stepping
  let current = $derived(value);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  // Round to the step's precision so 0.1 steps don't drift into 1.2000000000000002
  const round = (v: number) => Number(v.toFixed(Math.max(decimals, 4)));

  const apply = (dir: 1 | -1) => {
    const next = clamp(round(current + dir * step));
    if (next === current) {
      stopHold();
      return;
    }
    current = next;
    onChange(next);
  };

  const stopHold = () => {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  };

  /**
   * Keep stepping while the button is held. A short tap steps in `onClick` instead, on release: the steppers sit in
   * toolbars that scroll sideways, and a swipe that starts on a button must scroll, not step. The browser cancels
   * the pointer when it starts scrolling, which stops the hold, and sends no click.
   */
  const startHold = (e: PointerEvent, dir: 1 | -1) => {
    if (e.button !== 0) return;
    stopHold();
    held = false;
    const repeat = () => {
      held = true;
      apply(dir);
      holdTimer = setTimeout(repeat, REPEAT_MS);
    };
    holdTimer = setTimeout(repeat, HOLD_DELAY_MS);
  };

  const onClick = (e: MouseEvent, dir: 1 | -1) => {
    stopHold();
    // The click that ends a hold doesn't add a step; keyboard clicks (detail 0) always do
    if (held && e.detail !== 0) {
      held = false;
      return;
    }
    apply(dir);
  };

  const onInput = (e: Event & { currentTarget: HTMLInputElement }) => {
    const v = parseFloat(e.currentTarget.value.replace(",", "."));
    if (isNaN(v)) return;
    const next = clamp(v);
    current = next;
    onChange(next);
  };

  onDestroy(stopHold);
</script>

<div class="num-stepper" {title}>
  {#if icon}
    <span class="num-stepper-icon"><MdIcon {icon} class={iconClass} /></span>
  {/if}
  <button
    type="button"
    class="btn btn-sm btn-secondary"
    disabled={current <= min}
    onpointerdown={(e) => startHold(e, -1)}
    onpointerup={stopHold}
    onpointerleave={stopHold}
    onpointercancel={stopHold}
    oncontextmenu={(e) => e.preventDefault()}
    onclick={(e) => onClick(e, -1)}>
    <MdIcon icon="remove" />
  </button>
  <input
    class="form-control form-control-sm"
    type="text"
    inputmode="decimal"
    value={current.toFixed(decimals)}
    onchange={onInput}
    onfocus={(e) => e.currentTarget.select()} />
  {#if unit}
    <span class="num-stepper-unit">{unit}</span>
  {/if}
  <button
    type="button"
    class="btn btn-sm btn-secondary"
    disabled={current >= max}
    onpointerdown={(e) => startHold(e, 1)}
    onpointerup={stopHold}
    onpointerleave={stopHold}
    onpointercancel={stopHold}
    oncontextmenu={(e) => e.preventDefault()}
    onclick={(e) => onClick(e, 1)}>
    <MdIcon icon="add" />
  </button>
</div>

<style>
  .num-stepper {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .num-stepper-icon {
    padding: 0 0.25rem 0 0.375rem;
    color: var(--ink-secondary);
  }

  .num-stepper .btn {
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .num-stepper input {
    width: 3.25rem;
    padding: 0.25rem 0.125rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    background: transparent;
    border-color: transparent;
  }

  .num-stepper-unit {
    margin-left: -0.5rem;
    padding-right: 0.25rem;
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }
</style>
