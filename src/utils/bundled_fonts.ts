import * as fabric from "fabric";
import { loadedFonts } from "$/stores";

/** Fonts shipped with the app, @font-face rules live in styles/font.scss */
export const BUNDLED_FONTS: { family: string; label: string }[] = [
  { family: "Noto Sans Variable", label: "Noto Sans" },
  { family: "Inter Variable", label: "Inter" },
  { family: "Roboto Condensed Variable", label: "Roboto Condensed" },
  { family: "Oswald Variable", label: "Oswald" },
  { family: "Montserrat Variable", label: "Montserrat" },
  { family: "Bebas Neue", label: "Bebas Neue" },
  { family: "Roboto Slab Variable", label: "Roboto Slab" },
  { family: "Noto Serif Variable", label: "Noto Serif" },
  { family: "Roboto Mono Variable", label: "Roboto Mono" },
  { family: "Caveat Variable", label: "Caveat" },
  { family: "Pacifico", label: "Pacifico" },
];

/**
 * Font files load lazily on first use, which makes Fabric measure text with a fallback font.
 * Load them all up front (they're small and local), then let the canvas re-measure text.
 */
export const preloadBundledFonts = async (): Promise<void> => {
  await Promise.allSettled(
    BUNDLED_FONTS.flatMap(({ family }) => [
      document.fonts.load(`400 32px "${family}"`),
      document.fonts.load(`700 32px "${family}"`),
    ]),
  );
  fabric.cache.clearFontCache();
  loadedFonts.update((list) => [...list]);
};
