"""Refresh the files distributed in the Herdr gallery from the live configuration."""

import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
# Gallery slug -> mod folders shipped together.
FEATURES = {
    "agent-usage": ["agent-usage"],
    "space-folders": ["space-folders"],
    "agent-inbox": ["agent-inbox"],
    "git-graph": ["git-graph"],
    "git-diff": ["git-diff"],
    "file-editor": ["file-editor", "editor-links"],
    "project-search": ["project-search"],
    "go-to-file": ["go-to-file"],
    "file-actions": ["files-actions"],
    "hide-names": ["tabs-names", "pane-names", "status-names"],
}
PICTURES = {"agent-usage": "usage", "agent-inbox": "unread-agents", "git-graph": "git-panel"}


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
                    belongs = feature == "agent-inbox"
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

    def preview(folder, name):
        path = folder / "preview.png"
        dest = ROOT / path
        with Image.open(ROOT / "docs" / "images" / (name + ".webp")) as image:
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
        preview(folder, PICTURES.get(feature, feature))

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
