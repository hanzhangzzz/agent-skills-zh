#!/usr/bin/env bash
# 打开「这个终端标签页里 AI 正在工作的目录」。绑到编辑器快捷键（iTerm2 协进程等）。
#
# 为什么不能直接 `code .`：claude 运行期间终端的当前目录冻结在启动目录——子进程改不了
# 父 shell 的 cwd。AI 切进 worktree 后，`code .` 打开的还是旧目录。所以改为读
# session-cwd.sh 写下的位置文件；读不到再回退到终端自己的路径。
#
#   EDITOR_HERE_APP  要打开的应用，默认 "Visual Studio Code"
#   EDITOR_HERE_DRY  设为 1 只打印目标路径，不真的打开（测试用）
set -u

APP="${EDITOR_HERE_APP:-Visual Studio Code}"
LOG="${TMPDIR:-/tmp}/editor-here.log"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

open_it() {  # open_it <目录> <来源标签>
  log "open($2): $1"
  if [ "${EDITOR_HERE_DRY:-}" = "1" ]; then echo "$1"; exit 0; fi
  /usr/bin/open -a "$APP" "$1"
  exit 0
}

# ① AI 记录的位置：~/.claude/session-cwd/<iTerm 会话 id>
SID="$(/usr/bin/osascript -e 'tell application "iTerm2" to get id of current session of current window' 2>/dev/null | tr -d '\r\n')"
STATE="${CLAUDE_HOME:-$HOME/.claude}/session-cwd/${SID}"
if [ -n "$SID" ] && [ -f "$STATE" ]; then
  AI_DIR="$(head -1 "$STATE" | tr -d '\r\n')"
  [ -n "$AI_DIR" ] && [ -d "$AI_DIR" ] && open_it "$AI_DIR" "ai-session"
fi

# ② 回退：终端自己的当前路径
TERM_DIR="$(/usr/bin/osascript <<'OSA' 2>/dev/null
tell application "iTerm2"
  if (count of windows) is 0 then return ""
  tell current session of current window
    try
      return variable named "session.path"
    on error
      try
        return variable named "path"
      on error
        return ""
      end try
    end try
  end tell
end tell
OSA
)"
TERM_DIR="${TERM_DIR//[$'\r\n']/}"
[ -n "$TERM_DIR" ] && [ -d "$TERM_DIR" ] && open_it "$TERM_DIR" "terminal"

log "failed: sid='$SID' term='$TERM_DIR'"
/usr/bin/osascript -e 'display notification "拿不到当前路径，未打开编辑器" with title "editor-here"' >/dev/null 2>&1
exit 1
