#!/bin/bash
# make.sh [name ...]: the pictures from the raw shots: framed as pictures.json says (frame.py), then
# saved as lossless WebP in docs/images. With names, only those.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
if [ "$#" -eq 0 ]; then
  # Use the current spec, not old files left in out/ from earlier runs.
  names=$(py -c 'import json, sys; print(" ".join(json.load(open(sys.argv[1]))["pictures"]))' "$SHOTS/pictures.json")
  read -ra pictures <<< "$names"
  set --
  for picture in "${pictures[@]}"; do
    if [ "$picture" = editor-guides ] && [ ! -f "$DEMO/patched-guides" ]; then continue; fi
    set -- "$@" "$picture"
  done
fi
py "$SHOTS/frame.py" "$SHOTS/pictures.json" --root "$DEMO" --out "$DEMO/out" "$@"
for n in "$@"; do
  PATH="$REAL_PATH" cwebp -quiet -lossless -z 9 "$DEMO/out/$n.png" -o "$REPO/docs/images/$n.webp"
done
ls -l "$REPO/docs/images" | awk 'NR > 1 { print $5, $9 }'
