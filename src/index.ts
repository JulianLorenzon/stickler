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

// Toolbars scroll horizontally on phones; a fixed positioning strategy keeps menus from being clipped by them
Dropdown.Default.popperConfig = (defaults: Partial<PopperOptions>) => ({ ...defaults, strategy: "fixed" });

/** Android back button: close the topmost overlay, then the selection, then leave the app */
const setupBackButton = async () => {
  const { App: CapApp } = await import("@capacitor/app");

  CapApp.addListener("backButton", () => {
    const openModals = document.querySelectorAll<HTMLElement>(".modal.show");
    if (openModals.length > 0) {
      Modal.getInstance(openModals[openModals.length - 1])?.hide();
      return;
    }

    const openToggles = document.querySelectorAll<HTMLElement>("[data-bs-toggle='dropdown'].show");
    if (openToggles.length > 0) {
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
