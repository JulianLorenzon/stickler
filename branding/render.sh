#!/bin/sh
# Renders the logo PNGs (branding/*.png, public/logo.png) in the Playwright Docker image, then the Android
# launcher icons and splash screens from branding/icon-1024.png (ImageMagick in Alpine).
# Needs `npm install` first (for the Montserrat font). Run from anywhere: sh branding/render.sh
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
node "$root/branding/make.mjs"
img=mcr.microsoft.com/playwright:v1.56.0-noble
# Playwright's npm package is cached in a volume (installed as root once), the render runs as you so the
# PNGs are yours
docker run --rm -v stickler-pw-cache:/work/node_modules -w /work $img sh -c \
  '[ -d node_modules/playwright ] || npm i --no-save playwright@1.56.0 >/dev/null 2>&1'
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v stickler-pw-cache:/work/node_modules \
  -v "$root/branding:/branding" -v "$root/public:/public" \
  -v "$root/node_modules/@fontsource-variable/montserrat/files:/fonts:ro" -w /work \
  $img sh -c 'cp /branding/render.mjs /tmp/ && cd /tmp && ln -s /work/node_modules . && node render.mjs'
docker run --rm -v "$root/branding/icon-1024.png:/logo.png:ro" -v "$root/android/app/src/main/res:/res" \
  -v "$root/tools/icons-gen.sh:/gen.sh:ro" alpine sh -c "sh /gen.sh && chown -R $(id -u):$(id -g) /res"
