# MR 模式命令参考

do-something 在 MR 模式下要做的远端操作，GitHub 用 `gh`，GitLab 用 `glab` + REST。
先判断平台：`git remote get-url origin` 含 `github.com` → GitHub；否则按 GitLab 处理。
两边都要求 CLI 已登录（`gh auth status` / `glab auth status`），未登录就在 DO.md 当前状态记下并退回"绝不 push"行为。

## 第 0 步：读状态

| 要什么 | GitHub | GitLab |
|---|---|---|
| do/main 是否已并入默认分支 | `git merge-base --is-ancestor do/main origin/<default>` | 同左 |
| 找现有 MR（`state` 为 MERGED 也算收割，squash 合并后上一行判不出；同时读取 `title` 防止新 MR 沿用旧标题） | `gh pr list --head do/main --state all --json number,state,url,isDraft,title` | `glab mr list --source-branch do/main --all -F json`（`state` 为 merged） |
| CI 状态 | `gh pr checks <n>`（非零退出 = 有失败） | `glab ci status --branch do/main` |
| 失败的 CI 日志 | `gh run list --branch do/main --limit 1 --json databaseId` → `gh run view <id> --log-failed` | `glab ci view --branch do/main` 找失败 job → `glab ci trace <job-id>` |

## 评审线程

GitHub 的"已解决"状态只在 GraphQL 里：

```bash
# 列出未解决线程（含每条评论的 path/line/body/author）
gh api graphql -f query='
query($owner:String!,$repo:String!,$n:Int!){
  repository(owner:$owner,name:$repo){ pullRequest(number:$n){
    reviewThreads(first:100){ nodes{ id isResolved path line
      comments(first:20){ nodes{ author{login} body createdAt } } } } } } }' \
  -f owner=<owner> -f repo=<repo> -F n=<n> \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)'

# 在线程里回复
gh api repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies -f body='已修：<sha>'

# resolve
gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -f id=<thread-id>
```

GitLab：

```bash
# 未解决的 discussion
glab api "projects/:id/merge_requests/<iid>/discussions?per_page=100" \
  | jq '.[] | select(.notes[0].resolvable==true and .notes[0].resolved==false)'
# 回复
glab api -X POST "projects/:id/merge_requests/<iid>/discussions/<discussion-id>/notes" -f body='已修：<sha>'
# resolve
glab api -X PUT "projects/:id/merge_requests/<iid>/discussions/<discussion-id>" -f resolved=true
```

机器人线程的识别：ci-review 发的评论正文以 `<!-- ci-review -->` 开头；作者是人就不设回合上限。
"同一线程来回 5 轮"按你自己在该线程里的回复条数计。

## 结束：push、MR 标题与正文

先从 `origin/<default>...HEAD` 的完整 diff 概括 MR 的主要可交付成果，再设置标题：

```bash
TITLE='do: <具体对象 + 已实现的结果>'
```

`TITLE` 描述这批改动做成了什么，不复述 DO.md 的长期目的，不写“继续优化”“推进项目”等过程话。
新建 MR 时若它与上一个已合并的 `do/main` MR 同名，根据当前 diff 补足具体对象或结果；不要追加日期或序号。
续更现有 MR 时也按相对默认分支的全部未合并改动重算标题，不能只概括最后一个 commit。

`/tmp/do-body.md` 只描述当前 MR，不复制 DO.md 历史。格式固定：

```markdown
## 证据
<失败、用户/issue 信号、高频未覆盖路径或重复劳动的可核对事实>

## 为什么现在做
<本次结果如何直接推进项目目的；为什么它高于其他候选>

## 持久化产出
<修复、永久测试、生成器/门禁或用户可见能力>

## 完成度
<承诺范围是否全部完成；仍有关键路径未验证就明确写未完成，不能申请 value=pass>

## 验证
<干净副本可重跑的命令、预期退出码和最终产物证据>

## 运行版本
do-something-blob: `<git hash-object do-something/SKILL.md 的输出>`
```

运行版本在 commit 前计算。若 skill 不在仓库内，用实际加载的 `SKILL.md` 路径执行 `git hash-object`；
无法得到 blob 就写明实际路径与文件 SHA-256，不能省略版本证据。

```bash
git push -u origin do/main

# GitHub：无 MR 则建 draft，有则更新正文
gh pr create --draft --head do/main --base <default> --title "$TITLE" --body-file /tmp/do-body.md
gh pr edit <n> --title "$TITLE" --body-file /tmp/do-body.md

# GitLab
glab mr create --draft --source-branch do/main --target-branch <default> --title "$TITLE" --description "$(cat /tmp/do-body.md)" --yes
glab mr update <iid> --title "$TITLE" --description "$(cat /tmp/do-body.md)"
```

创建或更新后重新读取远端标题与正文，确认没有被 shell 转义、缓存模板或旧 session 改回。
