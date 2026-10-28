#!/bin/bash
# repo-map 行为测试：scratch HOME 隔离（绝不触碰用户真实 ~/.claude），扫描/解析/注入全链。
# 用法：bash repo-map/scripts/test_repo_map.sh
# 断言协议：以 ! 开头 = 必须不命中；其余 = egrep 必须命中。

set -u
RM="$(cd "$(dirname "$0")" && pwd)/repo_map.py"
PH="$(cd "$(dirname "$0")" && pwd)/prompt_hook.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export HOME="$WORK/home"
mkdir -p "$HOME/.claude"
CODE="$WORK/code"; mkdir -p "$CODE"

pass=0; fail=0
ok() { echo "✓ $1"; pass=$((pass+1)); }
bad() { echo "✗ $1 ${2:+—— 实得: ${2:0:120}}"; fail=$((fail+1)); }
assert() { # assert <名称> <实际串> <egrep 断言...>；失败只计一次
  local label="$1" out="$2"; shift 2
  local a good=1
  for a in "$@"; do
    if [ "${a#!}" != "$a" ]; then
      if printf '%s' "$out" | grep -qE "${a#!}"; then
        echo "✗ ${label} 不应命中 [${a#!}]"; good=0
      fi
    elif ! printf '%s' "$out" | grep -qE "$a"; then
      echo "✗ ${label} 断言未命中 [$a] 实得: $(printf '%s' "$out" | head -1)"; good=0
    fi
  done
  if [ "$good" = 1 ]; then ok "$label"; else fail=$((fail+1)); fi
}

g() { local d="$1"; shift; git -C "$d" -c user.email=t@t -c user.name=t "$@"; }

# 四仓库四角色：自研 / 协作 / 本地 / 第三方
mk() { git init -q -b master "$1"; }
mk "$CODE/alpha"; echo a > "$CODE/alpha/a.txt"; g "$CODE/alpha" add -A; g "$CODE/alpha" commit -q -m i
git -C "$CODE/alpha" remote add origin https://github.com/t/alpha.git          # 非可信 host，本人 commit → 自研·可写
mk "$CODE/beta";  echo b > "$CODE/beta/b.txt"; git -C "$CODE/beta" -c user.email=o@o -c user.name=o add -A; git -C "$CODE/beta" -c user.email=o@o -c user.name=o commit -q -m i
git -C "$CODE/beta" remote add origin https://gitlab.t/x/beta.git              # 可信 host，他人 commit → 协作·可写
mk "$CODE/gamma"; echo c > "$CODE/gamma/c.txt"; g "$CODE/gamma" add -A; g "$CODE/gamma" commit -q -m i  # 本人 commit，首中自研·可写
mk "$CODE/zeta"; echo z > "$CODE/zeta/z.txt"; git -C "$CODE/zeta" -c user.email=o@o -c user.name=o add -A; git -C "$CODE/zeta" -c user.email=o@o -c user.name=o commit -q -m i  # 无 remote 且无本人 commit → 本地·可写
mk "$CODE/delta"; echo d > "$CODE/delta/d.txt"; git -C "$CODE/delta" -c user.email=o@o -c user.name=o add -A; git -C "$CODE/delta" -c user.email=o@o -c user.name=o commit -q -m i
git -C "$CODE/delta" remote add origin https://untrusted.example/d/delta.git   # 非可信 host，他人 commit → 第三方·只读

cat > "$HOME/.claude/repo-map.config.json" <<EOF
{"scan_roots": ["$CODE"], "self_emails": ["t@t"], "trusted_hosts": ["gitlab.t"]}
EOF

# T1 scan → 缓存与角色
out=$(python3 "$RM" scan 2>&1)
assert "scan 退出与输出" "$out" '!Traceback'
[ -f "$HOME/.claude/repo-map-cache.json" ] && ok "scan 产出缓存" || bad "scan 产出缓存"
# 角色逐仓库钉死映射（而非仅验证字符串存在——存在性断言挡不住角色对调）
for spec in "alpha:自研·可写" "beta:协作·可写" "gamma:自研·可写" "delta:第三方·只读" "zeta:本地·可写"; do
  repo="${spec%%:*}"; role="${spec#*:}"
  out=$(python3 "$RM" resolve "$repo" 2>&1)
  assert "角色映射 ${repo} → ${role}" "$out" "（${role}"
done

# T2 list
out=$(python3 "$RM" list 2>&1)
assert "list 列出全部" "$out" 'alpha' 'beta' 'gamma' 'delta' 'zeta'

