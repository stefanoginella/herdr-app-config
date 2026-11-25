"""Migrate the three renamed Power Tools mods in an existing Herdr home."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
NAMES = {"usage": "agent-usage", "agents-unread": "agent-inbox", "git-panel": "git-graph"}
OLD_TIP = "9715f94a609aa049fceee033706dabce17053494"


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def tree(ref, name):
    prefix = "mods/" + name + "/"
    entries = git("ls-tree", "-r", "-z", ref, "--", prefix)
    files = {}
    for line in entries.split(b"\0"):
        if line:
            meta, path = line.decode().split("\t", 1)
            files[path[len(prefix):]] = meta.split()[2]
    return files


def local_files(folder):
    files = {}
    for path in folder.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Review the local symlink before migrating: {path}")
        if not path.is_file() or path.name in {"jsconfig.json", ".DS_Store"} or path.name.endswith(".d.ts") or "__pycache__" in path.parts:
            continue
        data = path.read_bytes()
        files[path.relative_to(folder).as_posix()] = hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()
    return files


def action(value, names):
    if isinstance(value, dict):
        result = dict(value)
        cmd = value.get("command")
        args = value.get("args")
        if isinstance(cmd, str):
            result["command"] = action(cmd, names)
        if isinstance(args, dict):
            result["args"] = layout(args, names)
            if cmd in {"mod.open", "mod.clone"} and args.get("name") in names:
                result["args"]["name"] = names[args["name"]]
        return result
    if isinstance(value, str):
        for old, new in names.items():
            if value.startswith(old + "."):
                return new + value[len(old):]
            if value == "mod.open:" + old:
                return "mod.open:" + new
    return value


def layout(value, names):
    if isinstance(value, list):
        return [layout(item, names) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key in {"mod", "toast", "terminal_menu"} and isinstance(item, str):
                result[key] = names.get(item, item)
            elif key == "link_handlers" and isinstance(item, list):
                result[key] = [names.get(mod, mod) for mod in item]
            else:
                result[key] = layout(item, names)
        return result
    if isinstance(value, str):
        for old, new in names.items():
            if value.startswith("mods/" + old + "/"):
                return "mods/" + new + value[len("mods/" + old):]
    return value


def keymap(value, names):
    result = {}
    for section, bindings in value.items():
        base, sep, suffix = section.partition(" > ")
        target = "mod:" + names[base[4:]] + sep + suffix if base.startswith("mod:") and base[4:] in names else section
        dest = result.setdefault(target, {})
        for key, original in bindings.items():
            binding = action(original, names)
            if key in dest and dest[key] != binding:
                raise ValueError(f"Conflicting shortcuts in {target}: {key}")
            dest[key] = binding
    return result


def migrate(home, apply):
    if not (home / "mods").is_dir():
        raise ValueError(f"No Herdr mods directory in {home}")
    head = git("rev-parse", "HEAD").decode().strip()
    registry = Path("data/pkg/packages.json")
    records = json.loads((home / registry).read_text()) if (home / registry).exists() else {}
    original_records = json.dumps(records, sort_keys=True)
    packages = records.get("packages", {})
    names = {}
    writes = {}
    archive = []

    def change_json(path, convert):
        if (home / path).is_file():
            old = json.loads((home / path).read_text())
            new = convert(old)
            if new != old:
                writes[path] = (json.dumps(new, ensure_ascii=False, indent=2) + "\n").encode()

    for old, new in NAMES.items():
        src, dst = Path("mods", old), Path("mods", new)
        old_key, new_key = "mod:" + old, "mod:" + new
        rec = packages.get(old_key)
        if not ((home / src).exists() or (home / dst).is_dir() or rec):
            continue
        expected = tree(head, new)
        if not expected:
            raise ValueError("Run this from a checkout containing the committed renames.")
        if rec:
            if rec.get("pin") or rec.get("branch") or rec.get("renamed") or rec.get("path") != src.as_posix():
                raise ValueError(f"Review the pinned, branch-specific or renamed herdr-pkg record for {old} before migrating.")
            if rec["source"].split("/")[-1] not in {"herdr-app-config", "herdr-powertools"} or new_key in packages:
                raise ValueError(f"Conflicting herdr-pkg source or destination for {old}.")
        if (home / src).is_dir():
            ours = local_files(home / src)
            if ours:
                history = git("log", "--format=%H", OLD_TIP, "--", src.as_posix()).decode().splitlines()
                if not any(ours == tree(commit, old) for commit in history):
                    raise ValueError(f"{src} contains local edits. Back it up and port them before replacing it.")
            archive.append(src)
        if (home / dst).is_dir():
            if (rec or (home / src).is_dir()) and home != ROOT and local_files(home / dst) != expected:
                raise ValueError(f"{dst} already exists with different files.")
        else:
            # Herdr can see the directory as soon as its first file lands.
            for rel in sorted(expected, key=lambda rel: rel != "mod.json"):
                sha = expected[rel]
                writes[dst / rel] = git("cat-file", "blob", sha)
        names[old] = new
        data = Path("data", old)
        if (home / data).is_dir():
            for path in (home / data).rglob("*"):
                if path.is_file():
                    target = Path("data", new) / path.relative_to(home / data)
                    if not (home / target).exists():
                        writes[target] = path.read_bytes()
                    elif (home / target).read_bytes() != path.read_bytes():
                        raise ValueError(f"Both {data} and data/{new} have different settings for the same view. Reconcile the two copies first.")
            archive.append(data)
        if rec:
            packages.pop(old_key)
            owner = rec["source"].split("/")[0]
            packages[new_key] = dict(rec, name=new, path=dst.as_posix(), source=owner + "/herdr-powertools",
                                     files=expected, modified=[], commit=head)
            packages[new_key].pop("conflict", None)

    if not names:
        print("No Power Tools mods to migrate.")
        return
    for path in (home / "layouts").glob("*.json"):
        change_json(path.relative_to(home), lambda obj: layout(obj, names))
    change_json(Path("windows.json"), lambda obj: layout(obj, names))
    change_json(Path("keys.json"), lambda obj: keymap(obj, names))
    for rec in packages.values():
        for binding in rec.get("keys", []):
            binding["action"] = action(binding["action"], names)
            binding["section"] = next(iter(keymap({binding["section"]: {}}, names)))
    if json.dumps(records, sort_keys=True) != original_records:
        writes[registry] = (json.dumps(records, indent=2, sort_keys=True) + "\n").encode()
        cache = Path("data/pkg/outdated.json")
        if (home / cache).is_file():
            archive.append(cache)
    if not writes and not archive:
        print("Already migrated.")
        return
    print(f"{len(writes)} files to write and {len(archive)} old paths to archive.")
    if not apply:
        print("Dry run. Quit Herdr and use --apply to migrate.")
        return
    (home / "data").mkdir(exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="powertools-migration-", dir=home / "data"))
    print(f"Backup: {backup}")
    written, moved = [], []
    try:
        for rel, content in writes.items():
            dest = home / rel
            if dest.exists():
                (backup / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dest, backup / rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as tmp:
                tmp.write(content)
            if dest.is_file():
                shutil.copymode(dest, tmp.name)
            os.replace(tmp.name, dest)
            written.append(rel)
        for rel in archive:
            (backup / rel).parent.mkdir(parents=True, exist_ok=True)
            (home / rel).rename(backup / rel)
            moved.append(rel)
    except BaseException:
        for rel in reversed(moved):
            (backup / rel).rename(home / rel)
        for rel in reversed(written):
            if (backup / rel).exists():
                shutil.copy2(backup / rel, home / rel)
            else:
                (home / rel).unlink()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("HERDR_APP_HOME", "~/.config/herdr-app")).expanduser())
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        migrate(args.home.resolve(), args.apply)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, str(exc) + "\n")
