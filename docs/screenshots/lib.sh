# lib.sh: where the sandbox is, its environment, and the helpers the other scripts use. Source it
# (bash). After it, every `herdr-app` and `hc` in the shell talks to the sandbox, never to your own
# Herdr: the sandbox has its own core (HC_SESSION), app home and state.

SHOTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # this folder
REPO="$(cd "$SHOTS/../.." && pwd)"                      # the setup the pictures are of
DEMO=${HERDR_SHOTS_DIR:-/var/tmp/herdr-app-demo}          # use a fresh short path for a separate run
PHYS=$(cd "$(dirname "$DEMO")" && pwd -P)/$(basename "$DEMO")
A=$PHYS/home/.config/herdr-app                          # the sandbox's app home
D=$PHYS/home/Developer                                  # its fake projects
R=$D/herdr-app                                          # the demo copy of this repository

# Python (with Pillow) and the real programs are found with your own HOME and PATH.
export REAL_HOME="${REAL_HOME:-$HOME}" REAL_PATH="${REAL_PATH:-$PATH}"
py() { env HOME="$REAL_HOME" PATH="$REAL_PATH" python3 "$@"; }
# (`which`, not the shell's own lookup: the shell remembers where it last found a command, and that
# may be a link in the sandbox.)
real() { env PATH="$REAL_PATH" /usr/bin/which "$1"; }

export HOME=$PHYS/home HC_SESSION=${HERDR_SHOTS_SESSION:-herdr-app-demo} HERDR_APP_HOME=$A
export XDG_STATE_HOME=$DEMO/state XDG_CONFIG_HOME=$PHYS/home/.config
export HERDR_APP_NO_SOUND=1 HERDR_TELEMETRY=0 DO_NOT_TRACK=1
unset HC_SOCKET
if [ -n "${HERDR_SHOTS_SOCKET:-}" ]; then export HC_SOCKET=$HERDR_SHOTS_SOCKET; fi
# The stubs come first: `docker`, `ddev` and `gh` would otherwise answer with real projects.
export PATH=$DEMO/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
unset HC_TERMINAL_SOCKET HC_TERMINAL_ID HC_SCOPE HC_RUNTIME CLAUDECODE CLAUDE_CODE_ENTRYPOINT __CFBundleIdentifier
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

# What scene.sh made: S1..S6 (spaces), T1 (the first space's first tab), TERM1 (its terminal).
[ -f "$DEMO/ids.sh" ] && . "$DEMO/ids.sh"

nap() { perl -e "select(undef,undef,undef,$1)"; }
h() { herdr-app do "$@" >/dev/null; }

# draw [times]: make the app draw. In the background it draws nothing by itself, and a mod takes a
# request left in shared state only when it draws: a shot makes it draw.
draw() { local i; for i in $(seq 1 "${1:-4}"); do herdr-app shot "$DEMO/raw/.draw.png" >/dev/null 2>&1; nap 0.5; done; }

# stage '<json steps>': run steps inside the app through the stage mod (stage/main.js lists them).
stage() { printf '%s' "$1" > "$A/stage.json"; herdr-app do mod.open '{"name":"stage"}' >/dev/null; }

# req '<json steps>' [draws]: stage them, then draw so that the mods take them while they are fresh.
# Steps the stage mod could not read or run are said, not passed over.
req() {
  stage "$1"; nap 0.4; draw "${2:-5}"
  py -c 'import json, sys
e = json.load(open(sys.argv[1])).get("stage.error")
if e: print("stage:", e, "in", sys.argv[2][:160], file=sys.stderr)' "$A/shared.json" "$1"
}

# zoom <n>: the app's zoom (it applies live).
zoom() {
  py - "$A/settings.json" "$1" <<'P'
import json, sys
p, z = sys.argv[1], float(sys.argv[2])
d = json.load(open(p)); d["zoom"] = z; json.dump(d, open(p, "w"), indent=2)
P
  nap 1.5; draw 3
}

# shot <name>: the window, as it is drawn, into raw/<name>.png.
shot() { draw 2; herdr-app shot "$DEMO/raw/$1.png" >/dev/null && echo "shot $1"; }

# look <name> [x y w h]: a copy of raw/<name>.png to check by eye, in look/: half size, or a part at full size.
look() {
  mkdir -p "$DEMO/look"
  py - "$DEMO/raw/$1.png" "$DEMO/look/$1.png" "${2:-}" "${3:-}" "${4:-}" "${5:-}" <<'P'
import sys
from PIL import Image
src, out, *box = sys.argv[1:]
im = Image.open(src).convert("RGB")
if box[0]:
    x, y, w, h = map(int, box); im = im.crop((x, y, x + w, y + h))
else:
    im = im.resize((im.width // 2, im.height // 2), Image.Resampling.LANCZOS)
im.save(out); print(out, im.size)
P
}

# terminal_of <space name> <tab name>: the address of that tab's first terminal.
terminal_of() {
  herdr-app ls | py -c '
import json, sys
for s in json.load(sys.stdin)["spaces"]:
    for t in s["tabs"]:
        if s["name"] == sys.argv[1] and t["name"] == sys.argv[2] and t["terminals"]: print(t["terminals"][0]["terminal"]); raise SystemExit
' "$1" "$2"
}

# open_file <path> [line]: show a file in the first tab's editor, at a line.
open_file() {
  local at=""; [ -n "${2:-}" ] && at=",\"select\":{\"line\":$2,\"start\":2,\"end\":2}"
  req "[{\"shared\":[\"file-editor.open\",{\"tab\":\"$T1\",\"path\":\"$1\",\"on\":null$at,\"at\":\"now\"}]}]" 6
}

# The folders of the sidebar, and no agent marked unread.
folders_json() {
  py - "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" <<'P'
import json, sys
s1, s2, s3, s4, s5, s6 = sys.argv[1:]
print(json.dumps([{"shared": ["space.folders", {"root": [
    {"id": "f1", "name": "Open source", "folded": False, "on": None, "spaces": [s1, s4]},
    {"id": "f2", "name": "Clients", "folded": False, "on": None, "spaces": [s2, s3]},
    {"id": "f3", "name": "Lab", "folded": True, "on": None, "spaces": [s5]},
    s6], "projects": {}, "next": None}]},
  {"shared": ["agents.unread", {}]}, {"shared": ["names.hidden", False]}]))
P
}

# quit_sandbox: close the window and stop the sandbox's core.
# Each step may fail (nothing runs), and a caller under `set -e` must not stop for that.
quit_sandbox() { herdr-app do app.quit >/dev/null 2>&1 || true; nap 2.5; hc server stop --json >/dev/null 2>&1 || true; }
