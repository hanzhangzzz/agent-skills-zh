---
name: explainer-video
description: |
  一句话生成 1–1.5 分钟、有电影感的中文知识短片（1080p MP4，配乐 + 环境声 + 音效 + 字幕，无需旁白）。默认电影模式：一帧一个发光主体、大片留白、光是主角（辉光、光斑、拖尾、粒子流场、焦散、体积雾）、真实素材做写实、一个视觉隐喻讲清一个原理，几个长镜头由相机变速推拉摇移，卡音乐节拍。风格从 59 种实测风格库（Lemo Opuscar）按题材挑；画面由 HTML/Canvas/WebGL/three.js 按时间逐帧渲染，导演流程含 treatment、双方向关键帧、拼图打分、15 秒样片。需要逐步教学时可用讲解模式（信息图、HUD 仪表、6–10 章）。用于"做个视频讲讲 X 是怎么回事""科普短片""讲解视频""explainer video"等请求。不用于实拍剪辑、AI 生图生视频、开源项目发布片（用 launch-video）。
trigger: /explainer-video
compatibility: Claude Code, Codex
license: MIT
---

# explainer-video

输入一句话题目，产出一支能直接发、让人想转发的知识短片。质量来自五样东西：**一个视觉隐喻**（不靠标签也看得懂）、**光**（一帧一个发光主体，质感来自光和真实素材）、**美术指导**（一种视觉语言，从风格库挑）、**镜头与声音**（几个长镜头、变速运镜、卡拍子、三层声音）、**导演评审**（拼图打分、15 秒样片、渲染前后的自动检查）。模板已经负责字幕、相机、转场、音效、混音和版面检查，你只写世界和镜头。

`<skill>` 指本 SKILL.md 所在目录。动手前读一遍 `references/directing.md`（导演方法：简报、treatment、两个方向的关键帧、声音、评审打分、15 秒样片）和 `references/worlds.md`（先读开头的“电影模式 / 讲解模式”对照表和“什么会让片子像复古 Flash”，再看美术指导卡、效果 → 技术表、真实素材、运镜）。电影模式的标准示例是 `assets/moon.example.js`（效果 `assets/moon.jpg`）；数据艺术 / 粒子流题材（信息、推荐、网络、社会现象）的标准例子是 `assets/cocoon/`（《信息茧房是怎么织成的》完整工程：横版、9:16 竖版、3:4 封面、为片子写的配乐，`world.js` 文件头有技法索引，效果 `assets/cocoon.jpg`）。讲解模式另读 `references/explainer-mode.md`、`exemplar.md`、`visuals.md`。

省上下文的读法：`explainer.js` 和 `engine.js` 只读文件头注释（API 都在那里，各约 50 行），不要通读。`gallery.example.js` 有 57 KB，先 `grep -n "^/\* [0-9]" gallery.example.js` 看七个镜头的起始行，再用 `sed -n '<起>,<止>p'` 只读要用的那一段。

## 0. 初始化（任一失败即停止并告知用户）

```bash
bash <skill>/scripts/init.sh <work>      # 检查 node / ffmpeg / python3，复制模板，安装 playwright
```

工作目录未指定时用当前目录下的 `explainer-<英文短名>/`。已有 Chromium 时先 `export CHROMIUM_PATH=<浏览器路径>` 再运行，免下载；之后所有渲染命令都在同一个环境变量下跑，在工作目录里执行。

## 1. 简报与 treatment

能和用户对话时，按 `directing.md` 第 1 节用一条消息问完再开工；一句话、无人值守时不问，用默认值，并在 `PLAN.md` 写明替用户做了哪些决定。

**用户给了参考片时，参考片就是验收标准**，压过本 skill 的所有默认风格（`directing.md` 第 1b 节）：先抽帧并原尺寸裁切看细节，写进美术指导卡；之后每次给用户看画面前，用 `scripts/refcompare.py` 并排比一次。

在工作目录写 `PLAN.md`。先按 `directing.md` 第 2 节写 treatment：三个候选结构和选择、一句话梗概与转折、1–2 部对标作品（学什么 / 不学什么）、一个只有这种媒介能做的动作。**这些写在打开任何示例代码之前**，否则会不自觉地照抄示例。然后回答下面几行：

