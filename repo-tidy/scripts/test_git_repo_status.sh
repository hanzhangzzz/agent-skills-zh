#!/bin/bash
# git-repo-status.sh 行为测试：scratch 仓库矩阵，逐场景断言 [repo-status] 输出。
# 用法：bash repo-tidy/scripts/test_git_repo_status.sh
# 断言协议：以 ! 开头 = 必须不命中；EMPTY = 输出必须为空串；其余 = egrep 必须命中。

set -u
HOOK="$(cd "$(dirname "$0")/.." && pwd)/scripts/git-repo-status.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
g() { local d="$1"; shift; git -C "$d" -c user.email=t@t -c user.name=t "$@"; }

run() { # run <名称> <cwd> <断言...>
  local label="$1" dir="$2"; shift 2
  local out rc a ok=1
  out=$(cd "$dir" && bash "$HOOK" 2>/dev/null); rc=$?
  for a in "$@"; do
    if [ "$a" = EMPTY ]; then
      if [ -n "$out" ]; then echo "✗ ${label} 期望空输出 实得: ${out:0:80}"; ok=0; fi
      continue
    fi
    if [ "${a#!}" != "$a" ]; then
      if printf '%s' "$out" | grep -qE "${a#!}"; then echo "✗ ${label} 不应命中 [${a#!}]"; ok=0; fi
      continue
    fi
    if ! printf '%s' "$out" | grep -qE "$a"; then
      echo "✗ ${label} 断言未命中 [$a] 实得: $(printf '%s' "$out" | head -1)"
      ok=0
    fi
  done
  if [ "$ok" = 1 ]; then echo "✓ ${label}"; pass=$((pass+1)); else fail=$((fail+1)); fi
}

assert_out() { # assert_out <名称> <输出> <断言...>：同 run，但输出由调用方自己产生（需注入环境变量时）
  local label="$1" out="$2"; shift 2
  local a ok=1
  for a in "$@"; do
    if [ "${a#!}" != "$a" ]; then
      printf '%s' "$out" | grep -qE "${a#!}" && { echo "✗ ${label} 不应命中 [${a#!}]"; ok=0; }
    elif ! printf '%s' "$out" | grep -qE "$a"; then
      echo "✗ ${label} 断言未命中 [$a] 实得: $(printf '%s' "$out" | head -1)"; ok=0
    fi
  done
  if [ "$ok" = 1 ]; then echo "✓ ${label}"; pass=$((pass+1)); else fail=$((fail+1)); fi
}

# T1 非 git 目录
mkdir -p "$WORK/plain"
run "非 git 目录无输出" "$WORK/plain" EMPTY

# T2 标准仓库：master 同步干净
mkrepo() { git init -q -b "$2" "$1" && g "$1" commit -q --allow-empty -m init; }
mkrepo "$WORK/std" master
g "$WORK/std" commit -q --allow-empty -m second
git init -q --bare "$WORK/std-origin.git"
git -C "$WORK/std" remote add origin "$WORK/std-origin.git"
g "$WORK/std" push -q origin master
run "master 同步干净：无归位建议" "$WORK/std" '\[repo-status\]' '分支: master' '工作区改动: 0' 'ahead 0 / behind 0' '!归位'

# T3 ahead 1
g "$WORK/std" commit -q --allow-empty -m wip
run "ahead 1：无归位建议" "$WORK/std" 'ahead 1 / behind 0' '!归位'
g "$WORK/std" push -q origin master

# T4 behind 1（wip 已上远端，本地回退一格 → 远端领先 1）：主检出在 master 且干净 → 自动快进
g "$WORK/std" reset -q --hard HEAD~1
g "$WORK/std" fetch -q origin
run "behind 1 干净主检出：自动快进、无归位建议" "$WORK/std" '已自动快进到 origin/master（\+1）' 'behind 0' '!归位'

# T4b 已跟踪文件有改动：不动工作区，只报告落后
g "$WORK/std" reset -q --hard HEAD~1
echo dirty > "$WORK/std/tracked.txt"; g "$WORK/std" add tracked.txt
run "behind 1 但已跟踪改动：不自动拉、有归位建议" "$WORK/std" 'behind 1' '归位' '!自动快进'
g "$WORK/std" reset -q --hard origin/master
g "$WORK/std" reset -q --hard HEAD~1

# T4c 只有未跟踪文件：照常快进
echo u > "$WORK/std/untracked.txt"
run "behind 1 仅未跟踪文件：照常快进" "$WORK/std" '已自动快进到 origin/master（\+1）'
rm -f "$WORK/std/untracked.txt"

