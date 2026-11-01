<script lang="ts">
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import type { MaterialIcon } from "material-icons";

  interface Props {
    /** Battery percent, or 1..4 bars on firmware that reports levels */
    level: number;
    charging?: boolean;
    showPercent?: boolean;
  }

  let { level, charging = false, showPercent = false }: Props = $props();

  const percent = $derived(level > 4 ? Math.min(100, level) : level * 25);

  const icon = $derived.by<MaterialIcon>(() => {
    if (charging) return "battery_charging_full";
    if (percent > 87) return "battery_full";
    if (percent > 62) return "battery_5_bar";
    if (percent > 37) return "battery_3_bar";
    if (percent > 12) return "battery_2_bar";
    return "battery_alert";
  });
</script>

<span class="battery" class:low={percent <= 12 && !charging} title="{percent}%">
  <MdIcon {icon} class="r-90" />
  {#if showPercent && level > 4}<span class="pct">{percent}%</span>{/if}
</span>

<style>
  .battery {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    color: var(--ink-secondary);
    white-space: nowrap;
  }
  .battery.low {
    color: var(--status-danger);
  }
  .pct {
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }
</style>
