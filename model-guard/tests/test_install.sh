#!/usr/bin/env bash
# install.sh 对抗测试：全部在临时 HOME 下进行，不碰真实配置。
# 用法: bash test_install.sh [scratch目录]
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$DIR/../scripts/install.sh"
SCRATCH="${1:-$(mktemp -d)}"; mkdir -p "$SCRATCH"
PASS=0; FAIL=0
ok()  { echo "✓ $1"; PASS=$((PASS+1)); }
bad() { echo "✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$2"; fi; }

ORIG='{"model":"opus","hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"/my/any.sh"}]},{"matcher":"Bash","hooks":[{"type":"command","command":"/my/bash.sh"}]}],"SessionStart":[{"matcher":"*","hooks":[{"type":"command","command":"/my/start.sh"}]}]},"statusLine":{"type":"command","command":"/my/status.sh --x","padding":2}}'

setup() {  # setup <名字>：临时 HOME，CLAUDE.md 软链到 ~/.codex/AGENTS.md（复刻用户真实布局）
  H="$SCRATCH/$1"; rm -rf "$H"; mkdir -p "$H/.claude" "$H/.codex"
  export CLAUDE_HOME="$H/.claude" CODEX_HOME="$H/.codex"
  printf '%s' "$ORIG" > "$CLAUDE_HOME/settings.json"
  printf '# 我的规则\n\n- 用中文\n' > "$CODEX_HOME/AGENTS.md"
  ln -s "$CODEX_HOME/AGENTS.md" "$CLAUDE_HOME/CLAUDE.md"
}
py() { python3 -c "$@"; }
S() { echo "$CLAUDE_HOME/settings.json"; }

# 1. 安装两次结果一致
setup twice
bash "$INSTALL" >/dev/null || bad "首次安装退出码" "非 0"
cp "$(S)" "$SCRATCH/first.json"; cp "$CODEX_HOME/AGENTS.md" "$SCRATCH/first.md"
bash "$INSTALL" >/dev/null
check "装两次 settings.json 一致" "cmp -s '$(S)' '$SCRATCH/first.json'"
check "装两次软提示一致" "cmp -s '$CODEX_HOME/AGENTS.md' '$SCRATCH/first.md'"
check "guard.sh 只注册一次且挂在已有的 * 条目下" \
  "[ \"\$(py 'import json,sys;d=json.load(open(sys.argv[1]));p=d[\"hooks\"][\"PreToolUse\"];print(len(p), sum(\"model-guard/scripts/guard.sh\" in h[\"command\"] for e in p for h in e[\"hooks\"]), len(p[0][\"hooks\"]))' '$(S)')\" = '2 1 2' ]"
check "其它 hook 与字段原样保留" \
  "py 'import json,sys;d=json.load(open(sys.argv[1]));c=[h[\"command\"] for v in d[\"hooks\"].values() for e in v for h in e[\"hooks\"]];assert {\"/my/any.sh\",\"/my/bash.sh\",\"/my/start.sh\"}<=set(c) and d[\"model\"]==\"opus\"' '$(S)'"
check "改前生成带时间戳的备份" "ls '$CLAUDE_HOME'/settings.json.bak-* >/dev/null 2>&1"

# 2. 状态栏被包、original 正确、padding 保留
check "statusLine 指向 statusline-tap.sh 且保留 padding=2" \
  "py 'import json,sys;s=json.load(open(sys.argv[1]))[\"statusLine\"];assert s[\"command\"].endswith(\"statusline-tap.sh\") and s[\"padding\"]==2' '$(S)'"
check "配置里 statusline_original 是安装前的原对象（重复安装未被 tap 覆盖）" \
  "py 'import json,sys;c=json.load(open(sys.argv[1]));assert c[\"statusline_original\"]=={\"type\":\"command\",\"command\":\"/my/status.sh --x\",\"padding\":2},c' '$CLAUDE_HOME/model-guard.json'"

# 3. 状态栏旁路：落盘 rate_limits，并把原 stdin 原样交给原命令
mkdir -p "$H/bin"; printf '#!/bin/sh\necho "orig:$1:$(cat)"\n' > "$H/bin/status.sh"; chmod +x "$H/bin/status.sh"
py 'import json,sys;p=sys.argv[1];c=json.load(open(p));c["statusline_original"]["command"]=sys.argv[2]+" --x";json.dump(c,open(p,"w"))' \
  "$CLAUDE_HOME/model-guard.json" "$H/bin/status.sh"
