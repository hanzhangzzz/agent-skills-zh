#!/usr/bin/env bash
# Harness Inspector — 定时巡检，发现问题写入 TODO.md
# 用法: bash inspector.sh ["用户额外指令"]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPT_FILE="$SCRIPT_DIR/prompts/inspector.md"

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

# 用户额外上下文（可选）
USER_CONTEXT="${1:-}"
if [ -f /tmp/harness-context.txt ]; then
  USER_CONTEXT="$(cat /tmp/harness-context.txt)"
fi
# 注意：不在此消费——full 模式下 worker-reviewer.sh 是同轮后继读者；
# 消费由 worker-reviewer 在实际投递后的脚本收尾执行

cd "$PROJECT_DIR"

echo "=== Inspector starting at $(date) ==="

# 将核心文档内容注入 prompt
DOCS_CONTEXT=""
for doc in \
  "AGENTS.md" \
  "CLAUDE.md" \
  "README.md" \
  "TODO.md"; do
  if [ -f "$doc" ]; then
    DOCS_CONTEXT="${DOCS_CONTEXT}

---
### ${doc}
$(cat "$doc")
"
  fi
done

# 构建额外上下文段落（如果有）
EXTRA_PROMPT=""
if [ -n "$USER_CONTEXT" ]; then
  EXTRA_PROMPT="

## 用户本轮额外指令

${USER_CONTEXT}

请在执行巡检时参考用户的额外指令。这不覆盖你的独立判断，但如果用户指出了特定关注点，优先深入分析。"
fi

claude -p "$(cat "$PROMPT_FILE")

项目路径: $PROJECT_DIR
当前时间: $(date '+%Y-%m-%d %H:%M:%S')

以下是核心文档的完整内容：

${DOCS_CONTEXT}
${EXTRA_PROMPT}

请按巡检流程执行，更新 TODO.md。

关键提醒：
1. Phase 4 是最重要的输出环节——确保方向调整中的新任务写入正式 Priority 列表，不要只写在 Strategic Assessment 文字中
2. 保留所有 [进行中] 和 [被拒绝] 状态的任务不变
3. 你的输出会直接影响 Worker 下一步做什么，请确保任务描述包含清晰的 hint" \
  --permission-mode bypassPermissions \
  --verbose \
  --output-format stream-json 2>&1 | tail -5

echo "=== Inspector finished at $(date) ==="
