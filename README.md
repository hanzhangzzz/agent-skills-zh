# agent-skills-zh

**中文** | [English](./README.en.md)

把读文档、整理内容、维护代码这些重复工作，交给能按步骤执行的 Agent 技能。

面向中文开发者，按需安装。这里有翻译、OCR、内容存档、文档可视化和仓库维护工具；每项的运行环境不同，先选你要完成的任务。

[![Skills](https://img.shields.io/badge/skills-15-blue)](#catalog)
[![Hook plugins](https://img.shields.io/badge/hook_plugins-1-purple)](#hooks)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

[选一个任务](#choose) · [完成第一次试用](#try) · [安装与环境](#install) · [完整目录](#catalog)

<a id="choose"></a>
## 你想完成什么？

| 你的任务 | 从这里开始 |
| --- | --- |
| 读懂英文文章、扫描书或长标准 | [文章翻译](./doc-reader/SKILL.md) · [扫描书 OCR](./scanned-book-ocr/SKILL.md) · [标准结构图](./pdf-triptych/SKILL.md) |
| 把文章、视频内容留到本地 | [公众号](./wechat-article-md-local/SKILL.md) · [小红书视频](./xiaohongshu-downloader/SKILL.md) · [X 内容](./x-article-download/SKILL.md) |
| 把已有内容变成可阅读、可发布的结果 | [双栏阅读视图](./md2view/SKILL.md) · [公众号排版](./hkr-render/SKILL.md) · [生图提示词](./gpt-image2-prompt-director/SKILL.md) |
| 管好 Agent 的代码工作 | [分支与工作树](./repo-tidy/SKILL.md) · [跨仓库定位](./repo-map/SKILL.md) · [自主推进](./do-something/SKILL.md) · [CI 审查](./ci-review/SKILL.md) |

不知道先试哪个？下面的提示词示例只需要你已有的 Agent，不需要图片生成权限或平台账号。

<a id="try"></a>
## 第一次试用：把一句想法变成生图提示词

**准备：** 已能正常使用 Claude Code 或 Codex；终端可用 Node.js、npm 和 Git。安装的是技能文件，不会替你安装宿主或开通模型服务。

在终端运行与你的 Agent 对应的一条命令：

```bash
# Claude Code
npx skills add hanzhangzzz/agent-skills-zh -s gpt-image2-prompt-director -a claude-code -g

# Codex
npx skills add hanzhangzzz/agent-skills-zh -s gpt-image2-prompt-director -a codex -g
```

安装完成后，新开一个 Agent 会话，粘贴：

```text
使用 gpt-image2-prompt-director：
我想做一个公众号个人头像：独立写作者，有辨识度，略男性化，
不要写实真人写真。请只输出可复制的生图提示词，先不要生成图片。
```

**应该得到：** 一份可复制的完整提示词，说明头像构图、视觉风格、圆形裁切、小尺寸可读性和要避免的元素，而非只有一串形容词。可对照仓库已有的[头像提示词示例](./gpt-image2-prompt-director/examples/readme-avatar-demo.md)；文字可以不同，约束应覆盖你的需求。

这一步产出文本。之后如需出图，再把提示词交给你可用的图片生成工具，费用和权限由该工具决定；提示词结构检查也不等于图片质量保证。

**没有生效？** 先运行 `npx skills list -g` 查看是否已安装到所选 Agent，再新开会话并明确点名技能。仍失败时，在 [Issue](https://github.com/hanzhangzzz/agent-skills-zh/issues/new) 中附 Agent 名称、安装命令和错误信息，去掉密钥与私人内容。

<a id="examples"></a>
## 可以得到什么结果？

下面是仓库保留的实际结果截图，可点击图片看大图。它们展示已有案例，不代表每种输入都已验证；安装前请看对应技能的依赖。

<!-- cards-gallery-start -->
### [doc-reader](./doc-reader/SKILL.md)

英文技术文章的原文、中文译文与 AI 幻灯片。仓库已有案例来自 [Anthropic 客户文章](https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude)；幻灯片需要额外生图权限，也可用 `--no-ppt` 跳过。

[![doc-reader](./assets/readme/doc-reader-preview.jpg)](./assets/readme/doc-reader-preview.jpg)

### [md2view](./md2view/SKILL.md)

仓库既有双栏阅读器示例：左侧保留原文，右侧重组信息，并通过来源锚点对照。截图展示阅读方式；内容完整性仍需人工复核。

[![md2view](./md2view/assets/demo-split.png)](./md2view/assets/demo-split.png)
<!-- cards-gallery-end -->

<a id="install"></a>
## 安装与运行环境

### 安装单项技能

```bash
# 只列出技能，不安装
npx skills add hanzhangzzz/agent-skills-zh --list

# 选择技能与 Agent；默认安装到当前项目
npx skills add hanzhangzzz/agent-skills-zh

# 示例：只给 Codex 全局安装文档翻译；Claude Code 用 -a claude-code
npx skills add hanzhangzzz/agent-skills-zh -s doc-reader -a codex -g
```

`-g` 表示跨项目使用；省略则安装到当前项目。更新用 `npx skills update`，它会检查已安装的技能。更多参数见 [skills CLI](https://github.com/vercel-labs/skills)。

**能被安装，不等于全部功能都能运行。** `npx skills` 分发技能文件，不会注册本仓的 hook、安装 Python/视频工具或配置平台账号。Claude Code 与 Codex 的调用方式也可能不同，优先直接说出技能名称与任务，不把 `/命令` 当成所有宿主都支持的接口。其他 Agent 尚未做本仓全量运行验证。

<a id="hooks"></a>
### 需要 hook 的功能

Claude Code 可通过插件市场安装带 hook 的插件：

```text
/plugin marketplace add hanzhangzzz/agent-skills-zh
/plugin install git-push-guard@agent-skills-zh
/plugin install repo-map@agent-skills-zh
/plugin install repo-tidy@agent-skills-zh
```

按需选其中一项。`git-push-guard` 是纯 hook 插件，不会出现在 `npx skills ... --list` 的技能清单里。`repo-map` 的自动注入依赖 Claude Code hook；手动查询仍可独立使用。

`repo-tidy` 的 marketplace 配置只注册仓库状态 hook；它另外提供面向 Claude Code 与 Codex 的安装脚本，用于状态、会话目录等集成。完整能力及环境检查见 [repo-tidy 安装说明](./repo-tidy/SKILL.md#安装)，不要把插件安装成功当作所有 hook 已启用。

其他技能也可通过 `/plugin install <技能名>@agent-skills-zh` 单独安装。技能正文、脚本和 hook 的运行条件见下表。

<details>
<summary>手动复制（首次安装，Claude Code 示例）</summary>

先克隆仓库并进入目录：

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

最后一行成功退出表示文件层级正确；再新开会话点名使用。手动复制不会注册 hook，也不受 `npx skills update` 管理。其他 Agent 推荐使用上面的 `-a` 安装方式。

</details>

<a id="catalog"></a>
## 完整目录与使用条件

点击名称直达执行说明。以下依赖不随技能文件自动安装；模型调用会使用你的宿主或 API 额度。

| 技能 / 插件 | 得到什么 | 使用条件与限制 |
| --- | --- | --- |
| [doc-reader](./doc-reader/SKILL.md) | 英文网页/PDF → 中文译文与对照预览 | Python 与抓取依赖；生图另需已登录且可使用 imagegen 的 Codex CLI，`--no-ppt` 可跳过。图片下载失败时保留原链接 |
| [scanned-book-ocr](./scanned-book-ocr/SKILL.md) | 扫描 PDF → 带页码的文本与校验记录 | Apple Silicon macOS、Python 3.12+、pdftoppm、OCR 模型；结果需抽检 |
| [pdf-triptych](./pdf-triptych/SKILL.md) | 标准/规范 PDF → 骨架、细节、例子三联图 | 可读取的 PDF、全文理解与浏览器渲染检查；不是普通 OCR |
| [md2view](./md2view/SKILL.md) | Markdown → 原文与重组视图的双栏 HTML | Python 3、模型与浏览器检查；来源锚点便于复核，不保证语义无遗漏 |
| [wechat-article-md-local](./wechat-article-md-local/SKILL.md) | 单篇公众号文章 → 本地 Markdown 与图片 | Node.js、Python 依赖、Chrome；脚本可安装本地 npm 依赖，受文章可访问性限制 |
| [xiaohongshu-downloader](./xiaohongshu-downloader/SKILL.md) | 小红书视频 → 视频文件与口播稿 | yt-dlp、ffmpeg、Whisper；受链接访问与平台限制，转录需复核 |
| [x-article-download](./x-article-download/SKILL.md) | 推文/文章/账号内容 → 本地 Markdown | 浏览器；批量路径需 xreach，视频需 yt-dlp/Whisper；部分内容需要登录 |
| [hkr-render](./hkr-render/SKILL.md) | Markdown → 公众号 HTML、可选封面与草稿 | 排版可独立使用；推草稿另需 AppID/Secret、相应 API 权限及 IP 白名单 |
| [gpt-image2-prompt-director](./gpt-image2-prompt-director/SKILL.md) | 想法 → 生图提示词 | 文本编写只需 Agent；内置评测需 Node.js，实际生图另需图片工具 |
| [repo-tidy](./repo-tidy/SKILL.md) | 安全准备分支/工作树，保留未证实合并的工作 | Git、Python 3；hook 与终端增强功能需单独配置 |
| [repo-map](./repo-map/SKILL.md) | 仓库名 → 本地路径与读写角色 | Python 3、本地仓库索引；自动注入需 Claude Code hook |
| [do-something](./do-something/SKILL.md) | 根据证据完成一项有效改进，或明确 NO-OP | Git 与可运行验证的 Agent；定时执行需另配调度，MR 模式需单独启用 |
| [harness](./harness/SKILL.md) | 巡检、修复、复审共用 TODO 看板 | 脚本通过 `claude -p` 运行，需 Claude Code CLI；定时模式需相应调度能力 |
| [ci-review](./ci-review/SKILL.md) | PR/MR 执行审查，机器人分支额外审价值 | GitHub/GitLab CI、凭据与模型服务；自动合并需显式开启；会改变行为的 Markdown 同样审查 |
| [hook-test-kit](./hook-test-kit/SKILL.md) | Claude Code hook 的行为测试骨架 | Bash 与待测 hook；生成后需运行测试及变异检查 |
| [git-push-guard](./git-push-guard/README.md) | 对 Agent 直推 main/master 请求确认 | Claude Code 纯 hook 插件；不是 Git 服务端保护，也不拦截所有终端操作 |

## 反馈与贡献

使用失败、缺少场景或想贡献技能，欢迎提 [Issue](https://github.com/hanzhangzzz/agent-skills-zh/issues) / [PR](https://github.com/hanzhangzzz/agent-skills-zh/pulls)。反馈请带上使用的技能、宿主/系统、脱敏输入、预期结果与实际错误。

开发规则见 [AGENTS.md](./AGENTS.md)，机器索引见 [MARKETPLACE.md](./MARKETPLACE.md)。在仓库根目录运行 `bash .github/scripts/run_behavior_tests.sh`，覆盖行为测试与市场登记校验；这些检查不替代模型质量和真实平台验证。

[流程与输出格式卡片](./assets/readme/cards-src/index.html) 是说明材料，不是运行截图；在本地浏览器打开该 HTML 查看。维护者修改 `cards.json` 后运行 `build_cards.py` 和 `build_gallery.py`，中英文首页使用同一组案例来源。

[MIT License](./LICENSE)。如果某项技能帮你完成了真实任务，欢迎分享你的使用场景。
