globalThis.window = globalThis;
const { run } = await import("./bundle.mjs");
process.stdout.write(await run());
