#!/bin/bash
# session-cwd.sh / worktree-fetch.sh 的对抗测试。
# 用法: bash test_session_cwd.sh [scratch目录]
set -u
unset CODEX_THREAD_ID CODEX_SESSION_ID  # 此处测试 Claude/终端路径；Codex 由 test_codex_session.py 覆盖。
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
# osascript 换成记录桩：测试不查询真实 iTerm/Terminal，也不弹真实桌面通知
OSA_LOG="$SCRATCH/osascript.log"; : > "$OSA_LOG"
printf '#!/bin/bash\necho "$*" >> %q\nexit 1\n' "$OSA_LOG" > "$SCRATCH/fake-osascript"; chmod +x "$SCRATCH/fake-osascript"
export EDITOR_HERE_OSASCRIPT="$SCRATCH/fake-osascript"
run_cwd() {  # run_cwd <会话id> <json> ; 回显 stdout
  printf '%s' "$2" | env HOME="$FAKE_HOME" TERM_SESSION_ID="$1" ITERM_SESSION_ID="$1" bash "$CWD_HOOK" --agent claude
}
state() { head -1 "$FAKE_HOME/.claude/session-cwd/$1" 2>/dev/null; }

# 假 ps：给 hook 的父进程（本测试 shell，全程存活）造一个 tty，让 owner 落在可控进程上；
# 其余调用交给真 ps。CI 没有控制终端也能测 owner 校验。
REAL_PS="$(command -v ps)"
TTY_BIN="$SCRATCH/ttyps"; mkdir -p "$TTY_BIN"
cat > "$TTY_BIN/ps" <<EOF
#!/bin/sh
[ "\$1" = "-o" ] && [ "\$2" = "tty=" ] && { echo ttys999; exit 0; }
exec "$REAL_PS" "\$@"
EOF
chmod +x "$TTY_BIN/ps"
run_cwd_tty() {  # 同 run_cwd，但 owner = 当前测试 shell；$3 可指定写入侧 locale
  printf '%s' "$2" | env HOME="$FAKE_HOME" PATH="$TTY_BIN:$PATH" LC_ALL="${3:-C}" \
    TERM_SESSION_ID="$1" ITERM_SESSION_ID="$1" bash "$CWD_HOOK" --agent claude
}

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
printf '{"cwd":"%s"}' "$TARGET" | env -u TERM_SESSION_ID -u ITERM_SESSION_ID HOME="$FAKE_HOME" PATH="$NOPS_BIN:$PATH" bash "$CWD_HOOK" --agent claude >/dev/null 2>&1
after=$(ls "$FAKE_HOME/.claude/session-cwd" | wc -l | tr -d ' ')
[ "$before" = "$after" ] && ok "非 iTerm 环境不写文件" || bad "非 iTerm 环境" "文件数 $before → $after"

# 6. cwd 不存在 → 不写脏数据
run_cwd "w0t0p1:CCC" '{"cwd":"/no/such/dir"}' >/dev/null
[ -z "$(state CCC)" ] && ok "cwd 不存在时不落文件" || bad "不存在的 cwd" "实际: $(state CCC)"

# 7. 畸形 JSON → 回退到 $PWD，不崩
out=$( cd "$TARGET" && printf 'not-json' | env HOME="$FAKE_HOME" TERM_SESSION_ID="w0t0p1:DDD" ITERM_SESSION_ID="w0t0p1:DDD" bash "$CWD_HOOK" --agent claude; echo "rc=$?" )
[ "$(state DDD)" = "$TARGET" ] && [ "$out" = "rc=0" ] \
  && ok "畸形输入回退到 \$PWD 且退出码 0" || bad "畸形输入" "state=$(state DDD) $out"

# 8. 空 stdin（hook 可能不喂输入）→ 不崩
printf '' | env HOME="$FAKE_HOME" TERM_SESSION_ID="w0t0p1:EEE" ITERM_SESSION_ID="w0t0p1:EEE" bash "$CWD_HOOK" --agent claude >/dev/null 2>&1
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
if [ -n "$tty_now" ] && [ "$tty_now" != "??" ] && [ "$tty_now" != "?" ]; then
  [ "$(state "tty-$tty_now")" = "$TARGET" ] \
    && ok "同时按 tty 键写一份（tty-$tty_now）" || bad "tty 键" "实际: $(state "tty-$tty_now")"
