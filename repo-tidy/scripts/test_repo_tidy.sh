#!/bin/bash
# repo_tidy.py 行为测试：scratch HOME + scratch 仓库，覆盖 --new/归位/清理安全线/--all。
# 用法：bash repo-tidy/scripts/test_repo_tidy.sh

set -u
RT="$(cd "$(dirname "$0")" && pwd)/repo_tidy.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export HOME="$WORK/home"          # CODE_ROOT = $HOME/Desktop/Works/code
CODE="$HOME/Desktop/Works/code"
mkdir -p "$CODE"

pass=0; fail=0
ok() { echo "✓ $1"; pass=$((pass+1)); }
bad() { echo "✗ $1 ${2:+—— ${2:0:140}}"; fail=$((fail+1)); }
g() { local d="$1"; shift; git -C "$d" -c user.email=t@t -c user.name=t "$@"; }

mkorigin() { git init -q --bare "$1"; }
mkrepo() { # mkrepo <路径> <初始分支>
  git init -q -b "$2" "$1" && g "$1" commit -q --allow-empty -m init
}

# ── 场景 1：--new 在干净同步仓库 → 归位 + 开 task 分支 ──
R1="$CODE/std"; mkrepo "$R1" master; mkorigin "$R1-origin.git"
g "$R1" remote add origin "$R1-origin.git"
g "$R1" push -q origin master
out=$(python3 "$RT" "$R1" --new auth 2>&1); rc=$?
cur=$(git -C "$R1" branch --show-current)
if [ $rc -eq 0 ] && [ "$cur" = "task/auth" ]; then ok "--new 归位并开 task/auth"; else bad "--new 归位并开 task/auth" "rc=$rc cur=$cur out=${out:0:100}"; fi

# ── 场景 2：主检出被占用（干净地停在别的任务分支）→ sibling worktree ──
WT="$R1-auth-wt"; rm -rf "$WT"
out=$(python3 "$RT" "$R1" --new api 2>&1); rc=$?
# worktree 命名 = {仓库名}--{task}（双横线），位于仓库同级
if [ $rc -eq 0 ] && git -C "$R1" worktree list | grep -q "task/api" && [ -d "$CODE/std--api" ]; then
  ok "--new 主检出占用时建 sibling worktree"
else bad "--new 主检出占用时建 sibling worktree" "rc=$rc FULL_OUT=$out"; fi

# ── 场景 3：已合并已推送分支 → dry-run 列出，--apply 删除 ──
R3="$CODE/cleanup"; mkrepo "$R3" master; mkorigin "$R3-origin.git"
g "$R3" remote add origin "$R3-origin.git"
g "$R3" push -q origin master
g "$R3" checkout -q -b done-feat; g "$R3" commit -q --allow-empty -m f; g "$R3" push -q origin done-feat
g "$R3" checkout -q master
g "$R3" merge -q --no-ff done-feat; g "$R3" push -q origin master
out=$(python3 "$RT" "$R3" 2>&1)
if printf '%s' "$out" | grep -q "done-feat"; then ok "dry-run 列出已合并分支"; else bad "dry-run 列出已合并分支" "$out"; fi
python3 "$RT" "$R3" --apply >/dev/null 2>&1
if git -C "$R3" branch --list done-feat | grep -q done-feat; then bad "--apply 未删除已合并分支"; else ok "--apply 删除已合并分支"; fi

# ── 场景 4：未推提交分支 → --apply 也必须保留（安全线）──
R4="$CODE/unsafe"; mkrepo "$R4" master; mkorigin "$R4-origin.git"
g "$R4" remote add origin "$R4-origin.git"
g "$R4" push -q origin master
g "$R4" checkout -q -b precious; g "$R4" commit -q --allow-empty -m 宝贵提交
out=$(python3 "$RT" "$R4" --apply 2>&1)
if git -C "$R4" branch --list precious | grep -q precious; then ok "未推提交分支 --apply 仍保留"; else bad "未推提交分支 --apply 仍保留"; fi

# ── 场景 5：脏工作区 → 只报告不动手 ──
echo change > "$R4/clean-me.txt"
before=$(git -C "$R4" status --porcelain | wc -l | tr -d ' ')
out=$(python3 "$RT" "$R4" --apply 2>&1)
after=$(git -C "$R4" status --porcelain | wc -l | tr -d ' ')
if [ "$before" = "$after" ]; then ok "脏工作区 --apply 不动手"; else bad "脏工作区 --apply 不动手" "before=$before after=$after"; fi

# ── 场景 6：--all 扫描 CODE_ROOT ──
out=$(python3 "$RT" --all 2>&1); rc=$?
if [ $rc -eq 0 ] && printf '%s' "$out" | grep -qE "std|cleanup|unsafe"; then ok "--all 扫描列出仓库"; else bad "--all 扫描列出仓库" "rc=$rc out=${out:0:120}"; fi

# ── 场景 7：detached HEAD 不崩 ──
g "$R1" checkout -q --detach 2>/dev/null
out=$(python3 "$RT" "$R1" 2>&1); rc=$?
if [ $rc -eq 0 ] || printf '%s' "$out" | grep -qi "detached\|HEAD"; then ok "detached HEAD 优雅处理"; else bad "detached HEAD 优雅处理" "rc=$rc"; fi

# ── 场景 8：无远端仓库 → master_ref 回退本地 master ──
R8="$CODE/solo"; mkrepo "$R8" main
out=$(python3 "$RT" "$R8" 2>&1); rc=$?
if [ $rc -eq 0 ]; then ok "无远端仓库正常处理"; else bad "无远端仓库正常处理" "rc=$rc out=${out:0:100}"; fi

echo "── 通过 $pass / 失败 $fail"
[ "$fail" -eq 0 ]
