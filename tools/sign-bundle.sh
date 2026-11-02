#!/bin/sh
# Signs the release app bundle (.aab) for Google Play with your upload key. jarsigner asks for the key's password,
# so it never has to be stored. Run it in your own terminal after building:
#
#   npm run build && npx cap sync android && (cd android && ./gradlew bundleRelease)
#   tools/sign-bundle.sh path/to/release.jks <key alias>
#
# Output: android/app/build/outputs/bundle/release/stickler-<version>.aab
set -e
[ -n "$2" ] || { echo "usage: $0 <keystore> <key alias>" >&2; exit 1; }
ks=$1; alias=$2
[ -f "$ks" ] || { echo "No keystore at $ks" >&2; exit 1; }
command -v jarsigner >/dev/null || { echo "jarsigner not found: it comes with the JDK" >&2; exit 1; }
root=$(cd "$(dirname "$0")/.." && pwd)

dir=$root/android/app/build/outputs/bundle/release
in=$dir/app-release.aab
[ -f "$in" ] || { echo "No app bundle at $in: build it first (see the top of this script)" >&2; exit 1; }
version=$(sed -n 's/^ *versionName "\(.*\)"/\1/p' "$root/android/app/build.gradle")
out=$dir/stickler-$version.aab

jarsigner -keystore "$ks" -sigalg SHA256withRSA -digestalg SHA-256 -signedjar "$out" "$in" "$alias"
jarsigner -verify "$out" >/dev/null && echo "Signed: $out"
