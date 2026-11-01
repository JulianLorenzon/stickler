<script lang="ts">
  import { Utils } from "$/lib/printer";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { detectAntiFingerprinting } from "$/utils/browsers";
  let caps = Utils.getAvailableTransports();

  let antiFingerprinting = detectAntiFingerprinting();
  let isMobile = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  let dismissed = $state(sessionStorage.getItem("browser_warning_dismissed") === "1");

  const dismiss = () => {
    dismissed = true;
    sessionStorage.setItem("browser_warning_dismissed", "1");
  };
</script>

{#if !caps.webBluetooth && !caps.capacitorBle && !dismissed}
  <div class="notice" role="alert">
    <MdIcon icon="bluetooth_disabled" />
    <span class="flex-grow-1">
      {#if isMobile}
        {$tr("browser_warning.mobile")}
      {:else}
        {$tr("browser_warning.lines.first")}
        {$tr("browser_warning.lines.second")}
      {/if}
    </span>
    <button class="btn-close btn-sm" aria-label="Dismiss" onclick={dismiss}></button>
  </div>
{/if}

{#if antiFingerprinting}
  <div class="notice" role="alert">
    <MdIcon icon="warning" />
    <span class="flex-grow-1">{$tr("browser_warning.fingerprinting")}</span>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin: 0.5rem 0.75rem 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    line-height: 1.35;
    border-radius: var(--radius-md);
    background: var(--bs-warning-bg-subtle);
    border: 1px solid var(--bs-warning-border-subtle);
    color: var(--bs-warning-text-emphasis);
  }

  .notice .btn-close {
    flex: none;
  }
</style>
