#!/bin/bash
# repo-tidy 对抗测试：本地 bare remote 构造全部边界场景
set -uo pipefail
T="${1:?用法: test_repo_tidy.sh <scratch-dir>}"
TIDY="python3 $(cd "$(dirname "$0")/../scripts" && pwd)/repo_tidy.py"
PASS=0; FAIL=0
ok(){ if eval "$2"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1"; fi; }

rm -rf "$T"; mkdir -p "$T"
T_REAL="$(cd "$T" && pwd -P)"  # macOS 的 /var 是 /private/var 软链，输出使用真实路径
git -c init.defaultBranch=master init --bare -q "$T/remote.git"
git -c init.defaultBranch=master clone -q "$T/remote.git" "$T/proj" 2>/dev/null
cd "$T/proj"
git config user.email t@t.t; git config user.name t
echo a > a.txt; git add a.txt; git commit -qm init; git push -q origin master

# 已合并分支（merge 进 master 并推送）
git switch -qc feat/done; echo b > b.txt; git add b.txt; git commit -qm b
git push -qu origin feat/done 2>/dev/null
git switch -q master; git merge -q --no-ff -m merge feat/done; git push -q origin master
# 进行中分支（已推送、未合并）
git switch -qc feat/wip; echo c > c.txt; git add c.txt; git commit -qm c
git push -qu origin feat/wip 2>/dev/null
# gone 分支（未合并、远端已删；本地独有内容必须保留）
git switch -qc feat/gone; echo d > d.txt; git add d.txt; git commit -qm d
git push -qu origin feat/gone 2>/dev/null; git push -q origin :feat/gone
# 第二个克隆推进远端 master（制造 behind）
git -c init.defaultBranch=master clone -q "$T/remote.git" "$T/clone2" 2>/dev/null
cd "$T/clone2"; git config user.email t@t.t; git config user.name t
echo e > e.txt; git add e.txt; git commit -qm e; git push -q origin master
# 主检出停在已合并分支上（工作区干净）
cd "$T/proj"; git switch -q feat/done
GONE_TIP=$(git rev-parse feat/gone)
git worktree add -q "$T/gone-wt" feat/gone

echo "== T1 dry-run 计划正确性 =="
OUT=$($TIDY "$T/proj"); echo "$OUT"
ok "计划切回 master"        'grep -q "将切回 master" <<<"$OUT"'
ok "删已合并 feat/done"      'grep -q "将删分支 feat/done" <<<"$OUT"'
ok "保留未合并 feat/gone"    'grep -q "保留 feat/gone" <<<"$OUT"'
ok "保留进行中 feat/wip"     'grep -q "保留 feat/wip" <<<"$OUT"'
ok "计划 ff 前进"            'grep -q "ff 前进" <<<"$OUT"'

echo "== T2 apply 实际效果 =="
OUT=$($TIDY "$T/proj" --apply); echo "$OUT"
ok "HEAD 回到 master"        '[ "$(git -C "$T/proj" rev-parse --abbrev-ref HEAD)" = master ]'
ok "master 追平远端"         '[ "$(git -C "$T/proj" rev-parse master)" = "$(git -C "$T/proj" rev-parse origin/master)" ]'
ok "feat/done 已删"          '! git -C "$T/proj" show-ref -q refs/heads/feat/done'
ok "feat/gone 提交仍在"      '[ "$(git -C "$T/proj" rev-parse feat/gone)" = "$GONE_TIP" ]'
ok "gone worktree 内容保留" '[ -f "$T/gone-wt/d.txt" ] && [ "$(git -C "$T/gone-wt" rev-parse HEAD)" = "$GONE_TIP" ]'
ok "feat/wip 仍在"           'git -C "$T/proj" show-ref -q refs/heads/feat/wip'

echo "== T3 --new 主检出空闲 → 原地开分支 =="
OUT=$($TIDY "$T/proj" --new t1); echo "$OUT"
ok "原地创建 task/t1"        '[ "$(git -C "$T/proj" rev-parse --abbrev-ref HEAD)" = task/t1 ]'

ok "--new 保留 gone 分支及 worktree" '[ "$(git -C "$T/proj" rev-parse feat/gone)" = "$GONE_TIP" ] && [ -f "$T/gone-wt/d.txt" ]'

echo "== T4 --new 主检出被占用 → 自动建 worktree =="
echo dirty >> "$T/proj/a.txt"   # 停在 task/t1 且工作区脏
OUT=$($TIDY "$T/proj" --new t2); echo "$OUT"
ok "sibling worktree 目录存在" '[ -d "$T/proj--t2" ]'
ok "worktree 在 task/t2"      '[ "$(git -C "$T/proj--t2" rev-parse --abbrev-ref HEAD)" = task/t2 ]'
ok "基于最新远端 master"      '[ "$(git -C "$T/proj--t2" rev-parse HEAD)" = "$(git -C "$T/proj" rev-parse origin/master)" ]'
ok "输出含 cd 路径"           'grep -Fq "cd $T_REAL/proj--t2" <<<"$OUT"'

echo "== T5 任务合并后 tidy 自动回收 worktree =="
cd "$T/proj--t2"; git config user.email t@t.t; git config user.name t
echo f > f.txt; git add f.txt; git commit -qm f; git push -qu origin task/t2 2>/dev/null
cd "$T/clone2"; git fetch -q; git merge -q origin/task/t2; git push -q origin master; git push -q origin :task/t2
git -C "$T/proj" checkout -q -- a.txt   # 清掉 t1 的脏文件，t1 仍是进行中分支
OUT=$($TIDY "$T/proj" --apply); echo "$OUT"
ok "worktree 已回收"          '[ ! -d "$T/proj--t2" ]'
ok "task/t2 分支已删"         '! git -C "$T/proj" show-ref -q refs/heads/task/t2'
ok "空且落后的 task/t1 一并回收（无内容可丢）" '! git -C "$T/proj" show-ref -q refs/heads/task/t1'
ok "HEAD 归位 master 并追平"  '[ "$(git -C "$T/proj" rev-parse --abbrev-ref HEAD)" = master ] && [ "$(git -C "$T/proj" rev-parse master)" = "$(git -C "$T/proj" rev-parse origin/master)" ]'

echo "== T7 同点空分支保护：并行 session 的新分支不被误删 =="
OUT=$($TIDY "$T/proj" --new t3); echo "$OUT"   # 原地切出 task/t3（与 origin/master 同点）
OUT=$($TIDY "$T/proj" --apply); echo "$OUT"    # 立即再 tidy，模拟另一 session 的归位
ok "task/t3 受同点保护未删"   'git -C "$T/proj" show-ref -q refs/heads/task/t3'
ok "检出未被拽走"             '[ "$(git -C "$T/proj" rev-parse --abbrev-ref HEAD)" = task/t3 ]'
ok "报告说明同点保留"         'grep -q "同点" <<<"$OUT"'
OUT=$($TIDY "$T/proj" --new t4); echo "$OUT"   # 主检出被 t3 占用 → t4 应走 worktree
ok "t4 自动建 worktree"       '[ -d "$T/proj--t4" ] && [ "$(git -C "$T/proj--t4" rev-parse --abbrev-ref HEAD)" = task/t4 ]'

echo "== T6 master 分叉保护：全仓跳过且报告不撒谎 =="
git -c init.defaultBranch=master init --bare -q "$T/r2.git"
git -c init.defaultBranch=master clone -q "$T/r2.git" "$T/p2" 2>/dev/null
cd "$T/p2"; git config user.email t@t.t; git config user.name t
echo a > a; git add a; git commit -qm a; git push -q origin master
git -c init.defaultBranch=master clone -q "$T/r2.git" "$T/p2b" 2>/dev/null
cd "$T/p2b"; git config user.email t@t.t; git config user.name t
echo r > r; git add r; git commit -qm remote; git push -q origin master
cd "$T/p2"; echo l > l; git add l; git commit -qm local  # 本地 master 分叉
git branch feat/x HEAD~1                                  # 一个真实可删的分支
OUT=$($TIDY "$T/p2" --apply); echo "$OUT"
ok "报告分叉并跳过"           'grep -q "分叉" <<<"$OUT" && grep -q "跳过" <<<"$OUT"'
ok "verb 是「将删」不是「已删」" 'grep -q "将删分支 feat/x" <<<"$OUT"'
ok "feat/x 实际未删"          'git -C "$T/p2" show-ref -q refs/heads/feat/x'
ok "本地 master 未被动过"     '[ "$(git -C "$T/p2" log --format=%s -1 master)" = local ]'

echo "== T8 origin/HEAD 优先：main/master 同时存在不选错基线 =="
git -c init.defaultBranch=main init --bare -q "$T/r3.git"
git clone -q "$T/r3.git" "$T/p3" 2>/dev/null
git -C "$T/p3" config user.email t@t.t
git -C "$T/p3" config user.name t
echo initial > "$T/p3/base.txt"
git -C "$T/p3" add base.txt
git -C "$T/p3" commit -qm initial
git -C "$T/p3" push -qu origin main
git -C "$T/p3" branch master
git -C "$T/p3" push -q origin master
echo current >> "$T/p3/base.txt"
git -C "$T/p3" commit -qam current-main
git -C "$T/p3" push -q origin main
git -C "$T/p3" remote set-head origin -a >/dev/null
OUT=$($TIDY "$T/p3" --new default-main); echo "$OUT"
ok "main/master 并存时从 main 创建" '[ "$(git -C "$T/p3" rev-parse HEAD)" = "$(git -C "$T/p3" rev-parse origin/main)" ]'
ok "没有误用旧 master" '[ "$(git -C "$T/p3" rev-parse HEAD)" != "$(git -C "$T/p3" rev-parse origin/master)" ]'
ok "任务检出留在主目录" '[ "$(git -C "$T/p3" branch --show-current)" = task/default-main ]'

echo "== T9 非标准默认分支 trunk 同样可用 =="
git --git-dir="$T/r3.git" symbolic-ref HEAD refs/heads/trunk
git -C "$T/p3" push -q origin main:trunk
git clone -q "$T/r3.git" "$T/p4"
OUT=$($TIDY "$T/p4" --new default-trunk); echo "$OUT"
ok "从 trunk 创建任务" '[ "$(git -C "$T/p4" branch --show-current)" = task/default-trunk ]'
ok "trunk 基线正确" '[ "$(git -C "$T/p4" rev-parse HEAD)" = "$(git -C "$T/p4" rev-parse origin/trunk)" ]'

echo; echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
