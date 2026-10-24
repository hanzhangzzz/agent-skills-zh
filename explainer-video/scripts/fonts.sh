#!/usr/bin/env bash
# Self-host the house fonts, subset to the characters actually used (re-run after every copy change).
# Usage: bash <skill>/scripts/fonts.sh <workdir>
set -euo pipefail
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
cd "${1:-.}"
python3 "$SKILL/scripts/fetch_fonts.py" --out fonts --text-from shots.js --text-from index.html --text-from explainer.js \
  "Noto Sans SC:wght@400;500;700;900" "JetBrains Mono:wght@500;600;700" "Inter Tight:wght@200;300"