# T4d 远端挂起：限时放弃，不拖垮 hook（10s timeout）
mkrepo "$WORK/slow" master
git -C "$WORK/slow" remote add origin "ssh://unreachable.invalid/x.git"
git -C "$WORK/slow" update-ref refs/remotes/origin/master HEAD
t0=$(date +%s)
out=$(cd "$WORK/slow" && GIT_SSH_COMMAND="sleep 30 #" bash "$HOOK" 2>/dev/null); elapsed=$(( $(date +%s) - t0 ))
if printf '%s' "$out" | grep -q '自动对齐失败（超时 3s' && [ "$elapsed" -lt 6 ]; then
  echo "✓ 远端挂起：${elapsed}s 内超时放弃并报告"; pass=$((pass+1))
else
  echo "✗ 远端挂起：耗时 ${elapsed}s 实得: ${out:0:120}"; fail=$((fail+1))
fi

# T4e 远端挂起但上次 fetch 已领先：退回本地快进
g "$WORK/slow" commit -q --allow-empty -m ahead
git -C "$WORK/slow" update-ref refs/remotes/origin/master HEAD
g "$WORK/slow" reset -q --hard HEAD~1
out=$(cd "$WORK/slow" && GIT_SSH_COMMAND="sleep 30 #" bash "$HOOK" 2>/dev/null)
assert_out "远端挂起：按上次 fetch 本地快进" "$out" '拉取失败（超时 3s），已按上次 fetch 快进（\+1）' 'behind 0'

# T4f 失败原因取第一条 fatal 行（origin 已删、残留 remote ref）
mkrepo "$WORK/gone" master
git -C "$WORK/gone" remote add origin "$WORK/no-such-origin.git"
git -C "$WORK/gone" update-ref refs/remotes/origin/master HEAD
out=$(cd "$WORK/gone" && bash "$HOOK" 2>/dev/null)
assert_out "失败原因可读" "$out" "自动对齐失败（'.*no-such-origin.git' does not appear" '!and the repository exists'

# T4g session 从主检出子目录启动：照常快进
g "$WORK/std" reset -q --hard HEAD~1
mkdir -p "$WORK/std/src/deep"
run "子目录启动：照常快进" "$WORK/std/src/deep" '已自动快进到 origin/master（\+1）'
rmdir -p "$WORK/std/src/deep" 2>/dev/null || true

# T5 工作区脏
g "$WORK/std" reset -q --hard origin/master
echo x > "$WORK/std/a.txt"; mkdir -p "$WORK/std/d"; echo y > "$WORK/std/d/b.txt"
run "工作区 2 处改动（含未跟踪）" "$WORK/std" '工作区改动: 2'

# T6 feature 分支
g "$WORK/std" checkout -q -b feature
run "feature 分支：有归位建议、不自动拉" "$WORK/std" '分支: feature' '归位' '!自动快进'

# T7 trunk 流派仓库（无 origin/master|main）
mkrepo "$WORK/trunk" trunk
run "trunk 仓库：不弹归位建议" "$WORK/trunk" '\[repo-status\]' '分支: trunk' '!归位' '!vs origin'

# T8 无远端仓库
mkrepo "$WORK/solo" master
run "无远端：无 vs 段" "$WORK/solo" '\[repo-status\]' '分支: master' '!vs origin' '!归位'

# T9 空仓库（无提交）
mkdir -p "$WORK/empty" && git init -q -b master "$WORK/empty"
run "空仓库：分支名可读、不崩" "$WORK/empty" '\[repo-status\]' '分支: master' '!ahead \?'

# T10 detached HEAD
g "$WORK/std" checkout -q --detach
run "detached HEAD：分支显示 HEAD 且有归位建议" "$WORK/std" '分支: HEAD' '归位'

# T11 linked worktree
g "$WORK/std" checkout -q feature
g "$WORK/std" worktree add -q -b wt2 "$WORK/wt"
run "linked worktree 正常显示" "$WORK/wt" '\[repo-status\]' '分支: wt2'

# T12 linked worktree 检出 master 且落后：不是主检出，不得自动拉
g "$WORK/std" worktree add -q "$WORK/wtm" master
g "$WORK/wtm" reset -q --hard HEAD~1
run "linked worktree 在 master 落后：不自动拉" "$WORK/wtm" '分支: master' 'behind 1' '!自动快进'

