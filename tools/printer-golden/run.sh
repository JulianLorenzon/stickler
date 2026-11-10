#!/usr/bin/env bash
# Print the byte log of the D11s scenario (Node in Docker). Compare with golden-d11s.txt:
#   tools/printer-golden/run.sh | diff tools/printer-golden/golden-d11s.txt -
set -euo pipefail
cd "$(dirname "$0")/../.."
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" -w /w node:22-slim sh -c \
  'node_modules/.bin/esbuild tools/printer-golden/entry.ts --bundle --format=esm --platform=node --log-level=warning --outfile=/tmp/bundle.mjs && cp tools/printer-golden/run.mjs /tmp/ && node /tmp/run.mjs'
