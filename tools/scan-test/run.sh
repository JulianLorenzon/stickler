#!/bin/sh
# Scanner tests. Run from anywhere after `npm run build`:
#   tools/scan-test/run.sh          formats + QR text + UPC-E (Node) and the fake camera test (Docker)
#   tools/scan-test/run.sh node     only the Node part
# The fake camera test uses the same Playwright image and cache volume as tools/screenshots/run.sh.
set -e
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
cd "$root"
node --disable-warning=ExperimentalWarning tools/scan-test/formats.mjs
[ "$1" = node ] && exit 0

img=mcr.microsoft.com/playwright:v1.56.0-noble
mkdir -p "$here/out"
docker run --rm -v stickler-pw-cache:/work/node_modules -w /work $img sh -c \
  '[ -d node_modules/playwright ] || npm i --no-save playwright@1.56.0 >/dev/null 2>&1'
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v stickler-pw-cache:/work/node_modules \
  -v "$here:/work/s:ro" -v "$root/node_modules/qrcode-generator:/repo/node_modules/qrcode-generator:ro" \
  -v "$root/dist:/dist:ro" -v "$here/out:/out" $img sh -c \
  'cd /tmp && cp /work/s/camera.mjs . && ln -s /work/node_modules . && node camera.mjs'
