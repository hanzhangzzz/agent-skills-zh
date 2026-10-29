#!/usr/bin/env python3
"""repo-tidy: 把本地仓库归位到最新 master，清理已合并/消亡的分支与 worktree。

默认 dry-run 只出清单；加 --apply 才真正执行。
安全底线：有未推提交或脏工作区的分支/worktree 只报告、不动手。

用法:
  repo_tidy.py [PATH]          # 单仓库 dry-run（默认当前目录）
  repo_tidy.py PATH --apply    # 单仓库执行
  repo_tidy.py --all           # 扫描 CODE_ROOT 下全部仓库 dry-run
  repo_tidy.py --all --apply
"""
import argparse
import os
import subprocess
import time
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CODE_ROOT = Path.home() / "Desktop/Works/code"
FETCH_TIMEOUT = 30
SQUASH_SCAN = 2000  # 找 squash 提交时最多回看默认分支多少个提交，防止古老分支拖慢菜单
MERGE_BUDGET = 3.0  # 单个分支找 squash 提交的墙钟预算（秒）；超时判「未证实」，绝不误判已合并
TREE_TIMEOUT = 120  # switch / ff / worktree 这类要动工作区的操作，大仓库给足时间
GIT_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}  # 永不挂在交互认证上
# 用户可能把 skill 软链到某个 worktree 里；回收前要查，否则软链悬空、skill「丢失」
SKILL_DIRS = [Path.home() / d for d in (".claude/skills", ".codex/skills", ".agents/skills")]


def git(repo, *args, timeout=15):
    """在 repo 下执行 git，返回 (returncode, stdout, stderr)。"""
    try:
        r = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True, timeout=timeout,
            encoding="utf-8", errors="replace", env=GIT_ENV,
        )
        return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"


def skill_links_into(path):
    """返回 SKILL_DIRS 一级条目及其下一层中，realpath 落在 path 之下的软链。"""
    target = os.path.realpath(path)
    hits = []
    for d in SKILL_DIRS:
        if not d.is_dir():
            continue
        for e in d.iterdir():
            cands = [e]
            if e.is_dir() and not e.is_symlink():
                try:
                    cands += list(e.iterdir())
                except OSError:
                    pass
            for c in cands:
                if c.is_symlink():
                    r = os.path.realpath(c)
                    if r == target or r.startswith(target + os.sep):
                        hits.append(str(c))
    return hits


def fatal_line(err, fallback):
    """从 git stderr 里挑出最有信息量的一行。"""
    lines = [l.strip() for l in err.splitlines() if l.strip()]
    for l in lines:
        if "fatal:" in l or "error:" in l:
            return l
    return lines[-1] if lines else fallback


def find_repos(root: Path, max_depth=3):
    """找出 root 下所有主仓库（.git 是目录；worktree 的 .git 是文件，跳过）。"""
    repos = []

    def walk(d: Path, depth: int):
        gitdir = d / ".git"
        if gitdir.is_dir():
            repos.append(d)
            return  # 不进入仓库内部找嵌套仓库
        if depth >= max_depth:
            return
        try:
            children = sorted(p for p in d.iterdir() if p.is_dir() and not p.name.startswith("."))
        except PermissionError:
            return
        for c in children:
            walk(c, depth + 1)

    walk(root, 0)
    return repos


def master_ref(repo):
    """优先采用 origin/HEAD；旧仓库缺少该引用时兼容 master/main。"""
    rc, remote_head, _ = git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    if rc == 0 and remote_head.startswith("origin/"):
        name = remote_head.removeprefix("origin/")
        rc, _, _ = git(repo, "show-ref", "-q", f"refs/remotes/origin/{name}")
        if rc == 0:
            return name, True
    for name in ("master", "main"):
        rc, _, _ = git(repo, "show-ref", "-q", f"refs/remotes/origin/{name}")
        if rc == 0:
            return name, True
    for name in ("master", "main"):
        rc, _, _ = git(repo, "show-ref", "-q", f"refs/heads/{name}")
        if rc == 0:
            return name, False
    return None, False


