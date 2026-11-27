"""Copy the packaged mods into a Herdr home for local development."""

import argparse
from fnmatch import fnmatch
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
EXCLUDE = (".*", "*.d.ts", "jsconfig.json", "node_modules", "__pycache__")


def sources():
    mods = {}
    for manifest in sorted((ROOT / "packages").glob("*/mods/*/mod.json")):
        source = manifest.parent
        if source.name in mods:
            raise ValueError(f"More than one package contains {source.name}")
        mods[source.name] = source
    if not mods:
        raise ValueError("No packaged mods found")
    return mods


def snapshot(mods):
    def included(name):
        return not any(fnmatch(name, pattern) for pattern in EXCLUDE)

    files = {}
    for source in mods.values():
        for folder, dirs, names in os.walk(source):
            dirs[:] = [name for name in dirs if included(name)]
            for name in filter(included, names):
                path = Path(folder, name)
                try:
                    st = path.stat()
                except FileNotFoundError:
                    continue  # An editor can replace a file during a scan.
                files[path] = (st.st_ino, st.st_size, st.st_mtime_ns, st.st_mode)
    return files


def sync(mods, home, rsync):
    runtime = home / "mods"
    if runtime.is_symlink():
        raise ValueError(f"Expected a real directory at {runtime}")
    runtime.mkdir(parents=True, exist_ok=True)
    for name in mods:
        dest = runtime / name
        if dest.is_symlink() or (dest.exists() and not dest.is_dir()):
            raise ValueError(f"Expected a real directory at {dest}")

    for name, source in mods.items():
        dest = runtime / name
        command = [rsync, "-rcp", "--delete-after", "--delay-updates", "--itemize-changes"]
        command.extend(f"--exclude={pattern}" for pattern in EXCLUDE)

        def copy_to(folder):
            return subprocess.check_output(
                [*command, str(source) + "/", str(folder) + "/"], text=True
            )

        if dest.exists():
            changed = copy_to(dest)
        else:
            # Let Herdr see the new mod only once its manifest and files are ready.
            with tempfile.TemporaryDirectory(prefix=".sync-", dir=runtime) as stage:
                folder = Path(stage) / name
                folder.mkdir()
                changed = copy_to(folder)
                folder.rename(dest)
        if changed:
            print(f"Synced {name}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=ROOT, help="destination app home (default: this checkout)")
    parser.add_argument("--watch", action="store_true", help="sync when package sources change")
    args = parser.parse_args()
    rsync = shutil.which("rsync")
    if not rsync:
        parser.error("rsync is required")

    try:
        mods = sources()
        previous = snapshot(mods) if args.watch else None
        sync(mods, args.home.expanduser(), rsync)
        if args.watch:
            print("Watching packaged mods. Press Ctrl+C to stop.", flush=True)
            while True:
                time.sleep(1)
                mods = sources()
                current = snapshot(mods)
                if current != previous:
                    sync(mods, args.home.expanduser(), rsync)
                    previous = current
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
