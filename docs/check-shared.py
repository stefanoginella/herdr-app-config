"""Check the helpers shipped in more than one standalone mod."""
from pathlib import Path
import sys

PACKAGES = Path(__file__).resolve().parents[1] / "packages"
COPIES = {
    "alias.js": {"hide-names", "tabs-names", "pane-names", "toast-names", "space-folders", "mark-agents-unread", "agent-usage"},
    "fieldkeys.js": {"file-editor", "project-search", "go-to-file"},
    "remote.js": {"file-editor", "project-search"},
    "external-apps.js": {"file-explorer", "project-search", "space-folders"},
    "git-guard.js": {"git-panel", "git-diff"},
}


def check():
    errors = []
    for name, required in COPIES.items():
        files = sorted(PACKAGES.glob(f"*/mods/*/{name}"))
        present = {path.parent.name for path in files}
        for mod in sorted(required - present):
            errors.append(f"Missing {name} in {mod}")
        for path in files[1:]:
            if path.read_bytes() != files[0].read_bytes():
                errors.append(f"{path.relative_to(PACKAGES)} differs from {files[0].relative_to(PACKAGES)}")
    return errors


if __name__ == "__main__":
    problems = check()
    for problem in problems:
        print(problem, file=sys.stderr)
    sys.exit(bool(problems))