def merged_into(repo, branch, base, budget=MERGE_BUDGET):
    """「已合并」的唯一判定：tidy / --apply / --all、--new 的僵尸检查、[tasks] 菜单都走这里。

    返回理由（已证实合并）或 None（未证实）。只用本地对象，不调网络。
    1. 祖先关系：普通 merge / fast-forward 合并。
    2. 内容已进入默认分支：squash / rebase 合并后任务分支的提交不是默认分支的祖先，
       改用 `git merge-tree --write-tree` 在内存里做三方合并，满足任一条即证实：
       a. 把分支合进默认分支当前 tip，结果树不变——分支的改动现在都在默认分支里；
       b. 默认分支上某个提交 S 恰好等于「把分支合进 S 的父提交」——S 就是这个分支
          的 squash 提交（GitHub/GitLab 的 squash 正是这样生成的），或 rebase 合并的最后一个提交。
          b 是为了覆盖 squash 之后默认分支又改了相邻行、a 因冲突证不出来的常见情况。
       不用 git cherry / patch-id：squash 把多个提交压成一个，逐提交对不上；整体 diff 的
       patch-id 又会被默认分支在相邻行的改动打乱。merge-tree 冲突或结果不同一律判「未证实」。
    分支相对分叉点没有净改动（例如只有空提交）时内容证据为空，不据此判合并。
    代价：每个候选一次 merge-tree。逐文件增删行数与分支净改动相同的候选（squash 提交的样子）先试，
    整体受 budget 秒墙钟预算约束；超时返回 None（未证实），宁可漏判不误删。
    upstream 已删除（gone）不作依据：PR 关闭不合并时远端分支同样会被删。
    """
    if git(repo, "merge-base", "--is-ancestor", branch, base)[0] == 0:
        return f"已合并进 {base}"
    rc, fork, _ = git(repo, "merge-base", base, branch)
    if rc != 0 or not fork:
        return None
    deadline = time.monotonic() + budget
    rc, out, _ = git(repo, "diff", "--numstat", "--no-renames", "-z", fork, branch)
    numstat = parse_numstat(out)
    changed = set(numstat)
    if rc != 0 or not changed:
        return None
    reason = f"改动已全部进入 {base}（squash/rebase 合并）"

    def merges_to(ours, tree):
        rc, out, _ = git(repo, "merge-tree", "--write-tree", "--no-messages", ours, branch, timeout=60)
        return rc == 0 and bool(out) and out.splitlines()[0] == tree

    if merges_to(base, git(repo, "rev-parse", f"{base}^{{tree}}")[1]):
        return reason
    # 候选 S：分叉点之后默认分支上改过分支全部文件的非 merge 提交，新的在前
    rc, out, _ = git(repo, "log", "--no-merges", "--no-renames", f"--max-count={SQUASH_SCAN}",
                     "--format=%x01%H %T", "--numstat", "-z", f"{fork}..{base}", timeout=60)
    exact, rest = [], []
    for block in out.split("\1")[1:]:  # \1 分隔提交，-z 让文件名里的任意字符都安全
        header, _, body = block.partition("\0")  # 头部以 NUL 结尾，其后是 numstat
        sha, tree = header.split()
        stat = parse_numstat(body)
        if changed <= set(stat):
            (exact if stat == numstat else rest).append((sha, tree))
    for sha, tree in exact + rest:
        if time.monotonic() > deadline:
            return None
        if merges_to(f"{sha}^", tree):
            return reason
    return None


def parse_numstat(out):
    """解析 `--numstat -z` 输出为 {路径: "增 删"}；二进制文件记 "- -"。"""
    stat, fields = {}, out.strip("\n\0").split("\0")
    for f in fields:
        f = f.lstrip("\n")
        parts = f.split("\t", 2)
        if len(parts) == 3 and parts[2]:
            stat[parts[2]] = f"{parts[0]} {parts[1]}"
    return stat


class RepoPlan:
    def __init__(self, repo):
        self.repo = repo
        self.fetch_error = None
        self.master = None
        self.switch_to_master = False  # 当前分支可清理且工作区净 → 切回 master
        self.ff_master = False         # master 落后 → ff 前进
        self.master_diverged = False
        self.del_branches = []         # [(name, reason)]
        self.del_worktrees = []        # [(path, branch)]
        self.keep = []                 # [(name, reason)] 需要人看的
        self.notes = []
        self.errors = []

    def has_actions(self):
        return self.switch_to_master or self.ff_master or self.del_branches or self.del_worktrees

    def noteworthy(self):
        return self.has_actions() or self.keep or self.errors or self.fetch_error


