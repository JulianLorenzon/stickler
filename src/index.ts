import "$/styles/style.scss";
import "@popperjs/core";
import type { Options as PopperOptions } from "@popperjs/core";
import "toastify-js/src/toastify.css";
import Dropdown from "bootstrap/js/dist/dropdown";
import Modal from "bootstrap/js/dist/modal";
import "bootstrap/js/dist/collapse";
import App from "$/App.svelte";
import { mount } from "svelte";
import { Capacitor } from "@capacitor/core";
import { configureFabric } from "$/defaults";
import { preloadBundledFonts } from "$/utils/bundled_fonts";

configureFabric();

// Menus in the bottom panel open upwards; Popper only flips them down when there's no room above.
// show.bs.dropdown fires right before Bootstrap builds the Popper config for the same menu.
let openUpwards = false;

/**
 * Popper doesn't always clear its inline position: a menu closed by tapping the canvas kept `bottom: 0`, the next open
 * added `top: 0`, so the menu was measured as tall as the screen and ended up below the bottom edge
 */
const clearMenuPosition = (toggle: HTMLElement) => {
  const menu = toggle.parentElement?.querySelector<HTMLElement>(":scope > .dropdown-menu");
  for (const p of ["inset", "top", "right", "bottom", "left", "transform", "margin", "position"]) menu?.style.removeProperty(p);
};

document.addEventListener("show.bs.dropdown", (e) => {
  const toggle = e.target as HTMLElement;
  openUpwards = toggle.closest(".panel") !== null;
  clearMenuPosition(toggle);
});
document.addEventListener("hidden.bs.dropdown", (e) => clearMenuPosition(e.target as HTMLElement));

// Toolbars scroll horizontally on phones; a fixed positioning strategy keeps menus from being clipped by them.
// preventOverflow on both axes pushes a menu back inside the screen when neither side of its button has room.
Dropdown.Default.popperConfig = (defaults: Partial<PopperOptions>) => ({
  ...defaults,
  placement: openUpwards ? (defaults.placement?.replace("bottom", "top") as PopperOptions["placement"]) : defaults.placement,
  strategy: "fixed",
  modifiers: [
    ...(defaults.modifiers ?? []).filter((m) => m.name !== "preventOverflow"),
    { name: "preventOverflow", options: { boundary: "clippingParents", altAxis: true, padding: 8 } },
    { name: "flip", options: { padding: 8 } },
  ],
});

/** Android back button: close the topmost overlay, then the selection, then leave the app */
const setupBackButton = async () => {
  const { App: CapApp } = await import("@capacitor/app");

  CapApp.addListener("backButton", () => {
    // The camera screens are mounted on top of everything, a modal included (the calibration page opens one), and
    // close themselves on "app:back"
    const cameraOpen = document.querySelector("[role='dialog'][aria-modal='true']:not(.modal)") !== null;

    const openModals = document.querySelectorAll<HTMLElement>(".modal.show");
    if (openModals.length > 0 && !cameraOpen) {
      Modal.getInstance(openModals[openModals.length - 1])?.hide();
      return;
    }

    const openToggles = document.querySelectorAll<HTMLElement>("[data-bs-toggle='dropdown'].show");
    if (openToggles.length > 0 && !cameraOpen) {
      openToggles.forEach((el) => Dropdown.getInstance(el)?.hide());
      return;
    }

    const evt = new Event("app:back", { cancelable: true });
    window.dispatchEvent(evt);
    if (!evt.defaultPrevented) {
      CapApp.minimizeApp();
    }
  });
};

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("native");
  setupBackButton();
}

const app = mount(App, {
  target: document.getElementById("app")!,
});

preloadBundledFonts();

export default app;
