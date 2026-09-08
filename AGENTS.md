# agent-skills-zh — AI 开发指南

本仓库（GitHub: hanzhangzzz/agent-skills-zh，原名 my-skill）是一个面向中文开发者的 Agent Skills 集合。任何 AI Agent 都可以为它贡献新的 skills。

## 添加新 Skill 的流程

### 1. 理解 Skill 结构

每个 skill 是一个目录，至少包含：
- `SKILL.md` — 主指令文件（必需）

可选包含：
- `scripts/` — 可执行脚本
- `prompts/` — 提示词模板
- `references/` — 参考文档
- `assets/` — 静态资源

### 2. 创建 Skill 目录

在仓库根目录下创建 `<skill-name>/` 目录：

```bash
mkdir -p <skill-name>/prompts
```

### 3. 编写 SKILL.md

每个 SKILL.md 必须包含 YAML frontmatter：

```yaml
---
name: <skill-name>          # 必需：与目录名相同，小写+连字符
description: |               # 必需：描述功能和触发场景
  简短描述...
trigger: /<skill-name>      # 推荐：触发命令
compatibility: Claude Code   # 可选：兼容平台
license: MIT                # 可选：许可证
---
```

**字段规范：**
| 字段 | 约束 |
|------|------|
| `name` | 仅小写字母、数字、连字符，≤64 字符 |
| `description` | ≤1024 字符 |
| `trigger` | 推荐使用 `/<skill-name>` 格式 |

### 4. 编写 SKILL.md 内容

内容应该包含：
1. **触发条件** — 什么情况下激活这个 skill
2. **执行步骤** — 清晰的执行流程
3. **输出格式** — 最终输出的格式要求
4. **错误处理** — 常见错误和应对方式

**内容原则：**
- 使用祈使句（"验证 X" 而非 "你应该验证 X"）
- 不超过 500 行
- 只写 Agent 不知道的信息，不重复通用知识
- Fail Fast：外部依赖检查放在最前面

### 5. 重要：路径不得硬编码

Skill 可能安装在多种路径下：
- `~/.claude/skills/<name>/` （全局）
- `.claude/skills/<name>/` （项目级）
- 插件缓存目录

**正确做法：** 使用相对于 SKILL.md 的路径引用：
```bash
# 正确
bash "$(dirname "$(readlink -f "$0")")/scripts/my_script.sh"

# 错误 ❌
bash ~/.claude/skills/my-skill/scripts/my_script.sh
```

### 6. 验证新 Skill

#### 6.1 格式检查

```bash
# 检查 frontmatter 是否完整
head -10 <skill-name>/SKILL.md | grep -E "^---" -A 5

# 检查 name 是否匹配目录名
grep "^name:" <skill-name>/SKILL.md | sed 's/name: //'
# 应该等于 <skill-name>
```

#### 6.2 内容检查

```bash
# 全仓行为与市场门禁共用同一入口（各 skill 测试、frontmatter、索引、生成物、脚本可执行位）
bash .github/scripts/run_behavior_tests.sh
```

注意：`~/.claude/settings.json` 这类用户级配置文件本来就在 `~/.claude`，属合法引用；
只有「假设 skill 装在固定位置」的路径（如 `~/.claude/skills/<name>/...`）才算硬编码，门禁已内置该裁决。

#### 6.3 功能验证（Claude Code 环境）

在 Claude Code 中测试触发：
```
/harness  # 如果是 harness skill
/<your-skill-name>  # 你的 skill 触发词
```

验证：
- Skill 是否正确激活
- 执行流程是否符合预期
- 输出格式是否正确

### 7. 更新市场索引

添加新 skill 后，更新两个文件：

#### 7.1 更新 MARKETPLACE.md

在 `## Skills 索引` 部分添加：

```json
### <skill-name>

```json
{
  "name": "<skill-name>",
  "version": "1.0.0",
  "description": "<描述>",
  "trigger": "/<skill-name>",
  "keywords": ["keyword1", "keyword2"],
  "compatibility": "Claude Code",
  "install_path": "<skill-name>/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```
```

#### 7.2 更新 README.md

在 `## 当前 Skills` 表格中添加一行：

```markdown
| [<skill-name>](./<skill-name>/) | <描述> | /<skill-name> |
```

#### 7.3 更新 .claude-plugin/marketplace.json（Claude Code Plugin 市场）

一个 plugin 只含一个 skill。在 `plugins` 数组中添加 entry：

```json
{
  "name": "<skill-name>",
  "source": "./",
  "strict": false,
  "description": "<描述>",
  "version": "1.0.0",
  "skills": ["./<skill-name>"]
}
```

带 hook 的 skill，把 hooks 配置**内联为对象**写进 entry（实测路径字符串引用外部 hooks.json 不生效），脚本路径用 `${CLAUDE_PLUGIN_ROOT}` 前缀：

```json
"hooks": {
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [
        { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/<skill-name>/scripts/xxx.sh", "timeout": 10 }
      ]
    }
  ]
}
```

改完跑 `claude plugin validate .` 校验，再用本地 marketplace 实装验证组件清单：

```bash
claude plugin marketplace add <仓库本地路径>
claude plugin install <skill-name>@agent-skills-zh
claude plugin details <skill-name>@agent-skills-zh   # 确认 Skills/Hooks 数量正确
```

### 8. 提交变更

```bash
git add <skill-name>/ MARKETPLACE.md README.md .claude-plugin/marketplace.json
git commit -m "feat: 添加 <skill-name> skill"
git push
```

## Skill 质量检查清单

提交前确认：
- [ ] `name` 与目录名完全一致
- [ ] `description` 包含功能描述和触发关键词
- [ ] 无硬编码的绝对路径
- [ ] `SKILL.md` 不超过 500 行
- [ ] 无多余的 README.md、CHANGELOG.md
- [ ] 脚本已验证可执行（`chmod +x`）
- [ ] 内容使用祈使句，无"你应该"等口语化表达

## 参考示例

查看现有 skill 的结构：
- [harness](./harness/) — 包含脚本和提示词的完整示例

## 常见问题

**Q: skill 名称可以包含空格吗？**
A: 不行。只允许小写字母、数字、连字符。

**Q: 可以有多个触发词吗？**
A: frontmatter 只支持一个 `trigger`，但你可以在 SKILL.md 内容中描述其他触发方式。

**Q: 如何处理外部依赖？**
A: 在执行流程最前面添加依赖检查，不通过则立即停止并提示用户。

**Q: 允许多层目录结构吗？**
A: 允许，但不推荐。保持结构扁平更容易维护。
