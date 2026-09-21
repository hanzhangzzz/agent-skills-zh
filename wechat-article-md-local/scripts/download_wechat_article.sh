#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <url> [output_dir]" >&2
  exit 1
fi

URL="$1"
OUTPUT_DIR="${2:-$HOME/Downloads}"
NODE_SCRIPT="${SKILL_DIR}/scripts/extract_wechat_article.mjs"
PYTHON_SCRIPT="${SKILL_DIR}/scripts/save_wechat_article.py"
CHROME_PATH="${WECHAT_CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# ---- Fail fast: dependency checks ----
command -v node >/dev/null || { echo "缺少 node，请先安装 Node.js" >&2; exit 1; }
PYTHON="$(command -v python3 || command -v python || true)"
[ -n "$PYTHON" ] || { echo "缺少 python3/python" >&2; exit 1; }
[ -f "$NODE_SCRIPT" ] || { echo "缺少 $NODE_SCRIPT" >&2; exit 1; }
[ -f "$PYTHON_SCRIPT" ] || { echo "缺少 $PYTHON_SCRIPT" >&2; exit 1; }
[ -x "$CHROME_PATH" ] || { echo "找不到 Chrome: ${CHROME_PATH}（可用 WECHAT_CHROME_PATH 环境变量指定）" >&2; exit 1; }

if [ ! -f "${SKILL_DIR}/node_modules/playwright-core/package.json" ]; then
  echo "首次运行：安装 playwright-core ..." >&2
  (cd "$SKILL_DIR" && npm install --no-audit --no-fund >&2) \
    || { echo "npm install 失败，请在 $SKILL_DIR 手动执行 npm install" >&2; exit 1; }
fi

"$PYTHON" -c "import requests, bs4, markdownify" 2>/dev/null \
  || { echo "缺少 Python 依赖，请执行: pip install requests beautifulsoup4 markdownify" >&2; exit 1; }

# ---- Run ----
TMP_JSON="$(mktemp /tmp/wechat_article.XXXXXX)"
trap 'rm -f "$TMP_JSON"' EXIT

WECHAT_CHROME_PATH="$CHROME_PATH" node "$NODE_SCRIPT" "$URL" > "$TMP_JSON"
"$PYTHON" "$PYTHON_SCRIPT" --input "$TMP_JSON" --output-dir "$OUTPUT_DIR"
