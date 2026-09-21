#!/usr/bin/env bash
# ci-review 安装/档位/状态脚本。
#   install.sh [路径] [--force] [--platform github|gitlab] [--merge on|off]   安装（幂等）
#   install.sh [路径] merge on|off                                            只改合并档位
#   install.sh [路径] status                                                  文件、档位、secrets、最近运行
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
TARGET="."; FORCE=0; PLATFORM=""; MERGE=""; CMD="install"
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1;;
    --platform) PLATFORM="$2"; shift;;
    --merge) MERGE="$2"; shift;;
    merge) CMD="merge"; MERGE="$2"; shift;;
    status) CMD="status";;
    *) TARGET="$1";;
  esac; shift
done
case "$MERGE" in ""|on|off) ;; *) echo "✗ --merge 只能是 on|off"; exit 1;; esac

cd "$TARGET"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "✗ $TARGET 不是 git 仓库"; exit 1; }
cd "$ROOT"
REMOTE="$(git remote get-url origin 2>/dev/null || true)"
[ -n "$REMOTE" ] || { echo "✗ 没有 origin 远端，ci-review 需要托管平台"; exit 1; }

# 平台：--platform 优先；否则按 origin 主机名判；判不出就退出 2，由调用方问用户后带 --platform 重跑
if [ -z "$PLATFORM" ]; then
  case "$REMOTE" in
    *github.com*) PLATFORM=github;;
    *gitlab*)     PLATFORM=gitlab;;
    *) echo "? 无法从 origin 判断平台：$REMOTE"; echo "  用 --platform github|gitlab 指定后重跑"; exit 2;;
  esac
fi
case "$PLATFORM" in
  github) CI_FILE=".github/workflows/ci-review.yml"; RULES=".github/ci-review.md"; GATE=".github/scripts/ci-review-verdict.sh"; TPL="github-ci-review.yml";;
  gitlab) CI_FILE=".gitlab/ci-review.yml";          RULES=".gitlab/ci-review.md"; GATE=".gitlab/ci-review-verdict.sh"; TPL="gitlab-ci-review.yml";;
  *) echo "✗ 平台只能是 github|gitlab"; exit 1;;
esac

merge_val() { # CI 文件里 CI_REVIEW_MERGE 的值：去引号、小写；没有该行输出空
  grep -E '^[[:space:]]*CI_REVIEW_MERGE:' "$CI_FILE" 2>/dev/null | head -1 | sed -E "s/^[^:]*:[[:space:]]*[\"']?([^\"' #]*)[\"']?.*/\\1/" | tr 'A-Z' 'a-z'
}
merge_mode() { [ "$(merge_val)" = true ] && echo on || echo off; }
set_merge() { # on|off
  local v=false; [ "$1" = on ] && v=true
  [ -n "$(merge_val)" ] || { echo "✗ ${CI_FILE} 里没有 CI_REVIEW_MERGE 行，手动加"; exit 1; }
  # 不管原值怎么写（True/yes/无引号），整个值替换成带引号的小写
  sed -i.bak -E "s/^([[:space:]]*CI_REVIEW_MERGE:)[[:space:]]*[\"']?[^\"' #]*[\"']?/\1 \"$v\"/" "$CI_FILE" && rm -f "$CI_FILE.bak"
  [ "$(merge_val)" = "$v" ] || { echo "✗ 没改成：${CI_FILE} 的 CI_REVIEW_MERGE 行格式认不出，手动改"; exit 1; }
  echo "✓ 合并档位 = ${1}（${CI_FILE}）"
}
copy() { # src dst
  if [ -e "$2" ] && [ "$FORCE" = 0 ]; then echo "· 已存在，跳过：${2}（--force 覆盖）"; else mkdir -p "$(dirname "$2")"; cp "$1" "$2"; echo "✓ 写入 $2"; fi
}

status() {
  echo "平台：${PLATFORM}（${REMOTE}）"
  for f in "$CI_FILE" "$RULES" "$GATE"; do [ -e "$f" ] && echo "✓ $f" || echo "✗ 缺 $f"; done
  [ -e "$CI_FILE" ] && echo "合并档位：$(merge_mode)（范围 $(grep -E '^[[:space:]]*CI_REVIEW_MERGE_BRANCHES:' "$CI_FILE" | sed -E 's/.*"([^"]*)".*/\1/')）"
  if [ "$PLATFORM" = github ]; then
    command -v gh >/dev/null || { echo "· gh 未安装，跳过 secrets 检查"; return; }
    gh secret list 2>/dev/null | grep -qE 'CI_REVIEW_API_KEY|CLAUDE_CODE_OAUTH_TOKEN' && echo "✓ 认证 secret 已设" || echo "✗ 缺 secret CI_REVIEW_API_KEY（或 CLAUDE_CODE_OAUTH_TOKEN）"
    for v in CI_REVIEW_BASE_URL CI_REVIEW_MODEL; do
      val="$(gh variable get "$v" 2>/dev/null || true)"; [ -n "$val" ] && echo "✓ $v = $val" || echo "· $v 未设（BASE_URL 空 = 官方 Anthropic；MODEL 空 = CLI 默认）"
    done
    gh run list --workflow ci-review --limit 3 2>/dev/null || true
  else
    command -v glab >/dev/null || { echo "· glab 未安装，跳过 variables 检查"; return; }
    for v in ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_MODEL GITLAB_TOKEN; do
      glab variable get "$v" >/dev/null 2>&1 && echo "✓ $v 已设" || echo "✗ $v 未设"
    done
    grep -q "$CI_FILE" .gitlab-ci.yml 2>/dev/null && echo "✓ .gitlab-ci.yml 已 include" || echo "✗ .gitlab-ci.yml 未 include $CI_FILE"
  fi
}

case "$CMD" in
  status) status;;
  merge)  [ -e "$CI_FILE" ] || { echo "✗ 未安装（缺 ${CI_FILE}），先跑安装"; exit 1; }; set_merge "$MERGE";;
  install)
    copy "$SKILL_DIR/templates/$TPL" "$CI_FILE"
    copy "$SKILL_DIR/prompts/review.md" "$RULES"
    copy "$SKILL_DIR/scripts/verdict_gate.sh" "$GATE"
    [ -n "$MERGE" ] && set_merge "$MERGE"
    echo; status;;
esac
