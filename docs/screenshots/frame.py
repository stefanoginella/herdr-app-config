# frame.py <pictures.json> --root <folder of raw/> --out <folder> [name ...]
# Every picture on one canvas, from the raw full-window shots. Needs Pillow.
# A card is a part of a shot exactly as the app drew it, at its own pixels: nothing is scaled.
#
# The spec: { "canvas": [W, H], "mat": {...}, "card": {...}, "pictures": { name: {...} } }
#   mat      { "color": "#rrggbb" }                           a flat backdrop
#            { "from": "#..", "to": "#..", "angle": 90 }      a gradient (in degrees, 90 = top to bottom)
#            + "radius": N                                    the canvas's own rounded corners (the rest is clear)
#   card     { "radius": N, "border": "#rrggbbaa", "shadow": {...} | [{...}, ...] }   what every card gets
#   picture  { "canvas": [W, H]?, "mat": {...}?, "cards": [ card ... ] }              cards are drawn in order
#   card     { "src": "raw/x.png", "crop": [x, y, w, h],    the part of the shot (all of it without)
#              "at": [x, y] | "center",                     where its top left goes on the canvas
#              "radius", "border", "shadow",                this card's own
#              "square": ["tl", "tr", "bl", "br"],          corners left square
#              "lights": [x, y, diameter, pitch] }          the window's three buttons, drawn at that spot
#   shadow   { "blur": N, "y": N, "alpha": 0..1 }
import json, math, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SS = 4  # supersampling for the masks


def rgba(c, alpha=None):
    c = c.lstrip("#")
    v = [int(c[i:i + 2], 16) for i in range(0, len(c), 2)]
    if len(v) == 3: v.append(255)
    if alpha is not None: v[3] = round(alpha * 255)
    return tuple(v)


def round_mask(size, radius, square=()):
    w, h = size
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    d.rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius * SS, fill=255,
                        corners=("tl" not in square, "tr" not in square, "br" not in square, "bl" not in square))
    return big.resize((w, h), Image.Resampling.LANCZOS)


def mat(size, m):
    w, h = size
    if "from" in m:
        a, b = rgba(m["from"]), rgba(m["to"])
        ang = math.radians(m.get("angle", 90)); dx, dy = math.cos(ang), math.sin(ang)
        # project each pixel on the gradient's axis, 0..1 across the canvas
        span = abs(dx) * w + abs(dy) * h
        ramp = Image.new("F", (w, h))
        px = ramp.load()
        ox, oy = (0 if dx >= 0 else w), (0 if dy >= 0 else h)
        for y in range(h):
            for x in range(w):
                px[x, y] = ((x - ox) * dx + (y - oy) * dy) / span
        t = ramp.point(lambda v: v * 255).convert("L")
        im = Image.composite(Image.new("RGBA", size, b), Image.new("RGBA", size, a), t)
    else:
        im = Image.new("RGBA", size, rgba(m.get("color", "#1b1e27")))
    if m.get("radius"):
        im.putalpha(round_mask(size, m["radius"]))
    return im


def card_image(root, c, base):
    im = Image.open(root / c["src"]).convert("RGBA")
    if "crop" in c:
        x, y, w, h = c["crop"]; im = im.crop((x, y, x + w, y + h))
    s = c.get("scale", 1.0)
    if "fit" in c:
        s = min(c["fit"][0] / im.width, c["fit"][1] / im.height)
    if s != 1.0:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.LANCZOS)
    radius = c.get("radius", base.get("radius", 0))
    mask = round_mask(im.size, radius, c.get("square", ()))
    im.putalpha(mask)
    border = c.get("border", base.get("border"))
    if border:
        # a hairline inside the card's edge
        ring = ImageChops.subtract(mask, round_mask_inset(im.size, radius, c.get("square", ()), 1))
        line = Image.new("RGBA", im.size, rgba(border)[:3] + (0,))
        a = rgba(border)[3]
        line.putalpha(ring.point([v * a // 255 for v in range(256)]))
        im = Image.alpha_composite(im, line)
    return im, mask


def round_mask_inset(size, radius, square, inset):
    w, h = size
    big = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(big)
    i = inset * SS
    d.rounded_rectangle((i, i, w * SS - 1 - i, h * SS - 1 - i), max(0, radius - inset) * SS, fill=255,
                        corners=("tl" not in square, "tr" not in square, "br" not in square, "bl" not in square))
    return big.resize((w, h), Image.Resampling.LANCZOS)


def shadow_layer(size, mask, at, sh):
    layer = Image.new("L", size, 0)
    layer.paste(mask, (at[0], at[1] + sh.get("y", 0)))
    layer = layer.filter(ImageFilter.GaussianBlur(sh.get("blur", 30)))
    out = Image.new("RGBA", size, rgba(sh.get("color", "#000000"))[:3] + (0,))
    a = sh.get("alpha", 0.5)
    out.putalpha(layer.point([round(v * a) for v in range(256)]))
    return out


def build(root, spec, name):
    p = spec["pictures"][name]
    size = tuple(p.get("canvas", spec["canvas"]))
    m = {**spec.get("mat", {}), **p.get("mat", {})}
    canvas = mat(size, m)
    keep = canvas.getchannel("A")
    base = spec.get("card", {})
    for c in p["cards"]:
        im, mask = card_image(root, c, base)
        at = c.get("at", "center")
        if at == "center": at = [(size[0] - im.width) // 2, (size[1] - im.height) // 2]
        at = (round(at[0]), round(at[1]))
        sh = c.get("shadow", base.get("shadow")) or []
        for one in (sh if isinstance(sh, list) else [sh]):   # a card can cast several: ambient, then contact
            canvas = Image.alpha_composite(canvas, shadow_layer(size, mask, at, one))
        layer = Image.new("RGBA", size, (0, 0, 0, 0)); layer.paste(im, at)
        canvas = Image.alpha_composite(canvas, layer)
        if c.get("lights"):
            # the window's three buttons: the system draws them, so a shot of the app has none
            lx, ly, d, pitch = c["lights"]
            big = Image.new("RGBA", (size[0] * SS, size[1] * SS), (0, 0, 0, 0)); dr = ImageDraw.Draw(big)
            for k, col in enumerate(("#ff5f57", "#febc2e", "#28c840")):
                x0, y0 = (at[0] + lx + k * pitch) * SS, (at[1] + ly) * SS
                dr.ellipse((x0, y0, x0 + d * SS, y0 + d * SS), fill=rgba(col), outline=rgba("#00000033"), width=SS // 2)
            canvas = Image.alpha_composite(canvas, big.resize(size, Image.Resampling.LANCZOS))
    canvas.putalpha(keep)  # cards and shadows never leave the mat's own shape
    out = Path(spec["out"]); out.mkdir(parents=True, exist_ok=True)
    f = out / f"{name}.png"
    canvas.save(f, optimize=True)
    print(f, canvas.size, f"{f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    args = sys.argv[1:]
    def take(flag):
        i = args.index(flag); v = args[i + 1]; del args[i:i + 2]; return v
    if not args or "--root" not in args or "--out" not in args:
        raise SystemExit("usage: frame.py <pictures.json> --root <folder of raw/> --out <folder> [name ...]")
    root, out = Path(take("--root")), Path(take("--out"))
    spec = json.loads(Path(args[0]).read_text())
    spec["out"] = str(out)
    for n in (args[1:] or spec["pictures"]):
        build(root, spec, n)
