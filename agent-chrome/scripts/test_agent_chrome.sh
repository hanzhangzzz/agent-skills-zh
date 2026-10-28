#!/usr/bin/env bash
# End-to-end test against the real Google Chrome in a throwaway AGENT_CHROME_ROOT (headless only).
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
AC="$HERE/agent_chrome.py"
export AGENT_CHROME_ROOT="$(mktemp -d)"
UDD="$AGENT_CHROME_ROOT/test-tmp"
fails=0
ok() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
cleanup() { python3 "$AC" down test-tmp --force >/dev/null 2>&1; rm -rf "$AGENT_CHROME_ROOT"; }
trap cleanup EXIT

check "add test-tmp" "python3 '$AC' add test-tmp --sites example.com --default-for test >/dev/null"
out=$(python3 "$AC" up test --headless) || bad "up --headless exit code"
port=$(echo "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["port"])')
check "up 返回 reused:false" "echo '$out' | grep -q '\"reused\": false'"
check "status 显示 running" "python3 '$AC' status test-tmp | grep -q '\"running\": true'"
check "curl /json/version" "curl -sf http://127.0.0.1:$port/json/version | grep -q webSocketDebuggerUrl"
check "第二次 up 复用" "python3 '$AC' up test-tmp --headless | grep -q '\"reused\": true'"
check "ls 显示 running" "python3 '$AC' ls | grep -E '^test-tmp ' | grep -q ' yes '"
check "down" "python3 '$AC' down test-tmp | grep -q '\"stopped\": true'"
check "pgrep 无残留" "! pgrep -f -- '--user-data-dir=$UDD' >/dev/null"
check "down 后 status 不在跑" "python3 '$AC' status test-tmp | grep -q '\"running\": false'"
err=$(python3 "$AC" add test-tmp 2>&1); rc=$?
check "重复 add 报错" "[ $rc -ne 0 ] && echo '$err' | grep -q 已存在"
err=$(python3 "$AC" add badname 2>&1); rc=$?
check "缺别名的名字报错" "[ $rc -ne 0 ] && echo '$err' | grep -q 不合规"
err=$(python3 "$AC" add X-main 2>&1); rc=$?
check "大写站点名报错" "[ $rc -ne 0 ]"
python3 "$AC" add daemon-main --daemon >/dev/null
err=$(python3 "$AC" down daemon-main 2>&1); rc=$?
check "daemon 无 --force 拒绝 down" "[ $rc -ne 0 ] && echo '$err' | grep -q daemon"

if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
