#!/bin/bash
# 把本 session 的工作目录写到 ~/.claude/session-cwd/<键>，供编辑器快捷键
# （editor-here.sh）打开「AI 当前所在目录」。
#
# 为什么需要：claude 运行期间终端的当前目录冻结在启动目录——子进程改不了父 shell
# 的 cwd。AI 切进 worktree 后，`code .` 打开的还是旧目录。
#
# 按两个键各写一份，因为快捷键那一侧不同终端能拿到的东西不一样：
#   <UUID>        TERM_SESSION_ID 的 UUID 段。iTerm2 与 Terminal.app 都设这个变量，
#                 iTerm2 的 AppleScript `id of current session` 正是这一段
#   tty-<name>    控制终端名（如 tty-ttys005）。Terminal.app 的 AppleScript 只给得出
#                 tty；这也是 POSIX 通用的回退
#
# 挂在 SessionStart / UserPromptSubmit / PostToolUse(EnterWorktree|ExitWorktree)。
# 必须静默：这几个事件的 stdout 会被注入模型上下文。
input=$(cat 2>/dev/null)

STATE_DIR="${CLAUDE_HOME:-$HOME/.claude}/session-cwd"

# ── 当前工作目录：优先 hook 输入里的 cwd，回退 $PWD ──
cwd=$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("cwd",""))
except Exception: print("")' 2>/dev/null)
[ -z "$cwd" ] && cwd="$PWD"
[ -d "$cwd" ] || exit 0

# ── 键 1：终端会话 id（iTerm2 / Terminal.app 都有）──
sid="${TERM_SESSION_ID:-$ITERM_SESSION_ID}"
sid="${sid##*:}"                      # w0t0p1:UUID → UUID

# ── 键 2：控制终端。hook 自身没有 tty，沿父进程链找第一个有的 ──
tty_name=""
p=$PPID
for _ in 1 2 3 4 5; do
  case "$p" in ""|0|1) break;; esac
  t=$(ps -o tty= -p "$p" 2>/dev/null | tr -d ' ')
  case "$t" in
    ""|"??"|"?") ;;
    *) tty_name="${t##*/}"; break;;
  esac
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
done

if [ -z "$sid" ] && [ -z "$tty_name" ]; then
  # 两个键都拿不到：增强层在这个环境用不了。留个记号，让 install.sh status 报得出，
  # 而不是让用户对着不生效的快捷键猜。
  mkdir -p "$STATE_DIR" 2>/dev/null
  printf '%s\tTERM_PROGRAM=%s\tno session id, no tty\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "${TERM_PROGRAM:-unknown}" \
    > "$STATE_DIR/.unsupported" 2>/dev/null
  exit 0
fi

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
[ -n "$sid" ]      && printf '%s\n' "$cwd" > "$STATE_DIR/$sid" 2>/dev/null
[ -n "$tty_name" ] && printf '%s\n' "$cwd" > "$STATE_DIR/tty-$tty_name" 2>/dev/null
rm -f "$STATE_DIR/.unsupported" 2>/dev/null   # 这个环境能用，清掉旧记号

find "$STATE_DIR" -type f -mtime +7 -delete 2>/dev/null   # 关掉的标签页留下的旧文件
exit 0
