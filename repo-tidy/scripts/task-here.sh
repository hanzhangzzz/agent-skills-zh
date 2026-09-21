#!/usr/bin/env bash
# 声明「本 session 当前在做哪个任务目录」，供编辑器快捷键使用。
#
# 给运行中不能切工作目录的 agent 用（Codex 就是）：它在主路径启动、cwd 定死，
# 但可以用绝对路径在 worktree 里干活。调一次本脚本，快捷键就指向那个 worktree，
# 用户看到的是任务代码而不是启动目录。
#
# Claude Code 不用调这个——EnterWorktree 会真的改 cwd，hook 自动就写对了。
#
#   task-here.sh <目录>     声明当前任务目录
#   task-here.sh --clear    取消声明，回到 hook 记录的 cwd
#   task-here.sh --show     打印当前声明（没有则空）
#
# 声明写在 <键>.task，优先级高于 session-cwd.sh 写的 <键>；后者每轮对话都会被
# hook 刷新成 cwd，会把声明冲掉，所以必须分开存。
set -u

STATE_DIR="${CLAUDE_HOME:-$HOME/.claude}/session-cwd"
sid="${TERM_SESSION_ID:-${ITERM_SESSION_ID:-}}"
sid="${sid##*:}"

if [ -z "$sid" ]; then
  echo "✗ 拿不到终端会话 id（TERM_SESSION_ID 为空），无法声明任务目录" >&2
  echo "  非 iTerm2/Terminal.app 环境请设 SESSION_KEY_CMD，详见 SKILL.md" >&2
  exit 1
fi
f="$STATE_DIR/$sid.task"

case "${1:-}" in
  --clear)
    rm -f "$f" && echo "✓ 已取消任务目录声明，快捷键回到 session 的工作目录"
    ;;
  --show)
    [ -f "$f" ] && cat "$f" || true
    ;;
  "")
    echo "用法: task-here.sh <目录> | --clear | --show" >&2; exit 2
    ;;
  *)
    dir="$1"
    [ -d "$dir" ] || { echo "✗ 目录不存在: $dir" >&2; exit 1; }
    dir="$(cd "$dir" && pwd)"          # 存绝对路径
    mkdir -p "$STATE_DIR" || exit 1
    printf '%s\n' "$dir" > "$f"
    echo "✓ 当前任务目录已声明: $dir"
    echo "  编辑器快捷键现在会打开这里。任务结束后用 --clear 取消。"
    ;;
esac
