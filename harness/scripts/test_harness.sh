#!/bin/bash
# harness 两脚本的行为测试：PATH 桩替身隔离真实 claude 调用，逐场景断言。
# 用法：bash harness/scripts/test_harness.sh
# 断言协议：以 ! 开头 = mock 日志中必须不出现；其余 = mock 日志中必须出现。

set -u
KIT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# claude 桩：记录全部参数到 MOCK_LOG，可选向 cwd 的 TODO.md 追加一行
mkdir -p "$WORK/shim"
cat > "$WORK/shim/claude" <<'SHIM'
#!/bin/bash
[ -n "${MOCK_FAIL:-}" ] && exit 3
{ echo "=== INVOCATION cwd=$(pwd)"; printf '%s\n' "$@"; } >> "${MOCK_LOG:?}"
[ -n "${MOCK_MARK:-}" ] && printf '%s\n' "$MOCK_MARK" >> "$PWD/TODO.md"
echo '{"type":"result"}'
SHIM
chmod +x "$WORK/shim/claude"

pass=0; fail=0
g() { local d="$1"; shift; git -C "$d" -c user.email=t@t -c user.name=t "$@"; }

check() { # check <名称> <必须出现的断言...>（!开头 = 必须不出现）；读 MOCK_LOG
  local label="$1"; shift
  local a good=1
  for a in "$@"; do
    if [ "${a#!}" != "$a" ]; then
      if grep -qF "${a#!}" "$MOCK_LOG" 2>/dev/null; then echo "✗ ${label} 不应出现 [${a#!}]"; good=0; fi
    elif ! grep -qF "$a" "$MOCK_LOG" 2>/dev/null; then
      echo "✗ ${label} 断言未命中 [$a]"; good=0
    fi
  done
  local n; n=$(grep -c "=== INVOCATION" "$MOCK_LOG" 2>/dev/null || echo 0)
  if [ "$good" = 1 ]; then echo "✓ ${label}（claude 调用 ${n} 次）"; pass=$((pass+1)); else fail=$((fail+1)); fi
}

reset_case() { # 每场景：全新 scratch 仓库 + 干净桩日志与全局临时文件
  PROJ="$WORK/p$1"
  mkdir -p "$PROJ"
  export MOCK_LOG="$WORK/mock.log"; : > "$MOCK_LOG"
  rm -f /tmp/harness-context.txt
  unset MOCK_MARK
  export PATH="$WORK/shim:$ORIG_PATH"
}
ORIG_PATH=$PATH

# ── inspector ──
reset_case 1
printf '# P\n\n巡检要点占位。\n' > "$PROJ/README.md"
printf -- '- [ ] [待领取] 既有任务\n' > "$PROJ/TODO.md"
RESOLVED=$(cd "$PROJ" && pwd -P)   # 脚本内部 pwd -P 会解析 macOS 符号链接
out=$(cd /tmp && HARNESS_PROJECT_DIR="$PROJ" MOCK_LOG="$MOCK_LOG" bash "$KIT/inspector.sh" 2>&1)
check "inspector：HARNESS_PROJECT_DIR 解析 + 文档注入 + bypassPermissions" \
  "项目路径: $RESOLVED" "巡检要点占位" "bypassPermissions" "stream-json"

reset_case 2
out=$(cd "$PROJ" && MOCK_LOG="$MOCK_LOG" bash "$KIT/inspector.sh" "重点关注内存泄漏" 2>&1)
check "inspector：额外指令经参数注入" "重点关注内存泄漏" "用户本轮额外指令"
[ ! -f /tmp/harness-context.txt ] && echo "✓ inspector：参数模式不误删无关状态" && pass=$((pass+1)) || { echo "✗ 参数模式误删 /tmp 状态"; fail=$((fail+1)); }

# consume-once：上下文文件读后即删
reset_case 3
echo "上下文来自文件" > /tmp/harness-context.txt
out=$(cd "$PROJ" && MOCK_LOG="$MOCK_LOG" bash "$KIT/inspector.sh" 2>&1)
check "inspector：上下文文件内容注入" "上下文来自文件"
if [ -f /tmp/harness-context.txt ]; then echo "✓ inspector：不消费（同轮 worker-reviewer 还要读）"; pass=$((pass+1)); else echo "✗ inspector 误消费：full 模式下 worker 将收不到额外指令"; fail=$((fail+1)); fi

