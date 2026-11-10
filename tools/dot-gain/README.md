# Dot gain fitting

Scripts that fitted the dot gain model in `src/utils/print_sim.ts` to photos of grey test prints. The measured
greys are in `fit.mjs` and `fit2.mjs`; `check.mjs` prints intended vs. simulated grey per dither mode.

```bash
npx esbuild tools/dot-gain/entry.ts --bundle --format=esm --outfile=tools/dot-gain/bundle.mjs
node tools/dot-gain/check.mjs
```

## Continuous-roll strip (MXW01)

The printer sheet's grey test on a roll is one piece with a row per mode. `measure_strip.py` finds the four solid
100% patches in a photo, places the other patches from the layout and measures them against the paper around them;
`fit_strip.mjs` fits a model to that by simulating the same strip. The MXW01 measurements are in
`mxw01-2026-11-10.json` (first photo) and `mxw01-2026-11-11.json` (all three strips, keyed `mode#photo`, `mode+`
for the strip printed with correction; `printed` holds the model that correction used).
For a photo with two strips, crop each and turn it upright first (Pillow `crop(...).rotate(90, expand=True)`).

```bash
docker run --rm -v "$PWD/tools/dot-gain:/s:ro" -v /path/photo.jpg:/in/photo.jpg:ro -v /tmp/dg:/out python:3.12-slim \
  sh -c "pip install -q numpy pillow; python -I /s/measure_strip.py /in/photo.jpg /out/overlay.jpg"
tools/android-build/run.sh sh -c 'npx esbuild tools/dot-gain/entry.ts --bundle --format=esm \
  --outfile=tools/dot-gain/bundle.mjs && MINBASE=0.15 node tools/dot-gain/fit_strip.mjs "$(cat tools/dot-gain/mxw01-2026-11-10.json)"'
```