else
  ok "跳过 tty 键（本环境无控制终端）"
fi

# 13. 只有 tty、没有会话 id（Terminal.app 之外的 POSIX 终端）
H=$FAKE_HOME
printf '{"cwd":"%s"}' "$TARGET" | env -u TERM_SESSION_ID -u ITERM_SESSION_ID HOME="$FAKE_HOME" bash "$CWD_HOOK" --agent claude >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "无会话 id 时靠 tty 仍可工作（不崩）" || bad "仅 tty" "退出码 $rc"

# 14. 两个键都没有 → 落 .unsupported 记号，让 status 报得出
FH2="$SCRATCH/unsup"; mkdir -p "$FH2"
printf '{"cwd":"%s"}' "$TARGET" | env -u TERM_SESSION_ID -u ITERM_SESSION_ID \
  HOME="$FH2" PATH="$NOPS_BIN:$PATH" bash "$CWD_HOOK" --agent claude >/dev/null 2>&1
[ -f "$FH2/.claude/session-cwd/.unsupported" ] \
  && ok "键全拿不到时留下 .unsupported 记号（供 status 报告）" \
  || bad ".unsupported 记号" "未生成"

# 15. 能用的环境要清掉旧的 .unsupported
mkdir -p "$FAKE_HOME/.claude/session-cwd"; touch "$FAKE_HOME/.claude/session-cwd/.unsupported"
run_cwd "w0t0p1:GGG" "{\"cwd\":\"$TARGET\"}" >/dev/null
[ ! -f "$FAKE_HOME/.claude/session-cwd/.unsupported" ] \
  && ok "环境可用时清掉旧的 .unsupported" || bad ".unsupported 清理" "文件仍在"

# ── task-here.sh：显式声明任务目录（给不能切 cwd 的 agent，如 Codex）──
TASK_HOOK="$DIR/../scripts/task-here.sh"
EDITOR="$DIR/../scripts/editor-here.sh"
TDIR="$SCRATCH/taskdir"; mkdir -p "$TDIR"
SID="TESTSID"
peek() { env HOME="$FAKE_HOME" SESSION_KEY_CMD="echo $SID" EDITOR_HERE_DRY=1 bash "$EDITOR" 2>/dev/null; }
task() { env HOME="$FAKE_HOME" TERM_SESSION_ID="w0t0p1:$SID" bash "$TASK_HOOK" "$@"; }

# 16. 声明后快捷键指向声明的目录
run_cwd_tty "w0t0p1:$SID" "{\"cwd\":\"$TARGET\"}" >/dev/null
task "$TDIR" >/dev/null
[ "$(peek)" = "$TDIR" ] && ok "声明任务目录后快捷键跟随" || bad "声明生效" "实际: $(peek)"

# 17. hook 刷新 cwd 不会冲掉声明（每轮对话都会发生，这是关键）
run_cwd_tty "w0t0p1:$SID" "{\"cwd\":\"$TARGET\"}" >/dev/null
[ "$(peek)" = "$TDIR" ] && ok "hook 刷新 cwd 不冲掉声明" || bad "声明被冲掉" "实际: $(peek)"

# 18. --show 打印当前声明
[ "$(task --show)" = "$TDIR" ] && ok "--show 打印当前声明" || bad "--show" "实际: $(task --show)"

# 19. --clear 后回到 hook 记录的 cwd
task --clear >/dev/null
[ "$(peek)" = "$TARGET" ] && ok "--clear 后回到 session 工作目录" || bad "--clear" "实际: $(peek)"

# 20. 目录不存在时拒绝声明
task "/no/such/dir" >/dev/null 2>&1
[ $? -ne 0 ] && ok "目录不存在时拒绝声明" || bad "不存在目录" "退出码 0"

# 21. 拿不到会话 id 时明确报错，不静默
out=$(env -u TERM_SESSION_ID -u ITERM_SESSION_ID HOME="$FAKE_HOME" bash "$TASK_HOOK" "$TDIR" 2>&1)
rc=$?
[ $rc -ne 0 ] && printf '%s' "$out" | grep -q "拿不到终端会话 id" \
  && ok "无会话 id 时明确报错（不静默失败）" || bad "无会话 id 报错" "rc=$rc out=$out"

