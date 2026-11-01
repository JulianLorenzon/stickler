import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { licensesPlugin } from "./vite-plugin-licenses";

const getDate = (): string => {
  const date = new Date();
  const fmt = (n: number) => (n > 9 ? n : `0${n}`);
  return `${date.getFullYear()}-${fmt(date.getMonth() + 1)}-${fmt(date.getDate())} ${fmt(date.getHours())}:${fmt(date.getMinutes())}`;
};

/** COMMIT_HASH if set (CI), otherwise the checked out commit, with "+" when there are uncommitted changes */
const getCommit = (): string | undefined => {
  if (process.env.COMMIT_HASH) return process.env.COMMIT_HASH;
  try {
    const hash = execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain --untracked-files=no -- .", { encoding: "utf8" }).trim() !== "";
    return dirty ? `${hash}+` : hash;
  } catch {
    return undefined;
  }
};

// https://vitejs.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/stickler/" : "/",
  plugins: [svelte(), licensesPlugin(__dirname)],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __APP_COMMIT__: JSON.stringify(getCommit()),
    __BUILD_DATE__: JSON.stringify(getDate()),
  },
  resolve: {
    alias: {
      $: resolve(__dirname, "./src")
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.endsWith(".css") || id.endsWith(".scss")) {
            return "style";
          }

          if (id.includes("node_modules")) {
            if (id.includes("fabric")) {
              return "lib.2.fabric";
            } else if (
              id.includes("@capacitor/filesystem") ||
              id.includes("@capacitor/share")
            ) {
              return "lib.2.cap";
            } else if (id.includes("zod")) {
              return "lib.2.zod";
            }

            return "lib.1.other";
          }
          return null;
        },
        chunkFileNames: () => {
          return "assets/[name].[hash].js";
        },
      },
    },
  },
});
