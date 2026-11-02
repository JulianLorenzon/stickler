# Building

The app is packaged as a native Android app using [Capacitor](https://capacitorjs.com/). Bluetooth is handled by the [`@capacitor-community/bluetooth-le`](https://github.com/capacitor-community/bluetooth-le) plugin, since the Web Bluetooth API is not available inside Android WebViews.

## Requirements

- Node.js 20+
- npm
- JDK 21 ([Temurin](https://adoptium.net/) recommended)
- Android SDK with:
  - `platforms;android-36`
  - `build-tools;35.0.0`
  - `platform-tools`

Set `ANDROID_HOME` to your SDK path, e.g.:

```bash
export ANDROID_HOME=~/android-sdk
```

If you have the Android SDK installed via Android Studio, it is typically at `~/Android/Sdk` on Linux/macOS or `%LOCALAPPDATA%\Android\Sdk` on Windows.

## Build

```bash
# 1. Install dependencies
npm install

# 2. Build the Svelte app
npm run build

# 3. Sync web assets into the Android project
npx cap sync android

# 4. Build the APK
cd android
./gradlew assembleDebug
```

The APK will be at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

## Install

With a device connected via USB (USB debugging enabled):

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to your device and open it to sideload.

## Release build

Release APKs are signed with your own release key. Create one once, keep it **outside the repo** and back it up
together with its password: every update has to be signed with the same key, or Android refuses to install it
over the old version.

```bash
keytool -genkeypair -v -keystore release.jks -storetype PKCS12 -alias release -keyalg RSA -keysize 4096 -validity 10000
```

Gradle builds the release APK **unsigned**. `tools/sign-release.sh` then signs it, and `apksigner` asks for the
key's password, so the password is never stored in a file. Run it in your own terminal, since it needs to prompt:

```bash
npm run build && npx cap sync android
(cd android && ./gradlew assembleRelease)
tools/sign-release.sh path/to/release.jks
```

The signed APK is `android/app/build/outputs/apk/release/stickler-<version>.apk`; the script prints the
certificate it was signed with.

Google Play takes an app bundle instead of an APK. Build it with `./gradlew bundleRelease` and sign it with your
upload key: `tools/sign-bundle.sh path/to/release.jks <key alias>` (jarsigner, from the JDK, asks for the
password). The result is `android/app/build/outputs/bundle/release/stickler-<version>.aab`. For quick tries on your own phone, use a debug build (`./gradlew assembleDebug`)
instead. A debug build and a release build can't update each other, because they're signed with different keys.

R8 (code shrinking) is off: the shrunk build crashed when connecting, and the cause hasn't been found yet.

## Building in Docker

If you'd rather not install the JDK, Node and the Android SDK, `tools/android-build/run.sh` does the same in a
container (about 1.6 GB, built on first use). It runs as your user, and Gradle and npm keep their caches in the
Docker volume `stickler-build-cache`.

```bash
tools/android-build/run.sh                              # unsigned release APK and app bundle (npm ci if needed, vite, cap sync, gradle)
tools/android-build/run.sh sign path/to/release.jks     # sign the APK; apksigner asks for the password
tools/android-build/run.sh sign-bundle path/to/release.jks <alias>   # sign the app bundle; jarsigner asks for the password
tools/android-build/run.sh sh -c 'cd android && ./gradlew assembleDebug'   # any other command
```

The first build downloads Gradle and the dependencies and takes a few minutes; after that a full build takes
under a minute. Each run starts a fresh Gradle daemon, which adds about 20 seconds compared with a local SDK.
`adb` is in the image too, but USB devices aren't visible inside it, so install from the host or over wireless
debugging.

## Architecture

The Android app is the same Svelte 5 + Fabric.js web UI, served from a Capacitor WebView. The key difference from the hosted web app is Bluetooth:

| Platform | BLE implementation |
|----------|--------------------|
| Web (Chrome/Edge) | `WebBleClient` — uses the Web Bluetooth API (`navigator.bluetooth`) |
| Android (Capacitor) | `CapBleClient` — uses `@capacitor-community/bluetooth-le` native plugin |

The factory function in `src/lib/printer/client.ts` checks `Capacitor.isNativePlatform()` at runtime and instantiates the right client. The rest of the app (label designer, print task, image encoding) is identical on both platforms.

On Android, the printer chip in the top bar opens a sheet that scans for nearby printers (names starting `FICHERO` or `D11s_`, sorted by signal strength). Tap one to connect. The last used printer is remembered (`last_printer` in localStorage) and reconnected automatically on launch unless that is switched off in the sheet. Connection helpers live in `src/utils/printer_connection.ts`.

Other native integration:

- `@capacitor/app` handles the hardware back button: it closes the open dialog or menu, then clears the canvas selection, then minimizes the app.
- `android.adjustMarginsForEdgeToEdge: "auto"` in `capacitor.config.ts` keeps the WebView clear of the system bars on Android 15+, where edge-to-edge is enforced. The theme in `res/values/styles.xml` colours the bars and splash screen to match the dark UI.
- Launcher icons, the pre-Android-12 splash images and `public/logo.png` are generated from the logo: `sh branding/render.sh` (Docker).

## Permissions

The following permissions are declared in `AndroidManifest.xml`:

| Permission | Reason |
|------------|--------|
| `BLUETOOTH`, `BLUETOOTH_ADMIN` | Legacy BLE (Android 11 and below) |
| `BLUETOOTH_SCAN` | Scan for nearby BLE devices (Android 12+) |
| `BLUETOOTH_CONNECT` | Connect to a paired device (Android 12+) |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Android 11 and below only (`maxSdkVersion` 30): BLE scanning needs them there |
| `CAMERA` | Scanning QR codes and barcodes; asked for by the WebView on the first scan |

There's no `INTERNET` permission: the WebView serves the bundled files locally, and links open in the browser.

The app requests the Bluetooth permissions at runtime the first time it scans or connects. On Android 12+ it initializes the BLE plugin with `androidNeverForLocation`, so only the Bluetooth permissions are requested. If Bluetooth is off, the system "turn on Bluetooth" dialog is shown.

## Updating after web changes

After modifying the web app, run:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

No Android-side changes are needed for web-only edits.
