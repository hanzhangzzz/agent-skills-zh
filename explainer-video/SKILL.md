---
name: explainer-video
description: |
  一句话生成 1.5–2.5 分钟的中文知识讲解动画视频（1080p MP4，配乐 + 音效 + 字幕，无需旁白）。用"把一个日常瞬间放慢成一段旅程"的结构讲清一个原理：一个主角（一句话、一笔钱、一颗光子）走过 6–10 站，每站一个概念，顶部仪表（计时器 / 距离 / 年份）显示走到了哪。画面由 HTML/SVG 按时间逐帧渲染，粉彩玻璃风格、HUD、字幕、转场、音效和版面检查都由模板提供，只需写每个镜头的画面。用于"做个视频讲讲 X 是怎么工作的""你按下 X 之后发生了什么""科普动画""讲解视频""explainer video"等请求。不用于实拍剪辑、AI 生图生视频、开源项目发布片（用 launch-video）。
trigger: /explainer-video
compatibility: Claude Code, Codex
license: MIT
---

# explainer-video

输入一句话题目，产出一支能直接发的讲解动画。质量来自三样东西：**结构**（主角 + 旅程 + 仪表 + 回扣）、**每个镜头的画面密度**、**渲染前后的自动检查**。模板已经负责背景、HUD、字幕、转场、音效和版面检查，你只写镜头。

`<skill>` 指本 SKILL.md 所在目录。动手前读一遍 `references/exemplar.md`（范例拆解）和 `references/visuals.md`（概念 → 画面配方）。

## 0. 初始化（任一失败即停止并告知用户）

```bash
bash <skill>/scripts/init.sh <work>      # 检查 node / ffmpeg / python3，复制模板，安装 playwright
```

工作目录未指定时用当前目录下的 `explainer-<英文短名>/`。已有 Chromium 时先 `export CHROMIUM_PATH=<浏览器路径>` 再运行，免下载；之后所有渲染命令都在同一个环境变量下跑，在工作目录里执行。

## 1. 把题目变成一条旅程

在工作目录写 `PLAN.md`，先回答这五行，再往下做：

```
主角：观众一路跟着的那个具体东西（例：那句问题"天空为什么是蓝色的？"）
日常瞬间：钩子画面，观众 1 秒认出来的动作（例：输入框打字，按下回车）
仪表：一个单调增长、可显示在顶部的量（例：回车后 0.000 → 3.000 s）
站点：6–10 站，每站一个概念、主角在这一站的形态（例：打包加密 → 乱码；光纤 → 光脉冲；切分 → token 块）
回扣：结尾用题目答案本身做画面（例：背景变成蓝天）
```

题目不是“一瞬间”时，按 `references/exemplar.md` 第 5 节换仪表（天数、公里、尺度、年份）。

## 2. 事实表

在 `PLAN.md` 里为每站列 1–3 条事实和数字，写明来源或依据。拿不准的数字写量级（“几十到上百层”），示意值在画面上标“示意”。每站至少一个具体数字或具体名词，这是讲解片和空洞动画的区别。

## 3. 分镜表

在 `PLAN.md` 写镜头表，每行一个镜头：

| 镜头 id | 章节 | 时长 | 仪表起止 | 主视觉（含主角形态） | 动作（按字幕时刻） | 字幕 |

规则：

- 结构固定：钩子 6–8 s（无 HUD）→ 承诺 5–6 s（片名 + 仪表归零，无 HUD）→ 6–10 章，每章 1–3 个镜头 → 回扣 6–8 s → 片尾 4 s。总长 90–150 s。
- 每个讲解镜头 5–10 s，一个镜头最多两句字幕。
- 字幕一句 ≤ 24 字，停留 ≥ 字数 / 6 + 1 秒。它说“此刻发生了什么”，像对朋友讲。每章第一次出现的术语用 `「术语」` 包起来，模板会用章节色高亮。
- 仪表按真实值走，不必匀速：片子的时间按概念重要性分配，慢放倍数会自动算出来显示在右上角。
- 每个镜头按 `references/visuals.md` 的密度清单设计：主视觉 + 主角 + 1–3 个标注 + 一个持续运动。
- 每章至少一次主角跨镜头的 continuity cut（下一个镜头 `enter: 'cut'`）。

## 4. 写 shots.js

打开工作目录里的 `shots.js`（初始是 4 个镜头的示例），读懂后整个替换成你的镜头。API 见 `explainer.js` 文件头，要点：

