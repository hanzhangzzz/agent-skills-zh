#!/bin/bash
# SessionStart hook: 若当前目录在 git 仓库内，注入一行仓库状态，
# 让每个 session 开局就知道自己站在哪个分支、离 master 多远、工作区脏不脏。
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null)
master=""
for m in master main; do
  git show-ref -q "refs/remotes/origin/$m" && { master=$m; break; }
done

# --no-optional-locks：session 开局的状态查询绝不写 index.lock，不与运行中的 git 操作抢锁
dirty=$(git --no-optional-locks status --porcelain 2>/dev/null | wc -l | tr -d ' ')
line="[repo-status] $(basename "$top") | 分支: $branch | 工作区改动: $dirty"

# ── 主检出自动对齐：「主检出恒定停在最新 master」由机制保证，不靠模型自觉 ──
# 条件：主检出（非 linked worktree）+ 在 master/main + 已跟踪文件无改动。
# 未跟踪文件不拦：快进若会覆盖未跟踪文件，--ff-only 自己会拒绝。
# 开销：远端可达时通常 1-2s；远端挂起（如 VPN 断开）时每个 session 开局固定多等 PULL_TIMEOUT 秒。
# hook timeout 10s：超时杀整个进程组（含 fetch/ssh 子进程，否则孤儿进程握着输出管道，
# hook 照样卡死），再退回按上次 fetch 的 origin/<默认分支> 本地快进；失败只报告，不阻断开局。
PULL_TIMEOUT=3
sync_note=""
abs_dir() { (cd "$1" 2>/dev/null && pwd -P); }  # 子目录里 --git-dir 是绝对路径、--git-common-dir 是相对路径
if [ -n "$master" ] && [ "$branch" = "$master" ] \
   && [ "$(abs_dir "$(git rev-parse --git-dir 2>/dev/null)")" = "$(abs_dir "$(git rev-parse --git-common-dir 2>/dev/null)")" ] \
   && [ -z "$(git --no-optional-locks status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  before=$(git rev-parse HEAD 2>/dev/null)
  if err=$(GIT_TERMINAL_PROMPT=0 perl -e '
        $t = shift; $p = fork;
        if (!$p) { setpgrp(0, 0); exec @ARGV; exit 127 }
        $SIG{ALRM} = sub { kill "KILL", -$p; exit 142 };
        alarm $t; waitpid($p, 0); exit($? >> 8)' \
        "$PULL_TIMEOUT" git pull -q --ff-only origin "$master" </dev/null 2>&1); then
    n=$(git rev-list --count "$before..HEAD" 2>/dev/null || echo 0)
    [ "${n:-0}" -gt 0 ] 2>/dev/null && sync_note=" | 已自动快进到 origin/${master}（+${n}）"
  else
    rc=$?
    if [ "$rc" -eq 142 ]; then
      reason="超时 ${PULL_TIMEOUT}s"
    else  # git 把关键信息放在第一条 fatal/error 行，后面是建议性残句
      reason=$(printf '%s\n' "$err" | grep -m1 -E '^(fatal|error):' | sed -E 's/^(fatal|error): //' | cut -c1-160)
      [ -n "$reason" ] || reason=$(printf '%s\n' "$err" | head -1 | cut -c1-160)
    fi
    git merge -q --ff-only "origin/$master" </dev/null >/dev/null 2>&1
    n=$(git rev-list --count "$before..HEAD" 2>/dev/null || echo 0)
    if [ "${n:-0}" -gt 0 ] 2>/dev/null; then
      sync_note=" | 拉取失败（${reason:-exit $rc}），已按上次 fetch 快进（+${n}）"
    else
      sync_note=" | 自动对齐失败（${reason:-exit $rc}），工作区未动"
    fi
  fi
fi

if [ -n "$master" ]; then
  counts=$(git rev-list --left-right --count "origin/$master...HEAD" 2>/dev/null)
  behind=$(echo "$counts" | awk '{print $1}')
  ahead=$(echo "$counts" | awk '{print $2}')
  line="$line | vs origin/$master: ahead ${ahead:-?} / behind ${behind:-?}（基于上次 fetch）$sync_note"
fi

if [ -n "$master" ] && { [ "$branch" != "$master" ] || [ "${behind:-0}" -gt 0 ] 2>/dev/null; }; then
  line="$line | 若本 session 是开新任务→先归位(repo-tidy)；续任务→就地继续"
fi

echo "$line"

# ── 任务菜单：worktree 就是任务登记表 ────────────────────────────────────
# 让 session 开局就看见有哪些任务在进行，新任务/续任务的判断有据可依。
if [ -n "$master" ]; then
  # 「已合并」与 repo_tidy.py --apply 共用同一判定（含 squash 合并），菜单说可回收就真能回收
  tidy="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repo_tidy.py"
  menu=""
  # 合并判定的总预算（秒）：hook 上限 10s，菜单必须在超时前输出；预算用完的分支标「未判定」
  menu_budget="${REPO_TIDY_MENU_BUDGET:-6}"; menu_start=$SECONDS
  while IFS= read -r wt_line; do
    case "$wt_line" in
      worktree\ *) wt_path="${wt_line#worktree }" ;;
      branch\ *)
        wt_branch="${wt_line#branch refs/heads/}"
        [ "$wt_path" = "$top" ] && continue          # 主检出本身不算任务
        state=""
        left=$(( menu_budget - (SECONDS - menu_start) ))
        mrc=2
        if [ "$left" -gt 0 ]; then
          merged=$(REPO_TIDY_MERGE_BUDGET="${REPO_TIDY_MERGE_BUDGET:-$(( left < 3 ? left : 3 ))}" \
            python3 "$tidy" "$top" --is-merged "$wt_branch" 2>/dev/null); mrc=$?
        fi
        if [ "$mrc" = 0 ]; then
          state="${merged}，可回收"
        elif [ "$mrc" = 2 ]; then
          state="合并状态未判定（时间预算内没判完，跑 repo_tidy.py 查看）"
        else
          ahead=$(git rev-list --count "origin/$master..$wt_branch" 2>/dev/null || echo 0)
          if git show-ref -q "refs/remotes/origin/$wt_branch"; then
            state="已推送，MR 待合（ahead ${ahead}）"
          else
            state="未推送（ahead ${ahead}）"
          fi
        fi
        dirty=$(git -C "$wt_path" --no-optional-locks status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')
        [ "$dirty" != "0" ] && state="${state}，工作区有 ${dirty} 处未提交"
        menu="$menu
  ${wt_path}  [${wt_branch}]  ${state}"
        ;;
      detached) wt_branch="(detached)" ;;
    esac
  done < <(git worktree list --porcelain 2>/dev/null)
  if [ -n "$menu" ]; then
    echo "[tasks] 进行中的 worktree：$menu"
  else
    echo "[tasks] 没有进行中的 worktree"
  fi
  echo "[tasks] 续某任务 → EnterWorktree(path=上面的路径)；新任务 → EnterWorktree(name=<task>)；两 session 共用同一 worktree 也用 path。进门前向用户一句话确认。"
fi
exit 0
