# Dot gain fitting

Scripts that fitted the dot gain model in `src/utils/print_sim.ts` to photos of grey test prints. The measured
greys are in `fit.mjs` and `fit2.mjs`; `check.mjs` prints intended vs. simulated grey per dither mode.

```bash
npx esbuild tools/dot-gain/entry.ts --bundle --format=esm --outfile=tools/dot-gain/bundle.mjs
node tools/dot-gain/check.mjs
```
