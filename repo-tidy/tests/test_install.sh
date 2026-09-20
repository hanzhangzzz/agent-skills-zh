#!/bin/bash
# install.sh 的对抗测试：幂等、不碰别人的配置、非法 JSON 不破坏。
# 用法: bash test_install.sh [scratch目录]
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$DIR/../scripts/install.sh"
SCRATCH="${1:-$(mktemp -d)}"; mkdir -p "$SCRATCH"
PASS=0; FAIL=0
ok()  { echo "✓ $1"; PASS=$((PASS+1)); }
bad() { echo "✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

fresh() {  # fresh <名字> [初始 settings.json 内容] → 回显假 CLAUDE_HOME
  local h="$SCRATCH/$1"; rm -rf "$h"; mkdir -p "$h"
  [ $# -ge 2 ] && printf '%s' "$2" > "$h/settings.json"
  echo "$h"
}
count_ours() {  # 统计本 skill 的 hook 条数
  python3 - "$1/settings.json" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print(0); raise SystemExit
n=sum(1 for ev in d.get("hooks",{}).values() if isinstance(ev,list)
        for e in ev if isinstance(e,dict)
        for h in e.get("hooks",[]) if isinstance(h,dict)
        and "repo-tidy/scripts/" in h.get("command",""))
print(n)
PY
}

# 1. 空目录：从零安装 5 条
H=$(fresh empty)
out=$(CLAUDE_HOME="$H" bash "$INSTALL" 2>&1)
[ "$(count_ours "$H")" = "5" ] && ok "空配置从零安装 5 条" || bad "从零安装" "实际 $(count_ours "$H") 条; $out"

# 2. 幂等：再跑一次不重复
CLAUDE_HOME="$H" bash "$INSTALL" >/dev/null 2>&1
[ "$(count_ours "$H")" = "5" ] && ok "重复安装不新增（幂等）" || bad "幂等" "实际 $(count_ours "$H") 条"

# 3. --check 装好后返回 0
CLAUDE_HOME="$H" bash "$INSTALL" --check >/dev/null 2>&1
[ $? -eq 0 ] && ok "--check 已装齐时退出码 0" || bad "--check 已装" "退出码非 0"

# 4. --check 未装时返回 1 且不写文件
H2=$(fresh nocheck '{}')
CLAUDE_HOME="$H2" bash "$INSTALL" --check >/dev/null 2>&1
rc=$?
[ $rc -eq 1 ] && [ "$(count_ours "$H2")" = "0" ] \
  && ok "--check 未装时退出码 1 且只读" || bad "--check 未装" "rc=$rc 条数=$(count_ours "$H2")"

# 5. 不碰用户已有的其它 hook
USER_CFG='{"hooks":{"SessionStart":[{"matcher":"*","hooks":[{"type":"command","command":"/my/own.sh"}]}],"Stop":[{"matcher":"*","hooks":[{"type":"command","command":"/my/stop.sh"}]}]},"model":"opus"}'
H3=$(fresh coexist "$USER_CFG")
CLAUDE_HOME="$H3" bash "$INSTALL" >/dev/null 2>&1
keep=$(python3 - "$H3/settings.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
cmds=[h["command"] for ev in d.get("hooks",{}).values() for e in ev for h in e.get("hooks",[])]
print("ok" if "/my/own.sh" in cmds and "/my/stop.sh" in cmds and d.get("model")=="opus" else "lost")
PY
)
[ "$keep" = "ok" ] && [ "$(count_ours "$H3")" = "5" ] \
  && ok "共存：用户原有 hook 与其它字段完好" || bad "共存" "keep=$keep ours=$(count_ours "$H3")"

# 6. 同 matcher 下追加而不是覆盖（SessionStart 的 * 已被用户占用）
same=$(python3 - "$H3/settings.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
ss=[e for e in d["hooks"]["SessionStart"] if e.get("matcher")=="*"]
print(len(ss), len(ss[0]["hooks"]) if ss else 0)
PY
)
[ "$same" = "1 3" ] && ok "同 matcher 合并进同一条目（1 条目 3 个 hook）" || bad "同 matcher 合并" "实际: $same"

# 7. 生成备份
ls "$H3"/settings.json.bak-* >/dev/null 2>&1 && ok "改动前生成备份" || bad "备份" "未找到 settings.json.bak-*"

# 8. --uninstall 只删自己的
CLAUDE_HOME="$H3" bash "$INSTALL" --uninstall >/dev/null 2>&1
left=$(python3 - "$H3/settings.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
cmds=[h["command"] for ev in d.get("hooks",{}).values() for e in ev for h in e.get("hooks",[])]
print("ok" if "/my/own.sh" in cmds and "/my/stop.sh" in cmds else "lost")
PY
)
[ "$(count_ours "$H3")" = "0" ] && [ "$left" = "ok" ] \
  && ok "--uninstall 只移除本 skill 的，用户的保留" || bad "uninstall" "ours=$(count_ours "$H3") user=$left"

# 9. 非法 JSON：拒绝且不破坏原文件
H4=$(fresh badjson '{"hooks": [broken')
before=$(cat "$H4/settings.json")
CLAUDE_HOME="$H4" bash "$INSTALL" >/dev/null 2>&1
rc=$?
[ $rc -ne 0 ] && [ "$(cat "$H4/settings.json")" = "$before" ] \
  && ok "非法 JSON 拒绝改动且原文件不变" || bad "非法 JSON" "rc=$rc"

# 10. 顶层非对象：拒绝
H5=$(fresh notobj '[1,2,3]')
CLAUDE_HOME="$H5" bash "$INSTALL" >/dev/null 2>&1
[ $? -ne 0 ] && ok "顶层非对象时拒绝" || bad "顶层非对象" "退出码 0"

# 11. 注册的是绝对路径且文件真实存在
H6=$(fresh paths)
CLAUDE_HOME="$H6" bash "$INSTALL" >/dev/null 2>&1
miss=$(python3 - "$H6/settings.json" <<'PY'
import json,os,sys
d=json.load(open(sys.argv[1]))
bad=[h["command"] for ev in d.get("hooks",{}).values() for e in ev for h in e.get("hooks",[])
     if not (h["command"].startswith("/") and os.path.isfile(h["command"]))]
print(len(bad))
PY
)
[ "$miss" = "0" ] && ok "注册的命令均为存在的绝对路径" || bad "路径有效性" "$miss 条无效"

echo "── 通过 $PASS / 失败 $FAIL"
[ "$FAIL" -eq 0 ]
