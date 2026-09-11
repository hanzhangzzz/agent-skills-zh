#!/usr/bin/env bash
# 仓库全部可离线复现的行为测试：本地与 CI 共用一个入口。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"

run() {
  local name="$1"
  shift
  local started=$SECONDS
  echo "::group::$name"
  "$@"
  echo "✓ ${name}（$((SECONDS - started))s）"
  echo "::endgroup::"
}

run "agent instruction checkout" python3 .github/scripts/test_agent_instruction_checkout.py
run "git-push-guard" bash git-push-guard/scripts/test_hook.sh
run "repo-tidy status hook" bash repo-tidy/scripts/test_git_repo_status.sh
run "repo-tidy CLI" bash repo-tidy/tests/test_repo_tidy.sh "$WORK/repo-tidy"
run "repo-map" bash repo-map/scripts/test_repo_map.sh
run "harness" bash harness/scripts/test_harness.sh
run "md2view" bash -c 'cd md2view/scripts && python3 -m unittest test_build_reader test_parse_blocks test_verify_anchors'
run "do-something contracts" python3 do-something/tests/test_mr_title_contract.py
run "do-something value policy" python3 do-something/tests/test_flywheel_policy.py
run "ci-review verdict gate" bash ci-review/tests/test_verdict_gate.sh
run "ci-review policy" python3 ci-review/tests/test_review_policy.py
run "ci-review installer" bash ci-review/tests/test_install.sh
run "scanned-book-ocr" python3 -m unittest discover -s scanned-book-ocr/scripts -p 'test_*.py'
run "README gallery generator" python3 assets/readme/cards-src/test_build_gallery.py
run "marketplace mutations" python3 .github/scripts/test_validate_marketplace.py
run "marketplace" python3 .github/scripts/validate_marketplace.py .

echo "✓ 全部行为测试通过"
