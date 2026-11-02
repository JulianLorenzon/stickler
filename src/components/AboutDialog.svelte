<script lang="ts">
  import { onMount } from "svelte";
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import type { LicensesFile } from "$/utils/licenses";

  let { show = $bindable() } = $props();

  // eslint-disable-next-line no-undef
  const appCommit = __APP_COMMIT__;
  // eslint-disable-next-line no-undef
  const buildDate = __BUILD_DATE__;

  const credits: { name: string; by: string; url?: string; license?: string; what: TranslationKey }[] = [
    {
      name: "fichero-printer",
      by: "Hamza (0xMH)",
      url: "https://github.com/0xMH/fichero-printer",
      license: "MIT",
      what: "about.credit.fichero",
    },
    {
      name: "NiimBlue",
      by: "MultiMote",
      url: "https://github.com/MultiMote/niimblue",
      license: "MIT",
      what: "about.credit.niimblue",
    },
    {
      name: "CanvasDither",
      by: "Niels Leenheer",
      url: "https://github.com/NielsLeenheer/CanvasDither",
      license: "MIT",
      what: "about.credit.canvasdither",
    },
    { name: "Werness dithering", by: "Brent Werness, Lucas Pope", what: "about.credit.werness" },
  ];

  /** Compiled into the APK by Gradle, so not in licenses.json */
  const nativeParts: { name: string; license: string; url: string }[] = [
    { name: "AndroidX (AppCompat, Core, WebKit, …)", license: "Apache-2.0", url: "https://developer.android.com/jetpack/androidx" },
    { name: "Apache Cordova (Capacitor compatibility layer)", license: "Apache-2.0", url: "https://cordova.apache.org" },
    { name: "Kotlin standard library, kotlinx.coroutines", license: "Apache-2.0", url: "https://kotlinlang.org" },
  ];

  /** Licence files are wrapped at ~80 columns; join the lines within a paragraph so they fit a phone */
  const reflow = (text: string): string => text.replace(/([^\n])\n(?=[^\n\s])/g, "$1 ");

  let licenses = $state<LicensesFile | undefined>();
  let loadError = $state<boolean>(false);

  onMount(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}licenses.json`);
      if (!res.ok) throw new Error(`${res.status}`);
      licenses = await res.json();
    } catch (e) {
      console.error("licenses.json", e);
      loadError = true;
    }
  });
</script>

<AppModal title={$tr("about.title")} variant="fullscreen" bind:show>
  <div class="app-head">
    <img src="{import.meta.env.BASE_URL}logo.png" alt="" class="logo" />
    <div>
      <div class="fw-semibold">Stickler</div>
      <div class="small text-secondary">{$tr("main.about")}</div>
      <div class="small text-secondary build">
        {#if appCommit}{appCommit.slice(0, 8)} ·{/if}
        {$tr("main.built")}
        {buildDate}
      </div>
    </div>
  </div>

  <h3 class="section-title">{$tr("about.credits")}</h3>
  <ul class="credits">
    {#each credits as c (c.name)}
      <li>
        <div>
          {#if c.url}
            <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a>
          {:else}
            <span class="fw-medium">{c.name}</span>
          {/if}
          <span class="text-secondary">· {c.by}</span>
          {#if c.license}<span class="badge">{c.license}</span>{/if}
        </div>
        <div class="small text-secondary">{$tr(c.what)}</div>
      </li>
    {/each}
  </ul>

  <h3 class="section-title">{$tr("about.license")}</h3>
  <p class="small text-secondary">{$tr("about.license.app")}</p>
  <p class="small">
    {$tr("about.source")}:
    <a href="https://github.com/JulianLorenzon/stickler" target="_blank" rel="noreferrer">github.com/JulianLorenzon/stickler</a>
  </p>
  {#if licenses}
    <details class="license">
      <summary>NOTICE · copyright and MIT notices</summary>
      <pre>{reflow(licenses.notice)}</pre>
    </details>
    <details class="license">
      <summary>LICENSE · GPL-3.0-or-later</summary>
      <pre>{reflow(licenses.app)}</pre>
    </details>
  {/if}

  <h3 class="section-title">{$tr("about.components")}</h3>
  <p class="small text-secondary">{$tr("about.components.help")}</p>
  {#if loadError}
    <div class="alert alert-warning py-2 small">{$tr("about.components.error")}</div>
  {:else if !licenses}
    <div class="small text-secondary">…</div>
  {:else}
    {#each licenses.packages as p (`${p.name}@${p.version}`)}
      <details class="license">
        <summary>
          <span class="name">{p.name}</span>
          <span class="text-secondary">{p.version}</span>
          <span class="badge">{p.license}</span>
        </summary>
        {#if p.url}<a class="small" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>{/if}
        <pre>{reflow(p.text ?? p.license)}</pre>
      </details>
    {/each}
  {/if}

  <h3 class="section-title">{$tr("about.android")}</h3>
  <ul class="credits">
    {#each nativeParts as n (n.name)}
      <li>
        <a href={n.url} target="_blank" rel="noreferrer">{n.name}</a>
        <span class="badge">{n.license}</span>
      </li>
    {/each}
  </ul>
  <p class="small text-secondary">{$tr("about.android.help")}</p>
</AppModal>

<style>
  .app-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .logo {
    width: 3rem;
    height: 3rem;
    border-radius: 10px;
  }

  .build {
    font-variant-numeric: tabular-nums;
  }

  .section-title {
    margin: 1.25rem 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-tertiary);
  }

  .credits {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .badge {
    margin-left: 0.25rem;
    font-weight: 500;
    color: var(--ink-secondary);
    background: var(--surface-0);
    border: 1px solid var(--border-soft);
  }

  .license {
    border-top: 1px solid var(--border-soft);
    padding: 0.375rem 0;
  }

  .license summary {
    font-size: 0.875rem;
  }

  .license .name {
    font-weight: 500;
  }

  .license pre {
    margin: 0.5rem 0 0;
    padding: 0.5rem;
    max-height: 18rem;
    overflow: auto;
    white-space: pre-wrap;
    font-size: 0.6875rem;
    color: var(--ink-secondary);
    background: var(--surface-0);
    border-radius: var(--radius-md);
  }
</style>
