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

## The app's own reading and fit

The app does the same on the phone (printer sheet, Calibration, "Correction from a photo"): `src/utils/grey_strip.ts`
finds the strip in a photo, measures it and fits the model. `calibrate.mjs` runs that code on photos here, to compare
with the scripts above or to try a photo that the app reads badly. Node has no JPEG decoder, so `to_raw.py` turns the
photo into raw pixels first (it can also turn or shrink it). Scratch files go in `tools/dot-gain/out/` (ignored).

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/s/out -v "$PWD/tools/dot-gain:/s" python:3.12-slim sh -c \
  "pip install -q --target /s/out/pylib pillow; PYTHONPATH=/s/out/pylib python /s/to_raw.py /s/out/photo.jpg /s/out/photo.rgba"
tools/android-build/run.sh sh -c 'npx esbuild tools/dot-gain/entry.ts --bundle --format=esm --alias:$=./src \
  --outfile=tools/dot-gain/bundle.mjs && node tools/dot-gain/calibrate.mjs tools/dot-gain/out/photo.rgba'
```

A `+` after a file name marks a strip printed with dot correction (`PRINTED='{"base":…}'` gives the model it was
printed with); `START` sets the model the fit starts from.
