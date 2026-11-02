<script lang="ts">
  import type { ExportedLabelTemplate, LabelProps } from "$/types";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { DOTS_PER_MM } from "$/defaults";

  interface Props {
    labels: ExportedLabelTemplate[];
    /** The label that's open on the canvas, -1 for none */
    selectedIndex?: number;
    /** Whether a saved label is also the start label */
    isDefault: (item: ExportedLabelTemplate) => boolean;
    onOpen: (index: number) => void;
    onExport: (index: number) => void;
    onDelete: (index: number) => void;
    onToggleDefault: (index: number) => void;
  }

  let {
    labels,
    selectedIndex = -1,
    isDefault,
    onOpen,
    onExport,
    onDelete,
    onToggleDefault,
  }: Props = $props();

  /** Row asking "Delete?", -1 for none */
  let deleteIndex = $state<number>(-1);

  const mm = (dots: number): number => Math.round((dots / DOTS_PER_MM) * 10) / 10;

  const sizeText = (props: LabelProps): string => {
    const paper = props.paper ?? props.size;
    return `${mm(paper.width)}×${mm(paper.height)} mm`;
  };
</script>

{#if labels.length === 0}
  <p class="empty">{$tr("params.saved_labels.empty")}</p>
{:else}
  <ul class="rows">
    {#each labels as item, idx (item.id ?? item.timestamp ?? idx)}
      <li class="saved-row" class:open={selectedIndex === idx}>
        {#if deleteIndex === idx}
          <span class="confirm-text">
            {$tr("params.saved_labels.delete_confirm")}
            <strong>{item.title || $tr("params.saved_labels.untitled")}</strong>?
          </span>
          <button
            class="btn btn-danger confirm-btn"
            onclick={() => {
              deleteIndex = -1;
              onDelete(idx);
            }}>
            {$tr("editor.delete")}
          </button>
          <button class="btn btn-secondary confirm-btn" onclick={() => (deleteIndex = -1)}>
            {$tr("params.saved_labels.cancel")}
          </button>
        {:else}
          <button class="open-btn" onclick={() => onOpen(idx)}>
            <span class="thumb print-start-{item.label.printDirection}">
              {#if item.thumbnailBase64}
                <img src={item.thumbnailBase64} alt="" />
              {:else}
                <MdIcon icon="label" />
              {/if}
            </span>
            <span class="text">
              <span class="title">{item.title || $tr("params.saved_labels.untitled")}</span>
              <span class="meta">
                {sizeText(item.label)}
                {#if selectedIndex === idx}
                  · <span class="badge-open">{$tr("params.saved_labels.open")}</span>
                {/if}
              </span>
            </span>
          </button>
          <button
            class="icon-action"
            class:on={isDefault(item)}
            onclick={() => onToggleDefault(idx)}
            title={isDefault(item) ? $tr("params.saved_labels.default.unset") : $tr("params.saved_labels.default.set")}
            aria-label={isDefault(item)
              ? $tr("params.saved_labels.default.unset")
              : $tr("params.saved_labels.default.set")}
            aria-pressed={isDefault(item)}>
            <MdIcon icon={isDefault(item) ? "star" : "star_border"} />
          </button>
          <button
            class="icon-action"
            onclick={() => onExport(idx)}
            title={$tr("params.saved_labels.save.json")}
            aria-label={$tr("params.saved_labels.save.json")}>
            <MdIcon icon="download" />
          </button>
          <button
            class="icon-action danger"
            onclick={() => (deleteIndex = idx)}
            title={$tr("editor.delete")}
            aria-label={$tr("editor.delete")}>
            <MdIcon icon="delete" />
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    margin: 0;
    padding: 1.25rem 0.5rem;
    text-align: center;
    color: var(--ink-tertiary);
    font-size: 0.875rem;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 50vh;
    overflow-y: auto;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-md);
  }

  .saved-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 4rem;
    padding: 0.25rem 0.25rem 0.25rem 0;
    border-bottom: 1px solid var(--border-soft);
  }

  .saved-row:last-child {
    border-bottom: none;
  }

  .saved-row.open {
    background: var(--surface-1);
    box-shadow: inset 3px 0 0 var(--bs-primary);
  }

  /* Thumbnail and text: the whole area opens the label */
  .open-btn {
    flex: 1;
    min-width: 0;
    min-height: 3.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0.5rem 0.25rem 0.75rem;
    background: none;
    border: none;
    color: var(--ink-primary);
    text-align: left;
    border-radius: var(--radius-sm);
  }

  .open-btn:active {
    background: var(--surface-2);
  }

  .thumb {
    flex: none;
    width: 5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    border-radius: 3px;
    overflow: hidden;
    color: #888;
  }

  .thumb.print-start-left {
    border-left: 2px solid var(--mark-feed);
  }

  .thumb.print-start-top {
    border-top: 2px solid var(--mark-feed);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .title {
    font-size: 0.9375rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    font-size: 0.75rem;
    color: var(--ink-tertiary);
  }

  .badge-open {
    color: var(--bs-primary);
  }

  /* 44 px touch targets */
  .icon-action {
    flex: none;
    width: 2.75rem;
    height: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 50%;
    color: var(--ink-secondary);
    font-size: 1.25rem;
  }

  .icon-action:active {
    background: var(--surface-2);
  }

  .icon-action.on {
    color: var(--bs-warning);
  }

  .icon-action.danger:active {
    color: var(--bs-danger);
  }

  .confirm-text {
    flex: 1;
    min-width: 0;
    padding-left: 0.75rem;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .confirm-btn {
    flex: none;
    min-height: 2.75rem;
  }
</style>
