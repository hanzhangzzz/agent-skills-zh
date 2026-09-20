#!/usr/bin/env bash
# 一键把 repo-tidy 的 hook 注册到 ~/.claude/settings.json。
#
# 私人配置（settings.json / CLAUDE.md）不进版本库，所以由这个脚本来改——
# 它只增不删、幂等、改前备份，绝不碰用户已有的其它 hook。
#
#   bash install.sh            安装（幂等，重复跑无副作用）
#   bash install.sh --check    只报告当前状态，不改任何东西
#   bash install.sh --uninstall 移除本 skill 注册的 hook（其它配置原样保留）
#
# 环境变量 CLAUDE_HOME 可覆盖 ~/.claude（测试用）。
set -u

MODE="install"
case "${1:-}" in
  --check)     MODE="check" ;;
  --uninstall) MODE="uninstall" ;;
  "")          ;;
  *) echo "用法: install.sh [--check|--uninstall]" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"

command -v python3 >/dev/null 2>&1 || { echo "❌ 需要 python3" >&2; exit 1; }

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
