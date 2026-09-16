---
name: repo-tidy
description: "Prepare a branch/worktree for a new repository-changing task or perform requested cleanup. Read-only audits, continued tasks and repo-status alone do not trigger mutations. Preserve active or unverified work."
---

# repo-tidy

把本地仓库恢复到「默认分支与远端一致、无可安全回收的遗留分支/worktree」的基线状态。默认分支优先读取 origin/HEAD，缺少该引用时才兼容 master/main。归位发生在**下一个任务开始时**（push 完 MR 未合，任务结束时无收尾时机）。

组件（脚本就地运行于 skill 目录，不复制副本）：
- `scripts/repo_tidy.py` —— 核心：tidy / `--all` / `--new`
- `scripts/git-repo-status.sh` —— SessionStart hook，开局注入一行 `[repo-status]`（分支/ahead-behind/脏净）。注册到 `~/.claude/settings.json` 的 `hooks.SessionStart`：`{"matcher": "*", "hooks": [{"type": "command", "command": "<skill绝对路径>/scripts/git-repo-status.sh", "timeout": 10}]}`
- `tests/test_repo_tidy.sh <scratch目录>` —— 对抗测试（含双默认分支与非标准默认分支的对抗场景），改脚本后必须跑

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

### 2. 核对范围后执行

核对 dry-run 清单与授权范围。已授权的单仓库清理或按项目规则启动新任务，可直接处理已核实安全的对象，不因换轮次重复询问。未推送、未合并、脏工作区、活跃任务或归属不明的对象保留；范围扩大或存在数据丢失风险时说明影响并确认。

`upstream 已删除` 本身不能证明工作已合并。脚本只自动清理已证实为默认分支祖先的分支；未证实合并的 gone 分支保留并报告；其关联 worktree 同样保留，但不单独列出目录。不阻塞 `--new` 创建新任务。squash 等不能由祖先关系证实的情况，也不自动删除；需要另行核实内容保留证据和清理授权。

```bash
python3 "$SKILL_DIR/scripts/repo_tidy.py" <repo-path> --apply
```

### 3. 开新任务（已有范围授权时直接归位并开分支/worktree）

```bash
python3 "$SKILL_DIR/scripts/repo_tidy.py" <repo-path> --new <task>
```

- 先对该仓库执行一次归位（等价 `--apply`，安全边界相同）
- 主检出空闲（在默认分支且无 tracked 改动）→ 原地 `switch -c task/<task> origin/<默认分支>`
- 主检出被占用（停在进行中分支或有改动）→ 自动创建 sibling worktree `<仓库>--<task>`（基于最新 origin/<默认分支>）并输出 `cd` 路径 —— 同项目多任务并行就靠这个：一任务一目录一 session，MR 合并后 tidy 自动回收
- `<task>` 含 `/` 时按原样作分支名，否则加 `task/` 前缀

## 脚本行为（安全边界）

| 对象 | 条件 | 动作 |
|------|------|------|
| 本地分支 | 已合并进 origin/<默认分支> | 删除 |
| 本地分支 | upstream 已删除 | 已证实合并则按上一行清理，否则保留并报告 |
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
