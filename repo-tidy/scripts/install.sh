#!/usr/bin/env bash
# 一键把 repo-tidy 的 hook 注册到 ~/.claude/settings.json。
#
# 私人配置（settings.json / CLAUDE.md）不进版本库，所以由这个脚本来改——
# 它只增不删、幂等、改前备份，绝不碰用户已有的其它 hook。
#
#   bash install.sh            安装（幂等，重复跑无副作用）
#   bash install.sh status     完整体检：依赖、hook、终端支持、位置文件是否在更新
#   bash install.sh --check    只查 hook 注册（status 的子集，脚本里用）
#   bash install.sh --uninstall 移除本 skill 注册的 hook（其它配置原样保留）
#
# 环境变量 CLAUDE_HOME 可覆盖 ~/.claude（测试用）。
set -u

MODE="install"
case "${1:-}" in
  --check)            MODE="check" ;;
  status|--status)    MODE="status" ;;
  --uninstall)        MODE="uninstall" ;;
  "")                 ;;
  *) echo "用法: install.sh [status|--check|--uninstall]" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"

command -v python3 >/dev/null 2>&1 || { echo "❌ 需要 python3" >&2; exit 1; }

if [ "$MODE" = "status" ]; then
  RC=0
  echo "── 依赖 ─────────────────────────────────────────"
  for c in python3 git; do
    if command -v "$c" >/dev/null 2>&1; then echo "  ✓ $c  $("$c" --version 2>&1 | head -1)"
    else echo "  ✗ $c 缺失"; RC=1; fi
  done
  if [ -f "$SETTINGS" ]; then
    if python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$SETTINGS" 2>/dev/null
    then echo "  ✓ settings.json 合法  $SETTINGS"
    else echo "  ✗ settings.json 不是合法 JSON，安装会被拒绝"; RC=1; fi
  else
    echo "  · settings.json 不存在（安装时会创建）"
  fi

  echo
  echo "── 核心层：仓库归位与任务 worktree（与终端、平台无关）──"
  for f in repo_tidy.py git-repo-status.sh worktree-fetch.sh; do
    if [ -x "$SCRIPT_DIR/$f" ] || [ -r "$SCRIPT_DIR/$f" ]; then echo "  ✓ $f"
    else echo "  ✗ $f 缺失"; RC=1; fi
  done

  echo
  echo "── 增强层：编辑器快捷键看到 AI 当前目录（需要终端能报出当前标签页）──"
  TERM_OK=0
  if [ -n "${SESSION_KEY_CMD:-}" ]; then
    echo "  ✓ 自定义探测器 SESSION_KEY_CMD=$SESSION_KEY_CMD"; TERM_OK=1
  elif [ -n "${TERM_SESSION_ID:-}${ITERM_SESSION_ID:-}" ]; then
    echo "  ✓ 终端会话 id 可用（TERM_PROGRAM=${TERM_PROGRAM:-?}）"; TERM_OK=1
  else
    echo "  ? 当前 shell 无 TERM_SESSION_ID（TERM_PROGRAM=${TERM_PROGRAM:-?}）"
    echo "    —— 若你的终端不是 iTerm2/Terminal.app，设 SESSION_KEY_CMD 指定探测命令"
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "  ✓ 平台 macOS：内置 iTerm2 / Terminal.app 探测"
  else
    echo "  ? 平台 $(uname -s)：未内置探测（未实测），需 SESSION_KEY_CMD + EDITOR_HERE_CMD"
  fi
  STATE_DIR="$CLAUDE_DIR/session-cwd"
  if [ -d "$STATE_DIR" ]; then
    N=$(find "$STATE_DIR" -type f ! -name '.*' 2>/dev/null | wc -l | tr -d ' ')
    FRESH=$(find "$STATE_DIR" -type f ! -name '.*' -mmin -60 2>/dev/null | wc -l | tr -d ' ')
    echo "  ✓ 位置文件 $N 个，其中 $FRESH 个 1 小时内更新过  $STATE_DIR"
    [ "$N" != "0" ] && [ "$FRESH" = "0" ] && echo "    （都不新鲜：hook 可能没在跑，或这些标签页已关闭）"
  else
    echo "  · 位置文件目录尚未创建（装好 hook 后首次对话时生成）"
  fi
  [ -f "$STATE_DIR/.unsupported" ] && {
    echo "  ✗ 上次运行拿不到会话键：$(cat "$STATE_DIR/.unsupported")"; RC=1; }
  if [ -x "$SCRIPT_DIR/editor-here.sh" ]; then
    echo "  ✓ editor-here.sh 可执行（记得绑到快捷键；干跑：EDITOR_HERE_DRY=1 $SCRIPT_DIR/editor-here.sh）"
  else
    echo "  ✗ editor-here.sh 不可执行"; RC=1
  fi

  echo
  echo "── hook 注册 ────────────────────────────────────"
  MODE="check"