IN='{"model":{"id":"claude-fable-5-1"},"rate_limits":{"five_hour":{"used_percentage":7,"resets_at":1790000000},"seven_day":{"used_percentage":17,"resets_at":1790500000}}}'
TAP=$(py 'import json,sys;print(json.load(open(sys.argv[1]))["statusLine"]["command"])' "$(S)")
OUT=$(printf '%s' "$IN" | eval "$TAP")
check "tap 把原 stdin 原样喂给原命令（含参数）" "[ \"\$OUT\" = 'orig:--x:$IN' ]"
check "tap 落盘 rate_limits 并加 saved_at" \
  "py 'import json,sys,time;d=json.load(open(sys.argv[1]));assert d[\"five_hour\"][\"used_percentage\"]==7 and abs(d[\"saved_at\"]-time.time())<60' '$CLAUDE_HOME/model-guard/rate-limits.json'"
py 'import json,sys;p=sys.argv[1];c=json.load(open(p));c["statusline_original"]=None;json.dump(c,open(p,"w"))' "$CLAUDE_HOME/model-guard.json"
check "无原命令时 tap 只落盘、输出为空" "[ -z \"\$(printf '%s' '$IN' | eval \"$TAP\")\" ]"

# 4. CLAUDE.md 是软链：写到目标、软链保留、只写一次
setup symlink
bash "$INSTALL" >/dev/null
check "CLAUDE.md 仍是软链" "[ -L '$CLAUDE_HOME/CLAUDE.md' ]"
check "软提示块只出现一次" "[ \"\$(grep -c 'model-guard:start' '$CODEX_HOME/AGENTS.md')\" = 1 ]"
check "原有内容保留" "grep -q '用中文' '$CODEX_HOME/AGENTS.md'"

# 5. CLAUDE.md 与 AGENTS.md 是两份独立文件时各写一份
setup separate
rm "$CLAUDE_HOME/CLAUDE.md"; printf '# claude\n' > "$CLAUDE_HOME/CLAUDE.md"
bash "$INSTALL" >/dev/null
check "独立文件各写一份" "grep -q model-guard:start '$CLAUDE_HOME/CLAUDE.md' && grep -q model-guard:start '$CODEX_HOME/AGENTS.md'"

# 6. 更新模型列表与保留额：配置与软提示同步，块被替换而非追加
setup update
bash "$INSTALL" >/dev/null
bash "$INSTALL" --models fable,astra,gpt-pro --reserve-5h 30 >/dev/null
check "配置同步更新" \
  "py 'import json,sys;c=json.load(open(sys.argv[1]));assert c[\"expensive_models\"]==[\"fable\",\"astra\",\"gpt-pro\"] and c[\"reserve_5h\"]==30 and c[\"reserve_7d\"]==50,c' '$CLAUDE_HOME/model-guard.json'"
check "软提示同步更新且仍只有一块" \
  "grep -q 'gpt-pro' '$CODEX_HOME/AGENTS.md' && grep -q '低于 30%' '$CODEX_HOME/AGENTS.md' && [ \"\$(grep -c 'model-guard:start' '$CODEX_HOME/AGENTS.md')\" = 1 ]"
bash "$INSTALL" --reserve-7d 60 >/dev/null
check "只改一项时其它配置沿用" \
  "py 'import json,sys;c=json.load(open(sys.argv[1]));assert c[\"expensive_models\"][-1]==\"gpt-pro\" and c[\"reserve_5h\"]==30 and c[\"reserve_7d\"]==60' '$CLAUDE_HOME/model-guard.json'"
bash "$INSTALL" --reserve-5h 120 >/dev/null 2>&1; rc=$?
check "非法保留额被拒且配置不变" "[ $rc -ne 0 ] && grep -q '\"reserve_5h\": 30' '$CLAUDE_HOME/model-guard.json'"
check "默认写入保留线下限 15% 且软提示写明下限" \
  "py 'import json,sys;c=json.load(open(sys.argv[1]));assert c[\"reserve_floor_5h\"]==15 and c[\"reserve_floor_7d\"]==15,c' '$CLAUDE_HOME/model-guard.json' && grep -q '不低于下限 5h 15% / 7d 15%' '$CODEX_HOME/AGENTS.md'"
bash "$INSTALL" --reserve-floor-7d 10 >/dev/null
check "--reserve-floor-7d 持久化、其它项沿用" \
  "py 'import json,sys;c=json.load(open(sys.argv[1]));assert c[\"reserve_floor_7d\"]==10 and c[\"reserve_floor_5h\"]==15 and c[\"reserve_7d\"]==60,c' '$CLAUDE_HOME/model-guard.json' && grep -q '7d 10%，' '$CODEX_HOME/AGENTS.md'"