```
一句话：这支片子让观众带走的那一句（例：月亮的自转被地球的潮汐刹慢，直到和公转一样长）
视觉隐喻：用哪一个画面讲清它，不需要标签也看得懂（例：月面指针的发光拖尾从套圈收成正圆）
主体：每一镜的发光主体，全片同一个或一条形态链（例：一颗种子 → 一颗樱桃 → 一粒豆 → 一杯咖啡里的光）
风格：从风格库挑（见下），列 3 个候选，写明选哪个、为什么
美术指导：照 worlds.md 的“美术指导卡”写全 8 行；选了风格库的风格时，美术指导就是它 STYLE.md 的不变量
光：每一镜用哪一种光或物理现象（辉光、光斑、拖尾、流场、焦散、体积雾、透光），对应 light.js 的哪个函数
招牌镜头：1–2 个让人想截图转发的画面（尺度揭示、一镜到底、“这怎么做到的”）
参考片拆解：（用户给了参考片时必填，它压过上面的“风格”和“光”）原尺寸裁切看到的线宽与密度、有无辉光、主体多大、是否被画框裁切、文字是装饰还是信息、调色；之后每轮 refcompare 的结论
流速与数量：观众要跟住的元素屏幕速度多少（≤ 约 1000 px/s）；数量曲线（例：几条能逐条看清 → 指数涨到洪流 → 特写放慢变稀）；因果怎么一条一条看得见（directing.md 第 5b 节）
爆点：第几秒；怎么蓄力（子弹时间）→ 冲击 → 释放 → 连锁；声音怎么配（第 8b 节）
落点：转折之后 6–9 s 画面怎么延续、收束字幕是哪句、片名卡怎么出（第 8c 节）
配乐表：每段画面音乐做什么，用 score_kit 写，audio_check 验起伏（第 4b 节的表）
其他画幅：要不要竖版 / 封面；要的话从一开始就把世界写进 world.js，尺寸和相机由页面传入（第 8 节）
```

**模板里每一行都要填**：漏掉的行就是会失败的地方（实测：只填前 7 行的规划，做出来是没有爆点、结尾突兀、配乐只是循环底、风格偏离参考片的片子）。

**默认是电影模式**（`worlds.md` 开头的对照表）：一帧一个发光主体、大片留白或暗场、画面上最多一行字、不显示 HUD、5–8 个长镜头、60–90 s，质感来自光（`light.js`）和真实素材。选什么风格都按电影模式的构图拍：水彩也可以是一张纸上只有一颗被光照亮的樱桃。只有用户要一步一步的教学讲解，或题目必须靠很多标注才讲得清时，才改用讲解模式，按 `references/explainer-mode.md` 写旅程和分镜。

**风格库**：`bash <skill>/scripts/styles.sh list` 列出 59 种经过实测的代码影片风格，来自 Lemo Opuscar（MIT），首次运行会下载到本机缓存，约 40 MB。每行是“名字 · 一句话本质 · 海报路径”。

1. 按题材挑 3 个候选，用 Read 看它们的海报。
2. 选定后通读那份 `STYLE.md`：材质与渲染、配色、字体与字幕、运动、镜头语法、声音、原生动作、坑。它的规则就是本片的不变量。
3. 写完 treatment 之后，需要它的技法时运行 `styles.sh demo <名字>`，读 `DEMO.md` 和引擎代码，学笔刷、纸纹、着色器和后期的写法，不抄它的故事和镜头。它的 demo 是一个整页 `render(t)` 画布，本框架是一个个镜头加 HUD 和字幕：把引擎放进 `EX.backdrop` 或镜头里的 canvas，字幕和 HUD 的 CSS 按它第 4 节的字体规则改写。
4. **不要默认选 3D**。3D 只在题材本身是几何体，或者用一种把几何美化的 3D 风格时才选（`worlds.md` 的“3D 分三档”）。

