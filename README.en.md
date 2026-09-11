# agent-skills-zh

[中文](./README.md) | **English**

**Agent Skills for Claude Code, Codex and 20+ coding agents — built for Chinese-speaking developers, useful for anyone who works with Chinese content.**
Translate English docs into Chinese, archive WeChat / Xiaohongshu / X content as Markdown, keep multi-repo Git hygiene, direct GPT-image prompts, and run autonomous improvement loops — one `SKILL.md` per capability, install only what you need.

[![GitHub stars](https://img.shields.io/github/stars/hanzhangzzz/agent-skills-zh?style=flat&logo=github)](https://github.com/hanzhangzzz/agent-skills-zh/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Skills](https://img.shields.io/badge/skills-15-blue)](#skills)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-8A2BE2)](#install)
[![Codex](https://img.shields.io/badge/Codex-compatible-black)](#install)
[![skills.sh](https://img.shields.io/badge/skills.sh-hanzhangzzz%2Fagent--skills--zh-orange)](https://skills.sh/hanzhangzzz/agent-skills-zh)

![agent-skills-zh skill map](./assets/readme/skills-map.svg)

## Quick start

```bash
# Works with Claude Code, Codex, Cursor, Copilot, Windsurf, Gemini CLI and more
npx skills add hanzhangzzz/agent-skills-zh                    # pick skills interactively
npx skills add hanzhangzzz/agent-skills-zh -s doc-reader -g   # install one skill globally
```

Then just talk to your agent. Every skill lists its trigger phrases (English and Chinese) in its `SKILL.md`, e.g. `/doc-reader <url>`, `format this for WeChat`, `tidy repo`, `do something useful`.

<a id="skills"></a>
## Skills

| Skill | What it does | Use when | Trigger |
| --- | --- | --- | --- |
| [doc-reader](./doc-reader/) | Translate an English article or PDF into Chinese section by section with consistent terminology, keep 100% of images, build a 3-column preview (original · translation · AI slides) | Reading long English blogs, papers and docs and wanting a faithful side-by-side Chinese version | `/doc-reader <URL or PDF>` |
| [scanned-book-ocr](./scanned-book-ocr/) | Local scanned PDF OCR → page-traceable text with deterministic concurrency checks and visual QA. 扫描书转文字，保留页码并校验质量 | Image-only books for AI reading; Apple Silicon macOS, Python 3.12+ | `$scanned-book-ocr` · `扫描 PDF 转文字` |
| [wechat-article-md-local](./wechat-article-md-local/) | Save a WeChat Official Account article as local Markdown with images downloaded | You receive an `mp.weixin.qq.com` link and want to archive, quote or analyze it | auto on `mp.weixin.qq.com` links |
| [xiaohongshu-downloader](./xiaohongshu-downloader/) | Download a Xiaohongshu (RedNote) video and transcribe the voice-over with Whisper into Markdown | You receive a Xiaohongshu video link and need the spoken content as text | auto on `xiaohongshu.com` / `xhslink.com` links |
| [x-article-download](./x-article-download/) | Download a tweet, a long-form X article or an entire account to Markdown | You receive an `x.com` link and want to archive or analyze it | auto on `x.com` links |
| [hkr-render](./hkr-render/) | WeChat publishing pipeline: Markdown → styled HTML (7 themes) → cover image → draft box, multi-article supported | Publishing WeChat Official Account articles | `format` · `排版` |
| [md2view](./md2view/) | Re-encode Markdown into a traceable two-column reading view (diagrams, flows, matrices) where every element is anchored to its source | Retrospectives, reports, specs and long docs that people need to absorb and share | `/md2view` |
| [gpt-image2-prompt-director](./gpt-image2-prompt-director/) | Turn a weak idea into a production-grade GPT image2 brief, with a built-in 40-case benchmark | Avatars, sticker packs, infographics, covers, posters, product shots, or repairing a drifting prompt | `$gpt-image2-prompt-director` |
| [repo-tidy](./repo-tidy/) | Git tidy-up + parallel-task base: back to latest master, prune merged branches/worktrees, `--new` opens a task branch (parallel worktree when busy); SessionStart hook injects repo status | Multi-repo, multi-task agent work where task branches pile up | `tidy repo` · `归位` · `开新任务` |
| [repo-map](./repo-map/) | Local repository map: self-healing index of all local git repos; a hook injects path + read/write role whenever a repo name is mentioned | Cross-repo references where the AI keeps asking for paths | `repo-map` · `仓库地图` |
| [harness](./harness/) | Minimal Harness Engineering: Inspector → Worker → Reviewer loop driven by a shared `TODO.md` | You want an agent to continuously inspect, fix and review a repo, on demand or on a schedule | `/harness` |
| [do-something](./do-something/) | Answer feedback, choose work backed by real value evidence, finish and verify a durable outcome, or return NO-OP. `do/*` auto-merge requires separate value and execution verdicts | An idle project where the agent may work unattended without manufacturing tasks to keep the loop busy | `/do-something` |
| [ci-review](./ci-review/) | Every PR/MR gets an execution verdict; configured bot branches also need a separate value verdict before deterministic auto-merge. Skill Markdown is reviewed as behavior code and failed verdicts are red checks | You want machine-verified execution, plus a value gate before unattended bot branches enter main | `/ci-review` |
| [git-push-guard](./git-push-guard/) | Hook-only plugin: intercepts direct pushes to `master`/`main`, asks for confirmation, per-repo allowlist | You let an agent commit and want shared-branch discipline enforced | auto on `git push` (plugin install only) |
| [hook-test-kit](./hook-test-kit/) | Behavior-matrix test scaffolding for Claude Code hooks — scratch fixtures, EMPTY/!-negation assertions, mutation-experiment finish. 给 hook 脚本补行为测试 | `/hook-test-kit` · 写了/改了 hook 要测试 |

## Gallery

Every image is a real output, or the skill's own real prompt text / board format — no mock-ups. Cards are in Chinese (the skills' native language); the layout is input on the left, output on the right.

<table>
<tr>
<td width="50%"><a href="./doc-reader/"><img src="./assets/readme/doc-reader-preview.jpg" alt="doc-reader three-column preview"></a><br><b>doc-reader</b> · English article → side-by-side Chinese + AI slides</td>
<td width="50%"><a href="./wechat-article-md-local/"><img src="./assets/readme/cards/wechat-article-md-local.png" alt="wechat-article-md-local real output"></a><br><b>wechat-article-md-local</b> · WeChat article → local Markdown</td>
</tr>
<tr>
<td><a href="./xiaohongshu-downloader/"><img src="./assets/readme/cards/xiaohongshu-downloader.png" alt="xiaohongshu-downloader output layout"></a><br><b>xiaohongshu-downloader</b> · Xiaohongshu video → transcript</td>
<td><a href="./x-article-download/"><img src="./assets/readme/cards/x-article-download.png" alt="x-article-download output layout"></a><br><b>x-article-download</b> · tweet / X article / whole account → Markdown</td>
</tr>
<tr>
<td><a href="./hkr-render/"><img src="./hkr-render/docs/gallery-preview.png" alt="hkr-render theme gallery"></a><br><b>hkr-render</b> · Markdown → WeChat layout (7 themes) → draft box</td>
<td><a href="./md2view/"><img src="./md2view/assets/demo-split.png" alt="md2view split reader"></a><br><b>md2view</b> · Markdown → traceable two-column reading view</td>
</tr>
<tr>
<td><a href="./gpt-image2-prompt-director/"><img src="./assets/readme/gpt-output-xhs-card.png" alt="gpt-image2-prompt-director real generation"></a><br><b>gpt-image2-prompt-director</b> · weak idea → production brief (real generation)</td>
<td><a href="./repo-tidy/"><img src="./assets/readme/cards/repo-tidy.png" alt="repo-tidy real output"></a><br><b>repo-tidy</b> · tidy up + open a task branch in one command</td>
</tr>
<tr>
<td><a href="./repo-map/"><img src="./assets/readme/cards/repo-map.png" alt="repo-map real injection"></a><br><b>repo-map</b> · mention a repo name, get its path and role injected</td>
<td><a href="./git-push-guard/"><img src="./assets/readme/cards/git-push-guard.png" alt="git-push-guard hook message"></a><br><b>git-push-guard</b> · asks before any direct push to master/main</td>
</tr>
<tr>
<td><a href="./harness/"><img src="./assets/readme/cards/harness.png" alt="harness TODO.md board"></a><br><b>harness</b> · Inspector → Worker → Reviewer board loop</td>
<td><a href="./do-something/"><img src="./assets/readme/cards/do-something.png" alt="do-something DO.md"></a><br><b>do-something</b> · unattended autonomous progress, merge to harvest</td>
</tr>
</table>

<a id="install"></a>
## Install

### 1. `npx skills` (any agent, recommended)

```bash
npx skills add hanzhangzzz/agent-skills-zh --list      # see what's inside
npx skills add hanzhangzzz/agent-skills-zh              # choose interactively
npx skills add hanzhangzzz/agent-skills-zh -s doc-reader -s md2view -g   # specific skills, user-level
npx skills update                                      # keep them fresh
```

### 2. Claude Code plugin marketplace (hooks auto-enabled)

```text
/plugin marketplace add hanzhangzzz/agent-skills-zh
/plugin install repo-tidy@agent-skills-zh        # + SessionStart repo-status hook
/plugin install repo-map@agent-skills-zh         # + UserPromptSubmit repo-map hook
/plugin install git-push-guard@agent-skills-zh   # hook-only: guard master/main
/plugin install doc-reader@agent-skills-zh       # ... and so on for any skill
```

One plugin = one skill: install, update (`/plugin update <name>@agent-skills-zh`) and uninstall each independently. Plugins with hooks work immediately, no `settings.json` edits.

### 3. Copy manually

```bash
git clone https://github.com/hanzhangzzz/agent-skills-zh.git
cp -r agent-skills-zh/doc-reader ~/.claude/skills/     # Claude Code
cp -r agent-skills-zh/doc-reader ~/.codex/skills/      # Codex
```

Notes:
- `repo-map` auto-injection and `repo-tidy` session status rely on Claude Code hooks; on Codex the commands still work, the automatic injection does not.
- `hkr-render` needs a `config.json` with your WeChat AppID/Secret before first use (see its `SKILL.md`).
- `doc-reader` slide generation uses the local Codex CLI's built-in imagegen: `codex` must be on `PATH` and logged in. Use `--no-ppt` to skip slides.

## Highlights

### doc-reader

One command turns an English technical article into a side-by-side Chinese edition: original on the left, section-level translation in the middle (consistent terminology, all images kept), and one AI knowledge-card slide per section on the right. Real output below, input was an Anthropic customer story:

![doc-reader three-column preview](./assets/readme/doc-reader-preview.jpg)

Slides are rendered by the local Codex CLI built-in imagegen — no image API key. The prompt was calibrated with a single-variable experiment: keeping visible Chinese characters under 250 per slide brought glyph errors from 2.5 per slide down to 0 (see [doc-reader/instructions.md](./doc-reader/instructions.md)).

![AI slide generated by doc-reader](./assets/readme/doc-reader-slide.jpg)

### hkr-render

Markdown in, WeChat-ready inline-style HTML out, with 7 themes tuned for dark mode and phone font sizes; optionally generate a cover and push to the draft box, several articles in one post:

![hkr-render theme gallery](./hkr-render/docs/gallery-preview.png)

### gpt-image2-prompt-director

Not a "style-word generator" — a creative director that first decides which visual artifact you actually need (avatar system, sticker pack, infographic, card, poster, product shot), then rewrites a weak input into a complete GPT image2 brief, and checks it against a 40-case benchmark with hard gates. Real generations from the same batch:

| Typography poster | Relic infographic |
| --- | --- |
| ![GPT image2 typography poster](./assets/readme/gpt-output-typography-poster.png) | ![GPT image2 relic infographic](./assets/readme/gpt-output-relic-infographic.png) |

```bash
cd gpt-image2-prompt-director
node scripts/eval_prompt_director.mjs --case-id 40 --prompt-file examples/readme-avatar-demo.md --fail-under 80 --strict
```

### md2view

![md2view split reader](./md2view/assets/demo-split.png)

`md2view` re-encodes a Markdown document instead of just styling it: it extracts the information structure and renders it as diagrams, flow chains, comparison matrices or annotated cards, while every element links back to the exact source passage. Markdown stays the source of truth for AI and git; the HTML is the human-facing projection. Details in [md2view/README.md](./md2view/README.md).

### harness

A lightweight autonomous loop: the Inspector reads the project and writes actionable tasks to `TODO.md`, the Worker claims and implements them with verification, the Reviewer checks diffs and results before anything is recorded. Run once, loop until nothing safe is left, or schedule it inside a Claude Code session.

### hook-test-kit

Behavior-matrix test scaffolding for Claude Code hooks (PreToolUse / SessionStart / UserPromptSubmit): scratch fixtures, JSON-over-stdin, an EMPTY/!-negation assertion protocol, and known bash pitfalls pre-fixed. Every suite finishes with a mutation experiment — break each interception rule, the suite must go red.

## Contributing

Each skill is a directory with a `SKILL.md` (YAML frontmatter: `name` = directory name, `description` = what + when to use, ≤1024 chars) plus optional `scripts/`, `references/`, `assets/`. No hard-coded paths. See [CLAUDE.md](./CLAUDE.md) for the full checklist, then open a PR — issues and skill requests are welcome.

If a skill saved you time, a ⭐ helps other people find it.

## License

[MIT](./LICENSE)
