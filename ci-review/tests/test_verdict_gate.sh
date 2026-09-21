#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/ci-review/scripts/verdict_gate.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

run_case() {
  local name="$1" expected="$2" mode="$3" branch="$4" sha="$5" sticky="$6" unresolved="${7:-0}"
  local file="$WORK/sticky.md" output rc
  printf '%s\n' "$sticky" > "$file"
  output="$(bash "$GATE" "$mode" "$branch" "$sha" "$file" 'do/*' "$unresolved" 2>&1)"
  rc=$?
  if [ "$rc" = "$expected" ]; then
    echo "✓ $name"
    PASS=$((PASS + 1))
  else
    echo "✗ ${name}：期望 rc=${expected}，实际 rc=${rc}；${output}"
    FAIL=$((FAIL + 1))
  fi
}

SHA=abc123
GOOD_DO="<!-- ci-review last=$SHA execution=pass value=pass -->"
GOOD_HUMAN="<!-- ci-review last=$SHA execution=pass value=na -->"

run_case "do 双通过可作为成功 check" 0 check do/main "$SHA" "$GOOD_DO"
run_case "普通分支只要求 execution" 0 check task/x "$SHA" "$GOOD_HUMAN"
run_case "execution fail 使 check 失败" 1 check do/main "$SHA" "<!-- ci-review last=$SHA execution=fail value=pass -->"
run_case "do 分支 value fail 使 check 失败" 1 check do/main "$SHA" "<!-- ci-review last=$SHA execution=pass value=fail -->"
run_case "旧单 verdict 协议 fail closed" 1 check do/main "$SHA" "<!-- ci-review last=$SHA verdict=pass -->"
run_case "sticky SHA 不一致 fail closed" 1 check do/main "$SHA" '<!-- ci-review last=old execution=pass value=pass -->'
run_case "do 双通过且无线程可合入" 0 merge do/main "$SHA" "$GOOD_DO" 0
run_case "未解决线程阻止合入但不伪造审查失败" 3 merge do/main "$SHA" "$GOOD_DO" 2
run_case "普通分支不在自动合入范围" 3 merge task/x "$SHA" "$GOOD_HUMAN" 0

echo "通过 $PASS / 失败 $FAIL"
[ "$FAIL" = 0 ]
