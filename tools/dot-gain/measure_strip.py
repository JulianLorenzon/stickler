"""
Measure a photo of the continuous-roll grey test (one piece, a row per dither mode, see src/utils/test_prints.ts).

Finds the solid 100% patch of each row, places the other patches from the known layout (dots), and gives each
patch's darkness relative to the paper around it and that row's 100% patch: 0 = paper, 1 = solid.
Also writes an overlay with the sampled boxes, to check the placement.

usage: python measure_strip.py <photo> <overlay.jpg>
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageOps

# Layout of the strip in printer dots (test_prints.ts: GREY_ROW, drawGreyLabel)
W, ROW = 384, 112
N, GAP = 10, 2
PW = (W - 2 * 4 - (N - 1) * GAP) // N  # 35
X0 = round((W - N * PW - (N - 1) * GAP) / 2)  # 8
TOP, BOTTOM = round(ROW * 0.24), round(ROW * 0.8)  # 27, 90
ROWS = ["atkinson", "floyd", "bluenoise", "werness"]


def patch_center(i):
    return X0 + i * (PW + GAP) + PW / 2, (TOP + BOTTOM) / 2


# Phone photos store the rotation in EXIF
img = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")
rgb = np.asarray(img).astype(np.float64)
L = rgb @ np.array([0.2126, 0.7152, 0.0722])
H_, W_ = L.shape

# Paper: bright pixels. Ink inside the paper's bounding box: dark pixels
paper_mask = L > 150
ys, xs = np.nonzero(paper_mask)
y0, y1 = np.percentile(ys, [1, 99]).astype(int)
x0, x1 = np.percentile(xs, [1, 99]).astype(int)

# Solid patches: columns/rows of the paper box where a big block is almost all dark. Find dark blobs by a coarse grid
dark = (L < 90)
dark[: y0] = False
dark[y1:] = False
dark[:, : x0] = False
dark[:, x1:] = False
# Coarse cells of 24 px; a cell is solid when > 97% dark
c = 24
gh, gw = H_ // c, W_ // c
cells = dark[: gh * c, : gw * c].reshape(gh, c, gw, c).mean(axis=(1, 3)) > 0.97

# Connected components of solid cells
from collections import deque

seen = np.zeros_like(cells, dtype=bool)
blobs = []
for gy in range(gh):
    for gx in range(gw):
        if cells[gy, gx] and not seen[gy, gx]:
            q = deque([(gy, gx)])
            seen[gy, gx] = True
            pts = []
            while q:
                a, b = q.popleft()
                pts.append((a, b))
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    na, nb = a + da, b + db
                    if 0 <= na < gh and 0 <= nb < gw and cells[na, nb] and not seen[na, nb]:
                        seen[na, nb] = True
                        q.append((na, nb))
            if len(pts) >= 12:
                p = np.array(pts)
                blobs.append(((p[:, 1].mean() + 0.5) * c, (p[:, 0].mean() + 0.5) * c, len(pts)))

# The 100% patches are the right-hand column: the four rightmost solid blobs (other dark things on the paper, like
# the end of an earlier print, sit further left), top to bottom. Their centres anchor the rows.
anchors = sorted(sorted(blobs, key=lambda b: -b[0])[:4], key=lambda b: b[1])
if len(anchors) != 4:
    sys.exit(f"expected 4 rows of solid patches, found {len(anchors)}")
A = np.array([(x, y) for x, y, _ in anchors])

# Down the strip: from the first to the last anchor (3 row pitches); across: perpendicular
down = (A[-1] - A[0]) / (3 * ROW)  # image px per dot, down
s = np.linalg.norm(down)
v = down / s
u = np.array([-v[1], v[0]])  # across, pointing right
if u[0] < 0:
    u = -u


def to_img(row, sx, sy):
    cx, cy = patch_center(9)
    return A[row] + (sx - cx) * s * u + (sy - cy) * s * v


def box_mean(row, sx, sy, hw, hh):
    """Mean luminance of a hw x hh (dots, half sizes) box around a strip point"""
    p = to_img(row, sx, sy)
    rx, ry = hw * s, hh * s
    x_a, x_b = int(p[0] - rx), int(p[0] + rx)
    y_a, y_b = int(p[1] - ry), int(p[1] + ry)
    return L[y_a:y_b, x_a:x_b].mean(), (x_a, y_a, x_b, y_b)


# Paper samples: margins left and right of the print, and the blank band right of the mode name (also clear of
# the longer "· corrected" titles)
paper_pts, paper_vals, boxes_paper = [], [], []
for row in range(4):
    for sx, sy in [(-14, 30), (-14, 60), (-14, 85), (398, 30), (398, 60), (398, 85),
                   (290, 10), (320, 10), (350, 10), (375, 10)]:
        val, box = box_mean(row, sx, sy, 4, 3)
        p = to_img(row, sx, sy)
        paper_pts.append(p)
        paper_vals.append(val)
        boxes_paper.append(box)
P = np.array(paper_pts)
# Quadratic fit of paper brightness over the image (light falls off across the photo)
X = np.column_stack([np.ones(len(P)), P[:, 0], P[:, 1], P[:, 0] ** 2, P[:, 1] ** 2, P[:, 0] * P[:, 1]])
coef, *_ = np.linalg.lstsq(X, np.array(paper_vals), rcond=None)


def paper_at(p):
    return coef @ np.array([1, p[0], p[1], p[0] ** 2, p[1] ** 2, p[0] * p[1]])


res = np.array(paper_vals) - X @ coef
result, boxes = {}, []
for row, name in enumerate(ROWS):
    refl = []
    for i in range(N):
        cx, cy = patch_center(i)
        val, box = box_mean(row, cx, cy, PW * 0.3, (BOTTOM - TOP) * 0.33)
        boxes.append(box)
        refl.append(val / paper_at(to_img(row, cx, cy)))
    black = refl[-1]
    result[name] = [round((1 - r) / (1 - black), 3) for r in refl[:-1]]

print(json.dumps({"scale_px_per_dot": round(s, 3), "paper_fit_rms": round(float(np.sqrt((res ** 2).mean())), 2),
                  "paper_range": [round(min(paper_vals)), round(max(paper_vals))], "measured": result}, indent=1))

ov = img.copy()
d = ImageDraw.Draw(ov)
for b in boxes:
    d.rectangle(b, outline=(255, 0, 0), width=5)
for b in boxes_paper:
    d.rectangle(b, outline=(0, 160, 255), width=5)
for x, y in A:
    d.ellipse((x - 15, y - 15, x + 15, y + 15), outline=(0, 255, 0), width=6)
ov.thumbnail((1200, 1600))
ov.save(sys.argv[2], quality=85)
