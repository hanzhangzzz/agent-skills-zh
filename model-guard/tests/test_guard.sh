#!/usr/bin/env bash
# guard.sh 行为矩阵：伪造 transcript 与 rate-limits，逐条验证放行/拦截。
# 用法: bash test_guard.sh [scratch目录]
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/../scripts/guard.sh"
SCRATCH="${1:-$(mktemp -d)}"; mkdir -p "$SCRATCH"
export CLAUDE_HOME="$SCRATCH/home"
rm -rf "$CLAUDE_HOME"; mkdir -p "$CLAUDE_HOME/model-guard"
PASS=0; FAIL=0
NOW=$(date +%s)

cat > "$CLAUDE_HOME/model-guard.json" <<'JSON'
{"expensive_models":["fable","astra"],"cheap_models":["opus","sonnet","haiku"],"reserve_5h":40,"reserve_7d":50,"statusline_original":null,"version":1}
JSON

transcript() {  # transcript <文件> <模型>：前面垫一条别的模型和一条超长 user 行，验证只取最后一条 assistant
  python3 - "$1" "$2" <<'PY'
import json, sys
path, model = sys.argv[1], sys.argv[2]
with open(path, "w") as f:
    f.write(json.dumps({"type": "assistant", "message": {"model": "claude-haiku-old"}}) + "\n")
    f.write(json.dumps({"type": "assistant", "message": {"model": model, "content": "x" * 200000}}) + "\n")
    f.write(json.dumps({"type": "user", "message": {"content": "y" * 100000}}) + "\n")
    f.write(json.dumps({"type": "assistant", "message": {"model": "<synthetic>"}}) + "\n")
PY
}
limits() {  # limits <5h用量%> <5h剩余秒> <7d用量%> <7d剩余秒> [saved_at偏移秒]
  python3 - "$CLAUDE_HOME/model-guard/rate-limits.json" "$NOW" "$@" <<'PY'
import json, sys
path, now, u5, l5, u7, l7 = sys.argv[1], int(sys.argv[2]), *map(float, sys.argv[3:7])
age = int(sys.argv[7]) if len(sys.argv) > 7 else 0
json.dump({"five_hour": {"used_percentage": u5, "resets_at": int(now + l5)},
           "seven_day": {"used_percentage": u7, "resets_at": int(now + l7)},
           "saved_at": now - age}, open(path, "w"))
PY
}
FABLE="$SCRATCH/fable.jsonl"; transcript "$FABLE" claude-fable-5-1
OPUS="$SCRATCH/opus.jsonl";   transcript "$OPUS" claude-opus-5-5

run() {  # run <transcript> <tool> <tool_input json> [额外字段json]
  local extra="${4:-}"; [ -n "$extra" ] || extra='{}'
  python3 -c '
import json,sys
e={"session_id":"s","transcript_path":sys.argv[1],"cwd":"/tmp","hook_event_name":"PreToolUse",
   "tool_name":sys.argv[2],"tool_input":json.loads(sys.argv[3])}
e.update(json.loads(sys.argv[4])); print(json.dumps(e))' "$1" "$2" "$3" "$extra" \
    | "$GUARD" 2>"$SCRATCH/stderr"
}
expect() {  # expect <期望退出码> <名称> <run 参数...>
  local want="$1" name="$2"; shift 2
  run "$@"; local rc=$?
  if [ "$rc" = "$want" ]; then echo "✓ $name"; PASS=$((PASS+1))
  else echo "✗ ${name}：期望 $want 实际 $rc"; sed 's/^/    /' "$SCRATCH/stderr"; FAIL=$((FAIL+1)); fi
}

H5=$((4*3600)); D6=$((6*86400))   # 5h 窗口剩 4 小时、7d 窗口剩 6 天（都接近窗口开头）

limits 90 $H5 90 $D6
expect 0 "非贵模型（opus）即使越线也放行"            "$OPUS" Bash '{"command":"ls"}'

limits 10 $H5 10 $D6
expect 0 "贵模型、线下放行 Bash"                    "$FABLE" Bash '{"command":"ls"}'

limits 75 $H5 10 $D6
expect 2 "5h 越线拦 Bash"                          "$FABLE" Bash '{"command":"ls"}'
grep -q "fable" "$SCRATCH/stderr" && grep -q "subagent" "$SCRATCH/stderr" && grep -q "/compact" "$SCRATCH/stderr" \
  && { echo "✓ 拒绝原因含模型、subagent、/compact"; PASS=$((PASS+1)); } \
  || { echo "✗ 拒绝原因不完整"; cat "$SCRATCH/stderr"; FAIL=$((FAIL+1)); }
[ "$(grep -c '' "$SCRATCH/stderr")" = "2" ] \
  && { echo "✓ 拒绝原因恰好两行"; PASS=$((PASS+1)); } || { echo "✗ 拒绝原因行数"; FAIL=$((FAIL+1)); }