范例的粉彩信息图是保底，不是默认答案：题目有实体、有路线、跨尺度、讲历史或讲数据时，选更贴题材的世界（`worlds.md` 第 2 节写了每种世界的搭法、技法和坑）。`assets/cinema.jpg` 只是 three.js 写法的示例，不是默认风格。所有世界共用同一套 HUD、字幕、仪表和检查；非粉彩世界用 `chrome: 'cinema'`（无框 HUD 和字幕）。

## 1b. 证明画风

按 `directing.md` 第 3 节，用真的绘图代码做两个方向，美术指导要真的不同，每个方向一张关键帧，最好就是招牌镜头。能对话就让用户选；无人值守就按第 6 节的评分表给两张打分，选高的，把分数写进 `PLAN.md`。选定后再往下做。静帧看不出流速和节奏：给用户看时附一段 30–45 s 的无声 demo（`--range a:b`，`--subframes 1`），给 mp4 路径。

## 2. 事实表

在 `PLAN.md` 里为每站列 1–3 条事实和数字，写明来源或依据。拿不准的数字写量级（“几十到上百层”），示意值在画面上标“示意”。每站至少一个具体数字或具体名词，这是讲解片和空洞动画的区别。

题目有流行的错误解释时（升力的“等时间到达”、四季的“离太阳远近”），在事实表里写一行“误解：哪一步推理错了 / 结论里哪部分其实是对的”。片子只否定错的那一步，不要连带否定对的结论。

## 3. 分镜表（电影模式）

在 `PLAN.md` 写镜头表，每行一个镜头：

| 镜头 id | 时长（拍） | 光 / 物理现象 | 发光主体 | 景别 · 镜头运动 · 为什么 | 画面上唯一的字（可无） | 字幕（≤ 1–2 句） | 声音（环境 / 拟音 / 音乐状态） |

再写节拍表（bpm、每镜几拍、切点和高潮落在哪一拍）和声音设计表（`directing.md` 第 4 节）。

规则：

- **少而精**：默认 45–60 s、3–5 个镜头。精细度来自每个镜头被认真看过的次数，不来自镜头数量（`directing.md` 第 6b 节）。优先**一个世界、一镜到底**：精细的场景只搭一次，在里面拍多个时刻，细节成本被摊薄。
- 结构：钩子 ≤ 3 s 就出现主体 → 2–3 个镜头推进，至少一次尺度揭示或一镜到底 → 高潮镜头（音乐最满或安静后的第一个重音）→ 回扣开头的画面。`--lint` 在 45 s 以下或 100 s 以上报 `DURATION`；每镜 6–16 s（短于 3 s 报 `SHORT`，长于 16 s 报 `LONG`）。
- `EX.run({ composition: 'cinema', chrome: 'cinema', theme: …, rate: null })`，所有镜头 `hud: false`；章节只用来分段，不显示。
- 一帧一个发光主体，≥ 50% 是留白或暗场。画面上除字幕外最多一行字（`--lint` 报 `CLUTTER`：超过 40 个字）；数字只出现最关键的那一个，做成大字。
- 讲清楚靠视觉隐喻 + 字幕的一句话，不靠标签。观众离开字幕，也能从画面看出“发生了什么变化”。
- 字幕一句 ≤ 24 字，停留 ≥ 字数 / 6 + 1 秒，全片 10–20 句；术语用 `「术语」` 包起来高亮。
- 每镜一种光或物理现象，镜头少而长，镜头内要有运动（推、拉、环绕、跟随、焦点转移），镜头之间用媒介里的转场（光收暗再亮起、穿过主体、形态变换），不用默认叠化。
- 用 `const B = EX.tempo(bpm)` 定拍子，镜头时长和高潮落在整拍上；至少一次 `hush` 安静后接全片最重要的声音。
- **观众要能跟住一个元素**：0.1 s 间隔的两帧里，同一个元素认得出来、位移 ≤ 约 100 px。讲“逐渐形成”的题目，数量要有曲线（几条 → 洪流 → 特写放慢），因果一条一条看得见（`directing.md` 第 5b 节）。
- **一个爆点**：全片选一个时刻（通常是尺度揭示）做足：子弹时间蓄力 → 冲击（回弹、冲击波、闪白、震屏）→ 释放 → 连锁点亮，声音同步（`directing.md` 第 8b 节）。
- **转折后留 6–9 s 落点**：延续新状态、一句收束字幕、先压暗再出片名卡、音乐长尾。转折就结束会显得突然（第 8c 节）。

