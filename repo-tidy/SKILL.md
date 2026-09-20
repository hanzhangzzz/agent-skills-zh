---
name: repo-tidy
description: |
  Git repository tidy-up and parallel-task base: switch back to the latest master/main, delete merged or upstream-gone branches, remove stale worktrees. Ships four hooks: SessionStart injects repo status plus a [tasks] worktree menu; session-cwd records each session's working directory so the user's editor shortcut opens what the AI is actually working on; PreToolUse(EnterWorktree) fetches first so new task branches start from the latest default branch. In Claude Code, start tasks with EnterWorktree — `--new <task>` is the fallback for environments without it. Use before a new repository-changing task or when the user explicitly requests cleanup. Read-only audits, questions, continued tasks, and [repo-status] alone do not trigger mutations. Also use when the user says 归位, 整理仓库, 清理分支, 清理 worktree, 开新任务, repo tidy, tidy repo, clean branches.

---

# repo-tidy

把本地仓库恢复到「默认分支与远端一致、无可安全回收的遗留分支/worktree」的基线状态。默认分支优先读取 origin/HEAD，缺少该引用时才兼容 master/main。归位发生在**下一个任务开始时**（push 完 MR 未合，任务结束时无收尾时机）。

组件（脚本就地运行于 skill 目录，不复制副本）：
- `scripts/repo_tidy.py` —— 核心：tidy / `--all` / `--new`
- `scripts/git-repo-status.sh` —— SessionStart hook：注入 `[repo-status]`（分支/ahead-behind/脏净）+ `[tasks]` 菜单（各 worktree 的分支与状态：已合并可回收 / 已推送 MR 待合 / 未推送 / 工作区脏），供判断续任务还是开新任务
- `scripts/session-cwd.sh` —— 把本 session 的 cwd 写到 `~/.claude/session-cwd/<iTerm 会话 id>`。用户的编辑器快捷键按前台标签页 id 读它，于是打开的永远是 AI 当前所在目录——**子进程改不了父 shell 的 cwd，所以不能靠 shell 的当前目录**。静默输出（挂在 SessionStart/UserPromptSubmit 上，stdout 会被注入上下文）
- `scripts/worktree-fetch.sh` —— PreToolUse(EnterWorktree) 先 `fetch --prune`，保证新任务分支从最新的 origin/<默认分支> 切出
- `tests/` —— `test_repo_tidy.sh`、`test_git_repo_status.sh`、`test_session_cwd.sh`，改脚本后必须跑

hook 注册（`~/.claude/settings.json`，命令用 skill 绝对路径）：

| 事件 | matcher | 脚本 |
|---|---|---|
| SessionStart | `*` | `git-repo-status.sh`、`session-cwd.sh` |
| UserPromptSubmit | `*` | `session-cwd.sh` |
| PostToolUse | `EnterWorktree\|ExitWorktree` | `session-cwd.sh` |
| PreToolUse | `EnterWorktree` | `worktree-fetch.sh` |

## 何时用

- 用户说「归位」「整理仓库」「清理分支/worktree」
- 需要修改仓库的新任务开工前；只读审计、问答、续任务不归位，`[repo-status]` 本身不触发动作
- 显式调用 do-something 时遵循该 skill 的 do/main 续做规则，不额外开普通任务分支
- 用户明确要求提交后的仓库整理

## 执行步骤

### 1. Dry-run 出清单

`SKILL_DIR` 指本 SKILL.md 所在目录（全局安装、项目级安装、plugin 缓存目录均适用，按实际安装位置解析，不要硬编码）。

```bash
# 单仓库（默认当前目录）
python3 "$SKILL_DIR/scripts/repo_tidy.py" <repo-path>

# 全部仓库（扫描 ~/Desktop/Works/code）
python3 "$SKILL_DIR/scripts/repo_tidy.py" --all
```

### 2. 确认后执行

把 dry-run 清单展示给用户；**涉及删除分支/worktree 时必须等用户确认**（用户本轮已明确说「清理」「归位」的，单仓库可直接 `--apply`）。

```bash
python3 "$SKILL_DIR/scripts/repo_tidy.py" <repo-path> --apply
```

### 3. 开新任务

**Claude Code 里走 `EnterWorktree`，不要用 `--new`。**读 SessionStart 注入的 `[tasks]` 菜单判断：

- 续某个任务 → `EnterWorktree(path=<该 worktree 路径>)`
- 新任务 → `EnterWorktree(name=<task>)`
- 两个 session 共用一个 worktree（一个写、一个 review）→ 同样用 `path`
- 进门前**向用户一句话确认**；用户说留在主检出就留。session 中途换新任务：`ExitWorktree(keep)` 再 `EnterWorktree(name=...)`，同样先确认

配套 hook 保证两件事：进门前已 fetch（新分支基于最新远端默认分支），进门后位置文件已更新（用户快捷键看到的就是这里）。主检出因此恒定停在默认分支，只作阅读窗口——**不在主检出上开工**，否则第一个任务就会把它占走，后续任务被迫绕到 worktree，而没人再把它还回来。

没有 `EnterWorktree` 的环境（如其他 CLI）才用回退命令：

```bash
python3 "$SKILL_DIR/scripts/repo_tidy.py" <repo-path> --new <task>
```

- 先对该仓库执行一次归位（等价 `--apply`，安全边界相同）
- 主检出空闲（在默认分支且无 tracked 改动）→ 原地 `switch -c task/<task> origin/<默认分支>`，**这会占用主检出**
- 主检出被占用 → 创建 sibling worktree `<仓库>--<task>`（基于最新 origin/<默认分支>）并输出 `cd` 路径
- `<task>` 含 `/` 时按原样作分支名，否则加 `task/` 前缀

## 脚本行为（安全边界）

| 对象 | 条件 | 动作 |
|------|------|------|
| 本地分支 | 已合并进 origin/<默认分支> | 删除 |
| 本地分支 | upstream 已删除（squash 合并后的常态） | 删除 |
| 本地分支 | 有未推提交 / 从未推送 / MR 进行中 | **保留并报告** |
| 本地分支 | 与 origin/<默认分支> 同点且未推送过（刚切出的空任务分支） | **保留**（并行 session 可能正要用） |
| 本地分支 | 空且已落后 origin/<默认分支>（切出后从未动过） | 删除（无内容可丢，重切才是正确归位） |
| 当前分支 | 可清理且工作区无 tracked 改动 | 切回默认分支再删 |
| 默认分支 | 落后远端 | ff-only 前进 |
| 默认分支 | 与远端分叉 | **不动，报告** |
| worktree | 分支可清理且工作区干净 | 移除 |
| worktree | 工作区脏 / detached | **保留并报告** |

脚本自身永远可以 dry-run；一切「✋ 保留」项需要人工决策，不要替用户强清。

## 不做的事

- 不删除整目录的克隆分身（如 `xxx-mr199/` 这类完整 clone）——发现时报告给用户，删目录是危险操作需单独确认
- 不 force push、不改写历史、不碰远端分支
