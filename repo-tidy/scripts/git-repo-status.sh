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

if [ -n "$master" ]; then
  counts=$(git rev-list --left-right --count "origin/$master...HEAD" 2>/dev/null)
  behind=$(echo "$counts" | awk '{print $1}')
  ahead=$(echo "$counts" | awk '{print $2}')
  line="$line | vs origin/$master: ahead ${ahead:-?} / behind ${behind:-?}（基于上次 fetch）"
fi

if [ -n "$master" ] && { [ "$branch" != "$master" ] || [ "${behind:-0}" -gt 0 ] 2>/dev/null; }; then
  line="$line | 若本 session 是开新任务→先归位(repo-tidy)；续任务→就地继续"
fi

echo "$line"

# ── 任务菜单：worktree 就是任务登记表 ────────────────────────────────────
# 让 session 开局就看见有哪些任务在进行，新任务/续任务的判断有据可依。
if [ -n "$master" ]; then
  menu=""
  while IFS= read -r wt_line; do
    case "$wt_line" in
      worktree\ *) wt_path="${wt_line#worktree }" ;;
      branch\ *)
        wt_branch="${wt_line#branch refs/heads/}"
        [ "$wt_path" = "$top" ] && continue          # 主检出本身不算任务
        state=""
        if git merge-base --is-ancestor "$wt_branch" "origin/$master" 2>/dev/null; then
          state="已合并进 master，可回收"
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