## 4. 写 shots.js

打开工作目录里的 `shots.js`（初始是 4 个镜头的示例），读懂后整个替换成你的镜头。API 见 `explainer.js` 文件头，要点：

```js
EX.chapter('pack', { name: '打包 · 加密', color: EX.C.blue });      // 按顺序声明章节
EX.shot({ id, chapter, dur, meter: [起, 止], caps: [[秒, '字幕']], sfx: [[秒, 'pop', 音量]],
          enter: 'dissolve' | 'cut', hud: true, html: `…`, init(el) {…}, render(el, u, d) {…} });
EX.run({ meter: { label: '回车后', unit: 's', decimals: 3, max: 3, ticks: [0, 1, 2, 3] }, mood: 'calm' });
```

世界与相机（详见 `explainer.js` 文件头和 `world.example.js`）：

```js
EX.world({ html, init(el), render(el, t) })     // 常驻的世界层（整条路、地图、地景），世界坐标，所有镜头都在它上面
EX.backdrop({ html, init(el), render(el, t) })  // 贴屏的全幅底层：canvas 星空、three.js 场景；视差读 EX.cam(t)
EX.shot({ …, at: [x, y, s], cam(u, d) { return [x, y, s] }, fly: 1.5 })
EX.run({ …, theme: 'dark', chrome: 'cinema', post: { vignette: .45, grain: 6 } })
const B = EX.tempo(96)                          // B(n) = 第 n 拍的秒数；配乐按这个速度合成
```

- `at: [x, y, s]`：这个镜头的 1920×1080 画面放在世界里的中心点和缩放。不写就是 `[960, 540, 1]`；两个镜头 `at` 不同时，默认转场是相机飞过去（`enter: 'fly'`），s 不同时飞行会保持细节所在的点不动，看起来就是推进或拉远。
- `cam(u, d)`：镜头内自定义相机（跟拍、横摇），返回世界坐标 `[x, y, s, 旋转度数]`，s 是屏幕装下多大一块世界（0.5 = 放大 2 倍）。不写时有 `at` 的镜头自动 3% 慢推。
- 镜头里的坐标仍是这个镜头自己的 1920×1080：安全区、字号、`--lint` 规则不变。世界层用世界坐标。
- three.js：工作目录 `npm i three`，`shots.js` 第一行 `import * as THREE from 'three'`（shots.js 按 ES module 加载，未声明的变量会报错）；画布放 `EX.backdrop({ subject: true, … })`（3D 场景就是主视觉，构图检查要算它；星空、天空这类纯背景不加 `subject`），文字用 DOM 标签贴在 `vector.project(camera)` 算出的屏幕点上，照 `three.example.js` 写。镜头的 `render` 先于 backdrop 执行，镜头里要投影 3D 点时先按 t 摆好场景和相机（示例里的 `setScene(t)`）。
- 相机的坑：
  - 不要给 `#world`、`#world-layer` 或它们的父级设 `opacity` / `transform`：会形成新的层叠上下文，世界层里的主角会沉到镜头下面。
  - 从小镜头飞到大镜头（拉远）时，新镜头的文字等飞完（`u > fly`）再出现，否则会以几十倍大小扫过屏幕；推进前先让上一镜的卡片淡出。
  - 世界层里的线宽、字号要考虑相机缩放 s：在 s = 3 的远景里，4 px 的线只剩 1.3 px。
  - 左右撑满的文字盒（`left:0; right:0`）在 3% 慢推后会超出画框，报 `OFFSCREEN`，给它定宽。

