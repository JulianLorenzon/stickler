#!/bin/sh
# Builds and signs the APK in Docker (JDK 21, Node 20, Android SDK 35), so nothing needs installing on the host.
# The repo is mounted at its own path; Gradle and npm caches persist in the volume stickler-build-cache.
#
#   tools/android-build/run.sh                   unsigned release APK: npm ci (if needed), vite build, cap sync, gradle
#   tools/android-build/run.sh sign <keystore>   sign it with tools/sign-release.sh (apksigner asks for the password)
#   tools/android-build/run.sh <command...>      anything else, e.g. sh, or sh -c 'cd android && ./gradlew assembleDebug'
set -e
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
img=stickler-android-build
docker build -q -t $img "$here" >/dev/null

opts=""
[ -t 0 ] && opts="-it"
# A local.properties from a host SDK would point Gradle at a path that doesn't exist in the container
if [ -f "$root/android/local.properties" ]; then
  props=$(mktemp); trap 'rm -f "$props"' EXIT; echo "sdk.dir=/opt/android-sdk" > "$props"
  opts="$opts -v $props:$root/android/local.properties:ro"
fi
if [ "$1" = sign ]; then
  [ -f "$2" ] || { echo "usage: $0 sign <keystore> [apksigner sign options]" >&2; exit 1; }
  ks=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2
  opts="$opts -v $ks:/keys/release.jks:ro"
  set -- tools/sign-release.sh /keys/release.jks "$@"
elif [ $# -eq 0 ]; then
  set -- sh -c '[ -d node_modules ] || npm ci; npm run build && npx cap sync android && cd android && ./gradlew assembleRelease'
fi

# shellcheck disable=SC2086
docker run --rm $opts --user "$(id -u):$(id -g)" -v stickler-build-cache:/cache -v "$root:$root" -w "$root" $img "$@"