```js
EX.chapter('pack', { name: '打包 · 加密', color: EX.C.blue });      // 按顺序声明章节
EX.shot({ id, chapter, dur, meter: [起, 止], caps: [[秒, '字幕']], sfx: [[秒, 'pop', 音量]],
          enter: 'dissolve' | 'cut', hud: true, html: `…`, init(el) {…}, render(el, u, d) {…} });
EX.run({ meter: { label: '回车后', unit: 's', decimals: 3, max: 3, ticks: [0, 1, 2, 3] }, mood: 'calm' });
```

- 画面里出现和仪表同义的数字（大字“第 N 天”、时钟）时，用 `EX.meterAt(t)` 取值（`t` 是 `render` 的第 4 个参数），不要另写一套数字，否则会和顶部仪表对不上。
- 仪表单位写 `s / ms / min / h / 天 / 年` 时，右上角自动显示“慢放 ×N”或“快进 ×N”；距离、层数这类非时间仪表不显示倍数。不想要倍数写 `rate: null`。
- 章节颜色依次取 `EX.C.blue / purple / pink / cyan / green / orange / red / indigo`，相邻章节不同色。
- 组件现成可用：`.card`（加 `.ring` 和 `--c` 描边）、`.tag`、`.tok`（含 `.id` 编号）、`.node > .ic`、`.bar`、`.t-hero / .t-h2 / .t-h3 / .t-body / .t-label`、`.code`、`.grad-text`、`svg.wire`；图标用 `ICON.名称`，不用 emoji。现有：`phone laptop server database cloud tower wifi router globe lock unlock key shield user users chip cpu doc chat search gear bolt clock check x arrow card qr bank store sun leaf drop heart eye brain layers box truck bell code sprout tree cup fire thermo ship plane factory pin mountain cart scale star atom dna cell battery money camera calendar`；缺的照 `icons.js` 的格式自己画（24×24、描边 2、1–4 条路径）。
- 运动：`EX.pop`（弹簧落定）、`EX.fadeUp`、`EX.place`（按中心定位）、`EX.drawPath`（路径生长）、`EX.num`（计数）、`EX.type`（打字），以及 `engine.js` 的 `spring springTrack expoOut cubic prog lerp clamp rng pulse dashFlow splitChars riseChars`。
- 音效名只有这 12 个：`click tick pop chime snap whoosh reveal type thud blip glitch drop`。
- 坐标有两套，别混：`class="abs"` + `style="left;top"` 是**左上角**；`EX.place(el, x, y)` 是**中心点**，并会覆盖 `transform`。同一个元素只用一种。
- 版面：内容只放在安全区 x 80–1840、y 180–900；上面是 HUD，下面是字幕。正文字号 ≥ 24 px，标签 ≥ 22 px。
- **尺寸给足**：一个镜头里所有内容合起来，至少占安全区宽度或高度的 60%，并且大致居中。常用尺寸：主卡片 1000–1300 × 420–560 px；节点图标 132 px，节点间距 ≥ 500 px；token 块字号 46–64 px；代码 34–40 px。宁大勿小，`--lint` 的 `SPARSE` / `OFF-CENTER` 会拦住太小和偏的画面。
- **骨架先立**：主视觉的骨架（全部节点、卡片外框、坐标轴、格子）在镜头开始 1 秒内全部出现；之后的时间用来让主角移动、状态变化、标注弹出。不要把骨架拆成整段镜头里逐个出现，否则镜头中段画面是半空的。
- `render` 必须是 `u` 的纯函数：不用 `Math.random`、`Date.now`、定时器、CSS animation/transition；随机用 `rng(seed)`，并在 `init` 里生成好。
- 示例就是合格标准，写镜头前先读：`shots.example.js` 四个镜头（钩子大输入框、片名环形计时器 + 粒子、乱码扫描、骨架先立的路径）；`gallery.example.js` 七种常用画法（剖面 + 引线标注、放大镜插图、仪表盘 + 数字卡、曲线图 + 标注、地图航线、时间轴里程碑、对比条），效果见 `<skill>/assets/gallery.jpg`。缺哪种画面就从里面拿最接近的改，尺寸、层次和动法照抄。插画用渐变分层（底色 + 内层 + 高光 + 柔阴影），不画单薄的细线稿。
- `EX.pop` 和 `EX.place` 都写 `transform`，同一个元素只用一个；要定位又要弹出，把 `spring(...)` 传给 `place` 的缩放参数。SVG 元素也能用：`place` 移动的是它的原点，所以形状围绕 (0, 0) 画。
- SVG 的 `id`（渐变、clipPath）全页共享，加镜头前缀（`eg-grad`、`gl-clip`）。恢复元素原色时写回颜色值，不要写 `style.color = ''`，那会退回默认深蓝。

