#!/bin/bash
# session-cwd.sh / worktree-fetch.sh 的对抗测试。
# 用法: bash test_session_cwd.sh [scratch目录]
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CWD_HOOK="$DIR/../scripts/session-cwd.sh"
FETCH_HOOK="$DIR/../scripts/worktree-fetch.sh"
SCRATCH="${1:-$(mktemp -d)}"
mkdir -p "$SCRATCH"
PASS=0; FAIL=0
ok()   { echo "✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

# 用假 HOME 隔离，绝不碰真实 ~/.claude/session-cwd
FAKE_HOME="$SCRATCH/home"; mkdir -p "$FAKE_HOME"
run_cwd() {  # run_cwd <ITERM_SESSION_ID> <json> ; 回显 stdout
  printf '%s' "$2" | env HOME="$FAKE_HOME" ITERM_SESSION_ID="$1" bash "$CWD_HOOK"
}
state() { cat "$FAKE_HOME/.claude/session-cwd/$1" 2>/dev/null; }

TARGET="$SCRATCH/proj"; mkdir -p "$TARGET"

# 1. 正常写入
out=$(run_cwd "w0t0p1:AAA" "{\"cwd\":\"$TARGET\"}")
[ "$(state AAA)" = "$TARGET" ] && ok "写入位置文件，文件名取会话 id 的 UUID 段" \
  || bad "写入位置文件" "实际: $(state AAA)"

# 2. stdout 必须为空（SessionStart/UserPromptSubmit 的 stdout 会注入上下文）
[ -z "$out" ] && ok "stdout 静默" || bad "stdout 静默" "实际输出: $out"

# 3. 覆盖更新（切 worktree 后要能改写）
T2="$SCRATCH/proj/.claude/worktrees/x"; mkdir -p "$T2"
run_cwd "w0t0p1:AAA" "{\"cwd\":\"$T2\"}" >/dev/null
[ "$(state AAA)" = "$T2" ] && ok "同一会话再次写入会覆盖" || bad "覆盖更新" "实际: $(state AAA)"

# 4. 多会话互不干扰
run_cwd "w0t1p0:BBB" "{\"cwd\":\"$TARGET\"}" >/dev/null
[ "$(state AAA)" = "$T2" ] && [ "$(state BBB)" = "$TARGET" ] \
  && ok "多会话各写各的文件" || bad "多会话隔离" "AAA=$(state AAA) BBB=$(state BBB)"

# 5. 不在 iTerm（无 ITERM_SESSION_ID）→ 不写任何东西
before=$(ls "$FAKE_HOME/.claude/session-cwd" | wc -l | tr -d ' ')
printf '{"cwd":"%s"}' "$TARGET" | env HOME="$FAKE_HOME" -u ITERM_SESSION_ID bash "$CWD_HOOK" >/dev/null 2>&1
after=$(ls "$FAKE_HOME/.claude/session-cwd" | wc -l | tr -d ' ')
[ "$before" = "$after" ] && ok "非 iTerm 环境不写文件" || bad "非 iTerm 环境" "文件数 $before → $after"

# 6. cwd 不存在 → 不写脏数据
run_cwd "w0t0p1:CCC" '{"cwd":"/no/such/dir"}' >/dev/null
[ -z "$(state CCC)" ] && ok "cwd 不存在时不落文件" || bad "不存在的 cwd" "实际: $(state CCC)"

# 7. 畸形 JSON → 回退到 $PWD，不崩
out=$( cd "$TARGET" && printf 'not-json' | env HOME="$FAKE_HOME" ITERM_SESSION_ID="w0t0p1:DDD" bash "$CWD_HOOK"; echo "rc=$?" )
[ "$(state DDD)" = "$TARGET" ] && [ "$out" = "rc=0" ] \
  && ok "畸形输入回退到 \$PWD 且退出码 0" || bad "畸形输入" "state=$(state DDD) $out"

# 8. 空 stdin（hook 可能不喂输入）→ 不崩
printf '' | env HOME="$FAKE_HOME" ITERM_SESSION_ID="w0t0p1:EEE" bash "$CWD_HOOK" >/dev/null 2>&1
[ $? -eq 0 ] && ok "空 stdin 退出码 0" || bad "空 stdin" "退出码非 0"

# ── worktree-fetch.sh ──
# 9. 非 git 目录 → 安全退出
printf '{"cwd":"%s"}' "$SCRATCH" | bash "$FETCH_HOOK" >/dev/null 2>&1
[ $? -eq 0 ] && ok "fetch hook 在非 git 目录安全退出" || bad "非 git 目录" "退出码非 0"

# 10. 无远端的 git 仓库 → 不崩（离线/本地仓库不该挡住开工）
REPO="$SCRATCH/repo"; mkdir -p "$REPO"
( cd "$REPO" && git init -q && git commit -q --allow-empty -m init 2>/dev/null )
printf '{"cwd":"%s"}' "$REPO" | bash "$FETCH_HOOK" >/dev/null 2>&1
[ $? -eq 0 ] && ok "fetch hook 在无远端仓库安全退出" || bad "无远端仓库" "退出码非 0"

# 11. fetch hook 永远静默（PreToolUse 的 stdout 也会进上下文）
out=$(printf '{"cwd":"%s"}' "$REPO" | bash "$FETCH_HOOK" 2>/dev/null)
[ -z "$out" ] && ok "fetch hook stdout 静默" || bad "fetch hook 静默" "实际: $out"

echo "── 通过 $PASS / 失败 $FAIL"
[ "$FAIL" -eq 0 ]
