import Toastify from "toastify-js";
import { z } from "zod";

/** Keep toasts clear of the bottom action bar */
const TOAST_POSITION = { gravity: "bottom", position: "center", offset: { x: 0, y: 72 } } as const;

export class Toasts {
  static error(e: any) {
    console.error(e);

    Toastify({
      text: `${e}`,
      ...TOAST_POSITION,
      duration: 5000,
      className: "toast-danger",
    }).showToast();
  }

  static message(text: string) {
    Toastify({
      text,
      ...TOAST_POSITION,
      duration: 5000,
      className: "toast-info",
    }).showToast();
  }

  static zodErrors(e: any, prefix: string) {
    if (e instanceof z.ZodError) {
      e.issues.forEach((i) => {
        this.error(`${prefix} "${i.path.join("→")}" ${i.message}`);
      });
    }
  }
}
