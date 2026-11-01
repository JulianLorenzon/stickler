<script lang="ts">
  import { onMount } from "svelte";
  import { OBJECT_DEFAULTS_TEXT } from "$/defaults";
  import { tr } from "$/utils/i18n";
  import { Toasts } from "$/utils/toasts";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { fontCache, userFonts } from "$/stores";
  import FontsMenu from "$/components/designer-controls/FontsMenu.svelte";
  import { BUNDLED_FONTS } from "$/utils/bundled_fonts";

  interface Props {
    editRevision?: number;
    value: string;
    valueUpdated: (v: string) => void;
  }

  let { value, valueUpdated, editRevision }: Props = $props();

  let fontQuerySupported = typeof queryLocalFonts !== "undefined";

  const bundledFamilies = new Set(BUNDLED_FONTS.map((f) => f.family));
  const fontLabel = $derived(BUNDLED_FONTS.find((f) => f.family === value)?.label ?? value);
  const systemFonts = $derived($fontCache.filter((f) => !bundledFamilies.has(f)));

  const getSystemFonts = async () => {
    try {
      const fonts = await queryLocalFonts();
      const fontListSorted = [OBJECT_DEFAULTS_TEXT.fontFamily, ...new Set(fonts.map((f: FontData) => f.family))].sort();
      fontCache.update(() => fontListSorted);
      LocalStoragePersistence.saveCachedFonts(fontListSorted);
    } catch (e) {
      Toasts.error(e);
    }
  };

  onMount(() => {
    try {
      let stored = LocalStoragePersistence.loadCachedFonts();
      if (stored.length > 0) {
        const uniqueFonts = new Set([OBJECT_DEFAULTS_TEXT.fontFamily, ...stored]);
        fontCache.update(() => [...uniqueFonts].sort());
      }
    } catch (e) {
      Toasts.error(e);
    }
  });
</script>

<div class="input-group flex-nowrap input-group-sm font-family-picker">
  <span class="input-group-text" title={$tr("params.text.font_family")}>
    <MdIcon icon="text_format" />
  </span>

  <!-- A button rather than a text field, so picking a font doesn't pop up the keyboard -->
  <button
    class="btn btn-outline-secondary dropdown-toggle font-family-btn"
    type="button"
    data-bs-toggle="dropdown"
    data-ver={editRevision}
    style="font-family: '{value}'">
    {fontLabel}
  </button>

  <div class="dropdown-menu dropdown-menu-end dropdown-sheet font-menu">
      <h6 class="dropdown-header">{$tr("params.text.bundled_fonts")}</h6>
      {#each BUNDLED_FONTS as font (font.family)}
        <button
          class="dropdown-item font-item"
          class:active={value === font.family}
          style="font-family: '{font.family}'"
          type="button"
          onclick={() => valueUpdated(font.family)}>
          {font.label}
        </button>
      {/each}

      {#if $userFonts.length > 0}
        <h6 class="dropdown-header">{$tr("params.text.user_fonts")}</h6>
        {#each $userFonts as font (font.family)}
          <button
            class="dropdown-item"
            style="font-family: {font.family}"
            type="button"
            onclick={() => valueUpdated(font.family)}>
            {font.family}
          </button>
        {/each}
      {/if}

      {#if systemFonts.length > 0}
        <h6 class="dropdown-header">{$tr("params.text.system_fonts")}</h6>
        {#each systemFonts as family (family)}
          <button
            class="dropdown-item"
            style="font-family: {family}"
            type="button"
            onclick={() => valueUpdated(family)}>
            {family}
          </button>
        {/each}
      {/if}

      {#if fontQuerySupported && systemFonts.length === 0}
        <div class="dropdown-divider"></div>
        <button class="dropdown-item text-primary" type="button" onclick={getSystemFonts}>
          <MdIcon icon="refresh" /> Load system fonts
        </button>
      {/if}
  </div>

  <FontsMenu />
</div>

<style>
  .font-family-picker {
    width: unset;
  }

  .font-family-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem;
    width: 10em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .font-menu {
    min-width: 16rem;
    max-height: 320px;
    overflow-y: auto;
  }

  .font-item {
    font-size: 1.15rem;
    padding-top: 0.4rem;
    padding-bottom: 0.4rem;
  }

</style>
