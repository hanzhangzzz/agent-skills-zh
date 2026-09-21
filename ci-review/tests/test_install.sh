#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="$ROOT/ci-review/scripts/install.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

ok() { echo "✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "✗ $1"; FAIL=$((FAIL + 1)); }
assert_file() { [ -f "$1" ] && ok "$2" || bad "$2"; }
assert_grep() { grep -qF "$2" "$1" && ok "$3" || bad "$3"; }

make_repo() {
  local dir="$1" remote="$2"
  git init -q "$dir"
  git -C "$dir" remote add origin "$remote"
}

GH="$WORK/github"
make_repo "$GH" https://github.com/example/project.git
bash "$INSTALL" "$GH" --force --platform github --merge on >/dev/null
assert_file "$GH/.github/workflows/ci-review.yml" "GitHub workflow 已生成"
assert_file "$GH/.github/ci-review.md" "GitHub 审查规范已生成"
assert_file "$GH/.github/scripts/ci-review-verdict.sh" "GitHub verdict gate 已生成"
assert_grep "$GH/.github/workflows/ci-review.yml" 'CI_REVIEW_MERGE: "true"' "GitHub merge on 被保留"
assert_grep "$GH/.github/workflows/ci-review.yml" 'HEAD_REF:' "GitHub 注入来源分支"
cmp -s "$ROOT/ci-review/prompts/review.md" "$GH/.github/ci-review.md" && ok "GitHub prompt 来自事实源" || bad "GitHub prompt 来自事实源"
cmp -s "$ROOT/ci-review/scripts/verdict_gate.sh" "$GH/.github/scripts/ci-review-verdict.sh" && ok "GitHub gate 来自事实源" || bad "GitHub gate 来自事实源"

GL="$WORK/gitlab"
make_repo "$GL" https://gitlab.example.com/group/project.git
bash "$INSTALL" "$GL" --force --platform gitlab --merge on >/dev/null
assert_file "$GL/.gitlab/ci-review.yml" "GitLab workflow 已生成"
assert_file "$GL/.gitlab/ci-review.md" "GitLab 审查规范已生成"
assert_file "$GL/.gitlab/ci-review-verdict.sh" "GitLab verdict gate 已生成"
assert_grep "$GL/.gitlab/ci-review.yml" 'CI_REVIEW_MERGE: "true"' "GitLab merge on 被保留"
assert_grep "$GL/.gitlab/ci-review.yml" 'HEAD_REF:' "GitLab 注入来源分支"
cmp -s "$ROOT/ci-review/prompts/review.md" "$GL/.gitlab/ci-review.md" && ok "GitLab prompt 来自事实源" || bad "GitLab prompt 来自事实源"
cmp -s "$ROOT/ci-review/scripts/verdict_gate.sh" "$GL/.gitlab/ci-review-verdict.sh" && ok "GitLab gate 来自事实源" || bad "GitLab gate 来自事实源"

echo "通过 $PASS / 失败 $FAIL"
[ "$FAIL" = 0 ]