def analyze(repo: Path) -> RepoPlan:
    plan = RepoPlan(repo)

    rc, _, err = git(repo, "fetch", "--prune", "origin", timeout=FETCH_TIMEOUT)
    if rc != 0:
        plan.fetch_error = fatal_line(err, "fetch 失败")

    master, has_remote = master_ref(repo)
    if master is None:
        plan.notes.append("未识别出 master/main 分支，跳过")
        return plan
    plan.master = master
    base = f"origin/{master}" if has_remote else master
    if not has_remote:
        plan.notes.append("无远端 master，仅本地整理")

    # --- 分支分类 ---
    base_tip = git(repo, "rev-parse", base)[1]
    rc, out, _ = git(repo, "for-each-ref", "refs/heads",
                     "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(objectname)")
    branches = {}
    for line in out.splitlines():
        parts = (line.split("\t") + ["", "", ""])[:4]
        branches[parts[0]] = {"upstream": parts[1], "track": parts[2], "tip": parts[3]}

    deletable = set()
    for name, info in branches.items():
        if name == master:
            continue
        never_pushed = not info["upstream"] or info["upstream"] == base
        if base_tip and info["tip"] == base_tip and never_pushed:
            # 与 origin/master 同点且从未作为独立远端分支推送 = 刚切出的空任务分支，
            # 可能有并行 session 正要用，不回收；走过 MR 的同点分支（ff 合并产物）照常清理。
            # 注：switch -c X origin/master 会自动把 upstream 设成 origin/master，故不能只判空
            plan.keep.append((name, f"与 {base} 同点（刚切出的空任务分支）"))
            continue
        merged = merged_into(repo, name, base)
        if merged:
            deletable.add(name)
            plan.del_branches.append((name, merged))
        elif info["track"] == "[gone]":
            # 远端删分支不能证明内容已合并（也可能是误删或未保留的提交）。
            plan.keep.append((name, "upstream 已删除但未证实合并，保留本地提交"))
        elif not info["upstream"]:
            plan.keep.append((name, "从未推送且未合并"))
        elif "ahead" in info["track"]:
            plan.keep.append((name, f"有未推提交 {info['track']}"))
        else:
            plan.keep.append((name, "已推送、MR 未合并（进行中）"))

    # --- worktree 分类 ---
    rc, out, _ = git(repo, "worktree", "list", "--porcelain")
    wt_of = {}  # branch -> path，用于判断分支是否被 worktree 占用
    entries = []
    cur = {}
    for line in out.splitlines() + [""]:
        if not line:
            if cur:
                entries.append(cur)
            cur = {}
        elif line.startswith("worktree "):
            cur["path"] = line[9:]
        elif line.startswith("branch "):
            cur["branch"] = line[7:].replace("refs/heads/", "")
        elif line == "detached":
            cur["branch"] = None
    for e in entries[1:]:  # 第一个是主 worktree
        path, br = e.get("path"), e.get("branch")
        if not Path(path).exists():
            # 目录已消失 → prune 即可释放，不阻塞分支删除
            plan.notes.append(f"worktree 目录已不存在: {path}（prune 可清）")
            continue
        if br:
            wt_of[br] = path
        rc_w, out_w, _ = git(Path(path), "status", "--porcelain", timeout=60)
        dirty = rc_w != 0 or bool(out_w)  # 状态查不出来时按脏处理，宁可不删
        links = skill_links_into(path) if br in deletable and not dirty else []
        if links:
            plan.keep.append((f"worktree {path}",
                              f"跳过回收：有 skill 软链指向它 → {', '.join(links)}"))
        elif br in deletable and not dirty:
            plan.del_worktrees.append((path, br))
        elif br in deletable and dirty:
            plan.keep.append((f"worktree {path}", f"分支 {br} 可清理但工作区脏"))
        elif br is None:
            plan.keep.append((f"worktree {path}", "detached HEAD，请人工确认"))

    # 分支被脏 worktree 占用则本轮不删
    blocked = {br for br, p in wt_of.items()
               if br in deletable and (p, br) not in plan.del_worktrees}
    if blocked:
        plan.del_branches = [(n, r) for n, r in plan.del_branches if n not in blocked]
        deletable -= blocked
        for n in sorted(blocked):
            plan.keep.append((n, f"可清理但被保留的 worktree 占用: {wt_of[n]}"))

    # --- 当前分支归位 ---
    rc, head, _ = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    rc_st, out_st, _ = git(repo, "status", "--porcelain", "--untracked-files=no", timeout=60)
    tracked_dirty = rc_st != 0 or bool(out_st)  # 状态查不出来时按脏处理
    if head != master and head in deletable:
        if tracked_dirty:
            plan.keep.append((f"当前分支 {head}", "可清理但工作区有改动，未切回 master"))
            plan.del_branches = [(n, r) for n, r in plan.del_branches if n != head]
        else:
            plan.switch_to_master = True
    elif head != master and head not in deletable:
        plan.notes.append(f"当前停在进行中分支 {head}，未动")

    # --- master 前进 ---
    if has_remote:
        rc, out, _ = git(repo, "rev-list", "--left-right", "--count", f"{base}...{master}")
        if rc == 0 and out:
            behind, ahead = (out.split() + ["0", "0"])[:2]
            if int(ahead) > 0 and int(behind) > 0:
                plan.master_diverged = True
                plan.keep.append((master, f"与 {base} 分叉(本地领先{ahead}/落后{behind})，请人工处理"))
            elif int(behind) > 0:
                plan.ff_master = True
                plan.notes.append(f"{master} 落后 {base} {behind} 个提交")
    return plan


