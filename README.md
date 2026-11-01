<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/lockup-dark.png">
    <img src="branding/lockup.png" alt="Stickler" width="480">
  </picture>
</p>

<p align="center">A label designer for the Fichero D11s thermal label printer. No account, no ads, no tracking.</p>

---

The [Fichero](https://www.action.com/nl-nl/p/3212141/fichero-labelprinter/) is a cheap Bluetooth label printer sold
at Action. Its official app asks for 26 permissions, including your advertising ID and ad attribution tracking.
Stickler talks to the printer directly and only asks for Bluetooth (plus location on Android 11 and older,
where Android requires it for any Bluetooth scan), and for the camera the first time you scan a code.

## What it does

- **Design labels:** text, images, QR codes, barcodes (EAN-13/8, UPC-A/E, ITF, Code 39/93/128, Codabar), lines and
  shapes, on the Fichero label rolls or a custom size
- **Print photos well on a 1-bit printer:** Atkinson (the default), Floyd–Steinberg, blue noise and Werness
  dithering, with dot gain correction so greys come out the way they look on screen
- **See it before you print it:** an "on paper" preview that simulates how the thermal dots spread
- **Copy codes:** scan a QR code or barcode with the camera and get an editable copy on the label
- **Batch print** from a data table, one label per row
- **Calibrate** the print position with an offset test strip
- **Save** labels on the device and export them as JSON or PNG

## Get it

Stickler runs on Android 6.0 or newer. For now it's shared as an APK; ask for a copy. To build it yourself, see
[docs/BUILDING.md](docs/BUILDING.md).

## The printer

Internally the Fichero is an AiYin D11s: a 96-dot printhead at 203 DPI that prints 1-bit images onto 14 mm labels
over Bluetooth Low Energy. The protocol is documented in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Credits

Stickler started as a fork of [fichero-printer](https://github.com/0xMH/fichero-printer) by Hamza (0xMH), who
reverse engineered the printer's protocol and wrote the first web version
([blog post](https://blog.dbuglife.com/reverse-engineering-fichero-label-printer/)). The label designer grew out of
[NiimBlue](https://github.com/MultiMote/niimblue) by MultiMote, and the threshold and Atkinson dithering code comes
from [CanvasDither](https://github.com/NielsLeenheer/CanvasDither) by Niels Leenheer. The app's About screen lists
every open source component and its licence.

Stickler is not affiliated with Action, Fichero or AiYin.

## Licence

Stickler is free software under the [GNU GPL, version 3 or later](LICENSE). Parts that come from fichero-printer,
NiimBlue and CanvasDither keep their MIT licence; [NOTICE](NOTICE) has their notices. The barcode reader is
[zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (Apache-2.0), compiled to WebAssembly by
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT).
