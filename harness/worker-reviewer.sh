#!/usr/bin/env bash
# Harness Worker+Reviewer Loop — 持续领取任务、修复、审查
# 用法:
#   ./worker-reviewer.sh          # 单次循环（领一个任务）
#   ./worker-reviewer.sh --loop   # 持续循环直到没有可做的任务
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKER_PROMPT="$SCRIPT_DIR/prompts/worker.md"
REVIEWER_PROMPT="$SCRIPT_DIR/prompts/reviewer.md"

resolve_project_dir() {
  if [ -n "${HARNESS_PROJECT_DIR:-}" ]; then
    (
      cd "$HARNESS_PROJECT_DIR"
      pwd -P
    )
    return
  fi

  pwd -P
}

PROJECT_DIR="$(resolve_project_dir)"

# 用户额外上下文（从临时文件读取）
USER_CONTEXT=""
if [ -f /tmp/harness-context.txt ]; then
  USER_CONTEXT="$(cat /tmp/harness-context.txt)"
fi
DELIVERED=0   # 是否真的把上下文投递给了 claude（决定收尾是否消费）
# trap EXIT：无论 set -e 中断、正常退出还是 --loop break，投递过的上下文都收尾消费
trap '[ "$DELIVERED" = 1 ] && rm -f /tmp/harness-context.txt' EXIT

cd "$PROJECT_DIR"

LOOP_MODE=false
if [[ "${1:-}" == "--loop" ]]; then
  LOOP_MODE=true
fi

# 构建用户额外上下文段落（如果有）
EXTRA_PROMPT=""
if [ -n "$USER_CONTEXT" ]; then
  EXTRA_PROMPT="

## 用户本轮额外指令

${USER_CONTEXT}

请在工作时参考用户的额外指令。"
fi

# 检查 TODO.md 中是否有可做的任务（[待领取] 或 [被拒绝]）
has_work() {
  grep -qE '^[[:space:]]*-[[:space:]]*\[[ x]\][[:space:]]*\[(待领取|被拒绝)\]' TODO.md 2>/dev/null
}

run_worker() {
  echo "=== Worker starting at $(date) ==="

  # 读取必读文档，注入上下文
  WORKER_DOCS=""
  for doc in "AGENTS.md" "CLAUDE.md" "README.md" "TODO.md"; do
    if [ -f "$doc" ]; then
      WORKER_DOCS="${WORKER_DOCS}

---
### ${doc}
$(cat "$doc")
"
    fi
  done

  DELIVERED=1   # 调用即投递：prompt 已作为参数递出，CLI 随后异常不影响投递事实

  claude -p "$(cat "$WORKER_PROMPT")

项目路径: $PROJECT_DIR
当前时间: $(date '+%Y-%m-%d %H:%M:%S')

以下是必读文档的内容：

${WORKER_DOCS}
${EXTRA_PROMPT}

请从 TODO.md 中领取最高优先级的 [待领取] 或 [被拒绝] 任务并完成修复。

关键提醒：
1. 不要执行 git commit——这是 Reviewer 的职责
2. 每次只做一个任务
3. 测试必须通过才能标记 [待审查]
4. 根据项目文档中定义的验证命令执行相关自动化检查；如果项目定义了端到端或真实流程验证，必须执行并记录结果
5. 严格按照任务状态机操作：[待领取] → [进行中] → [待审查]" \
    --permission-mode bypassPermissions \
    --verbose \
    --output-format stream-json 2>&1 | tail -3
  echo "=== Worker finished at $(date) ==="
}

run_reviewer() {
  echo "=== Reviewer starting at $(date) ==="

  # 读取 TODO.md（最新状态）和相关文档
  REVIEWER_DOCS=""
  for doc in "AGENTS.md" "CLAUDE.md" "README.md" "TODO.md"; do
    if [ -f "$doc" ]; then
      REVIEWER_DOCS="${REVIEWER_DOCS}

---
### ${doc}
$(cat "$doc")
"
    fi
  done

  DELIVERED=1

  claude -p "$(cat "$REVIEWER_PROMPT")

项目路径: $PROJECT_DIR
当前时间: $(date '+%Y-%m-%d %H:%M:%S')

以下是相关文档的内容：

${REVIEWER_DOCS}
${EXTRA_PROMPT}

Worker 刚完成了任务。请审查 Worker 的改动，更新 TODO.md。

关键提醒：
1. 用 git status 和 git diff 查看改动（Worker 不会 commit）
2. 通过：移入 Done Log；只有在项目规则允许或用户明确要求时才执行 git commit，且必须遵守项目提交规范
3. 不通过：标记 [被拒绝] + 写清楚 issues 和 suggestion
4. 同一任务失败 3 次后标记为 blocked" \
    --permission-mode bypassPermissions \
    --verbose \
    --output-format stream-json 2>&1 | tail -3
  echo "=== Reviewer finished at $(date) ==="
}

# 主循环
iteration=0
while true; do
  iteration=$((iteration + 1))
  echo ""
  echo "============================================"
  echo "  Iteration #${iteration} at $(date)"
  echo "============================================"

  # 检查是否有可做的任务
  if ! has_work; then
    echo "No actionable tasks found (no [待领取] or [被拒绝] in TODO.md)."
    echo "Waiting for Inspector to add new tasks."
    break
  fi

  # Phase 1: Worker
  run_worker

  # 检查 Worker 是否真的完成了任务
  if ! grep -q "\[待审查\]" TODO.md 2>/dev/null; then
    echo "Worker did not complete any task. Skipping review."
    if [[ "$LOOP_MODE" == "false" ]]; then
      break
    fi
    continue
  fi

  # Phase 2: Reviewer
  run_reviewer

  echo "=== Iteration #${iteration} complete ==="

  # 单次模式：做完一轮就退出
  if [[ "$LOOP_MODE" == "false" ]]; then
    break
  fi

  # 循环模式：短暂休息后继续
  echo "Waiting 5 seconds before next iteration..."
  sleep 5
done

echo ""
echo "=== Worker+Reviewer session ended at $(date) ==="
echo "Total iterations: ${iteration}"