**分批写，分批查**。每写完 2–3 章就跑一次第 5 步，修干净再写下一批。不要一次写完全片才第一次渲染。

## 5. 检查（每批都跑）

```bash
node --check shots.js                                                  # 先查语法，比渲染快
bash <skill>/scripts/fonts.sh <work>                                   # 文案变了就重跑
node <skill>/scripts/render.mjs --html index.html --stills shots --lint  # 每个镜头中点和结尾各一张静帧（会先清掉旧静帧）
ffmpeg -v error -y -pattern_type glob -i 'out/stills/t*.png' -vf "scale=640:-1,tile=4x6" -frames:v 1 out/sheet.jpg
```

`--lint` 打印两类问题，必须清零（退出码 0）才能进入下一步：

- `LINT`（版面）：`SPARSE` 画面太空或主视觉太小、`OFF-CENTER` 构图偏、`EMPTY` 什么都没画、`OFFSCREEN` 出画、`SMALL` 字太小、`WRAP` 短标签折成多行、`INVISIBLE` 文字透明（看不见）、`OVERLAP` 文字互相压住、`UNDER-CAP-PILL` / `UNDER-HUD-*` 被字幕或 HUD 挡住、`CLIPPED` 文字被裁。`SPARSE` 的修法是把主视觉放大、补上缺的部分，或把骨架提前到镜头开头，不是加装饰。构图只按每个镜头的中点帧判，镜头末尾变形缩小去接下一个镜头不算违规。
- `AUDIT`（节奏）：`CAPTION-LONG` / `CAPTION-FAST` 字幕太长或太快、`LONG` / `SHORT` 镜头时长不合理、`NO-TERM` 章节没命名术语、`METER-BACKWARDS` 仪表倒退、`DURATION` / `CHAPTERS` 总体规模不对。

页面报错（`PAGE ERRORS`）必须修。查某一帧里某个元素的状态，用渲染器直接求值，不要自己写浏览器脚本：

```bash
node <skill>/scripts/render.mjs --html index.html --at 37.2 --eval "document.querySelector('#pk-code').textContent"
```

能看图时用 Read 打开 `out/sheet.jpg`，逐格回答三个问题，有一个“否”就改：主视觉是否一眼能看出在讲什么？主角在不在？离开字幕，这一格画面本身是否有信息？lint 通过只说明没有硬伤，不说明好看；不要写“目检通过”就跳过。

## 6. 渲染与混音

```bash
node <skill>/scripts/render.mjs --html index.html --out out/silent.mp4
node <skill>/scripts/render.mjs --html index.html --cues-out cues.json      # 自动音效：换章 whoosh、叠化 tick，加上各镜头的 sfx
python3 <skill>/scripts/motion_check.py --video out/silent.mp4 --cues cues.json
python3 <skill>/scripts/mix.py --video out/silent.mp4 --cues cues.json --out out/<name>.mp4
```

`motion_check.py` 列出 ≥ 2 s 的静止段（`STILL`），逐个补持续运动（扫描线、光点流动 `dashFlow`、呼吸光晕 `pulse`、缓慢漂移），重渲后 `STILL` 为 0。2 分钟片子渲染约 3 分钟。

## 7. 验证与交付

```bash
ffprobe -v error -show_entries stream=codec_type,width,height:format=duration -of compact out/<name>.mp4
ffmpeg -v error -y -i out/<name>.mp4 -vf "fps=1/3,scale=480:-1,tile=6x8" -frames:v 1 out/contact.jpg
```

确认有视频流和音频流、1920×1080、时长与分镜一致、`--lint` 为 0。交付：

- 成片路径和 `out/contact.jpg`
- 一句话结构（主角 / 仪表 / 站点 / 回扣）和章节列表
- 事实表中哪些是确数、哪些是量级或示意
- 修改方式：改 `shots.js` 后重跑第 5、6 步

配乐由脚本合成，没有版权问题；音频听感无法自动判断，请用户试听。对外发布需要用户授权。
