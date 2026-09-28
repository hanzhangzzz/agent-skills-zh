---
name: launch-video
description: |
  为开源项目制作约 30 秒的发布宣传视频（1080p MP4，带配乐和音效）：痛点 → 亮相 → 原理 → 可核实的证据 → 安装命令。用 HTML 写动画，逐帧渲染后合成；产品画面来自真实录屏、真实输出和源码，配乐与音效由脚本合成，无第三方授权问题。用于“给项目做宣传视频”“发布视频”“launch video”“像 jevgrep 那样的介绍视频”“README/推文配视频”等请求。与 readme-craft 同属开源项目分发系列：README 负责让人试用，视频负责让人停下来看。不用于实拍剪辑、AI 生成视频或纯 GIF 录屏。
trigger: /launch-video
compatibility: Claude Code, Codex
license: MIT
---

# launch-video

把一个开源项目的核心价值压成约 30 秒的视频：观众看完知道它解决什么问题、怎么做到、凭什么信、怎么开始。画面由 HTML 动画按时间逐帧渲染，所以文字清晰、可反复修改、可重新生成。

同系列：`readme-craft` 写仓库首页。视频里的定位句、证据与安装命令应和 README 一致；README 过时或无法走通时先修 README。

## 0. 检查依赖（任一缺失即停止并告知）

```bash
node --version && ffmpeg -version | head -1 && python3 --version
```

在工作目录安装渲染依赖（只装一次）：

```bash
npm i -D playwright && npx playwright install chromium
```

已有 Chromium 时可设置 `CHROMIUM_PATH` 复用，免下载。

## 1. 取证：先找证据幕

读 README、包元数据、发布记录、源码入口、测试与已有案例，确定：

- **观众与痛点**：谁在什么场景遇到什么代价。
- **一句承诺**：项目名后面那一句，只强调一个词。
- **证据**：可复现的量化结果 > 真实产物 > 真实操作对比。证据与数字只取自可核实来源，并记下来源、版本、条件。
- **安装命令**：从 README 或发布页逐字复制，并核对当前发布版本（如 `npm view <pkg> version`）。
- **真实素材**：已有录屏、截图、导出文件；缺素材时实际运行项目录制，不画假界面。

没有任何可信证据时，明确告诉用户：视频只能展示真实操作过程，或建议先产出证据。不编数字。

## 2. 分镜

按 `references/storyboard.md` 的五幕结构写分镜表（幕、时间、标题、一句解释、画面素材及其来源、真实性标签）。用户未指定时默认：英文、16:9、30 秒、浅深交替、强调色取自产品主色。

方向或素材存在重大不确定（选哪个项目、面向哪个渠道、证据是否可用）时，先向用户确认；其余按默认推进。

## 3. 搭建工作目录

工作目录放在用户指定位置；未指定时放在项目仓库之外的运营/素材目录，或仓库内 `docs/media/launch-video/`。源 HTML 是视频的“源码”，与成片放在一起；`node_modules/` 与 `out/` 不入库。

```bash
mkdir -p <work>/assets && cd <work>
cp <skill>/assets/template.html promo.html
python3 <skill>/scripts/fetch_fonts.py --out fonts "Instrument Serif:ital@0;1" "Inter Tight:wght@400;500;600" "JetBrains Mono:wght@400;600"
```

`<skill>` 指本 SKILL.md 所在目录。

素材处理：

- 录屏转帧：`ffmpeg -i rec.mp4 -vf "fps=15,crop=W:H:X:Y" -q:v 3 assets/rec/%03d.jpg`，用模板的 `setFrame` / `preloadFrames` 播放。先抽一帧确认裁剪去掉了字幕条、系统信息与隐私内容。
- 截图与导出图复制进 `assets/`，文件名写清来源。

## 4. 写动画

在 `promo.html` 中按分镜替换全部大写占位符和 `.ph` 占位框：

- 保留引擎部分；在 `SCENES`、`STEPS`、`RENDER` 中写每幕动画。`render(t)` 必须是纯函数。
- 代码、字段名、输出格式照源码写；示意值要在画面上标注。
- 一幕一件事，标题 ≤ 8 个词。

动手前读 `references/pitfalls.md`。

## 5. 静帧检查 → 全片渲染

```bash
node <skill>/scripts/render.mjs --html promo.html --stills 1,3.5,6,9,13,17,22,29.9
node <skill>/scripts/render.mjs --html promo.html --out out/silent.mp4
```

逐张查看静帧：残影、溢出、占位符、文字可读性、深浅幕角标可见。`render.mjs` 报页面错误时必须修复，不能忽略。

## 6. 配乐与音效

在工作目录写 `cues.json`，把音效对齐到画面节点（点击、亮相、转场、状态出现、打字）；工具演示每 10 秒约 3–5 个，宁少勿密：

```json
{"bgm_gain": 0.5, "cues": [{"t": 4.6, "sfx": "reveal", "gain": 0.6}, {"t": 13.0, "sfx": "chime", "gain": 0.5}]}
```

内置音效：`click tick pop chime snap whoosh reveal type`。

```bash
python3 <skill>/scripts/mix.py --video out/silent.mp4 --cues cues.json --out out/<project>-launch.mp4
```

默认配乐由 `scripts/synth_audio.py` 按视频时长合成。用户有授权明确的音乐时用 `--music <file>` 替换；不要使用来源或授权不明的音频。

## 7. 验证

```bash
ffprobe -v error -show_entries stream=codec_type,width,height,r_frame_rate:format=duration -of compact out/<project>-launch.mp4
ffmpeg -v error -y -i out/<project>-launch.mp4 -vf "fps=1,scale=480:-1,tile=6x5" -frames:v 1 out/sheet.jpg
```

确认：有视频流和音频流、时长正确、每秒抽帧无残影与空白、首帧为第一幕、末帧停在安装画面。按 `references/pitfalls.md` 的自检清单逐条核对。音频的主观听感无法由脚本判断，交付时请用户试听。

## 输出

交付成片路径、源 HTML 与 `cues.json`、分镜摘要（每幕内容及素材来源）、真实性说明（哪些是真实录屏、哪些是示意）、验证结果，以及修改方式（改 HTML 或 cues 后重跑第 5、6 步）。

发布到 X、社区、README 或任何对外渠道，都需要用户对具体平台和内容的授权；未授权时只交付成片和建议文案。
