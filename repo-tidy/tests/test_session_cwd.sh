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
run_cwd() {  # run_cwd <会话id> <json> ; 回显 stdout
  printf '%s' "$2" | env HOME="$FAKE_HOME" TERM_SESSION_ID="$1" ITERM_SESSION_ID="$1" bash "$CWD_HOOK"
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

# 5. 既无会话 id 也无 tty（非终端环境）→ 不写任何东西
# 用假 ps 让 tty 探测也失败，模拟 CI / 非交互环境
NOPS_BIN="$SCRATCH/nops"; mkdir -p "$NOPS_BIN"
printf '#!/bin/sh\nexit 1\n' > "$NOPS_BIN/ps"; chmod +x "$NOPS_BIN/ps"
before=$(ls "$FAKE_HOME/.claude/session-cwd" | wc -l | tr -d ' ')
printf '{"cwd":"%s"}' "$TARGET" | env -u TERM_SESSION_ID -u ITERM_SESSION_ID HOME="$FAKE_HOME" PATH="$NOPS_BIN:$PATH" bash "$CWD_HOOK" >/dev/null 2>&1
after=$(ls "$FAKE_HOME/.claude/session-cwd" | wc -l | tr -d ' ')
[ "$before" = "$after" ] && ok "非 iTerm 环境不写文件" || bad "非 iTerm 环境" "文件数 $before → $after"

# 6. cwd 不存在 → 不写脏数据
run_cwd "w0t0p1:CCC" '{"cwd":"/no/such/dir"}' >/dev/null
[ -z "$(state CCC)" ] && ok "cwd 不存在时不落文件" || bad "不存在的 cwd" "实际: $(state CCC)"

# 7. 畸形 JSON → 回退到 $PWD，不崩
out=$( cd "$TARGET" && printf 'not-json' | env HOME="$FAKE_HOME" TERM_SESSION_ID="w0t0p1:DDD" ITERM_SESSION_ID="w0t0p1:DDD" bash "$CWD_HOOK"; echo "rc=$?" )
[ "$(state DDD)" = "$TARGET" ] && [ "$out" = "rc=0" ] \
  && ok "畸形输入回退到 \$PWD 且退出码 0" || bad "畸形输入" "state=$(state DDD) $out"

# 8. 空 stdin（hook 可能不喂输入）→ 不崩
printf '' | env HOME="$FAKE_HOME" TERM_SESSION_ID="w0t0p1:EEE" ITERM_SESSION_ID="w0t0p1:EEE" bash "$CWD_HOOK" >/dev/null 2>&1
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

# ── 双键：会话 id 与 tty 各写一份 ──────────────────────────────────────
# 12. tty 键（Terminal.app 与 POSIX 终端靠这个）
run_cwd "w0t0p1:FFF" "{\"cwd\":\"$TARGET\"}" >/dev/null
tty_now=$(ps -o tty= -p $PPID 2>/dev/null | tr -d ' '); tty_now="${tty_now##*/}"
if [ -n "$tty_now" ] && [ "$tty_now" != "??" ]; then
  [ "$(state "tty-$tty_now")" = "$TARGET" ] \
    && ok "同时按 tty 键写一份（tty-$tty_now）" || bad "tty 键" "实际: $(state "tty-$tty_now")"
else
  ok "跳过 tty 键（本环境无控制终端）"
fi

# 13. 只有 tty、没有会话 id（Terminal.app 之外的 POSIX 终端）
H=$FAKE_HOME
printf '{"cwd":"%s"}' "$TARGET" | env -u TERM_SESSION_ID -u ITERM_SESSION_ID HOME="$FAKE_HOME" bash "$CWD_HOOK" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "无会话 id 时靠 tty 仍可工作（不崩）" || bad "仅 tty" "退出码 $rc"

# 14. 两个键都没有 → 落 .unsupported 记号，让 status 报得出
FH2="$SCRATCH/unsup"; mkdir -p "$FH2"
printf '{"cwd":"%s"}' "$TARGET" | env -u TERM_SESSION_ID -u ITERM_SESSION_ID \
  HOME="$FH2" PATH="$NOPS_BIN:$PATH" bash "$CWD_HOOK" >/dev/null 2>&1
[ -f "$FH2/.claude/session-cwd/.unsupported" ] \
  && ok "键全拿不到时留下 .unsupported 记号（供 status 报告）" \
  || bad ".unsupported 记号" "未生成"

# 15. 能用的环境要清掉旧的 .unsupported
mkdir -p "$FAKE_HOME/.claude/session-cwd"; touch "$FAKE_HOME/.claude/session-cwd/.unsupported"
run_cwd "w0t0p1:GGG" "{\"cwd\":\"$TARGET\"}" >/dev/null
[ ! -f "$FAKE_HOME/.claude/session-cwd/.unsupported" ] \
  && ok "环境可用时清掉旧的 .unsupported" || bad ".unsupported 清理" "文件仍在"

echo "── 通过 $PASS / 失败 $FAIL"
[ "$FAIL" -eq 0 ]
