import Toastify from "toastify-js";
import { z } from "zod";

/** Toastify's own gap above a top toast */
const TOASTIFY_TOP = 15;

/**
 * Toasts go at the top of the label workspace, under the app bar and the doc toolbar, so they cover neither those
 * buttons nor the add/print bars at the bottom. Without the workspace (it's always there now) under the app bar.
 */
const toastPosition = () => {
  const workspace = document.querySelector(".workspace")?.getBoundingClientRect().top;
  const top = workspace ?? document.querySelector(".app-bar")?.getBoundingClientRect().bottom ?? 0;
  return { gravity: "top", position: "center", offset: { x: 0, y: Math.max(0, top + 8 - TOASTIFY_TOP) } } as const;
};

export class Toasts {
  static error(e: any) {
    console.error(e);

    Toastify({
      text: `${e}`,
      ...toastPosition(),
      duration: 5000,
      className: "toast-danger",
    }).showToast();
  }

  static message(text: string) {
    Toastify({
      text,
      ...toastPosition(),
      duration: 5000,
      className: "toast-info",
    }).showToast();
  }

  static zodErrors(e: any, prefix: string) {
    if (e instanceof z.ZodError) {
      e.issues.forEach((i) => {
        this.error(`${prefix} "${i.path.join("→")}" ${i.message}`);
      });
    } else {
      // Anything else used to vanish without a word
      this.error(`${prefix} ${e}`);
    }
  }
}
