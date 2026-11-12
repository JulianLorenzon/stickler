"""
Turns a photo into raw pixels for calibrate.mjs (Node has no JPEG decoder): 8 bytes of width and height (uint32 LE),
then RGBA. Applies the EXIF rotation like the app's createImageBitmap does, scales the long side down to <max side>,
and can turn or shrink the photo to try other framings.

usage: python to_raw.py <photo> <out.rgba> [max side = 1600] [turn degrees = 0] [shrink = 1]
"""
import struct
import sys

from PIL import Image, ImageOps

img = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGBA")
side = int(sys.argv[3]) if len(sys.argv) > 3 else 1600
turn = float(sys.argv[4]) if len(sys.argv) > 4 else 0
shrink = float(sys.argv[5]) if len(sys.argv) > 5 else 1
img.thumbnail((side, side))
if turn:
    img = img.rotate(turn, expand=True, resample=Image.BICUBIC, fillcolor=(40, 40, 40, 255))
if shrink != 1:
    # The strip smaller in the frame, on a dark table
    small = img.resize((round(img.width * shrink), round(img.height * shrink)))
    img = Image.new("RGBA", img.size, (40, 40, 40, 255))
    img.paste(small, ((img.width - small.width) // 2, (img.height - small.height) // 2))
with open(sys.argv[2], "wb") as f:
    f.write(struct.pack("<II", img.width, img.height))
    f.write(img.tobytes())