def apply_plan(plan: RepoPlan):
    repo = plan.repo
    for path, br in plan.del_worktrees:
        rc, _, err = git(repo, "worktree", "remove", path, timeout=60)
        if rc != 0:
            plan.errors.append(f"worktree remove {path}: {fatal_line(err, err)}")
            plan.del_branches = [(n, r) for n, r in plan.del_branches if n != br]
    git(repo, "worktree", "prune")

    if plan.switch_to_master:
        rc, _, err = git(repo, "switch", plan.master, timeout=TREE_TIMEOUT)
        if rc != 0:
            plan.errors.append(f"切回 {plan.master} 失败: {fatal_line(err, err)}")
            head = git(repo, "rev-parse", "--abbrev-ref", "HEAD")[1]
            plan.del_branches = [(n, r) for n, r in plan.del_branches if n != head]

    if plan.ff_master and git(repo, "rev-parse", "--abbrev-ref", "HEAD")[1] == plan.master:
        rc, _, err = git(repo, "merge", "--ff-only", f"origin/{plan.master}", timeout=TREE_TIMEOUT)
        if rc != 0:
            plan.errors.append(f"ff 前进失败: {fatal_line(err, err)}")
    elif plan.ff_master:
        rc, _, err = git(repo, "fetch", "origin",
                         f"{plan.master}:{plan.master}", timeout=FETCH_TIMEOUT)
        if rc != 0:
            plan.errors.append(f"后台前进 {plan.master} 失败: {fatal_line(err, err)}")

    for name, _ in plan.del_branches:
        rc, _, err = git(repo, "branch", "-D", name)
        if rc != 0:
            plan.errors.append(f"删分支 {name}: {fatal_line(err, err)}")


def start_task(repo: Path, task: str):
    """归位后开新任务：一律建 sibling worktree，主检出不动——它恒定停在默认分支，只作阅读窗口。"""
    master, has_remote = master_ref(repo)
    if master is None:
        print("❌ 未识别出 master/main 分支，无法开任务", file=sys.stderr)
        sys.exit(1)
    base = f"origin/{master}" if has_remote else master
    branch = task if "/" in task else f"task/{task}"
    if git(repo, "show-ref", "-q", f"refs/heads/{branch}")[0] == 0:
        print(f"❌ 分支 {branch} 已存在；续作请直接切换或进入对应 worktree", file=sys.stderr)
        sys.exit(1)

    head = git(repo, "rev-parse", "--abbrev-ref", "HEAD")[1]
    _, out_st, _ = git(repo, "status", "--porcelain", "--untracked-files=no", timeout=60)

    # 主检出停在已合并的分支上 = 任务做完没归位（干净的通常已在上面的归位里切回）。
    # 必须说出来，不能默默绕开，否则主检出从此没人还回来。
    if head != master and has_remote:
        if merged_into(repo, head, f"origin/{master}"):
            dirty = [l for l in out_st.splitlines() if l.strip()]
            stale = []
            for line in dirty:
                f = line[3:].strip().strip('"')
                # 与 origin/master 逐字相同的改动 = 已合并任务留下的副本，丢了不可惜
                if git(repo, "diff", "--quiet", f"origin/{master}", "--", f)[0] == 0:
                    stale.append(f)
            print(f"⚠️  主检出停在 {head}，该分支已合并进 origin/{master}——任务做完了没归位。")
            if dirty:
                print(f"    工作区还有 {len(dirty)} 处未提交改动"
                      + (f"，其中 {len(stale)} 处与 origin/{master} 逐字相同（是残留副本）" if stale else "")
                      + "。")
                print(f"    先确认这些改动是否还需要：cd {repo} && git status")
                print(f"    确认可弃后归位：git stash push -u -m park-{head} && "
                      f"git switch {master} && git merge --ff-only origin/{master}")
            else:
                print(f"    工作区干净，直接归位：cd {repo} && git switch {master} && "
                      f"git merge --ff-only origin/{master}")
            print(f"    归位后主检出回到 {master}，只作阅读窗口；新任务不受影响，照常建并行 worktree。")

    wt = repo.parent / f"{repo.name}--{task.replace('/', '-')}"
    if wt.exists():
        print(f"❌ 目录已存在: {wt}", file=sys.stderr)
        sys.exit(1)
    rc, _, err = git(repo, "worktree", "add", "--no-track", "-b", branch, str(wt), base,
                     timeout=TREE_TIMEOUT)
    if rc != 0:
        print(f"❌ 建 worktree 失败: {fatal_line(err, err)}", file=sys.stderr)
        sys.exit(1)
    print(f"✅ 已建并行 worktree（分支 {branch}，基于 {base}），主检出保持不动\ncd {wt}")


