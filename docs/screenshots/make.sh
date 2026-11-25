#!/bin/bash
# make.sh [name ...]: the pictures from the raw shots: framed as pictures.json says (frame.py), then
# saved as lossless WebP in docs/images. With names, only those.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
py "$SHOTS/frame.py" "$SHOTS/pictures.json" --root "$DEMO" --out "$DEMO/out" "$@"
for f in "$DEMO"/out/*.png; do
  n=$(basename "$f" .png)
  [ $# -eq 0 ] || [[ " $* " == *" $n "* ]] || continue
  PATH="$REAL_PATH" cwebp -quiet -lossless -z 9 "$f" -o "$REPO/docs/images/$n.webp"
done
ls -l "$REPO/docs/images" | awk 'NR > 1 { print $5, $9 }'
