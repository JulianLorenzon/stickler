import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import type { LicenseEntry, LicensesFile } from "./src/utils/licenses";

const FILE_NAME = "licenses.json";
const LICENSE_FILE = /^(mit-)?(licen[cs]e|copying|ofl)(\.|$)/i;

/** Build-only tools listed under dependencies, not shipped in the app */
const NOT_SHIPPED = new Set(["@capacitor/cli"]);

/** node_modules/<name> or node_modules/@scope/<name> directory a module id belongs to */
const packageDirOf = (id: string): string | undefined => {
  // Rollup's virtual modules (CommonJS helpers and the like) start with a null byte
  if (id.startsWith("\0")) return undefined;
  const dir = id.replace(/\\/g, "/").match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
  return dir && fs.existsSync(path.join(dir, "package.json")) ? dir : undefined;
};

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** For MIT packages without a license file (qrcode-generator): the copyright line from the code and the MIT text */
const mitFromSource = (dir: string, main: string | undefined): string | undefined => {
  const file = main && path.join(dir, main);
  if (!file || !fs.existsSync(file)) return undefined;
  const copyright = fs.readFileSync(file, "utf8").slice(0, 4000).match(/Copyright \(c\)[^\n]*/i)?.[0];
  return copyright ? `${copyright.trim()}\n\n${MIT_TEXT}` : undefined;
};

/**
 * Code compiled into a package's files rather than shipped as its own npm package, so it has no package.json to
 * read. Each needs its licence text in licenses/.
 */
const EMBEDDED: {
  name: string;
  version: string;
  license: string;
  url: string;
  file: string;
  /** The package it's compiled into, at the version the entry was checked against */
  inside: { name: string; version: string };
}[] = [
  {
    // The barcode reader inside zxing-wasm's .wasm file (zxing-wasm's own code is MIT and listed normally)
    name: "zxing-cpp",
    version: "2c3dcfe",
    license: "Apache-2.0",
    url: "https://github.com/zxing-cpp/zxing-cpp",
    file: "licenses/zxing-cpp.txt",
    // zxing-wasm exports the zxing-cpp commit it was built from as ZXING_CPP_COMMIT
    inside: { name: "zxing-wasm", version: "3.1.6" },
  },
];

/** Homepage or repository as a link; expands "github:user/repo" and "user/repo" */
const packageUrl = (pkg: { homepage?: string; repository?: string | { url?: string } }): string | undefined => {
  const raw = pkg.homepage ?? (typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url);
  if (!raw) return undefined;
  const url = raw.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://");
  return /^[\w.-]+\/[\w.-]+$/.test(url.replace(/^github:/, "")) ? `https://github.com/${url.replace(/^github:/, "")}` : url;
};

const readEntry = (dir: string): LicenseEntry => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = fs.readdirSync(dir).find((f) => LICENSE_FILE.test(f));
  const license: string = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "unknown");
  let text = file ? fs.readFileSync(path.join(dir, file), "utf8").trim() : undefined;
  if (!text && license === "MIT") text = mitFromSource(dir, pkg.main);
  return { name: pkg.name, version: pkg.version, license, url: packageUrl(pkg), text };
};

/**
 * Writes licenses.json next to the app: every package that ends up in the bundle, plus the direct dependencies
 * that ship without being JS modules (fonts and icons through CSS, Capacitor's native Android code).
 */
export const licensesPlugin = (root: string): Plugin => {
  const collect = (moduleIds: Iterable<string>): LicensesFile => {
    const dirs = new Set<string>();
    for (const id of moduleIds) {
      const dir = packageDirOf(id);
      if (dir) dirs.add(dir);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!NOT_SHIPPED.has(name)) dirs.add(path.join(root, "node_modules", name));
    }

    const byName = new Map<string, LicenseEntry>();
    for (const dir of dirs) {
      const entry = readEntry(dir);
      if (!NOT_SHIPPED.has(entry.name)) byName.set(`${entry.name}@${entry.version}`, entry);
    }

    const shipped = [...byName.values()];
    for (const e of EMBEDDED) {
      const host = shipped.find((p) => p.name === e.inside.name);
      if (!host) continue;
      if (host.version !== e.inside.version) {
        console.warn(`licenses: ${e.inside.name} is now ${host.version}; check ${e.name}'s version and licence`);
      }
      const { name, version, license, url } = e;
      byName.set(`${name}@${version}`, { name, version, license, url, text: fs.readFileSync(path.join(root, e.file), "utf8").trim() });
    }

    return {
      notice: fs.readFileSync(path.join(root, "NOTICE"), "utf8"),
      app: fs.readFileSync(path.join(root, "LICENSE"), "utf8"),
      packages: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  };

  return {
    name: "app-licenses",
    // The dev server has no bundle; list the direct dependencies
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${FILE_NAME}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(collect([])));
      });
    },
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((chunk) => (chunk.type === "chunk" ? chunk.moduleIds : []));
      this.emitFile({ type: "asset", fileName: FILE_NAME, source: JSON.stringify(collect(ids)) });
    },
  };
};
