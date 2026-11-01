<script lang="ts">
  import AppModal from "$/components/basic/AppModal.svelte";
  import { appConfig, printerClient } from "$/stores";
  import { tr } from "$/utils/i18n";
  import { CLIENT_DEFAULTS } from "$/lib/printer";

  let { show = $bindable() } = $props();

  // New clients pick the value up in initClient; this applies it to the current one right away
  $effect(() => {
    $printerClient?.setPacketInterval($appConfig.packetIntervalMs ?? CLIENT_DEFAULTS.packetIntervalMs);
  });
</script>

<AppModal title={$tr("debug.title")} bind:show>
  <p class="small text-secondary">{$tr("debug.intro")}</p>

  <label class="form-label small mb-1" for="debug-chunk-delay">{$tr("debug.chunk_delay")}</label>
  <div class="input-group flex-nowrap input-group-sm mb-1">
    <input
      id="debug-chunk-delay"
      class="form-control"
      type="number"
      min="1"
      placeholder={`${CLIENT_DEFAULTS.packetIntervalMs}`}
      bind:value={$appConfig.packetIntervalMs} />
    <span class="input-group-text">ms</span>
    <button class="btn btn-outline-secondary" onclick={() => ($appConfig.packetIntervalMs = undefined)}
      >{$tr("debug.reset")}</button>
  </div>
  <div class="small text-secondary mb-3">{$tr("debug.chunk_delay.help")}</div>

  <label class="form-label small mb-1" for="debug-label-pause">{$tr("debug.label_pause")}</label>
  <div class="input-group flex-nowrap input-group-sm mb-1" role="group">
    <input
      id="debug-label-pause"
      class="form-control"
      type="number"
      min="0"
      placeholder="0"
      bind:value={$appConfig.pageDelay} />
    <span class="input-group-text">ms</span>
    <button class="btn btn-outline-secondary" onclick={() => ($appConfig.pageDelay = undefined)}
      >{$tr("debug.reset")}</button>
  </div>
  <div class="small text-secondary">{$tr("debug.label_pause.help")}</div>
</AppModal>
