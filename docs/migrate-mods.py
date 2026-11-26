"""Migrate renamed Power Tools mods and layout in an existing Herdr home."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
OLD_LOOK = "main-folders"
NEW_LOOK = "herdr-powertools"
NAMES = {
    "usage": "agent-usage",
    "agent-inbox": "mark-agents-unread",
    "agents-unread": "mark-agents-unread",
    "git-graph": "git-panel",
    "files-actions": "file-explorer",
    "back-forward": "back-and-forward",
    "status-names": "hide-names",
}
PACKAGE_SLUGS = {
    "agent-inbox": "agent-inbox",
    "git-graph": "git-graph",
    "files-actions": "file-actions",
    "status-names": "hide-names",
}


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
            if cmd == "layout.switch" and args.get("name") == OLD_LOOK:
                result["args"]["name"] = NEW_LOOK
        return result
    if isinstance(value, str):
        if value == "layout.switch:" + OLD_LOOK:
            return "layout.switch:" + NEW_LOOK
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
        if section == "layout:" + OLD_LOOK:
            target = "layout:" + NEW_LOOK
        dest = result.setdefault(target, {})
        for key, original in bindings.items():
            binding = action(original, names)
            if key in dest and dest[key] != binding:
                raise ValueError(f"Conflicting shortcuts in {target}: {key}")
            dest[key] = binding
    return result


def merge_layout(base, local, upstream):
    if local == base:
        return upstream
    if upstream == base or local == upstream:
        return local
    with tempfile.TemporaryDirectory() as scratch:
        paths = [Path(scratch) / name for name in ("local", "installed", "upstream")]
        for path, content in zip(paths, (local, base, upstream)):
            path.write_bytes(content)
        result = subprocess.run(["git", "merge-file", "-p", *paths], capture_output=True)
        if result.returncode:
            raise ValueError(f"Local edits to {OLD_LOOK} conflict with the new layout. Reconcile them before migrating.")
        return result.stdout


def migrate(home, apply):
    if not (home / "mods").is_dir():
        raise ValueError(f"No Herdr mods directory in {home}")
    head = git("rev-parse", "HEAD").decode().strip()
    registry = Path("data/pkg/packages.json")
    records = json.loads((home / registry).read_text()) if (home / registry).exists() else {}
    original_records = json.dumps(records, sort_keys=True)
    packages = records.get("packages", {})
    remote = subprocess.run(["git", "-C", str(ROOT), "remote", "get-url", "origin"],
                            capture_output=True, text=True).stdout.strip()
    origin = re.search(r"github\.com[/:]([^/:]+)/(herdr-powertools|herdr-app-config)(?:\.git)?/?$", remote, re.I)
    source = origin.group(1) + "/herdr-powertools" if origin else None
    previous = origin.group(1) + "/herdr-app-config" if origin else None
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
        data = Path("data", old)
        old_key, new_key = "mod:" + old, "mod:" + new
        rec = packages.get(old_key)
        if not ((home / src).exists() or (home / dst).is_dir() or (home / data).is_dir() or rec):
            continue
        expected = tree(head, new)
        if not expected:
            raise ValueError("Run this from a checkout containing the committed renames.")
        if rec:
            package = PACKAGE_SLUGS.get(old)
            tracked_path = rec.get("path")
            standalone = package and tracked_path == f"packages/{package}/{src}"
            if rec.get("pin") or rec.get("branch") or rec.get("renamed") or not (standalone or tracked_path == src.as_posix()):
                raise ValueError(f"Review the pinned, branch-specific or renamed herdr-pkg record for {old} before migrating.")
            if not source or rec["source"] not in {previous, source} or new_key in packages:
                raise ValueError(f"Conflicting herdr-pkg source or destination for {old}.")
        legacy_code = {}
        if (home / src).is_dir():
            legacy_code = local_files(home / src)
            if legacy_code:
                history = git("log", "--format=%H", head, "--", src.as_posix()).decode().splitlines()
                if not any(legacy_code == tree(commit, old) for commit in history):
                    raise ValueError(f"{src} contains local edits. Back it up and port them before replacing it.")
            archive.append(src)
        if (home / dst).is_dir():
            if (rec or legacy_code) and home != ROOT and local_files(home / dst) != expected:
                raise ValueError(f"{dst} already exists with different files.")
        else:
            # Herdr can see the directory as soon as its first file lands.
            for rel in sorted(expected, key=lambda rel: rel != "mod.json"):
                sha = expected[rel]
                writes[dst / rel] = git("cat-file", "blob", sha)
        names[old] = new
        if (home / data).is_dir():
            for path in (home / data).rglob("*"):
                if path.is_file():
                    target = Path("data", new) / path.relative_to(home / data)
                    content = path.read_bytes()
                    if target in writes or (home / target).exists():
                        existing = writes[target] if target in writes else (home / target).read_bytes()
                        if existing == content:
                            continue
                        if target in writes or rec or legacy_code:
                            raise ValueError(f"Both {data} and data/{new} have different settings for the same view. Reconcile the two copies first.")
                        # A Git pull may already have switched the live app to the new ID.
                        # It owns the current preference. Archive the previous copy intact.
                        print(f"Keeping the active {new} preference and backing up its earlier {old} copy.")
                    else:
                        writes[target] = content
            archive.append(data)
        if rec:
            packages.pop(old_key)
            updated_path = f"packages/{new}/{dst}" if standalone else dst.as_posix()
            packages[new_key] = dict(rec, name=new, path=updated_path, files=expected, modified=[], commit=head)
            packages[new_key].pop("conflict", None)

    old_look, new_look = (Path("layouts", name + ".json") for name in (OLD_LOOK, NEW_LOOK))
    old_key, new_key = ("layout:" + name for name in (OLD_LOOK, NEW_LOOK))
    rec = packages.get(old_key)
    has_old, has_new = ((home / rel).is_file() for rel in (old_look, new_look))
    if rec and not (has_old or has_new):
        raise ValueError(f"The tracked layout {OLD_LOOK} is missing. Restore it before migrating.")
    if has_old or has_new:
        existing_new = (home / new_look).read_bytes() if has_new else None
        current = existing_new if has_new else (home / old_look).read_bytes()
        if has_old:
            if has_new and (home / old_look).read_bytes() != current:
                raise ValueError(f"Both {old_look} and {new_look} exist and differ. Reconcile them before migrating.")
            archive.append(old_look)
        if rec:
            if not source or rec.get("source") not in {previous, source} or rec.get("path") != old_look.as_posix() or new_key in packages:
                raise ValueError(f"Conflicting herdr-pkg source or destination for {OLD_LOOK}.")
            if rec.get("pin") or rec.get("branch") or rec.get("renamed"):
                raise ValueError(f"Review the pinned, branch-specific or renamed herdr-pkg record for {OLD_LOOK} before migrating.")
            upstream_sha = git("rev-parse", "--verify", f"{head}:{new_look.as_posix()}").decode().strip()
            upstream = git("cat-file", "blob", upstream_sha)
            if not has_new:
                base = git("show", f"{rec['commit']}:{old_look.as_posix()}")
                current = merge_layout(base, current, upstream)
        original = json.loads(current)
        updated = layout(original, names)
        if original != updated:
            current = (json.dumps(updated, ensure_ascii=False, indent=2) + "\n").encode()
        if current != existing_new:
            writes[new_look] = current
        if rec:
            del packages[old_key]
            packages[new_key] = dict(rec, name=NEW_LOOK, path=new_look.as_posix(),
                                     files={new_look.name: upstream_sha}, commit=head,
                                     modified=[new_look.name] if current != upstream else [])
            packages[new_key].pop("conflict", None)
        old_state, new_state = (Path("layouts", ".state", rel.name) for rel in (old_look, new_look))
        if (home / old_state).is_file():
            if not (home / new_state).exists():
                writes[new_state] = (home / old_state).read_bytes()
            archive.append(old_state)
        change_json(Path("shared.json"), lambda obj: dict(obj, layout=NEW_LOOK) if obj.get("layout") == OLD_LOOK else obj)

    for path in (home / "layouts").glob("*.json"):
        if path.name in {old_look.name, new_look.name}:
            continue
        change_json(path.relative_to(home), lambda obj: layout(obj, names))
    change_json(Path("windows.json"), lambda obj: layout(obj, names))
    change_json(Path("keys.json"), lambda obj: keymap(obj, names))
    for rec in packages.values():
        if origin and origin.group(2) == "herdr-powertools" and rec.get("source") == previous:
            rec["source"] = source
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