- 画面里出现和仪表同义的数字（大字“第 N 天”、时钟）时，用 `EX.meterAt(t)` 取值（`t` 是 `render` 的第 4 个参数），不要另写一套数字，否则会和顶部仪表对不上。
- 仪表单位写 `s / ms / min / h / 天 / 年` 时，右上角自动显示“慢放 ×N”或“快进 ×N”；距离、层数这类非时间仪表不显示倍数。不想要倍数写 `rate: null`。
- 章节颜色依次取 `EX.C.blue / purple / pink / cyan / green / orange / red / indigo`，相邻章节不同色。
- 电影模式的质感来自 `light.js`（`import './light.js'` 后用 `LIGHT.glow / bokeh / trail / flow / haze / sphere / shader`，用法见文件头和 `moon.example.js`），写实物体用真实素材（`worlds.md` 的“真实素材”：NASA、Poly Haven、博物馆开放数据），并写 `CREDITS.md`。
- 流 / 粒子 / 级联类题材（信息流、推荐、谣言传播、感染）用 `flow.js`（`import { makePool, makeSampler, makeStroker, makeClock, makeCascade } from './flow.js'`）：`makePool` 可变速率出生的粒子、`makeSampler` 按方向分布采样、`makeStroker` 同色线段合成一次 stroke、`makeClock` 子弹时间世界时钟、`makeCascade` 树状级联传播；用法与坑见文件头，不要从零重写。
- 只用美术指导卡里的颜色、字体和材质。下面的粉彩组件只属于粉彩信息图世界，其他世界不要用白卡和胶囊；数据标注写成大号数字 + 细线 + 等宽小标签。
- 组件现成可用：`.card`（加 `.ring` 和 `--c` 描边）、`.tag`、`.tok`（含 `.id` 编号）、`.node > .ic`、`.bar`、`.t-hero / .t-h2 / .t-h3 / .t-body / .t-label`、`.code`、`.grad-text`、`svg.wire`；图标用 `ICON.名称`，不用 emoji。现有：`phone laptop server database cloud tower wifi router globe lock unlock key shield user users chip cpu doc chat search gear bolt clock check x arrow card qr bank store sun leaf drop heart eye brain layers box truck bell code sprout tree cup fire thermo ship plane factory pin mountain cart scale star atom dna cell battery money camera calendar`；缺的照 `icons.js` 的格式自己画（24×24、描边 2、1–4 条路径）。
- 运动：`EX.pop`（弹簧落定）、`EX.fadeUp`、`EX.place`（按中心定位）、`EX.drawPath`（路径生长）、`EX.num`（计数）、`EX.type`（打字），以及 `engine.js` 的 `spring springTrack expoOut cubic prog lerp clamp rng pulse dashFlow splitChars riseChars`。
- 声音三层（`directing.md` 第 4 节）：
  - 拟音 `sfx: [[秒, 名, 音量]]`，共 21 个名字：`click tick pop chime snap whoosh reveal type thud blip glitch drop pour paper glass metal wood crackle impact riser swoosh-soft`。`riser` 写的时间是它的结束点（升到顶的那一刻），和 `impact` 写同一时间。
  - 环境声 `amb: 'wind'`：每个镜头一层，可选 `wind room hum water fire city space`。相邻镜头同名就连续播放，换名在切点处交叉淡化。总音量用 `EX.run({ amb_gain })` 调。
  - 安静 `hush: [[u0, u1]]`：音乐和环境声在这段降到 −24 dB，拟音不受影响。用在转折前，之后的第一个声音要是全片最重要的声音之一。
  - 混音自动在 `impact / riser / chime` 下压低音乐，并把成片响度统一到 −14 LUFS。
