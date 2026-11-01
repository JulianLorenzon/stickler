<script lang="ts">
  import { type LabelProps, type OjectType } from "$/types";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import type { MaterialIcon } from "$/styles/mdi_icons";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import IconPicker from "$/components/designer-controls/IconPicker.svelte";
  import ZplImportButton from "$/components/designer-controls/ZplImportButton.svelte";

  interface Props {
    onSubmit: (i: OjectType) => void;
    onIconPicked: (i: MaterialIcon) => void;
    onSvgIconPicked: (i: string) => void;
    labelProps: LabelProps;
    zplImageReady: (img: Blob) => void;
    /** Shown only where a code scanner is available */
    onScan?: () => void;
  }

  let { onSubmit, onIconPicked, onSvgIconPicked, labelProps, zplImageReady, onScan }: Props = $props();

  const objects: { type: OjectType; icon: MaterialIcon; label: TranslationKey }[] = [
    { type: "text", icon: "text_fields", label: "editor.objectpicker.text" },
    { type: "image", icon: "image", label: "editor.objectpicker.image" },
    { type: "qrcode", icon: "qr_code_2", label: "editor.objectpicker.qrcode" },
    { type: "barcode", icon: "view_week", label: "editor.objectpicker.barcode" },
    { type: "line", icon: "horizontal_rule", label: "editor.objectpicker.line" },
    { type: "rectangle", icon: "crop_square", label: "editor.objectpicker.rectangle" },
    { type: "circle", icon: "radio_button_unchecked", label: "editor.objectpicker.circle" },
  ];
</script>

{#if onScan}
  <button class="tool-btn" onclick={onScan}>
    <MdIcon icon="qr_code_scanner" />
    <span>{$tr("editor.objectpicker.scan")}</span>
  </button>
{/if}

{#each objects as o (o.type)}
  <button class="tool-btn" onclick={() => onSubmit(o.type)}>
    <MdIcon icon={o.icon} />
    <span>{$tr(o.label)}</span>
  </button>
{/each}

<IconPicker onSubmit={onIconPicked} onSubmitSvg={onSvgIconPicked} />

<ZplImportButton {labelProps} onImageReady={zplImageReady} text={$tr("editor.import.zpl")} />
