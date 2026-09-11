---
name: agent-skills-zh
description: Agent Skills for Claude Code & Codex, Chinese-first — 面向中文开发者的 Agent Skills 注册表
version: 1.1.0
registry: https://github.com/hanzhangzzz/agent-skills-zh
install: npx skills add hanzhangzzz/agent-skills-zh
---

# agent-skills-zh Registry

Machine-readable index of every skill in this repository. Agents can parse this file to discover and install skills; humans should read [README.md](./README.md).

本文件是仓库的注册表索引，Agent 可以解析它来发现和安装 skill；人类请看 README。

## Skills 索引

### doc-reader

```json
{
  "name": "doc-reader",
  "version": "1.1.0",
  "description": "Translate an English technical article (URL) or PDF into accurate Chinese section by section, keep 100% of images, build a local 3-column preview HTML (original · translation · AI slides). Slides via local Codex CLI imagegen, no image API key. 英文技术文档/PDF 章节级精准翻译，图片全保留，三栏本地预览",
  "trigger": "/doc-reader",
  "keywords": ["doc-reader", "translate", "translation", "english to chinese", "technical documentation", "pdf", "markdown", "slides", "imagegen", "codex", "翻译", "技术文档", "幻灯片"],
  "compatibility": "Claude Code, Codex (slides need a logged-in local Codex CLI)",
  "install_path": "doc-reader/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### wechat-article-md-local

```json
{
  "name": "wechat-article-md-local",
  "version": "1.0.0",
  "description": "Save a WeChat Official Account (mp.weixin.qq.com) article as local Markdown with images downloaded; HTML fallback. 公众号文章下载为本地 Markdown，图片本地化",
  "trigger": "auto on mp.weixin.qq.com links",
  "keywords": ["wechat", "weixin", "official account", "mp.weixin.qq.com", "article", "markdown", "download", "archive", "微信", "公众号", "文章下载"],
  "compatibility": "Claude Code, Codex",
  "install_path": "wechat-article-md-local/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### xiaohongshu-downloader

```json
{
  "name": "xiaohongshu-downloader",
  "version": "1.0.0",
  "description": "Download a Xiaohongshu (RedNote) video from xiaohongshu.com / xhslink.com and transcribe the voice-over with Whisper into a Markdown transcript. 小红书视频下载 + 口播逐字稿",
  "trigger": "auto on xiaohongshu.com / xhslink.com links",
  "keywords": ["xiaohongshu", "rednote", "xhs", "video", "download", "whisper", "transcript", "transcription", "markdown", "小红书", "口播", "逐字稿", "视频转文字"],
  "compatibility": "Claude Code, Codex",
  "install_path": "xiaohongshu-downloader/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### x-article-download

```json
{
  "name": "x-article-download",
  "version": "1.0.0",
  "description": "Download a tweet, a long-form X article or an entire account to Markdown (text, images, videos, linked GitHub repos); auto-detects content type. X/Twitter 单条或整账号批量下载为 Markdown",
  "trigger": "auto on x.com / twitter.com links",
  "keywords": ["x", "twitter", "tweet", "x article", "download", "archive", "markdown", "batch", "推特", "推文下载", "X 文章"],
  "compatibility": "Claude Code, Codex",
  "install_path": "x-article-download/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### hkr-render

```json
{
  "name": "hkr-render",
  "version": "1.0.0",
  "description": "WeChat Official Account publishing pipeline: Markdown → WeChat-compatible inline-style HTML (7 themes) → cover image with brightness check → push to draft box, multi-article supported. 公众号排版 → 封面 → 推送草稿箱",
  "trigger": "排版 / 微信排版 / /format",
  "keywords": ["wechat", "weixin", "official account", "publishing", "formatting", "typesetting", "markdown to html", "cover image", "draft", "公众号", "排版", "微信排版", "发布"],
  "compatibility": "Claude Code, Codex (needs config.json with WeChat AppID/Secret)",
  "install_path": "hkr-render/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### md2view

```json
{
  "name": "md2view",
  "version": "4.0.0",
  "description": "Re-encode a Markdown document into a traceable two-column reading view — original on the left, model-designed diagrams/flows/matrices/cards on the right, every element anchored to its source — as a single-file HTML. Markdown 重编码为可溯源的双栏阅读视图",
  "trigger": "/md2view",
  "keywords": ["markdown", "html", "visualization", "document", "diagram", "two-column", "traceable", "report", "spec", "文档可视化", "信息重组", "双栏阅读", "复盘"],
  "compatibility": "Claude Code, Codex",
  "install_path": "md2view/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### gpt-image2-prompt-director

```json
{
  "name": "gpt-image2-prompt-director",
  "version": "1.0.0",
  "description": "Turn a weak idea into a production-grade GPT image2 (gpt-image-2) generation brief — avatars, sticker packs, infographics, covers, posters, product shots — with a built-in 40-case benchmark and hard gates. GPT image2 提示词导演 + 评测门禁",
  "trigger": "$gpt-image2-prompt-director",
  "keywords": ["gpt-image-2", "gpt image2", "image generation", "prompt", "prompt engineering", "avatar", "sticker", "infographic", "poster", "benchmark", "生图", "提示词", "头像", "表情包", "信息图"],
  "compatibility": "Claude Code, Codex",
  "install_path": "gpt-image2-prompt-director/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### repo-tidy

```json
{
  "name": "repo-tidy",
  "version": "1.0.0",
  "description": "Git tidy-up and parallel-task base: back to latest master/main, prune merged or upstream-gone branches, remove stale worktrees; --new <task> does tidy + task branch in one command (parallel worktree when the checkout is busy); SessionStart hook injects repo status. 仓库归位与并行任务底座",
  "trigger": "归位 / 开新任务 / repo tidy",
  "keywords": ["git", "branch", "worktree", "cleanup", "tidy", "parallel tasks", "hook", "session start", "归位", "整理仓库", "清理分支", "开新任务"],
  "compatibility": "Claude Code (hook), Codex (commands)",
  "install_path": "repo-tidy/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### hook-test-kit

```json
{
  "name": "hook-test-kit",
  "version": "1.0.0",
  "description": "为 Claude Code hook 脚本生成行为矩阵测试骨架：scratch fixture 隔离、stdin 喂 JSON、EMPTY/!否定断言协议、bash 坑位预修，变异实验收尾",
  "trigger": "/hook-test-kit",
  "keywords": ["hook", "测试", "PreToolUse", "SessionStart", "UserPromptSubmit", "行为测试"],
  "compatibility": "Claude Code",
  "install_path": "hook-test-kit/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### repo-map

```json
{
  "name": "repo-map",
  "version": "1.0.0",
  "description": "Local repository map: self-healing index of all local git repos (name, path, read/write role, purpose); UserPromptSubmit hook injects path + role whenever a repo name is mentioned; optional macOS launchd sync. 本地仓库地图，提到仓库名自动注入路径",
  "trigger": "仓库地图 / repo-map",
  "keywords": ["git", "multi-repo", "monorepo", "repository index", "hook", "prompt injection", "launchd", "仓库地图", "全局项目索引", "跨仓库"],
  "compatibility": "Claude Code (hook), Codex (resolve command)",
  "install_path": "repo-map/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### harness

```json
{
  "name": "harness",
  "version": "1.0.0",
  "description": "Minimal Harness Engineering loop: Inspector finds issues, Worker fixes, Reviewer verifies, coordinated through a shared TODO.md board; run once or on a schedule. 三角色 AI 自治改进循环",
  "trigger": "/harness",
  "keywords": ["harness", "harness engineering", "autonomous agent", "code review", "automation", "inspection", "workflow", "TODO", "AI 自治循环", "自动巡检修复"],
  "compatibility": "Claude Code, Codex",
  "install_path": "harness/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### do-something

```json
{
  "name": "do-something",
  "version": "1.4.0",
  "description": "Autonomously answer feedback first, select the highest-value task supported by real evidence, finish and verify a durable outcome, or return NO-OP when nothing qualifies. MR mode pairs with ci-review and requires separate value and execution verdicts before auto-merge. 自主推进项目，以真实价值和完成度为门，不为保持循环制造提交",
  "trigger": "/do-something",
  "keywords": ["autonomous", "agent", "cron", "loop", "unattended", "project improvement", "backlog", "merge request", "flywheel", "做点什么", "自己看着办", "推进一下"],
  "compatibility": "Claude Code, Codex",
  "install_path": "do-something/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### ci-review

```json
{
  "name": "ci-review",
  "version": "1.2.0",
  "description": "Install a CI-triggered LLM code reviewer into a repo: every PR/MR gets a reproducible execution verdict; configured bot branches such as do/* also need a separate value verdict proving evidence, purpose alignment, durable output, and completion before deterministic auto-merge. Markdown behavior files are reviewed as code, and failed verdicts become red checks. CI 里的验证型代码审查机器人，机器人分支价值与执行双门禁",
  "trigger": "/ci-review",
  "keywords": ["code review", "ci", "github actions", "gitlab ci", "claude-code-action", "pull request", "merge request", "auto merge", "flywheel", "代码审查", "自动 review", "自动合并"],
  "compatibility": "Claude Code",
  "install_path": "ci-review/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

### git-push-guard

```json
{
  "name": "git-push-guard",
  "version": "1.0.0",
  "description": "Hook-only Claude Code plugin (no SKILL.md): intercepts direct git push to master/main, asks for confirmation, per-repo path allowlist for permanent bypass. 纯 hook：直推默认分支拦截",
  "trigger": "auto on git push to master/main",
  "keywords": ["git", "push", "hook", "guard", "protect main", "protect master", "PreToolUse", "分支保护", "直推拦截"],
  "compatibility": "Claude Code plugin only",
  "install_path": "git-push-guard/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```

## 安装指令模板 · Install templates

Agents can install any skill above with one of these:

```bash
# Skills CLI (Claude Code, Codex, Cursor, Copilot, Windsurf, Gemini CLI, ...)
npx skills add hanzhangzzz/agent-skills-zh -s <skill-name> -g

# Claude Code plugin marketplace (hooks auto-enabled)
/plugin marketplace add hanzhangzzz/agent-skills-zh
/plugin install <skill-name>@agent-skills-zh

# Manual copy
git clone https://github.com/hanzhangzzz/agent-skills-zh
cp -r agent-skills-zh/<skill-name> ~/.claude/skills/    # or ~/.codex/skills/
```

Natural-language request an agent understands · 自然语言安装请求：

```text
请从 https://github.com/hanzhangzzz/agent-skills-zh 安装 doc-reader skill
```

```text
Install the "hkr-render" skill from https://github.com/hanzhangzzz/agent-skills-zh
```

### scanned-book-ocr

```json
{
  "name": "scanned-book-ocr",
  "version": "1.0.0",
  "description": "扫描书 PDF 本地批量 OCR，输出页码可追溯的文本，含并发一致性基准、完整性校验和视觉抽检；支持 Apple Silicon macOS。",
  "trigger": "$scanned-book-ocr",
  "keywords": [
    "ocr",
    "scanned pdf",
    "book",
    "text",
    "扫描书",
    "图片 PDF",
    "文字提取"
  ],
  "compatibility": "Claude Code, Codex; Apple Silicon macOS, Python 3.12+, pdftoppm",
  "install_path": "scanned-book-ocr/",
  "repo": "https://github.com/hanzhangzzz/agent-skills-zh",
  "license": "MIT"
}
```
