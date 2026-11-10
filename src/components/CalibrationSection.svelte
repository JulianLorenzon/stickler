<script lang="ts">
  import type { PrinterModelMeta } from "$/lib/printer";
  import { appConfig, printerClient } from "$/stores";
  import type { PreviewProps, PreviewPropsOffset } from "$/types";
  import { DOTS_PER_MM } from "$/defaults";
  import { tr } from "$/utils/i18n";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { dotModelFor } from "$/utils/print_sim";
  import { Toasts } from "$/utils/toasts";
  import { Utils } from "$/lib/printer";
  import {
    drawOffsetLabel,
    formatMm,
    greyTestPages,
    hasLabelGaps,
    offsetPlan,
    printTestImage,
    testLabelFor,
    withOffset,
    type TestPrintOptions,
  } from "$/utils/test_prints";
  import MdIcon from "$/components/basic/MdIcon.svelte";

  /** Test prints for the connected printer, shown in the printer sheet */
  let { meta }: { meta: PrinterModelMeta } = $props();

  const printer = $derived(meta.driver);
  const gaps = $derived(hasLabelGaps(meta));
  const hasModel = $derived(dotModelFor(printer) !== undefined);

  let busy = $state(false);
  let corrected = $state(false);
  let offsetStep = $state<number>(DOTS_PER_MM);
  /** Offsets of the last printed strip, to pick from */
  let offsetsPrinted = $state<number[]>([]);

  const loadPreviewProps = (): PreviewProps => {
    try {
      return LocalStoragePersistence.loadSavedPreviewProps() ?? {};
    } catch {
      return {};
    }
  };

  let offset = $state<PreviewPropsOffset>(loadPreviewProps().offset ?? { x: 0, y: 0, offsetType: "inner" });
  const plan = $derived(offsetPlan(offset.x, offsetStep));

  /** Print settings: what the print preview keeps for next time, else the printer's defaults */
  const printOptions = (label: { direction: TestPrintOptions["direction"] }): TestPrintOptions => {
    const saved = loadPreviewProps();
    return {
      direction: label.direction,
      density: saved.density ?? meta.densityDefault,
      labelType: saved.labelType !== undefined && meta.paperTypes.includes(saved.labelType) ? saved.labelType : meta.paperTypes[0],
      printTaskName: saved.printTaskName ?? $printerClient.getPrintTaskType() ?? "B1",
    };
  };

  const testLabel = () => testLabelFor(printer, meta, LocalStoragePersistence.loadLastLabelProps());

  const pageDelay = async (index: number, total: number) => {
    const delay = $appConfig.pageDelay;
    if (delay !== undefined && delay > 0 && index < total - 1) await Utils.sleep(delay);
  };

  const printPages = async (pages: HTMLCanvasElement[], opts: TestPrintOptions) => {
    busy = true;
    try {
      for (let i = 0; i < pages.length; i++) {
        await printTestImage($printerClient, pages[i], opts);
        await pageDelay(i, pages.length);
      }
    } catch (e) {
      console.error(e);
      Toasts.error(e);
    } finally {
      busy = false;
    }
  };

  const printGreyTest = () => {
    const label = testLabel();
    const pages = greyTestPages(printer, meta, label, corrected && hasModel);
    // The offset is for labels; a strip on a roll prints as it is
    return printPages(gaps ? pages.map((p) => withOffset(p, offset)) : pages, printOptions(label));
  };

  const printOffsetStrip = () => {
    const label = testLabel();
    const values = [...plan];
    offsetsPrinted = values;
    const pages = values.map((x, i) => withOffset(drawOffsetLabel(label.width, label.height, x, i), { ...offset, x }));
    return printPages(pages, printOptions(label));
  };

  /** An offset picked from a test strip is a calibration: the print preview uses it from now on */
  const useOffset = (x: number) => {
    offset = { ...offset, x };
    try {
      LocalStoragePersistence.savePreviewProps({ ...loadPreviewProps(), offset });
      Toasts.message($tr("calibration.offset.saved"));
    } catch (e) {
      Toasts.error(e);
    }
  };
</script>

<div class="calibration">
  <div class="title">{$tr("preview.group.grey")}</div>
  <p class="hint">{$tr(gaps ? "preview.grey.help" : "preview.grey.help.strip")}</p>
  {#if hasModel}
    <div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" role="switch" id="grey-corrected" bind:checked={corrected} />
      <label class="form-check-label" for="grey-corrected">{$tr("calibration.grey.corrected")}</label>
    </div>
  {:else}
    <p class="hint">{$tr("preview.grey.no_model")}</p>
  {/if}
  <button class="btn btn-secondary w-100" disabled={busy} onclick={printGreyTest}>
    <MdIcon icon="gradient" />
    {$tr("preview.grey.print")}
  </button>

  {#if gaps}
    <div class="title mt-3">{$tr("preview.calibration")}</div>
    <div class="step">
      <span>{$tr("calibration.offset.step")}</span>
      <div class="btn-group" role="group">
        {#each [DOTS_PER_MM / 2, DOTS_PER_MM] as step (step)}
          <button
            class="btn {offsetStep === step ? 'btn-primary' : 'btn-secondary'}"
            onclick={() => (offsetStep = step)}>{step / DOTS_PER_MM} mm</button>
        {/each}
      </div>
    </div>
    <p class="hint">
      {$tr("preview.calibration.help")}
      {plan.map((v) => formatMm(v)).join(" · ")} mm
    </p>
    <button class="btn btn-secondary w-100" disabled={busy} onclick={printOffsetStrip}>
      <MdIcon icon="print" />
      {$tr("preview.calibration.print")}
    </button>

    {#if offsetsPrinted.length > 0}
      <p class="hint mt-2 mb-1">{$tr("preview.calibration.pick")}</p>
      <div class="values">
        {#each offsetsPrinted as v (v)}
          <button class="btn {offset.x === v ? 'btn-primary' : 'btn-secondary'}" onclick={() => useOffset(v)}>
            {formatMm(v)} mm
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  {#if busy}
    <p class="hint mt-2 mb-0"><span class="spinner-border spinner-border-sm"></span> {$tr("calibration.printing")}</p>
  {/if}
</div>

<style>
  .calibration {
    padding-top: 0.25rem;
  }

  .title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-tertiary);
    margin-bottom: 0.25rem;
  }

  .hint {
    font-size: 0.8125rem;
    color: var(--ink-tertiary);
    margin: 0 0 0.5rem;
  }

  .step {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .step .btn,
  .values .btn {
    min-height: 2.75rem;
  }

  .values {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }

  .values .btn {
    padding-left: 0;
    padding-right: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