limits 10 $H5 60 $D6
expect 2 "7d 越线拦 Bash"                          "$FABLE" Bash '{"command":"ls"}'

limits 75 $H5 10 $D6
expect 0 "越线 Agent(model=sonnet) 放行"            "$FABLE" Agent '{"prompt":"x","model":"sonnet","subagent_type":"general-purpose"}'
expect 2 "越线 Agent 无 model 拒"                   "$FABLE" Agent '{"prompt":"x","subagent_type":"general-purpose"}'
expect 2 "越线 Agent fork 拒（即使带 model）"        "$FABLE" Agent '{"prompt":"x","model":"opus","subagent_type":"fork"}'
grep -q "fork" "$SCRATCH/stderr" && { echo "✓ fork 拒绝原因点名 fork"; PASS=$((PASS+1)); } || { echo "✗ fork 原因"; FAIL=$((FAIL+1)); }
expect 2 "越线 Agent(model=fable) 拒"               "$FABLE" Agent '{"prompt":"x","model":"fable"}'
expect 0 "越线 Read limit=100 放行"                 "$FABLE" Read '{"file_path":"/a","limit":100}'
expect 2 "越线 Read 无 limit 拒"                    "$FABLE" Read '{"file_path":"/a"}'
expect 2 "越线 Read limit=500 拒"                   "$FABLE" Read '{"file_path":"/a","limit":500}'
expect 0 "越线 AskUserQuestion 放行"                "$FABLE" AskUserQuestion '{}'
expect 0 "越线 TodoWrite 放行"                      "$FABLE" TodoWrite '{}'
expect 2 "越线 Edit 拒"                             "$FABLE" Edit '{"file_path":"/a"}'
expect 2 "越线 mcp 工具拒"                          "$FABLE" mcp__serena__find_symbol '{}'

# subagent：hook 拿到的是主 session transcript，须按 agent_id 读 subagent 自己的 transcript
SUB_MAIN="$SCRATCH/main-sess.jsonl"; transcript "$SUB_MAIN" claude-fable-5-1
mkdir -p "$SCRATCH/main-sess/subagents"
transcript "$SCRATCH/main-sess/subagents/agent-abc123.jsonl" claude-sonnet-5-5
expect 0 "越线时贵模型派出的 sonnet subagent 跑 Bash 放行" "$SUB_MAIN" Bash '{"command":"ls"}' '{"agent_id":"abc123","agent_type":"general-purpose"}'
transcript "$SCRATCH/main-sess/subagents/agent-fork1.jsonl" claude-fable-5-1
expect 2 "越线时继承贵模型的 subagent 跑 Bash 被拦"         "$SUB_MAIN" Bash '{"command":"ls"}' '{"agent_id":"fork1","agent_type":"fork"}'
echo '{"model":"haiku"}' > "$SCRATCH/main-sess/subagents/agent-new1.meta.json"
expect 0 "subagent transcript 未写入时读 meta.json 的 model" "$SUB_MAIN" Bash '{"command":"ls"}' '{"agent_id":"new1"}'

rm -f "$CLAUDE_HOME/model-guard/rate-limits.json"
expect 0 "用量数据缺失放行（fail open）"             "$FABLE" Bash '{"command":"ls"}'

limits 99 $H5 99 $D6 $((7*3600))
expect 0 "用量数据过期（7 小时前）放行"               "$FABLE" Bash '{"command":"ls"}'

limits 95 600 10 $D6
expect 0 "5h 窗口尾端（剩 10 分钟、u=95%）放行"       "$FABLE" Bash '{"command":"ls"}'

limits 65 $((5*3600 - 60)) 10 $D6
expect 2 "5h 窗口开头（u=65%）拦"                    "$FABLE" Bash '{"command":"ls"}'

python3 -c 'import json,sys,time;json.dump({"five_hour":{"used_percentage":99},"saved_at":int(time.time())},open(sys.argv[1],"w"))' \
  "$CLAUDE_HOME/model-guard/rate-limits.json"
expect 0 "缺 resets_at 放行"                        "$FABLE" Bash '{"command":"ls"}'

python3 -c 'import json,sys,time;n=int(time.time());json.dump({"five_hour":{"utilization":0.8,"resets_at":n+14000},"saved_at":n},open(sys.argv[1],"w"))' \
  "$CLAUDE_HOME/model-guard/rate-limits.json"
expect 2 "utilization=0.8 按比例解析为 80% 并拦截"     "$FABLE" Bash '{"command":"ls"}'

echo "not json" | "$GUARD" 2>/dev/null; rc=$?
[ $rc = 0 ] && { echo "✓ 非法 stdin 放行"; PASS=$((PASS+1)); } || { echo "✗ 非法 stdin rc=$rc"; FAIL=$((FAIL+1)); }

echo; echo "通过 ${PASS}，失败 ${FAIL}"
[ "$FAIL" = 0 ]