# ── owner 校验：写位置文件的 agent 退出后，快捷键不得再采信它 ──
# 真实事故：标签页里跑过 claude（jev-quality），退出后 cd 到别处，快捷键仍打开 jev-quality
SD="$FAKE_HOME/.claude/session-cwd"
STALE="$SCRATCH/stale-proj"; mkdir -p "$STALE"
peek_key() { env HOME="$FAKE_HOME" SESSION_KEY_CMD="echo $1" EDITOR_HERE_DRY=1 bash "$EDITOR" 2>/dev/null; }
OLD_START="Mon Oct 12 13:34:18 2026"

# 22. hook 写入的第 2 行是 owner，指向存活的写入者
line2=$(sed -n 2p "$SD/$SID")
pid=$(printf '%s' "$line2" | awk '{print $2}')
[ "${line2%% *}" = "owner" ] && [ "$pid" = "$$" ] \
  && ok "位置文件记录 owner（写入者 PID + 启动时间）" || bad "owner 行" "实际: $line2（期望 PID $$）"

# 23. 存活 owner → 采信
[ "$(peek_key "$SID")" = "$TARGET" ] && ok "owner 存活时采信位置文件" || bad "存活 owner" "实际: $(peek_key "$SID")"

# 24. owner 已退出 → 不采信
( : ) & dead=$!; wait "$dead"
printf '%s\nowner %s %s\n' "$STALE" "$dead" "$OLD_START" > "$SD/DEAD"
[ "$(peek_key DEAD)" != "$STALE" ] && ok "owner 已退出时不打开过期目录" || bad "过期 owner" "仍打开 $STALE"

# 25. PID 被复用（进程活着但启动时间不符）→ 不采信
printf '%s\nowner %s %s\n' "$STALE" "$$" "Thu Jan 1 00:00:00 1970" > "$SD/REUSED"
[ "$(peek_key REUSED)" != "$STALE" ] && ok "PID 复用（启动时间不符）不采信" || bad "PID 复用" "仍打开 $STALE"

# 26. 旧格式（无 owner 行）→ 不采信；活着的 session 下一轮对话就会被 hook 改写
printf '%s\n' "$STALE" > "$SD/LEGACY"
[ "$(peek_key LEGACY)" != "$STALE" ] && ok "无 owner 的旧格式文件不采信" || bad "旧格式" "仍打开 $STALE"

# 27. owner 已退出时，同键的 .task 声明一并失效
printf '%s\n' "$STALE" > "$SD/DEAD.task"
[ "$(peek_key DEAD)" != "$STALE" ] && ok "owner 退出后 .task 声明一并失效" || bad ".task 失效" "仍打开 $STALE"

# 28. tty 被新标签页复用：旧 tty- 文件 owner 已死 → 不采信
printf '%s\nowner %s %s\n' "$STALE" "$dead" "$OLD_START" > "$SD/tty-ttys888"
[ "$(peek_key /dev/ttys888)" != "$STALE" ] && ok "复用 tty 的旧位置文件不采信" || bad "tty 复用" "仍打开 $STALE"

# 29. 写入侧与读取侧 locale 不同仍匹配（快捷键进程的 LANG 往往与终端不同）
run_cwd_tty "w0t0p1:LOC" "{\"cwd\":\"$TARGET\"}" zh_CN.UTF-8 >/dev/null
out=$(env LC_ALL=en_US.UTF-8 HOME="$FAKE_HOME" SESSION_KEY_CMD="echo LOC" EDITOR_HERE_DRY=1 bash "$EDITOR" 2>/dev/null)
[ "$out" = "$TARGET" ] && ok "读写两侧 locale 不同仍能匹配 owner" || bad "locale" "实际: $out"


# 拿不到任何路径的失败分支（dry 模式）：不弹通知；整份测试从未调用真实 osascript
env HOME="$SCRATCH/empty-home" SESSION_KEY_CMD="echo NOPE" EDITOR_HERE_DRY=1 bash "$EDITOR" >/dev/null 2>&1; rc=$?
[ $rc -ne 0 ] && ! grep -q "display notification" "$OSA_LOG" \
  && ok "失败分支 dry 模式不弹通知，测试只走 osascript 记录桩" || bad "测试弹了通知" "rc=$rc; $(grep -c 'display notification' "$OSA_LOG") 条"

echo "── 通过 $PASS / 失败 $FAIL"
[ "$FAIL" -eq 0 ]
