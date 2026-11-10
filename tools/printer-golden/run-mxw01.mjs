globalThis.window = globalThis;
import { readFileSync } from "node:fs";
const { runMxw01 } = await import("./bundle.mjs");
process.stdout.write(await runMxw01(new Uint8Array(readFileSync(process.argv[2]))));