def render(plan: RepoPlan, applied: bool):
    tag = "✅" if applied and not plan.errors else ("⚠️" if plan.errors or plan.fetch_error else "📋")
    lines = [f"{tag} {plan.repo}"]
    if plan.fetch_error:
        lines.append(f"  ⚠️ fetch 失败: {plan.fetch_error}（以下基于本地缓存判断）")
    verb = "已" if applied else "将"
    if plan.switch_to_master:
        lines.append(f"  ↩️ {verb}切回 {plan.master}")
    if plan.ff_master:
        lines.append(f"  ⏩ {plan.master} {verb} ff 前进到远端最新")
    for p, br in plan.del_worktrees:
        lines.append(f"  🧹 {verb}移除 worktree {p} (分支 {br})")
    for n, r in plan.del_branches:
        lines.append(f"  🗑️ {verb}删分支 {n} —— {r}")
    for n, r in plan.keep:
        lines.append(f"  ✋ 保留 {n} —— {r}")
    for n in plan.notes:
        lines.append(f"  ℹ️ {n}")
    for e in plan.errors:
        lines.append(f"  ❌ {e}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", nargs="?", default=".", help="仓库路径（默认当前目录）")
    ap.add_argument("--all", action="store_true", help=f"扫描 {CODE_ROOT} 下全部仓库")
    ap.add_argument("--apply", action="store_true", help="真正执行（默认 dry-run）")
    ap.add_argument("--new", metavar="TASK",
                    help="归位后开新任务：一律建 sibling worktree <仓库>--<task>，主检出不动（隐含 --apply）")
    ap.add_argument("--is-merged", metavar="BRANCH",
                    help="只判定 BRANCH 是否已合并进默认分支（不 fetch、不动分支和工作区）：已合并打印理由、退出 0，"
                         "否则退出 1。供 [tasks] 菜单与 tidy 共用同一判定")
    args = ap.parse_args()

    if args.is_merged:
        rc, top, _ = git(Path(args.path).resolve(), "rev-parse", "--show-toplevel")
        master, has_remote = master_ref(top) if rc == 0 else (None, False)
        if master is None:
            sys.exit(1)
        budget = float(os.environ.get("REPO_TIDY_MERGE_BUDGET", MERGE_BUDGET))
        reason = merged_into(top, args.is_merged, f"origin/{master}" if has_remote else master, budget)
        if reason:
            print(reason)
        sys.exit(0 if reason else 1)

    if args.all and args.new:
        print("❌ --new 只支持单仓库", file=sys.stderr)
        sys.exit(1)

    if args.all:
        repos = find_repos(CODE_ROOT)
    else:
        rc, top, _ = git(Path(args.path).resolve(), "rev-parse", "--show-toplevel")
        if rc != 0:
            print(f"❌ {args.path} 不是 git 仓库", file=sys.stderr)
            sys.exit(1)
        repos = [Path(top)]

    with ThreadPoolExecutor(max_workers=6) as ex:
        plans = list(ex.map(analyze, repos))

    executed = set()
    if args.apply or args.new:
        for p in plans:
            if p.has_actions() and not p.master_diverged:
                apply_plan(p)
                executed.add(id(p))
            elif p.has_actions() and p.master_diverged:
                p.notes.append("master 与远端分叉，本仓库所有动作已跳过，请先人工处理")

    if args.new:
        p = plans[0]
        if p.noteworthy():
            print(render(p, id(p) in executed))
        start_task(repos[0], args.new)
        return

    shown = 0
    for p in plans:
        if p.noteworthy():
            print(render(p, id(p) in executed))
            shown += 1
    clean = len(plans) - shown
    mode = "执行完成" if args.apply else "dry-run（加 --apply 执行）"
    print(f"\n共 {len(plans)} 个仓库，{shown} 个有事项，{clean} 个已是干净状态 —— {mode}")


if __name__ == "__main__":
    main()
