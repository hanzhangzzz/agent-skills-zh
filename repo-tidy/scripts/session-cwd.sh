#!/bin/bash
# 把本 session 的工作目录写到 ~/.claude/session-cwd/<iTerm 会话 id>。
# 挂在 SessionStart / UserPromptSubmit / PostToolUse(EnterWorktree|ExitWorktree)。
# option+V（~/bin/vscode-here）读这个文件打开 VS Code，于是用户看到的永远是
# AI 当前所在的目录——不再依赖 shell 的 cwd（子进程改不了父 shell，那条路走不通）。
# 静默：不向 stdout 写任何东西（SessionStart/UserPromptSubmit 的 stdout 会注入上下文）。
input=$(cat 2>/dev/null)
sid="${ITERM_SESSION_ID##*:}"          # w0t0p1:UUID → UUID，与 AppleScript 的 session id 一致
[ -z "$sid" ] && exit 0                # 不在 iTerm 里（VS Code 终端等）就不管
cwd=$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("cwd",""))
except Exception: print("")' 2>/dev/null)
[ -z "$cwd" ] && cwd="$PWD"
[ -d "$cwd" ] || exit 0
dir="$HOME/.claude/session-cwd"
mkdir -p "$dir"
printf '%s\n' "$cwd" > "$dir/$sid"
find "$dir" -type f -mtime +7 -delete 2>/dev/null   # 关掉的标签页留下的旧文件，一周后清
exit 0