- 坐标有两套，别混：`class="abs"` + `style="left;top"` 是**左上角**；`EX.place(el, x, y)` 是**中心点**，并会覆盖 `transform`。同一个元素只用一种。
- 版面：内容只放在安全区 x 80–1840、y 180–900；上面是 HUD，下面是字幕。正文字号 ≥ 24 px，标签 ≥ 22 px（`--lint` 拦 22 px 以下）。
- **尺寸给足**：一个镜头里所有内容合起来，至少占安全区宽度或高度的 60%，并且大致居中。常用尺寸：主卡片 1000–1300 × 420–560 px；节点图标 132 px，节点间距 ≥ 500 px；token 块字号 46–64 px；代码 34–40 px。宁大勿小，`--lint` 的 `SPARSE` / `OFF-CENTER` 会拦住太小和偏的画面。
- **骨架先立**：主视觉的骨架（全部节点、卡片外框、坐标轴、格子）在镜头开始 1 秒内全部出现；之后的时间用来让主角移动、状态变化、标注弹出。不要把骨架拆成整段镜头里逐个出现，否则镜头中段画面是半空的。
- `render` 必须是 `u` 的纯函数：不用 `Math.random`、`Date.now`、定时器、CSS animation/transition；随机用 `rng(seed)`，并在 `init` 里生成好。
- 3D 镜头用 `cinema3d.js`（`import { makeCinema, timewarp, lightRig, studioEnv, makeSparks, makeFlakes, makePuffs, makeDust } from './cinema3d.js'`）：渲染链已调好（2 倍超采样、物理景深、HDR 辉光、热浪、色差、调色、颗粒、ACES、颜色空间），不要自己从零写。质量标准是 `hero.example.js`（烘焙一爆，9 s 微距镜头；效果见 `out/` 静帧）：一个 `THREE.WebGLRenderer` 放在 `EX.backdrop({ subject: true })`，多镜头时每个镜头一个 `THREE.Scene`，backdrop 的 `render(el, t)` 按当前镜头选场景和相机。
- 示例教技法，不定风格（风格来自风格库）。写镜头前先读电影模式的标准 `moon.example.js`（light.js 的光、真实素材、无 HUD、少字、长镜头，效果 `<skill>/assets/moon.jpg`），再按需读：`cinema.example.js`（美术指导卡、three.js 后期：辉光 + 景深、动态排版、变速运镜、卡拍子，效果 `<skill>/assets/cinema.jpg`）；`world.example.js`（世界层 + 相机跟拍 + 尺度穿越 + canvas 星空 + 深色主题）和 `three.example.js`（3D 主体 + 3D 点上的标签），效果见 `<skill>/assets/worlds.jpg`；`shots.example.js` 四个镜头（钩子大输入框、片名环形计时器 + 粒子、乱码扫描、骨架先立的路径）；`gallery.example.js` 七种常用画法（剖面 + 引线标注、放大镜插图、仪表盘 + 数字卡、曲线图 + 标注、地图航线、时间轴里程碑、对比条），效果见 `<skill>/assets/gallery.jpg`。缺哪种画面就从里面拿最接近的改，尺寸、层次和动法照抄。插画用渐变分层（底色 + 内层 + 高光 + 柔阴影），不画单薄的细线稿。
- `EX.pop` 和 `EX.place` 都写 `transform`，同一个元素只用一个；要定位又要弹出，把 `spring(...)` 传给 `place` 的缩放参数。SVG 元素也能用：`place` 移动的是它的原点，所以形状围绕 (0, 0) 画。
- SVG 的 `id`（渐变、clipPath）全页共享，加镜头前缀（`eg-grad`、`gl-clip`）。恢复元素原色时写回颜色值，不要写 `style.color = ''`，那会退回默认深蓝。

- **特写里的信息要能读**：屏幕上 ≥ 24 px，内容用观众真会点的标题，不用编号；颜色承载语义（一个类目一个颜色），群像要一个个人可辨，不能连成网（`worlds.md` 的“数据艺术 / 粒子流”）。
- **会变或会动的文字按视频帧定格**（数字、跟着元素走的标签）：取 `Math.floor(t * 30) / 30` 时刻的值和位置，否则 `--subframes` 运动模糊会把它叠成重影。

**分批写，分批查**。每写完 2–3 章就跑一次第 5 步，修干净再写下一批。不要一次写完全片才第一次渲染。

## 5. 检查（每批都跑）

```bash
node --check shots.js                                                  # 先查语法，比渲染快
bash <skill>/scripts/fonts.sh <work>                                   # 文案变了就重跑
node <skill>/scripts/render.mjs --html index.html --stills shots --lint  # 每个镜头中点和结尾各一张静帧 + 联系表 out/sheet-01.jpg …（每页 24 张，先清掉旧的）
```

`--lint` 打印两类问题，必须清零（退出码 0）才能进入下一步：