bash "$INSTALL" --reserve-floor-5h -1 >/dev/null 2>&1; rc=$?
check "非法下限被拒且配置不变" "[ $rc -ne 0 ] && grep -q '\"reserve_floor_5h\": 15' '$CLAUDE_HOME/model-guard.json'"
bash "$INSTALL" --reserve-5h 10 --reserve-floor-5h 50 >/dev/null
check "下限高于保留额时现状表与软提示显示实际生效值 min(下限, 保留额)" \
  "bash '$INSTALL' --status | grep -q '保留线下限  *5h 10%' && grep -q '不低于下限 5h 10% / 7d 10%' '$CODEX_HOME/AGENTS.md'"

# 7. 卸载后 settings.json 与安装前等价，软提示块移除，配置保留
setup uninstall
bash "$INSTALL" >/dev/null; bash "$INSTALL" --uninstall >/dev/null
check "卸载后 settings.json 与安装前语义等价" \
  "py 'import json,sys;assert json.load(open(sys.argv[1]))==json.loads(sys.argv[2])' '$(S)' '$ORIG'"
printf '# 我的规则\n\n- 用中文\n' > "$SCRATCH/orig.md"
check "卸载后 AGENTS.md 逐字节恢复原文" "cmp -s '$CODEX_HOME/AGENTS.md' '$SCRATCH/orig.md'"
check "卸载保留配置文件" "[ -f '$CLAUDE_HOME/model-guard.json' ]"
bash "$INSTALL" --uninstall >/dev/null
check "重复卸载无副作用" "py 'import json,sys;assert json.load(open(sys.argv[1]))==json.loads(sys.argv[2])' '$(S)' '$ORIG'"

# 8. 原本没有 statusLine：安装造一个，卸载删掉
setup nostatus
printf '{}' > "$(S)"
bash "$INSTALL" >/dev/null
check "无原状态栏时 original 为 null" \
  "py 'import json,sys;assert json.load(open(sys.argv[1]))[\"statusline_original\"] is None' '$CLAUDE_HOME/model-guard.json'"
bash "$INSTALL" --uninstall >/dev/null
check "卸载后回到空配置" "py 'import json,sys;assert json.load(open(sys.argv[1]))=={}' '$(S)'"

# 9. 非法 settings.json 拒绝修改
setup badjson
printf '{oops' > "$(S)"
bash "$INSTALL" >/dev/null 2>&1; rc=$?
check "非法 JSON 拒绝安装且原文不动" "[ $rc -ne 0 ] && [ \"\$(cat '$(S)')\" = '{oops' ]"

# 10. 无 ~/.codex 时只写 CLAUDE.md
setup nocodex
rm -rf "$CODEX_HOME"; rm "$CLAUDE_HOME/CLAUDE.md"
bash "$INSTALL" >/dev/null
check "无 Codex 目录时只写 CLAUDE.md、不创建 ~/.codex" "grep -q model-guard:start '$CLAUDE_HOME/CLAUDE.md' && [ ! -e '$CODEX_HOME' ]"

# 11. --status 与 --selftest
setup statustest
bash "$INSTALL" --status >/dev/null 2>&1; rc=$?
check "未安装时 --status 退出码 1" "[ $rc = 1 ]"
bash "$INSTALL" >/dev/null
OUT=$(bash "$INSTALL" --status 2>&1); rc=$?
check "安装后 --status 退出码 0 且提示 Codex 未信任" "[ $rc = 0 ] && echo \"\$OUT\" | grep -q '已注册，✗ 未信任'"
OUT=$(bash "$INSTALL" --selftest 2>&1); rc=$?
check "--selftest 通过" "[ $rc = 0 ] && echo \"\$OUT\" | grep -q '全部通过'" || echo "$OUT"

# 13. 已包过状态栏但配置丢失/损坏：重装拒绝、卸载不动状态栏，绝不用 null 覆盖原命令
setup lostcfg
bash "$INSTALL" >/dev/null
cp "$(S)" "$SCRATCH/lost-before.json"
rm "$CLAUDE_HOME/model-guard.json"
bash "$INSTALL" >"$SCRATCH/lost.out" 2>&1; rc=$?
check "配置丢失时重装拒绝且 settings.json 不变" "[ $rc -ne 0 ] && cmp -s '$(S)' '$SCRATCH/lost-before.json' && grep -q '.bak' '$SCRATCH/lost.out'"
printf '{broken' > "$CLAUDE_HOME/model-guard.json"
bash "$INSTALL" >/dev/null 2>&1; rc=$?
check "配置损坏时重装同样拒绝" "[ $rc -ne 0 ] && cmp -s '$(S)' '$SCRATCH/lost-before.json'"
OUT=$(bash "$INSTALL" --uninstall 2>&1)
check "配置丢失时卸载保留状态栏并提示手工恢复、hook 照常移除" \
  "py 'import json,sys;d=json.load(open(sys.argv[1]));assert d[\"statusLine\"][\"command\"].endswith(\"statusline-tap.sh\");assert not any(\"guard.sh\" in h[\"command\"] for e in d[\"hooks\"][\"PreToolUse\"] for h in e[\"hooks\"])' '$(S)' && echo \"\$OUT\" | grep -q '未还原状态栏'"

