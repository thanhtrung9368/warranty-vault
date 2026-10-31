#!/usr/bin/env bash
# Screenshot every frame at 390 x 844 pt, 2x, with headless Chrome.
# Run from anywhere: bash docs/handoff/login-redesign/render.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

python3 "$HERE/render_mockups.py"

for f in "$HERE"/frames/*.html; do
  name="$(basename "$f" .html)"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=390,844 \
    --screenshot="$HERE/$name.png" "file://$f" >/dev/null 2>&1
  echo "wrote $name.png"
done
