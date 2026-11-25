"""Refresh the files distributed in the Herdr gallery from the live configuration."""

import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
# Gallery slug -> mod folders shipped together.
FEATURES = {
    "agent-usage": ["agent-usage"],
    "space-folders": ["space-folders"],
    "mark-agents-unread": ["mark-agents-unread"],
    "git-panel": ["git-panel"],
    "git-diff": ["git-diff"],
    "file-editor": ["file-editor", "editor-links"],
    "project-search": ["project-search"],
    "go-to-file": ["go-to-file"],
    "file-explorer": ["file-explorer"],
    "hide-names": ["tabs-names", "pane-names", "hide-names"],
}
PICTURES = {"agent-usage": "usage", "mark-agents-unread": "unread-agents", "file-explorer": "file-actions"}


def wrap_text(text, face, width):
    lines = []
    for word in text.split():
        if lines and face.getlength(lines[-1] + " " + word) <= width:
            lines[-1] += " " + word
        else:
            lines.append(word)
    return lines


def gallery_card(screenshot, title, spec):
    """Make a 16:10 gallery cover from the published demo screenshot and its recipe title."""
    size = (1280, 800)
    ramp = Image.linear_gradient("L").resize(size)
    canvas = Image.composite(Image.new("RGB", size, "#bdcde0"), Image.new("RGB", size, "#edf2f8"), ramp)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.polygon([(860, 0), (1280, 0), (1280, 800), (530, 800)], fill=(77, 111, 156, 22))
    for shot in spec["shots"]:
        x, y, w, h = shot["crop"]
        if x < 0 or y < 0 or x + w > screenshot.width or y + h > screenshot.height:
            raise ValueError(f"{title} crop falls outside its screenshot")
        width = shot["width"]
        panel = screenshot.crop((x, y, x + w, y + h)).convert("RGB")
        panel = panel.resize((width, round(h * width / w)), Image.Resampling.LANCZOS)
        mask = Image.new("L", panel.size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, panel.width - 1, panel.height - 1), 10, fill=255)
        px, py = shot["at"]
        shadow = Image.new("L", size)
        shadow.paste(mask.point(lambda v: v * 74 // 255), (px, py + 16))
        canvas.paste("#283449", (0, 0), shadow.filter(ImageFilter.GaussianBlur(17)))
        canvas.paste(panel, (px, py), mask)

    # Pillow ships this typeface with its wheel so checks use the same lettering on each OS.
    label = ImageFont.load_default(size=28)
    heading = ImageFont.load_default(size=101)
    body = ImageFont.load_default(size=38)
    ink = "#142539"
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((66, 68, 73, 93), fill="#3071a4")
    draw.text((89, 70), "HERDR POWER TOOLS", font=label, fill=ink, anchor="lt")

    titles = wrap_text(title, heading, 490)
    captions = wrap_text(spec["caption"], body, 456)
    title_step, caption_step = 100, 47
    height = len(titles) * title_step + 20 + len(captions) * caption_step
    top = (size[1] - height) // 2 + 24
    for i, line in enumerate(titles):
        draw.text((63, top + i * title_step), line, font=heading, fill=ink, stroke_width=2, stroke_fill=ink, anchor="lt")
    for i, line in enumerate(captions):
        draw.text((67, top + len(titles) * title_step + 20 + i * caption_step), line,
                  font=body, fill="#344c63", anchor="lt")
    return canvas


def tracked(*paths):
    raw = subprocess.check_output(["git", "ls-files", "-z", "--", *paths], cwd=ROOT)
    return [Path(p.decode()) for p in raw.split(b"\0") if p]


def feature_keys(feature, mods, keys):
    result = {}
    sections = {"mod:" + mod for mod in mods}
    for section, bindings in keys.items():
        for key, action in bindings.items():
            command = action["command"] if isinstance(action, dict) else action
            args = action.get("args", {}) if isinstance(action, dict) else {}
            if command == "file-editor.search-project":
                belongs = feature == "project-search"
            elif section == "global":
                belongs = any(command.startswith(mod + ".") or command == "mod.open:" + mod for mod in mods)
                if command == "mod.open":
                    belongs = args.get("name") in mods
                if command.startswith("agent.select:") or command == "agent.select":
                    belongs = feature == "mark-agents-unread"
            else:
                belongs = section.split(" > ")[0] in sections
            if belongs:
                result.setdefault(section, {})[key] = action
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report stale gallery files without writing")
    check = parser.parse_args().check
    keys = json.loads((ROOT / "keys.json").read_text())
    cards = json.loads((ROOT / "docs/gallery-cards.json").read_text())
    changed = []
    expected = set()

    def put(path, data):
        expected.add(path)
        dest = ROOT / path
        if dest.is_file() and dest.read_bytes() == data:
            return
        changed.append(path)
        if not check:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)

    def preview(folder, name, card=None):
        path = folder / "preview.png"
        dest = ROOT / path
        with Image.open(ROOT / "docs" / "images" / (name + ".webp")) as screenshot:
            image = screenshot
            if card:
                title = (ROOT / folder / "RECIPE.md").read_text().splitlines()[0].removeprefix("# ")
                image = gallery_card(screenshot, title, card)
            if dest.is_file():
                with Image.open(dest) as old:
                    if old.format == "PNG" and old.size == image.size and old.mode == image.mode and old.tobytes() == image.tobytes():
                        return
            changed.append(path)
            if not check:
                image.save(dest, format="PNG")

    preview(Path("."), "power-tools")
    for feature, mods in FEATURES.items():
        folder = Path("packages") / feature
        sources = tracked(*["mods/" + mod for mod in mods])
        for mod in mods:
            if Path("mods", mod, "mod.json") not in sources:
                raise ValueError(f"Missing tracked manifest for {mod}")
        for source in sources:
            if (ROOT / source).is_file():
                put(folder / source, (ROOT / source).read_bytes())
        bindings = feature_keys(feature, mods, keys)
        if bindings:
            put(folder / "keys.json", (json.dumps(bindings, indent=2) + "\n").encode())
        preview(folder, PICTURES.get(feature, feature), cards[feature])

    # Only remove previously published, generated files that have lost their source.
    for path in tracked("packages/*/mods/**", "packages/*/keys.json"):
        if path not in expected and (ROOT / path).is_file():
            changed.append(path)
            if not check:
                (ROOT / path).unlink()
    if check and changed:
        for path in changed:
            print(path)
        raise SystemExit("Refresh the gallery with python3 docs/gallery.py")
    print(f"{len(FEATURES)} feature packages, {len(changed)} files {'stale' if check else 'refreshed'}")


if __name__ == "__main__":
    main()