- `LINT`（版面）：`SPARSE` 画面太空或主视觉太小、`THIN` 画得太淡太细（安全区里真正上色的像素不足 5%，常见于只画描边的线稿）、`OFF-CENTER` 构图偏、`EMPTY` 什么都没画、`OFFSCREEN` 出画、`SMALL` 字太小、`WRAP` 短标签折成多行、`INVISIBLE` 文字透明（看不见）、`OVERLAP` 文字互相压住、`UNDER-CAP-PILL` / `UNDER-HUD-*` 被字幕或 HUD 挡住、`CLIPPED` 文字被裁。`SPARSE` 的修法是把主视觉放大、补上缺的部分，或把骨架提前到镜头开头，不是加装饰。构图只按每个镜头的中点帧判，镜头末尾变形缩小去接下一个镜头不算违规。构图按像素算（去掉 HUD 和字幕的画面对比只有背景的画面），DOM、SVG、canvas、WebGL 一视同仁；满幅背景层只算背景，主体仍要够大够居中。
- `AUDIT`（节奏）：`CAPTION-LONG` / `CAPTION-FAST` 字幕太长或太快、`LONG` / `SHORT` 镜头时长不合理、`NO-TERM` 章节没命名术语、`METER-BACKWARDS` 仪表倒退、`DURATION` / `CHAPTERS` 总体规模不对、`SOUND` 全片没有安静段或多数镜头没有环境声。

页面报错（`PAGE ERRORS`）必须修。查某一帧里某个元素的状态，用渲染器直接求值，不要自己写浏览器脚本：

```bash
node <skill>/scripts/render.mjs --html index.html --at 37.2 --eval "document.querySelector('#pk-code').textContent"
```

lint 通过只说明没有硬伤，不说明好看。接着做导演评审（`directing.md` 第 6 节）：

```bash
node <skill>/scripts/render.mjs --html index.html --sheet auto           # 9 个关键时刻拼成 out/keyframes.jpg
```

用 Read 打开 `out/keyframes.jpg` 和每一页 `out/sheet-NN.jpg`（全部页都看）；招牌镜头和每个 3D 镜头还要用 Read 打开**原尺寸**静帧（`out/stills/`）逐个检查：物体有没有互相穿插、标注引线有没有落在它指的东西上、有没有不该出现的高光或漏光。拼图缩小后看不出这些问题。然后按 7 项打 1–10 分：开头抓人、一眼看懂、美术统一、镜头与转场、节奏、讲清楚、震撼。分数写进 `REVIEW.md`。有一项低于 8 分就改，最多三轮；打 9 分要说得出它比 8 分好在哪。不要写“目检通过”就跳过。

能调用更强的模型时，用**评审模式**（`directing.md` 第 6c 节）：强模型只看原尺寸帧、写带目标数值和自检方法的指令，执行模型实现并回报实测数字。看得出不好却改不到位时，这比多跑几轮自评有效。

## 6. 15 秒样片，然后渲染与混音

先出开头约 15 秒的样片，配上声音检查一遍（`directing.md` 第 7 节），能对话就发给用户确认，没问题再渲全片：

```bash
node <skill>/scripts/render.mjs --html index.html --range 0:15 --subframes 2          # → out/sample.mp4
```

交付渲染加 `--subframes 3`（3D 用 2）得到运动模糊，片子才不像矢量预览；`post.grain` 的颗粒在这一步加上。渲染会自动多进程并行。

**长渲染不能丢**：单条命令可能超过工具的前台时限（约 10 分钟）。超过时，用 `nohup … > out/render.log 2>&1 &` 在后台启动，然后在前台反复执行 `sleep 240; tail -2 out/render.log`，直到看到 `✓`。渲染没结束之前，不要结束回答：会话一结束，后台进程会被一起杀掉。

```bash
node <skill>/scripts/render.mjs --html index.html --subframes 3 --out out/silent.mp4
node <skill>/scripts/render.mjs --html index.html --cues-out cues.json      # 自动音效：换章 whoosh、叠化 tick，加上各镜头的 sfx
python3 <skill>/scripts/motion_check.py --video out/silent.mp4 --cues cues.json
python3 <skill>/scripts/mix.py --video out/silent.mp4 --cues cues.json --out out/<name>.mp4
```