# 14. 原本无状态栏（original 合法为 null）时重装不被误拒
setup nullorig
printf '{}' > "$(S)"
bash "$INSTALL" >/dev/null; bash "$INSTALL" >/dev/null 2>&1; rc=$?
check "original 为 null 的正常安装可重装" "[ $rc = 0 ]"

# 15. settings.json 是软链：原子写落到目标、软链保留、无临时文件残留
setup linked
mv "$(S)" "$H/real-settings.json"; ln -s "$H/real-settings.json" "$(S)"
bash "$INSTALL" >/dev/null
check "settings.json 软链保留且目标已写入" "[ -L '$(S)' ] && grep -q statusline-tap '$H/real-settings.json'"
check "原子写无 .tmp 残留" "! ls '$H'/*.tmp '$CLAUDE_HOME'/*.tmp '$CODEX_HOME'/*.tmp >/dev/null 2>&1"

# 12. Codex hooks.json：注册、幂等、保留别人的 hook、信任检测、卸载还原
CODEX_ORIG='{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"/my/codex-any.sh"}]}],"Stop":[{"hooks":[{"type":"command","command":"/my/notify.sh"}]}]}}'
setup codexhook
printf '%s' "$CODEX_ORIG" > "$CODEX_HOME/hooks.json"
bash "$INSTALL" >/dev/null; cp "$CODEX_HOME/hooks.json" "$SCRATCH/codex-first.json"; bash "$INSTALL" >/dev/null
check "Codex hooks.json 装两次一致" "cmp -s '$CODEX_HOME/hooks.json' '$SCRATCH/codex-first.json'"
check "Codex guard.sh 只注册一次、别人的 hook 保留" \
  "py 'import json,sys;d=json.load(open(sys.argv[1]));c=[h[\"command\"] for v in d[\"hooks\"].values() for e in v for h in e[\"hooks\"]];assert sum(\"model-guard/scripts/guard.sh\" in x for x in c)==1 and \"/my/codex-any.sh\" in c and \"/my/notify.sh\" in c,c' '$CODEX_HOME/hooks.json'"
check "Codex hooks.json 改前有备份" "ls '$CODEX_HOME'/hooks.json.bak-* >/dev/null 2>&1"
# 按 Codex 信任登记规则写 config.toml（规则已用 codex exec 实测：登记后 hook 才执行）
cat > "$SCRATCH/trust.py" <<'EOF'
import json, hashlib, sys
path = sys.argv[1]; d = json.load(open(path))
for gi, e in enumerate(d["hooks"]["PreToolUse"]):
    for hi, h in enumerate(e["hooks"]):
        if "model-guard" in h["command"]:
            ident = {"event_name": "pre_tool_use", "matcher": e["matcher"], "hooks": [
                {"type": "command", "command": h["command"], "timeout": h.get("timeout", 600), "async": False}]}
            dig = "sha256:" + hashlib.sha256(json.dumps(ident, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            open(sys.argv[2], "w").write('[hooks.state."%s:pre_tool_use:%d:%d"]\ntrusted_hash = "%s"\n' % (path, gi, hi, dig))
EOF
python3 "$SCRATCH/trust.py" "$CODEX_HOME/hooks.json" "$CODEX_HOME/config.toml"
check "信任登记后 --status 显示已信任" "bash '$INSTALL' --status 2>&1 | grep -q '已注册，已信任'"
sed -i.orig 's/sha256:./sha256:0/' "$CODEX_HOME/config.toml"
check "hash 不符时显示未信任" "bash '$INSTALL' --status 2>&1 | grep -q '已注册，✗ 未信任'"
OUT=$(bash "$INSTALL" --selftest 2>&1); rc=$?
check "--selftest 含 Codex 用例并通过" "[ $rc = 0 ] && echo \"\$OUT\" | grep -q 'Codex 贵模型 + 7d 过线'" || echo "$OUT"
bash "$INSTALL" --uninstall >/dev/null
check "卸载后 Codex hooks.json 与安装前等价" \
  "py 'import json,sys;assert json.load(open(sys.argv[1]))==json.loads(sys.argv[2])' '$CODEX_HOME/hooks.json' '$CODEX_ORIG'"

echo; echo "通过 ${PASS}，失败 ${FAIL}"
[ "$FAIL" = 0 ]
