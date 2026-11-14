<script lang="ts">
  import Modal from "bootstrap/js/dist/modal";
  import { onDestroy, onMount, type Snippet } from "svelte";
  import { tr } from "$/utils/i18n";

  interface Props {
    show: boolean;
    title: string;
    onClose?: () => void;
    children: Snippet;
    footer?: Snippet;
    /** "sheet" docks to the bottom on phones, "fullscreen" covers the screen on phones */
    variant?: "default" | "sheet" | "fullscreen";
  }

  let { show = $bindable(), title, onClose, children, footer, variant = "default" }: Props = $props();

  let modalEl: HTMLElement;
  let modal: Modal;
  /**
   * Opened over another modal: Bootstrap's backdrop stays under that one, so this one dims what's behind it itself
   * (the modal's own box covers the screen)
   */
  let stacked = $state(false);

  onMount(() => {
    stacked = document.querySelector(".modal.show") !== null;
    modal = new Modal(modalEl);
    modal.show();

    // Bootstrap's events bubble: a modal opened inside this one must not close this one too
    modalEl.addEventListener('hide.bs.modal', (e) => {
      if (e.target !== modalEl) return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    modalEl.addEventListener("hidden.bs.modal", (e) => {
      if (e.target !== modalEl) return;
      if (onClose) onClose();
      show = false;
    });

  });

  onDestroy(() => {
    if (modal) {
      modal.hide();
      modal.dispose();
    }
  });

  export const hide = () => {
    if (modal) {
      modal.hide();
    }
  };
</script>

<div bind:this={modalEl} class="modal fade" class:stacked tabindex="-1" aria-hidden="true">
  <div
    class="modal-dialog modal-dialog-centered modal-dialog-scrollable"
    class:modal-sheet={variant === "sheet"}
    class:modal-fullscreen-sm-down={variant === "fullscreen"}>
    <div class="modal-content">
      <div class="modal-header">
        <h1 class="modal-title fs-5">{title}</h1>
        <button aria-label={$tr("main.dismiss")} type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>

      <div class="modal-body">
        {@render children()}
      </div>

      {#if footer}
        <div class="modal-footer">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal.stacked {
    background: rgb(0 0 0 / 0.5);
  }
</style>