# T13 [tasks] 菜单与 repo_tidy.py 共用「已合并」判定：squash 合并的 worktree 标可回收，未合并的不标
mkrepo "$WORK/sq" master
echo a > "$WORK/sq/a.txt"; g "$WORK/sq" add a.txt; g "$WORK/sq" commit -q -m base
git init -q --bare "$WORK/sq-origin.git"
git -C "$WORK/sq" remote add origin "$WORK/sq-origin.git"
g "$WORK/sq" push -q origin master
g "$WORK/sq" worktree add -q -b task/squashed "$WORK/sq--squashed" origin/master
echo s >> "$WORK/sq--squashed/a.txt"; g "$WORK/sq--squashed" commit -q -am s1
echo t > "$WORK/sq--squashed/t.txt"; g "$WORK/sq--squashed" add t.txt; g "$WORK/sq--squashed" commit -q -m s2
g "$WORK/sq" worktree add -q -b task/open "$WORK/sq--open" origin/master
echo o > "$WORK/sq--open/o.txt"; g "$WORK/sq--open" add o.txt; g "$WORK/sq--open" commit -q -m open
g "$WORK/sq" merge -q --squash task/squashed >/dev/null 2>&1; g "$WORK/sq" commit -q -m "squash task/squashed"
echo later >> "$WORK/sq/a.txt"; g "$WORK/sq" commit -q -am later   # squash 后默认分支又改了相邻行
g "$WORK/sq" push -q origin master
run "[tasks] squash 合并的 worktree 标可回收" "$WORK/sq" \
  'sq--squashed  \[task/squashed\]  改动已全部进入 origin/master（squash/rebase 合并），可回收' \
  'sq--open  \[task/open\]  未推送（ahead 1）' '!task/open.*可回收'

# T14 热点文件：默认分支每个提交都改同一文件、任务分支也改它 → 候选成百上千。
# squash 提交按内容（增删行）认出，rebase 合并靠 git cherry，热点文件上的日常提交不会逐个试；
# 预算只给 git 调用设超时，超时标「未判定」，不能落成「未推送 / MR 待合」。断言不依赖机器快慢：预算直接压到近 0。
mkrepo "$WORK/hot" master
echo 0 > "$WORK/hot/hot.txt"; g "$WORK/hot" add hot.txt; g "$WORK/hot" commit -q -m base
git init -q --bare "$WORK/hot-origin.git"; git -C "$WORK/hot" remote add origin "$WORK/hot-origin.git"
for b in sq open part; do g "$WORK/hot" worktree add -q -b "task/$b" "$WORK/hot--$b" master
  echo "work-$b" >> "$WORK/hot--$b/hot.txt"; g "$WORK/hot--$b" commit -q -am "$b"; done
echo "more-part" >> "$WORK/hot--part/hot.txt"; g "$WORK/hot--part" commit -q -am "part 2"
echo "work-sq" >> "$WORK/hot/hot.txt"; g "$WORK/hot" commit -q -am "squash task/sq"   # task/sq 的 squash 提交，最老的候选
for i in $(seq 1 150); do echo "$i" >> "$WORK/hot/hot.txt"; g "$WORK/hot" commit -q -am "c$i"; done
echo "work-part" >> "$WORK/hot/hot.txt"; g "$WORK/hot" commit -q -am "task/part 的一半"     # 只合进一半：不能判已合并
for i in $(seq 151 300); do echo "$i" >> "$WORK/hot/hot.txt"; g "$WORK/hot" commit -q -am "c$i"; done
g "$WORK/hot" push -q origin master
run "[tasks] 热点文件：squash 按内容认出，未合并 / 部分合并的分支判未推送（默认预算）" "$WORK/hot" \
  'hot--sq  \[task/sq\]  改动已全部进入 origin/master（squash/rebase 合并），可回收' \
  'hot--open  \[task/open\]  未推送（ahead 1）' 'hot--part  \[task/part\]  未推送（ahead 2）'
REPO_TIDY_MERGE_BUDGET=0.001 run "[tasks] 单分支预算耗尽：标未判定，不落成未推送 / MR 待合 / 可回收" "$WORK/hot" \
  'hot--sq  \[task/sq\]  合并状态未判定' 'hot--open  \[task/open\]  合并状态未判定' \
  'hot--part  \[task/part\]  合并状态未判定' '!可回收|未推送|MR 待合'
REPO_TIDY_MENU_BUDGET=0 run "[tasks] 菜单总预算耗尽：全部标未判定，菜单照常输出" "$WORK/hot" \
  'hot--sq  \[task/sq\]  合并状态未判定' 'hot--open  \[task/open\]  合并状态未判定' \
  'hot--part  \[task/part\]  合并状态未判定' '!可回收|未推送|MR 待合'

REAL_PY=$(command -v python3); mkdir -p "$WORK/crashbin"
printf '#!/bin/bash\ncase "$*" in *--is-merged*) echo "Traceback: boom" >&2; exit 1;; esac\nexec %q "$@"\n' "$REAL_PY" > "$WORK/crashbin/python3"
chmod +x "$WORK/crashbin/python3"
PATH="$WORK/crashbin:$PATH" run "[tasks] 判定进程崩溃（退出 1 但没说未合并）：标未判定，不下否定结论" "$WORK/hot" \
  'hot--open  \[task/open\]  合并状态未判定' '!未推送|MR 待合|可回收'

echo "── 通过 $pass / 失败 $fail"
[ "$fail" -eq 0 ]
