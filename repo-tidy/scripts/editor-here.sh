#!/usr/bin/env bash
# 打开「这个终端标签页里 AI 正在工作的目录」。绑到编辑器快捷键。
#
# 为什么不能直接 `code .`：claude 运行期间终端的当前目录冻结在启动目录——子进程改不了
# 父 shell 的 cwd。AI 切进 worktree 后 `code .` 打开的还是旧目录。改为读
# session-cwd.sh 写下的位置文件。
#
# 怎么知道「当前是哪个标签页」——按顺序试三种，取第一个成功的：
#   1. $SESSION_KEY_CMD  自定义命令，输出一个键。tmux/WezTerm/Linux 用这个口子，例如
#        export SESSION_KEY_CMD="tmux display-message -p '#{pane_id}'"
#      （配套要让 session-cwd.sh 也认得同一个键——见 SKILL.md「其它终端」）
#   2. iTerm2      AppleScript 取 current session 的 id（对应位置文件名 <UUID>）
#   3. Terminal.app AppleScript 取 selected tab 的 tty（对应 tty-<name>）
# 都拿不到 → 回退到终端自己的当前路径（就是旧行为，至少不比原来差）。
#
#   EDITOR_HERE_APP  macOS 上要打开的应用，默认 "Visual Studio Code"
#   EDITOR_HERE_CMD  直接指定打开命令（覆盖平台默认），如 "code" / "cursor" / "zed"
#   EDITOR_HERE_DRY  设为 1 只打印目标路径，不真的打开
set -u

LOG="${TMPDIR:-/tmp}/editor-here.log"
STATE_DIR="${CLAUDE_HOME:-$HOME/.claude}/session-cwd"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG" 2>/dev/null; }

open_it() {  # open_it <目录> <来源标签>
  log "open($2): $1"
  if [ "${EDITOR_HERE_DRY:-}" = "1" ]; then echo "$1"; exit 0; fi
  if [ -n "${EDITOR_HERE_CMD:-}" ]; then
    "$EDITOR_HERE_CMD" "$1"
  elif [ "$(uname -s)" = "Darwin" ]; then
    /usr/bin/open -a "${EDITOR_HERE_APP:-Visual Studio Code}" "$1"
  elif command -v code >/dev/null 2>&1; then
    code "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1"
  else
    log "no opener: 设 EDITOR_HERE_CMD 指定打开命令"
    exit 1
  fi
  exit 0
}

try_state() {  # try_state <键> <来源标签>；命中则打开
  [ -n "$1" ] || return 1
  # 显式声明的任务目录优先：Codex 这类不能切 cwd 的 agent 靠它指路，
  # 而 <键> 每轮对话都会被 hook 刷成 cwd，会把声明冲掉
  local t="$STATE_DIR/$1.task"
  if [ -f "$t" ]; then
    local td; td="$(head -1 "$t" | tr -d '\r\n')"
    [ -n "$td" ] && [ -d "$td" ] && open_it "$td" "$2-task"
  fi
  local f="$STATE_DIR/$1"
  [ -f "$f" ] || return 1
  local d; d="$(head -1 "$f" | tr -d '\r\n')"
  [ -n "$d" ] && [ -d "$d" ] && open_it "$d" "$2"
  return 1
}

# ① 自定义探测器（非 macOS / tmux / 其它终端）
if [ -n "${SESSION_KEY_CMD:-}" ]; then
  key="$(eval "$SESSION_KEY_CMD" 2>/dev/null | head -1 | tr -d '\r\n')"
  try_state "$key" "custom"
  try_state "tty-${key##*/}" "custom-tty"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  # ② iTerm2：session id 就是位置文件名的 UUID 段
  key="$(/usr/bin/osascript -e 'tell application "iTerm2" to get id of current session of current window' 2>/dev/null | tr -d '\r\n')"
  try_state "$key" "iterm"

  # ③ Terminal.app：AppleScript 只给得出 tty
  key="$(/usr/bin/osascript -e 'tell application "Terminal" to get tty of selected tab of front window' 2>/dev/null | tr -d '\r\n')"
  try_state "tty-${key##*/}" "terminal-app"
fi

# ④ 回退：终端自己的当前路径（旧行为）
if [ "$(uname -s)" = "Darwin" ]; then
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
  [ -n "$TERM_DIR" ] && [ -d "$TERM_DIR" ] && open_it "$TERM_DIR" "terminal-path"
fi

log "failed: 拿不到当前标签页的键，也拿不到终端路径"
[ "$(uname -s)" = "Darwin" ] && /usr/bin/osascript -e 'display notification "拿不到当前路径，未打开编辑器" with title "editor-here"' >/dev/null 2>&1
exit 1
