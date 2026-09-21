# agent-skills-zh

[中文](./README.md) | **English**

Agent skills for reading documents, saving content, and maintaining code, with workflows designed for Chinese-speaking developers.

Install only what you need. Each skill has its own runtime requirements; choose a task before choosing an installation method.

[![Skills](https://img.shields.io/badge/skills-15-blue)](#catalog)
[![Hook plugins](https://img.shields.io/badge/hook_plugins-1-purple)](#hooks)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

[Choose a task](#choose) · [Try one skill](#try) · [Installation](#install) · [Full catalog](#catalog)

<a id="choose"></a>
## What do you want to do?

| Your task | Start here |
| --- | --- |
| Read English articles, scanned books, or long standards | [Translate an article](./doc-reader/SKILL.md) · [OCR a book](./scanned-book-ocr/SKILL.md) · [Map a standard](./pdf-triptych/SKILL.md) |
| Keep online content locally | [WeChat](./wechat-article-md-local/SKILL.md) · [Xiaohongshu video](./xiaohongshu-downloader/SKILL.md) · [X content](./x-article-download/SKILL.md) |
| Turn content into something readable or publishable | [Split reading view](./md2view/SKILL.md) · [WeChat layout](./hkr-render/SKILL.md) · [Image prompt](./gpt-image2-prompt-director/SKILL.md) |
| Manage an agent's coding work | [Branches and worktrees](./repo-tidy/SKILL.md) · [Repository lookup](./repo-map/SKILL.md) · [Autonomous progress](./do-something/SKILL.md) · [CI review](./ci-review/SKILL.md) |

Not sure where to start? The text-only example below uses your existing agent without image-generation access or a platform account.

<a id="try"></a>
## First try: turn an idea into an image prompt

**Requirements:** a working Claude Code or Codex session, plus Node.js, npm, and Git in your terminal. Installing skill files does not install the agent or grant model access.

Run the command for your agent:

```bash
# Claude Code
npx skills add hanzhangzzz/agent-skills-zh -s gpt-image2-prompt-director -a claude-code -g

# Codex
npx skills add hanzhangzzz/agent-skills-zh -s gpt-image2-prompt-director -a codex -g
```

Open a new agent session and paste:

```text
Use gpt-image2-prompt-director.
I need a distinctive WeChat profile avatar for an independent writer,
slightly masculine, without a photorealistic portrait.
Return only a complete, copyable image prompt. Do not generate an image yet.
```

**Expected result:** a complete prompt covering composition, visual style, circular cropping, small-size readability, and things to avoid—not just adjectives. Compare it with the existing [avatar prompt example](./gpt-image2-prompt-director/examples/readme-avatar-demo.md) (Chinese); wording can vary, but it should address your constraints.

This step produces text. To make an image, use an image tool you already have access to; its permissions and pricing apply. Passing a prompt-structure check does not guarantee image quality.

**Not working?** Run `npx skills list -g` to check installation for your selected agent, start a new session, and explicitly name the skill. If it still fails, [open an issue](https://github.com/hanzhangzzz/agent-skills-zh/issues/new) with the agent, installation command, and error. Remove secrets and private content.

<a id="examples"></a>
## Example results

These are existing output screenshots stored in this repository. Click an image for the full-size version. They demonstrate individual cases, not validation of every input; check each skill's dependencies before installing.

<!-- cards-gallery-start -->
### [doc-reader](./doc-reader/SKILL.md)

Original article, Chinese translation, and AI slides from an existing [Anthropic customer article](https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude) example. Slides require image-generation access; `--no-ppt` skips them.

[![doc-reader](./assets/readme/doc-reader-preview.jpg)](./assets/readme/doc-reader-preview.jpg)

### [md2view](./md2view/SKILL.md)

An existing split-reader example: source text on the left, reorganized information on the right, connected by source anchors. The screenshot shows the reading layout; content completeness still needs review.

[![md2view](./md2view/assets/demo-split.png)](./md2view/assets/demo-split.png)
<!-- cards-gallery-end -->

<a id="install"></a>
## Installation and runtime requirements

### Install individual skills

```bash
# Discover skills without installing
npx skills add hanzhangzzz/agent-skills-zh --list

# Choose skills and agents; project-level by default
npx skills add hanzhangzzz/agent-skills-zh

# Example: install doc-reader globally for Codex; use -a claude-code for Claude Code
npx skills add hanzhangzzz/agent-skills-zh -s doc-reader -a codex -g
```

`-g` makes the skill available across projects; omit it for a project installation. `npx skills update` checks your installed skills for updates. See the [skills CLI](https://github.com/vercel-labs/skills) for more options.

**Installable does not mean every feature can run.** `npx skills` distributes skill files; it does not register this repository's hooks, install Python/video tools, or configure platform accounts. Invocation also varies by agent: explicitly name the skill and task rather than assuming every host supports `/commands`. This repository has not been fully tested across other agents.

<a id="hooks"></a>
### Features that need hooks

Claude Code can install hook integrations through the plugin marketplace:

```text
/plugin marketplace add hanzhangzzz/agent-skills-zh
/plugin install git-push-guard@agent-skills-zh
/plugin install repo-map@agent-skills-zh
/plugin install repo-tidy@agent-skills-zh
```

Choose only the plugins you need. `git-push-guard` is hook-only and is absent from `npx skills ... --list`. Automatic `repo-map` injection uses a Claude Code hook; manual lookup works independently.

The `repo-tidy` marketplace entry registers only its repository-status hook. A separate installer supports Claude Code and Codex integrations for status and session directories. See [repo-tidy installation](./repo-tidy/SKILL.md#安装) for its full setup and environment checks; plugin installation alone does not enable every hook.

Other skills can also be installed individually with `/plugin install <skill-name>@agent-skills-zh`. Runtime requirements still apply.

<details>
<summary>Manual copy (first installation, Claude Code example)</summary>

Clone the repository and enter it:

```bash
git clone https://github.com/hanzhangzzz/agent-skills-zh.git
cd agent-skills-zh
```

<!-- manual-install-start -->
```bash
mkdir -p ~/.claude/skills/doc-reader
cp -R doc-reader/. ~/.claude/skills/doc-reader/
test -f ~/.claude/skills/doc-reader/SKILL.md
```
<!-- manual-install-end -->

The final command verifies the file layout. Start a new session and explicitly name the skill. Manual copies do not register hooks and are not managed by `npx skills update`; use `-a` above for other agents.

</details>

<a id="catalog"></a>
## Full catalog and requirements

Names link directly to instructions. Dependencies below are not automatically installed with skill files. Model calls consume your agent or API allowance.

| Skill / plugin | Result | Requirements and limits |
| --- | --- | --- |
| [doc-reader](./doc-reader/SKILL.md) | English article/PDF → Chinese translation and preview | Python and fetch dependencies; slides also need a logged-in, imagegen-capable Codex CLI. `--no-ppt` skips slides; failed image downloads retain source links |
| [scanned-book-ocr](./scanned-book-ocr/SKILL.md) | Scanned PDF → page-traceable text and checks | Apple Silicon macOS, Python 3.12+, pdftoppm, OCR models; spot-check results |
| [pdf-triptych](./pdf-triptych/SKILL.md) | Standard/spec PDF → skeleton, detail, example triptych | Readable PDF, full-text reasoning, browser rendering checks; not general OCR |
| [md2view](./md2view/SKILL.md) | Markdown → source and reorganized view in one HTML | Python 3, a model, and browser checks; anchors aid verification, not proof of semantic completeness |
| [wechat-article-md-local](./wechat-article-md-local/SKILL.md) | One WeChat article → local Markdown and images | Node.js, Python dependencies, Chrome; wrapper can install local npm dependencies; article must be accessible |
| [xiaohongshu-downloader](./xiaohongshu-downloader/SKILL.md) | Xiaohongshu video → video and transcript | yt-dlp, ffmpeg, Whisper; platform/access limits apply; review transcription |
| [x-article-download](./x-article-download/SKILL.md) | Tweets/articles/account content → local Markdown | Browser; batch path needs xreach, video needs yt-dlp/Whisper; some content requires login |
| [hkr-render](./hkr-render/SKILL.md) | Markdown → WeChat HTML, optional cover and draft | Formatting works independently; draft upload needs AppID/Secret, API permissions, and IP allowlisting |
| [gpt-image2-prompt-director](./gpt-image2-prompt-director/SKILL.md) | Idea → image-generation prompt | Text writing needs an agent; evaluator needs Node.js; actual images need a separate image tool |
| [repo-tidy](./repo-tidy/SKILL.md) | Prepare branches/worktrees while retaining unverified work | Git, Python 3; hooks and terminal integrations need separate setup |
| [repo-map](./repo-map/SKILL.md) | Repository name → local path and access role | Python 3, local repository index; automatic injection needs a Claude Code hook |
| [do-something](./do-something/SKILL.md) | Complete an evidence-backed improvement or return NO-OP | Git and a verification-capable agent; scheduling and MR mode require separate setup |
| [harness](./harness/SKILL.md) | Inspect, implement, and review through a TODO board | Scripts use `claude -p`, requiring Claude Code CLI; scheduled mode needs a scheduler |
| [ci-review](./ci-review/SKILL.md) | Execution review for PRs/MRs, plus value review for bot branches | GitHub/GitLab CI, credentials, model service; auto-merge is opt-in; behavioral Markdown is reviewed too |
| [hook-test-kit](./hook-test-kit/SKILL.md) | Behavior-test scaffolding for Claude Code hooks | Bash and a hook to test; run the generated tests and mutation checks |
| [git-push-guard](./git-push-guard/README.md) | Ask before an agent pushes directly to main/master | Claude Code hook-only plugin; not server-side protection or a guard for every terminal command |

## Feedback and contributing

[Issues](https://github.com/hanzhangzzz/agent-skills-zh/issues) and [pull requests](https://github.com/hanzhangzzz/agent-skills-zh/pulls) are welcome. Include the skill, agent/OS, sanitized input, expected result, and actual error.

See [AGENTS.md](./AGENTS.md) for development rules and [MARKETPLACE.md](./MARKETPLACE.md) for the registry. Run `bash .github/scripts/run_behavior_tests.sh` from the repository root for behavior and marketplace checks; they do not replace model-quality or live-platform validation.

[Workflow and output-format cards](./assets/readme/cards-src/index.html) are explanations, not screenshots; open the HTML locally to view them. Maintainers should edit `cards.json`, then run `build_cards.py` and `build_gallery.py`. Both homepages use the same example sources.

[MIT License](./LICENSE). If a skill helps you finish a real task, share how you used it.
