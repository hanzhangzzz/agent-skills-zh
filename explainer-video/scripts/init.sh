#!/usr/bin/env bash
# Create an explainer-video work directory: page, framework, starter shots, renderer dependency.
# Usage: bash <skill>/scripts/init.sh <workdir>
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: init.sh <workdir>" >&2; exit 2; }
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
W="$1"
for t in node ffmpeg ffprobe python3; do command -v "$t" >/dev/null || { echo "missing dependency: $t" >&2; exit 2; }; done
mkdir -p "$W/out"
cp "$SKILL/assets/engine.js" "$SKILL/assets/explainer.js" "$SKILL/assets/icons.js" "$W/"
[ -f "$W/index.html" ] || cp "$SKILL/assets/explainer.html" "$W/index.html"
[ -f "$W/shots.js" ] || cp "$SKILL/assets/shots.example.js" "$W/shots.js"
cp "$SKILL/assets/shots.example.js" "$SKILL/assets/gallery.example.js" "$SKILL/assets/world.example.js" "$SKILL/assets/three.example.js" "$SKILL/assets/cinema.example.js" "$W/"   # reference shots to read and adapt
cd "$W"
if [ ! -d node_modules/playwright ]; then
  [ -f package.json ] || echo '{"private":true}' > package.json
  npm i -D playwright >/dev/null
  # reuse an installed Chromium when CHROMIUM_PATH is set; otherwise download Playwright's
  [ -n "${CHROMIUM_PATH:-}" ] || npx playwright install chromium >/dev/null
fi
echo "✓ work dir ready: $(pwd)"
echo "  next: write shots.js, then: bash $SKILL/scripts/fonts.sh $(pwd)"
