# lines.py <shot.png> [least length]: the long one-pixel lines of a shot, which are the borders of
# its panes, panels and dialogs. For reading a crop box when a picture is added or a layout changed.
# Needs Pillow. A line is a run of one colour that differs from the rows (columns) on both sides.
import sys
from PIL import Image

im = Image.open(sys.argv[1]).convert("RGB")
least = int(sys.argv[2]) if len(sys.argv) > 2 else 300
W, H = im.size
px = im.load()
far = lambda a, b: abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])

def runs(horizontal):
    n, m = (H, W) if horizontal else (W, H)
    at = (lambda i, j: px[j, i]) if horizontal else (lambda i, j: px[i, j])
    for i in range(1, n - 1):
        start = None
        for j in range(m + 1):
            ok = j < m and far(at(i, j), at(i - 1, j)) > 12 and far(at(i, j), at(i + 1, j)) > 12 and (start is None or far(at(i, j), at(i, j - 1)) < 6)
            if ok and start is None: start = j
            elif not ok and start is not None:
                if j - start >= least: yield i, start, j - 1, at(i, start + 5)
                start = j if j < m and far(at(i, j), at(i - 1, j)) > 12 and far(at(i, j), at(i + 1, j)) > 12 else None

for name, horizontal in (("h y", True), ("v x", False)):
    for i, a, b, c in runs(horizontal):
        print(f"{name}={i:5d}  {a:5d}..{b:5d}  len {b - a + 1:5d}  #{c[0]:02x}{c[1]:02x}{c[2]:02x}")
