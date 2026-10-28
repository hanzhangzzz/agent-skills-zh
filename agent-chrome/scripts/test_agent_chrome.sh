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

python3 "$AC" add solo-main >/dev/null
check "站点名兜底到 <站点>-main" "[ \"\$(python3 '$AC' resolve solo)\" = solo-main ]"

# Same-process up -> down (the seed path): the spawned Chrome must be reaped, not waited on as a zombie.
check "同进程 up/down 正常关闭且不空等" "python3 -c '
import sys, time; sys.path.insert(0, \"$HERE\"); import agent_chrome as a
r = a.load(); a.up(r, \"test-tmp\", True); t = time.time(); d = a.down(r, \"test-tmp\")
assert d[\"graceful\"] and not d[\"sigkill\"] and time.time() - t < 8, d'"

# A Chrome on the same dir but another port is not ours: up and down must both refuse and leave it alive.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir="$UDD" \
  --remote-debugging-port=19399 --no-first-run about:blank >/dev/null 2>&1 &
other=$!
for _ in $(seq 1 50); do curl -sf http://127.0.0.1:19399/json/version >/dev/null && break; sleep 0.2; done
err=$(python3 "$AC" up test-tmp --headless 2>&1); rc=$?
check "目录被占时 up 拒绝并报 pid" "[ $rc -ne 0 ] && echo '$err' | grep -q 'pid $other'"
err=$(python3 "$AC" down test-tmp 2>&1); rc=$?
check "目录被占时 down 拒绝" "[ $rc -ne 0 ] && kill -0 $other"
kill "$other"; for _ in $(seq 1 50); do kill -0 "$other" 2>/dev/null || break; sleep 0.2; done
pkill -f -- "--user-data-dir=$UDD" 2>/dev/null; sleep 0.5

# Without node the graceful Browser.close path is unavailable, but down must still stop Chrome via SIGTERM.
python3 "$AC" up test-tmp --headless >/dev/null
err=$(PATH=/usr/bin:/bin python3 "$AC" down test-tmp 2>&1); rc=$?
check "缺 node 时 down 仍用 SIGTERM 关掉" "[ $rc -eq 0 ] && echo '$err' | grep -q 'SIGTERM' && ! python3 '$AC' status test-tmp | grep -q '\"running\": true'"

# A helper that hangs (DevTools never answers Browser.close) must not skip the SIGTERM fallback either.
FAKE="$AGENT_CHROME_ROOT/fakenode"; mkdir -p "$FAKE"
printf '#!/bin/sh\n[ "$1" = "--version" ] && { echo v22.0.0; exit 0; }\nsleep 60\n' > "$FAKE/node"; chmod +x "$FAKE/node"
python3 "$AC" up test-tmp --headless >/dev/null
err=$(PATH="$FAKE:/usr/bin:/bin" python3 "$AC" down test-tmp 2>&1); rc=$?
check "helper 卡住时 down 仍用 SIGTERM 关掉" "[ $rc -eq 0 ] && echo '$err' | grep -q 'SIGTERM' && ! python3 '$AC' status test-tmp | grep -q '\"running\": true'"

# Headed up needs node for the window: without it, fail before Chrome is started instead of leaving one behind.
err=$(PATH=/usr/bin:/bin python3 "$AC" up test-tmp 2>&1); rc=$?
check "缺 node 时有头 up 先失败、不留 Chrome" "[ $rc -ne 0 ] && echo '$err' | grep -q node && ! python3 '$AC' status test-tmp | grep -q '\"running\": true'"

if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
