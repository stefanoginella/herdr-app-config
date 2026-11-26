#!/bin/bash
# retake.sh: every picture again, from nothing: build the sandbox, start it, set the scene, take the
# shots, close it, frame them into docs/images. A second Herdr window is on screen meanwhile
# (about ten minutes); your own Herdr is not touched.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
"$SHOTS/build.sh"
"$SHOTS/launch.sh" &
"$SHOTS/scene.sh"
"$SHOTS/shoot.sh"
quit_sandbox
"$SHOTS/make.sh"
py "$REPO/docs/gallery.py"
