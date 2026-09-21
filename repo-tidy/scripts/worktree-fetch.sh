#!/bin/bash
# PreToolUse(EnterWorktree)：进门前先 fetch，保证 EnterWorktree 从最新的 origin/master 切分支。
# 只 fetch，不改任何工作区；失败也放行（离线时不该挡住开工）。
input=$(cat 2>/dev/null)
cwd=$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("cwd",""))
except Exception: print("")' 2>/dev/null)
[ -z "$cwd" ] && cwd="$PWD"
top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
git -C "$top" fetch --prune origin >/dev/null 2>&1
exit 0
