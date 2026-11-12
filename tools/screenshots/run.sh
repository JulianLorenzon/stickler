#!/bin/sh
# Screenshots of the built app (dist/) in headless Chromium, in Docker. Output: tools/screenshots/out/
# usage: tools/screenshots/run.sh '<json>'   or   tools/screenshots/run.sh /work/s/<file>.json (a file in this folder)
# Each shot: { "name", "path"?, "viewport"?, "mobile"?, "full"?, "native"?, "init"?, "scale"?, "camera"? (video file played as the camera), "actions"? (click: selector, at: [x, y]) } (see shoot.mjs).
# "native": true loads native-stub.js, a fake Android bridge, so the native BLE UI renders without a phone.
set -e
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
img=mcr.microsoft.com/playwright:v1.56.0-noble
mkdir -p "$here/out"
docker run --rm -v stickler-pw-cache:/work/node_modules -w /work $img sh -c \
  '[ -d node_modules/playwright ] || npm i --no-save playwright@1.56.0 >/dev/null 2>&1'
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v stickler-pw-cache:/work/node_modules \
  -v "$here:/work/s:ro" -v "$root/node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js:/work/native-bridge.js:ro" -v "$root/dist:/dist:ro" -v "$here/out:/out" $img sh -c \
  'cd /tmp && cp /work/s/shoot.mjs . && ln -s /work/node_modules . && node shoot.mjs "$0"' "$1"