fi

mkdir -p "$CLAUDE_DIR"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

python3 - "$SCRIPT_DIR" "$SETTINGS" "$MODE" <<'PY'
import json, os, shutil, sys, time

script_dir, settings_path, mode = sys.argv[1], sys.argv[2], sys.argv[3]

# (事件, matcher, 脚本名, 超时秒)
WANT = [
    ("SessionStart",     "*",                         "git-repo-status.sh", 10),
    ("SessionStart",     "*",                         "session-cwd.sh",      5),
    ("UserPromptSubmit", "*",                         "session-cwd.sh",      5),
    ("PostToolUse",      "EnterWorktree|ExitWorktree","session-cwd.sh",      5),
    ("PreToolUse",       "EnterWorktree",             "worktree-fetch.sh",  30),
]

try:
    with open(settings_path, encoding="utf-8") as f:
        data = json.load(f)
except json.JSONDecodeError as e:
    print(f"❌ {settings_path} 不是合法 JSON（{e}），不敢改，请先手工修复", file=sys.stderr)
    sys.exit(1)
if not isinstance(data, dict):
    print("❌ settings.json 顶层不是对象，不敢改", file=sys.stderr)
    sys.exit(1)

hooks = data.setdefault("hooks", {})
missing, present = [], []
for event, matcher, name, timeout in WANT:
    cmd = os.path.join(script_dir, name)
    entries = hooks.get(event, [])
    found = any(
        h.get("command") == cmd
        for e in entries if isinstance(e, dict) and e.get("matcher") == matcher
        for h in e.get("hooks", []) if isinstance(h, dict)
    )
    (present if found else missing).append((event, matcher, name, timeout, cmd))

if mode == "check":
    for event, matcher, name, _, _ in present:
        print(f"  ✓ 已注册  {event:<17} {matcher:<27} {name}")
    for event, matcher, name, _, _ in missing:
        print(f"  ✗ 未注册  {event:<17} {matcher:<27} {name}")
    print(f"\n{len(present)}/{len(WANT)} 已就位" + ("" if missing else " —— 无需安装"))
    sys.exit(0 if not missing else 1)

def backup():
    dst = f"{settings_path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(settings_path, dst)
    return dst

if mode == "uninstall":
    ours = {os.path.join(script_dir, n) for _, _, n, _ in WANT}
    removed = 0
    for event in list(hooks):
        entries = hooks.get(event)
        if not isinstance(entries, list):
            continue
        for entry in list(entries):
            if not isinstance(entry, dict):
                continue
            before = len(entry.get("hooks", []))
            entry["hooks"] = [h for h in entry.get("hooks", [])
                              if not (isinstance(h, dict) and h.get("command") in ours)]
            removed += before - len(entry["hooks"])
            if not entry["hooks"]:
                entries.remove(entry)          # 整条空了才删，不动别人的
        if not entries:
            hooks.pop(event)
    if removed:
        print(f"  备份: {backup()}")
        with open(settings_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print(f"✓ 已移除 {removed} 条 hook" if removed else "无本 skill 的 hook，未改动")
    sys.exit(0)

if not missing:
    print(f"✓ {len(WANT)} 条 hook 均已注册，未改动")
    sys.exit(0)

print(f"  备份: {backup()}")
for event, matcher, name, timeout, cmd in missing:
    entry = next((e for e in hooks.setdefault(event, [])
                  if isinstance(e, dict) and e.get("matcher") == matcher), None)
    hook = {"type": "command", "command": cmd, "timeout": timeout}
    if entry is None:
        hooks[event].append({"matcher": matcher, "hooks": [hook]})
    else:
        entry.setdefault("hooks", []).append(hook)
    print(f"  + {event:<17} {matcher:<27} {name}")

with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"\n✓ 新增 {len(missing)} 条，原有 {len(present)} 条未动。hook 热生效，无需重启。")
PY
