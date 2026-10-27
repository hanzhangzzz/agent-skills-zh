#!/usr/bin/env bash
# Self-host the house fonts, subset to the characters actually used (re-run after every copy change).
# Usage: bash <skill>/scripts/fonts.sh <workdir>
set -euo pipefail
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
cd "${1:-.}"
# every top-level page and script: a film may be split into modules (a shared world.js, a second page for another
# aspect ratio); scanning only shots.js silently drops the glyphs used elsewhere
srcs=()
for f in *.js *.html; do case "$f" in *.example.js) continue;; esac; [ -f "$f" ] && srcs+=(--text-from "$f"); done
python3 "$SKILL/scripts/fetch_fonts.py" --out fonts "${srcs[@]}" \
  "Noto Sans SC:wght@400;500;700;900" "JetBrains Mono:wght@500;600;700" "Inter Tight:wght@200;300"
