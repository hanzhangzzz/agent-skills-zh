# 目的

面向中文开发者的 Agent Skills 集合：每个 skill 解决一类真实重复劳动，装上就能用，产出可被展示验证。

# 约束

- MR: on
- 飞轮治理 v2 的故障 canary 全部通过前，自动合入保持 off。
- 外部发消息、生产 API、真实账号发布、付款和不可逆操作仍需人类授权。

# 当前状态

- 证据指纹字段：`base=<默认分支 HEAD>; checks=<失败检查>; feedback=<未解决线程>; issues=<开放事项>; constraints=<约束与开放风险>`。
- 当前指纹：待下一次 do-something 启动时按真实仓库状态生成；时间或运行次数不构成新证据。
- 上次裁决：现有行为测试已接入统一 CI；下一步是验证价值门、NO-OP、Markdown 审查和失败 check 的真实 E2E，未通过前不恢复自动合入。

# 已证实不变量

- `.github/scripts/run_behavior_tests.sh` 是本仓全部本地可复现行为测试的唯一入口，PR 与 main push 都会运行。
- ci-review 对普通分支验证执行；对 `do/*` 分支同时要求 `execution=pass` 与 `value=pass`。
- `SKILL.md`、references、审查 prompt 和 `CLAUDE.md` 会改变 Agent 行为，不能按普通 Markdown 免审。
- README 中英文 skill 表、marketplace、cards.json 与 badge 数量由门禁检查一致性。

# 开放风险与候选

- 真实 canary 尚未完成：无新证据应 NO-OP；DO-only、执行失败、价值失败都必须红且不得合入。
- 长期 resume session 会缓存旧 skill；治理改造合入后需新 session，或让定时任务每轮从磁盘重新读取当前 SKILL.md。
- doc-reader 的 Codex imagegen、公众号/X/小红书真实账号链路仍需有人在场验证，不能由无人值守飞轮擅自执行。
