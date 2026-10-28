#!/usr/bin/env bash
# Style library for explainer-video: Lemo Opuscar (github.com/lemomo-ai/lemo-opuscar, MIT), fetched on demand into a
# local cache — style specs and posters only, demos when asked. Nothing is copied into the skill.
# Usage:
#   styles.sh list            fetch / refresh the specs, then print: slug · essence (one line) · poster path
#   styles.sh show <slug>     paths of the style's STYLE.md, poster and (if fetched) demo
#   styles.sh demo <slug>     also fetch that style's demo code (brush engines, shaders, 3D post) to learn techniques
#   styles.sh path            print the library folder
set -euo pipefail
REPO=https://github.com/lemomo-ai/lemo-opuscar
LIB="${EXPLAINER_STYLES_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/explainer-video/opuscar}"
cmd="${1:-list}"
fetch() {
  command -v git >/dev/null || { echo "missing dependency: git" >&2; exit 2; }
  if [ ! -d "$LIB/.git" ]; then
    mkdir -p "$(dirname "$LIB")"
    git clone -q --depth 1 --filter=blob:none --sparse "$REPO" "$LIB" || { echo "could not fetch $REPO (offline?)" >&2; exit 2; }
    git -C "$LIB" sparse-checkout set --no-cone '/LICENSE' '/DIRECTOR.md' '/TECHNIQUE.md' '/styles/README.md' \
      '/styles/*/STYLE.md' '/styles/*/poster.jpg' '/styles/*/style.json' '/core/three/' '/core/post/' '/core/lib.js'
  fi
}
case "$cmd" in
  list)
    fetch
    for d in "$LIB"/styles/*/; do
      s=$(basename "$d"); case "$s" in _*) continue ;; esac; [ -f "$d/STYLE.md" ] || continue
      essence=$(grep -m1 '^> ' "$d/STYLE.md" | sed 's/^> //' | cut -c1-150)
      echo "$s · $essence · $d""poster.jpg"
    done
    echo "(MIT, Lemo Opuscar · $LIB)" ;;
  show)
    fetch; s="${2:?usage: styles.sh show <slug>}"; d="$LIB/styles/$s"
    [ -f "$d/STYLE.md" ] || { echo "no style '$s' (styles.sh list)" >&2; exit 2; }
    echo "spec:   $d/STYLE.md"; echo "poster: $d/poster.jpg"
    [ -d "$d/demo" ] && echo "demo:   $d/demo (read it after your treatment, to learn techniques only)" || echo "demo:   not fetched (styles.sh demo $s)" ;;
  demo)
    fetch; s="${2:?usage: styles.sh demo <slug>}"
    [ -f "$LIB/styles/$s/STYLE.md" ] || { echo "no style '$s'" >&2; exit 2; }
    git -C "$LIB" sparse-checkout add "/styles/$s/" && echo "demo: $LIB/styles/$s/demo (DEMO.md explains how it was built)" ;;
  path) echo "$LIB" ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