# ── worker-reviewer ──
reset_case 4
run_wr() { # run_wr <cwd>；MOCK_LOG/MOCK_MARK 经环境导出传递（勿用前缀赋值+未引号展开，会被分词）
  (cd "$1" && bash "$KIT/worker-reviewer.sh" ${2:-} 2>&1)
}

# T4 无 TODO.md：不调 claude
out=$(run_wr "$PROJ")
if printf '%s' "$out" | grep -q "No actionable tasks" && ! grep -q "INVOCATION" "$MOCK_LOG" 2>/dev/null; then
  echo "✓ worker-reviewer：无 TODO.md 不调 claude"; pass=$((pass+1))
else echo "✗ worker-reviewer：无 TODO.md 行为异常"; fail=$((fail+1)); fi
echo "本轮指令" > /tmp/harness-context.txt   # 场景前置：reset_case 的清理不能算到脚本头上
out=$(run_wr "$PROJ")
if printf '%s' "$out" | grep -q "No actionable tasks" && [ -f /tmp/harness-context.txt ]; then
  echo "✓ worker-reviewer：无可做任务早退不消费上下文"; pass=$((pass+1))
else echo "✗ 未投递却消费了上下文（无条件销毁回归）"; fail=$((fail+1)); fi

# T5 [待领取] + Worker 未完成 → 只调 Worker，不调 Reviewer
printf -- '- [ ] [待领取] 修内存泄漏\n' > "$PROJ/TODO.md"
out=$(run_wr "$PROJ")
check "worker-reviewer：领取任务并注入 TODO 内容" "领取最高优先级" "修内存泄漏"
if printf '%s' "$out" | grep -q "Worker did not complete" && [ "$(grep -c 'INVOCATION' "$MOCK_LOG")" = 1 ]; then
  echo "✓ worker-reviewer：Worker 未完成则跳过 Reviewer"; pass=$((pass+1))
else echo "✗ worker-reviewer：未完成却走了 Reviewer"; fail=$((fail+1)); fi

# T6 Worker 标记 [待审查] → Worker + Reviewer 各一次
: > "$MOCK_LOG"
printf -- '- [ ] [待领取] 修内存泄漏\n' > "$PROJ/TODO.md"
export MOCK_MARK='- [x] [待审查] 修内存泄漏'
out=$(run_wr "$PROJ")
unset MOCK_MARK
check "worker-reviewer：完成链路调 Reviewer 审查" "审查 Worker 的改动" "git status"
if [ "$(grep -c 'INVOCATION' "$MOCK_LOG")" = 2 ]; then echo "✓ worker-reviewer：Worker+Reviewer 各一次"; pass=$((pass+1)); else echo "✗ 调用次数异常"; fail=$((fail+1)); fi

# T7 [被拒绝] 也算可做任务
: > "$MOCK_LOG"
printf -- '- [ ] [被拒绝] 打回的任务\n' > "$PROJ/TODO.md"
out=$(run_wr "$PROJ")
check "worker-reviewer：被拒绝任务可重新领取" "被拒绝] 打回的任务"

# T7b claude CLI 异常退出：投递已发生 → trap EXIT 仍收尾消费（set -e 中断不可达回归钉）
reset_case 7
printf -- '- [ ] [待领取] 修内存泄漏\n' > "$PROJ/TODO.md"
echo "异常退出轮上下文" > /tmp/harness-context.txt
out=$(cd "$PROJ" && MOCK_LOG="$MOCK_LOG" MOCK_FAIL=1 bash "$KIT/worker-reviewer.sh" 2>&1); rc=$?
if [ $rc -ne 0 ] && [ ! -f /tmp/harness-context.txt ]; then
  echo "✓ claude 异常退出：脚本非零退出且上下文已收尾消费"; pass=$((pass+1))
else echo "✗ claude 异常退出：rc=$rc 上下文$([ -f /tmp/harness-context.txt ] && echo 未消费)"; fail=$((fail+1)); fi

# T8 收尾消费：有可做任务且实际投递 → 脚本收尾删除
reset_case 8
printf -- '- [ ] [待领取] 消费语义场景\n' > "$PROJ/TODO.md"
echo "worker 轮上下文" > /tmp/harness-context.txt
out=$(run_wr "$PROJ")
if [ -f /tmp/harness-context.txt ]; then echo "✗ 投递后未消费"; fail=$((fail+1)); else echo "✓ worker-reviewer：投递后收尾消费"; pass=$((pass+1)); fi

echo "── 通过 $pass / 失败 $fail"
[ "$fail" -eq 0 ]