`--cues-out` 的自动音效规则：每章第一镜加 whoosh、`fly` 转场加 whoosh、其他叠化加 tick，再加各镜头自己的 `sfx`。写了配乐时，在 `EX.run({ autoCues: false })` 关掉自动的 whoosh/tick（各镜头自己的 `sfx` 不受影响），或把换章 whoosh 换成自己的音：自动 whoosh 会撞上配乐低谷，成片 `audio_check` 报 `HISS`。
配乐要用画面事件时刻（冲击、裂缝、首批元素到达……）时，页面在 `EX.run` 之前设 `window.__events = { impact: …, crack: … }`（JSON 可序列化对象），`--cues-out` 原样写进 `cues.json` 的 `events` 字段，配乐脚本直接读（例子：`assets/cocoon/shots.js` 与 `compose_score.py`）。不要另造导出流程。

**配乐**：默认合成的是循环底乐，只当占位，用户听不出它是配乐。成片照画面时间线写一首（`scripts/score_kit.py`；例子 `assets/cocoon/compose_score.py` 读 `cues.json` 拿事件时刻，运行 `PYTHONPATH=<skill>/scripts python3 compose_score.py cues.json out/score.wav`，需要 numpy），再用测量代替耳朵检查：`python3 <skill>/scripts/audio_check.py out/score.wav --out out/`（逐秒响度要符合设计的起伏，无 `HISS`/`CLIP`/`FLAT`），最后 `mix.py … --music out/score.wav`（`directing.md` 第 4b 节）。`mix.py` 会测量编码后的真峰值，超标自动重编码。

`motion_check.py` 列出 ≥ 2 s 的静止段（`STILL`），逐个补持续运动（扫描线、光点流动 `dashFlow`、呼吸光晕 `pulse`、缓慢漂移），重渲后 `STILL` 为 0。渲染自动多进程：2 分钟的 2D 片约 2 分钟（`--subframes 3` 约 5 分钟），140 秒的 3D 片 `--subframes 2` 约 6 分钟（Apple 芯片实测）。

## 7. 验证与交付

```bash
ffprobe -v error -show_entries stream=codec_type,width,height:format=duration -of compact out/<name>.mp4
ffmpeg -v error -y -i out/<name>.mp4 -vf "fps=1/3,scale=480:-1,tile=6x9" -frames:v 1 out/contact.jpg   # 6×9 格 × 3 s = 162 s，装得下 lint 允许的最长片
```

确认有视频流和音频流、1920×1080、时长与分镜一致、`--lint` 为 0，`python3 <skill>/scripts/audio_check.py out/<name>.mp4 --mix` 无 `HISS`/`CLIP`（成片加 `--mix`：拟音和响度归一让成片天然平，`FLAT` 只对配乐轨有意义）。交付：

- 成片路径和 `out/contact.jpg`
- 一句话结构（主角 / 仪表 / 站点 / 回扣）和章节列表
- 事实表中哪些是确数、哪些是量级或示意
- 修改方式：改 `shots.js` 后重跑第 5、6 步

配乐由脚本合成，没有版权问题；音频听感无法自动判断，交付时给出 `audio_check.py` 的响度曲线，并请用户试听。对外发布需要用户授权。

## 8. 其他画幅（竖版 9:16、3:4 封面）

舞台固定 1920×1080，别的画幅要重新构图，不要缩放加黑边。把世界抽成 `world.js`（尺寸、相机、安全区由页面传入），横版和竖版页面共用；竖版页面直接用 `engine.js` 的 `LV.start({ width: 1080, height: 1920 })`。抽模块前后各渲几张横版静帧逐像素比对，差值为 0 才算没改坏。小红书 / 抖音：主体在中间 1080×1440，字幕在底部 22% 之上、右侧 150 px 以左，用 `scripts/safe_guides.py --preset xhs` 叠参考线检查。两版共用同一份 `cues.json` 和配乐。细节与例子：`worlds.md` 第 5 节、`assets/cocoon/vertical.*`、`cover.html`。
