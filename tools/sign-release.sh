#!/bin/sh
# Signs the release APK with your release key. apksigner asks for the key's password, so it never has to be
# stored. Run it in your own terminal after building:
#
#   npm run build && npx cap sync android && (cd android && ./gradlew assembleRelease)
#   tools/sign-release.sh path/to/release.jks
#
# Output: android/app/build/outputs/apk/release/stickler-<version>.apk
# Any arguments after the keystore go to `apksigner sign`, e.g. --ks-key-alias <alias> if the keystore holds
# more than one key.
set -e
[ -n "$1" ] || { echo "usage: $0 <keystore> [apksigner sign options]" >&2; exit 1; }
ks=$1; shift
[ -f "$ks" ] || { echo "No keystore at $ks" >&2; exit 1; }
root=$(cd "$(dirname "$0")/.." && pwd)
sdk=${ANDROID_HOME:-$(sed -n 's/^sdk.dir=//p' "$root/android/local.properties" 2>/dev/null | tr -d "\r")}
bt=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -x "$bt/apksigner" ] || { echo "apksigner not found: set ANDROID_HOME or sdk.dir in android/local.properties" >&2; exit 1; }

dir=$root/android/app/build/outputs/apk/release
in=$dir/app-release-unsigned.apk
[ -f "$in" ] || { echo "No unsigned APK at $in: build it first (see the top of this script)" >&2; exit 1; }
version=$(sed -n 's/^ *versionName "\(.*\)"/\1/p' "$root/android/app/build.gradle")
out=$dir/stickler-$version.apk

"$bt/zipalign" -f -p 4 "$in" "$dir/aligned.apk"
"$bt/apksigner" sign --ks "$ks" --out "$out" "$@" "$dir/aligned.apk"
rm -f "$dir/aligned.apk" "$out.idsig"
"$bt/apksigner" verify --print-certs "$out" | grep -E "Signer #1 certificate (DN|SHA-256)"
echo "Signed: $out"
