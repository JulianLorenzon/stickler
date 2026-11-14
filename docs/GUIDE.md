# How to use Stickler

Stickler designs and prints labels on two small Bluetooth thermal printers: the **Fichero D11s** label printer and
**MXW01** mini printers with 57 mm paper. This guide walks through what the app can do and where to find it.

## Connect a printer

1. Switch the printer on and open Stickler. Allow Bluetooth when Android asks.
2. Tap the printer button at the top right. The printer panel lists the printers it finds, the strongest signal
   first. Tap yours to connect.
3. Next time Stickler connects by itself: when the app opens, when you come back to it, and when the printer panel
   sees one of your printers. You can turn that off in the printer panel.

Stickler remembers every printer you've connected to and connects to whichever one is switched on. Tap the ✕ next to
a printer to forget it. With a printer connected, the panel shows its battery and, where the printer supports it, lets
you set when it switches itself off.

You can design labels without a printer; you only need one to print.

## Pick the label size

Tap the size button at the top left (for example "40×14 mm"):

- **Fichero rolls**: the 30, 40 and 50 mm labels the Fichero takes.
- **57 mm rolls**: for the MXW01. **Auto length** makes the label grow with what you put on it, and only as long
  as it needs to be.
- **Custom size**: any width and length. Save sizes you use often under **My sizes**.

The designer shows the paper, with grey strips where the printer can't reach.

## Design a label

Add things from the **Add object** bar at the bottom: text, an image, a QR code, a barcode, an icon, a line, a
rectangle or a circle. **Scan** copies a code with the camera.

- **Select** something by tapping it. Drag it to move it, the corners to resize it, the rotate handle to turn it.
  The panel at the bottom then shows its settings, and **Done** closes them.
- **Align and arrange**: centre it, align it to an edge, fit it to the label, bring it to the front or send it to
  the back. **Clone** makes a copy, **Delete** removes it.
- **Text**: font, size, bold, italic, alignment and line height. "Adjust text size to fit field width" keeps a text
  inside its box. Your own fonts can be added too.
- **Images**: **Crop** lets you straighten and turn a photo, and cut it square, round, oval or to the label's shape.
- **QR codes and barcodes**: nine barcode formats, with or without the number under it.
- **Date and time**: the variable button inserts `{dt}`, which prints today's date and time.
- **Undo**, **Redo** and **Clear** are in the toolbar. Pinch to zoom; the button at the bottom right fits the label to
  the screen.

### Copy a code from a picture

Under **Scan**, **From image** reads a QR code or barcode from a picture, like the screenshot your phone makes when
you share a Wi-Fi network. You can also share a picture to Stickler from another app. A code in it is added to your
label as an editable code; a picture without a code is added as an image.

## Save and share labels

**Labels** in the toolbar keeps labels on your phone:

- **Save as new** keeps the label you're working on; **Update** saves over the one you opened.
- Tap a saved label to open it. The star picks the label the app opens with.
- Behind **⋮**: **Export** saves a label as a file, **Import** opens one, **PNG** saves a picture of it, and
  **Copy link** gives a link that opens the label.

## Print a batch from a table

**Data** in the toolbar takes a table, one label per row. The first row holds the column names, and the columns are
separated by commas. Each name becomes a variable, like `{name}`: put it in a text, QR code or barcode, and every
label gets that row's value. With the table switched on, one print gives a label for every row.

## Print

Tap **Print** (or **Connect & print** when no printer is connected). The preview shows what will come out:

- **Bitmap** is exactly what's sent to the printer; **Simulated** shows how the dots spread on paper.
- **Post-process** decides how greys become black dots. **Auto**, the default, keeps text and codes crisp and
  dithers photos. You can also pick Atkinson, Floyd–Steinberg, blue noise or Werness dithering, Bayer, or a plain
  threshold.
- The **Threshold** or **Tone** slider makes the label darker or lighter.
- **Dot correction** allows for the way thermal dots spread into each other, so greys come out on paper the way
  they look on screen. It uses your printer's calibration (see below).
- **Density** sets how hot the printer prints, **Copies** how many to print. **Invert** swaps black and white.
- On the Fichero, **Offset** moves the print on the label.

While printing, **Cancel** stops after the label being printed.

## Calibrate

**Calibration** in the app menu (⋮ at the top right) tunes Stickler to your printer. Measuring and the saved
corrections work without a printer; only the test prints need one.

**Dot correction**, in three steps:

1. **Print the grey test**: a row of greys for each dither mode. On the MXW01: thermal printers print darker once
   they're warm, so to calibrate for printing several things in a row, print it twice and measure the second.
2. **Measure it**: lay it flat in even daylight, without shadows, and use **Measure with the camera** (it measures as
   soon as all rows are in view) or **Choose a photo**.
3. **Use the result**: the chart shows how dark each grey printed, against the correction in use and the built-in
   one. **Use this correction**, **Keep to compare**, or **Discard**.

Under **Corrections** are the built-in correction and the ones you kept. Tap one to compare it with the one in use,
switch to it, or delete it. **Check print** prints the grey test with that correction; measure it, and Stickler says
whether the greys land where they should. Two photos of the same print already differ by a few percent, so small
differences don't count.

**Offset** (Fichero only): print the offset test strip and pick the label where the print sits best.

## Good to know

- Thermal paper fades in sunlight and heat. Keep labels you need for a long time out of the sun.
- Thermal printers print darker as they warm up; a long run of labels can come out a little darker towards the end.
- Stickler has no internet access. Everything stays on your phone; see the
  [privacy policy](https://stickler.julianlorenzon.com/privacy-policy.html).
- The language is set in the app menu: English, Dutch, German, Spanish or Polish.
