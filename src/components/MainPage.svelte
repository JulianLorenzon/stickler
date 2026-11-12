<script lang="ts">
  import BrowserWarning from "$/components/basic/BrowserWarning.svelte";
  import LabelDesigner from "$/components/LabelDesigner.svelte";
  import PrinterConnector from "$/components/PrinterConnector.svelte";
  import { locale, locales, tr } from "$/utils/i18n";
  import DebugStuff from "$/components/DebugStuff.svelte";
  import AboutDialog from "$/components/AboutDialog.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import PrinterSheet from "$/components/PrinterSheet.svelte";
  import CalibrationPage from "$/components/CalibrationPage.svelte";
  import { printerSheetOpen } from "$/stores";

  // eslint-disable-next-line no-undef
  const appVersion = __APP_VERSION__;
  // eslint-disable-next-line no-undef
  const appCommit = __APP_COMMIT__;
  // eslint-disable-next-line no-undef
  const buildDate = __BUILD_DATE__;

  let debugStuffShow = $state<boolean>(false);
  let aboutShow = $state<boolean>(false);
  let calibrationShow = $state<boolean>(false);
</script>

<div class="app-shell">
  <header class="app-bar">
    <img src="{import.meta.env.BASE_URL}logo.png" alt="" class="logo" />
    <span class="brand">Stickler</span>

    <div class="ms-auto d-flex align-items-center gap-1">
      <PrinterConnector />

      <div class="dropdown">
        <button class="btn icon-btn" data-bs-toggle="dropdown" aria-label={$tr("main.menu")}>
          <MdIcon icon="more_vert" />
        </button>
        <div class="dropdown-menu dropdown-menu-end app-menu">
          <div class="px-3 py-2">
            <label class="form-label small text-secondary mb-1" for="app-locale">
              <MdIcon icon="translate" />
              {$tr("main.language")}
            </label>
            <select id="app-locale" class="form-select form-select-sm" bind:value={$locale}>
              {#each Object.entries(locales) as [key, name] (key)}
                <option value={key}>{name}</option>
              {/each}
            </select>
          </div>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" onclick={() => (calibrationShow = true)}>
            <MdIcon icon="tune" />
            {$tr("calibration.title")}
          </button>
          <button class="dropdown-item" onclick={() => (debugStuffShow = true)}>
            <MdIcon icon="bug_report" />
            {$tr("debug.title")}
          </button>
          <button class="dropdown-item" onclick={() => (aboutShow = true)}>
            <MdIcon icon="info" />
            {$tr("about.title")}
          </button>
          <div class="dropdown-divider"></div>
          <div class="px-3 pb-1 small text-secondary">
            <div>{$tr("main.about")}</div>
            <div class="build-info">
              {#if appVersion}{appVersion} ·{/if}
              {#if appCommit}{appCommit.slice(0, 8)} ·{/if}
              {$tr("main.built")}
              {buildDate}
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>

  <BrowserWarning />

  <main class="app-main">
    <LabelDesigner />
  </main>
</div>

<!-- Before the printer sheet, which it can open: a later modal lies on top, and the back button closes the last one -->
{#if calibrationShow}
  <CalibrationPage bind:show={calibrationShow} />
{/if}

{#if $printerSheetOpen}
  <PrinterSheet bind:show={$printerSheetOpen} />
{/if}

{#if debugStuffShow}
  <DebugStuff bind:show={debugStuffShow} />
{/if}

{#if aboutShow}
  <AboutDialog bind:show={aboutShow} />
{/if}

<style>
  .app-shell {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .app-bar {
    position: sticky;
    top: 0;
    z-index: 1020;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 3.5rem;
    padding: 0 0.5rem 0 0.875rem;
    background: var(--surface-0);
    border-bottom: 1px solid var(--border-soft);
  }

  .logo {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 6px;
  }

  .brand {
    font-weight: 600;
    font-size: 1.05rem;
    letter-spacing: 0.01em;
  }

  .app-menu {
    min-width: 15rem;
  }

  .build-info {
    font-variant-numeric: tabular-nums;
  }

  .app-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