# T3 resolve 命中
out=$(python3 "$RM" resolve alpha 2>&1)
assert "resolve alpha → 路径+角色" "$out" "$CODE/alpha" '自研·可写'

# T4 resolve 未命中不炸
out=$(python3 "$RM" resolve no-such-repo-xyz 2>&1); rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q Traceback; then bad "resolve 未命中不炸"; else ok "resolve 未命中不炸"; fi

# T5 prompt_hook：提到 alpha（cwd 在外）→ 注入
out=$(printf '{"prompt":"跟 alpha 对接一下","cwd":"'$WORK'"}' | python3 "$PH" 2>&1)
assert "hook 注入 alpha" "$out" 'alpha' "$CODE/alpha" '自研·可写' 'additionalContext'

# T6 hook：cwd 在 alpha 内 → 自身不注入
out=$(printf '{"prompt":"跟 alpha 对接","cwd":"'$CODE/alpha'"}' | python3 "$PH" 2>&1)
assert "hook cwd 自身不注入" "$out" '!additionalContext'

# T7 hook：边界——kube 不命中 kubernetes
git init -q -b master "$CODE/kubernetes" && echo k > "$CODE/kubernetes/k.txt"
g "$CODE/kubernetes" add -A; g "$CODE/kubernetes" commit -q -m i
python3 "$RM" scan >/dev/null 2>&1
out=$(printf '{"prompt":"看下 kube","cwd":"'$WORK'"}' | python3 "$PH" 2>&1)
assert "边界: kube 不命中 kubernetes" "$out" '!kubernetes'

# T8 hook：beta-v2 不被 beta 前缀误命中
mk "$CODE/beta-v2"; echo b2 > "$CODE/beta-v2/x.txt"; g "$CODE/beta-v2" add -A; g "$CODE/beta-v2" commit -q -m i
python3 "$RM" scan >/dev/null 2>&1
out=$(printf '{"prompt":"看下 beta-v2","cwd":"'$WORK'"}' | python3 "$PH" 2>&1)
assert "边界: beta-v2 命中自身" "$out" 'beta-v2'
assert "边界: beta-v2 场景不误注入 beta 条目" "$out" '!→ .*'"$CODE"'/beta（' 
out=$(printf '{"prompt":"看下 beta 的文档","cwd":"'$WORK'"}' | python3 "$PH" 2>&1)
assert "边界: beta 不命中 beta-v2" "$out" '!beta-v2'

# 停用词：别名列入 alias_stopwords 后不再自动注入，resolve 照常
cp "$HOME/.claude/repo-map.config.json" "$WORK/config.bak"
cat > "$HOME/.claude/repo-map.config.json" <<EOF
{"scan_roots": ["$CODE"], "self_emails": ["t@t"], "trusted_hosts": ["gitlab.t"], "alias_stopwords": ["Alpha"]}
EOF
out=$(printf '{"prompt":"跟 alpha 对接，顺便看 gamma","cwd":"'$WORK'"}' | python3 "$PH" 2>&1)
assert "停用词: alpha 不注入、gamma 照常" "$out" "gamma" "!$CODE/alpha"
out=$(python3 "$RM" resolve alpha 2>&1)
assert "停用词不影响 resolve" "$out" "$CODE/alpha"
mv "$WORK/config.bak" "$HOME/.claude/repo-map.config.json"

# T9 hook：无缓存/坏输入静默
mv "$HOME/.claude/repo-map-cache.json" "$WORK/cache.bak"
out=$(printf '{"prompt":"跟 alpha 对接","cwd":"'$WORK'"}' | python3 "$PH" 2>&1)
[ -z "$out" ] && ok "无缓存静默退出" || bad "无缓存静默退出" "$out"
mv "$WORK/cache.bak" "$HOME/.claude/repo-map-cache.json"
out=$(printf 'not json' | python3 "$PH" 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -z "$out" ]; then ok "坏输入静默不崩"; else bad "坏输入静默不崩" "rc=$rc $out"; fi

# T10 增量：resolve 触发自愈，发现新仓库
mk "$CODE/epsilon"; echo e > "$CODE/epsilon/e.txt"; g "$CODE/epsilon" add -A; g "$CODE/epsilon" commit -q -m i
out=$(python3 "$RM" resolve epsilon 2>&1)
assert "增量自愈发现新仓库" "$out" "$CODE/epsilon"

echo "── 通过 $pass / 失败 $fail"
[ "$fail" -eq 0 ]
