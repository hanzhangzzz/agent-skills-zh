# 参考片库：爆款发布视频拆解与共性

学做法，不抄样子。参考片的配色、字体、图形属于它的品牌；要学的是节奏、取景、入场方式、信息密度。动手前至少拆一支参考（本库或用户给的），把结论写进 `DIRECTION.md`（见 `direction.md`）。

## 怎么拆一支参考

```bash
# 2 fps 联系表看结构与节奏（列数 6，行数 = 时长 × 2 ÷ 6 向上取整）
ffmpeg -v error -y -i ref.mp4 -vf "fps=2,scale=320:-1,tile=6x10" -frames:v 1 ref-sheet.jpg
# 10 fps 帧条看一个转场怎么做的
ffmpeg -v error -y -ss <切点-0.4> -t 1 -i ref.mp4 -vf "fps=10,scale=320:-1,tile=10x1" -frames:v 1 ref-cut.jpg
```

用 Read 看图，逐项回答并写下：开场 2 秒发生了什么；镜头数与平均时长；大字占画面高度的比例；产品 UI 占画面宽度的比例；明暗分段；转场语法（硬切 / 变形 / 共享元素 / 遮罩）；数字怎么出现；结尾停多久、最后一帧是什么。只记"它用了什么做法、在表达什么"，不记颜色和字体。

X 上的视频可用 `https://api.fxtwitter.com/<user>/status/<id>` 取直链下载（只用于本地拆解，不再分发）。持续更新的案例库：`zhuyansen/awesome-opus-5.5-video`（按"产品演示与广告"分类）、`X-RayLuan/awesome-opus-5-5-video-prompts`、`apimodels/claude-opus-5-5-video-prompts`（含完整 prompt）。

## 七支参考（2026-09 Opus 5.5 发布周，全部为代码渲染）

| 片 | 时长 / 画幅 | 传播 | 结构 | 值得学的做法 | 不要学 |
| --- | --- | --- | --- | --- | --- |
| @twoclipping UI morph `x.com/twoclipping/status/2103273003555402193` | 14 s · 1:1 | 1.17M 看 · 1.9 万收藏 | 一个黑色形状在 Generate 按钮 → 加载环 → 对勾 → 播放器 → 音量条 → 开关 → 分段控件 → 图表卡 → 命令面板 → 按钮之间连续变形，光标真实点击驱动，末帧=首帧 | **一个主角从不切镜**；每拍一个状态；光标驱动每次变化；闭式弹簧落定；纯黑白加一个强调色；"禁用清单"写进 prompt（crossfade、blur-in、3D 翻转、粒子、发光、停留 >1 s） | 它没有产品内容，只是技法展示；别拿它当发布片结构 |
| @tdinh_me TypingMind `x.com/tdinh_me/status/2103703135902740699` | 15 s · 16:9 | 19.6 万看 | 真实输入框打字→发送 → 产品窗口被各家模型 logo 环绕 → 6 个功能幕（小标签 + 两行大标题在左，截图卡在右，各 ~1.2 s）→ 3D 倾斜窗口阵列配 "The AI client you actually own." → 三行叠加 "No subscription. Pay once. Use forever." + 评分徽章 → 圆环揭示 logo + 标语 + URL | **开场就是产品真实交互**；功能幕固定模板快切；标题两行、第二行强调色；结尾社会证明 + URL；三行加价式叠加文案 | 全片深蓝单色调，功能幕截图偏小；30 分钟一次成片的平均水平 |
| @deedydas inference startup `x.com/deedydas/status/2102787937482252537` | 26 s · 16:9 | 35 万看 · 约 $2 | 聊天框 "Summarize the quarter" + Thinking 计时器从 0.36 s 数到 5.54 s → 大字 WAITING 划线变 WASTE. 紫色全屏砸屏 → "Most of inference is waiting." 配 token 利用率格子 31% → "Not anymore." 格子填满 94% → token 流墙 + tok/s 计数 124 → 12,480、延迟 512 ms → 38 ms → 品牌名 muda 的日文含义与圆相 → "We removed the waste. It was most of it." → 渐变品牌卡 → 彩蛋 "26.000 s / 0.038 s：we were done before the logo was" | **痛点量化成画面**（计时器、利用率格子）；一个大词砸屏 + 划线改写；数字滚动与证据一体，口径小字在旁；品牌名含义做成画面；结尾彩蛋呼应开头 | 浅底上的灰字对比偏弱；一句话 prompt 的"通用 SaaS"字体感 |
| @gauravsbuilding Fastlane `x.com/gauravsbuilding/status/2104370091672711402` | 15 s · 16:9 | 42.9 万看 · 12 小时自主运行 | 3D 隧道里的竖屏视频墙 → URL 输入胶囊（红点光标）→ 悬浮手机模型 → "Posted. Every day." 覆在网格上 → 通知堆叠 "Passed 30M views" → 大数字 36.1M views → 米白底上的赛道母题 TREND / LEARN / POST 绕圈 → 铬金属 logo → "It ships. It learns." + URL | **品牌母题（赛道）贯穿**；明暗交替（深 → 米白 → 深）一次；通知堆叠讲结果；大数字一屏只一个 | 12 小时跑出来的 3D 质感不是 30 分钟能复现的；别承诺这个成本 |
| @DanielSmidstrup ClimbX `x.com/DanielSmidstrup/status/2104013515623170390` | 30 s · 16:9 | 11.3 万看 · 20 分钟 | 圆点 → 旗 → 山 logo 从粒子聚成 → 橙色全屏贴满便签 "what do I post today?" → logo + 标语 → 产品 UI 巡游（Studio / Calendar / Inspiration）→ "10 ready posts every day, in your voice." 大数字 2 → 6 → 10 配卡片堆叠 → "make it yours." 编辑器 + 评分面板 → "your week, handled." 日历 → 深色段 "build connections, not impressions." 回复卡 + 增长线 → 收尾 logo + 数据 "0→10K / 9.9M / 140 days" + climbx.so + CTA 停 6 s | **"动词 it yours." 两词段标题 + 强调词**；大数字计数 + 卡片堆叠；明暗分段讲两种价值；收尾数据 + CTA 停够长 | 30 秒塞了 6 个功能，中段节奏平；UI 巡游里字偏小 |
| @jake11moran NotchBrowser `x.com/jake11moran/status/2103237884564414633` | 27 s · 16:9 · HyperFrames | 7 千看 | 真实 macOS 壁纸上 "in the AI era, the hard part is" + 痛点清单滚动到 "managing your desktop?" → 真实窗口一层层堆满屏幕再被甩走 → "don't make your browser one of them" → 浏览器从菜单栏刘海里长出来 → 面板里嵌真实网页截图 → 清单 "tiny 1.7 mb / native / ergonomic / no extra window in the way" → logo "launching soon" | **痛点用真实环境演出来**（窗口堆叠）；产品从它真实所在的位置长出；机制演示 = 真实截图嵌进产品外壳；对勾清单收尾 | 壁纸噪点让字难读；结尾没有 URL |
| @shribuilds WrapScribe `x.com/shribuilds/status/2102827288190689364` | 41 s · 16:9 | 3 万看 | 口述 "Um, let's launch on Thursday — no, Wednesday." 被自动清理成 "Let's launch on Wednesday." → "You talk. Your Mac types." → "Edit with your voice." → "Anywhere you type." 窗口轮播 → logo → "Meetings? Noted." → "Select. Polish. Translate." → "99 languages" → 片段卡 → 笔记本线框里 "Nothing you say leaves your Mac" → "Pay once." → logo + URL | **开场直接演核心机制**（一句错话被清理）；每个功能一个两词标题；全片一套卡片语言 | 41 秒、9 个功能，看完记不住一个；证明了"长 = 平" |

## 旧版对照：jev-task-router 发布片（本 skill 2026-10-04 产出，36 s）

| 问题 | 表现 | 对应的参考做法 |
| --- | --- | --- |
| 全片深色、无明暗分段 | 36 秒同一种底色，信息流里不显眼 | deedydas / ClimbX / Fastlane 都有一次全屏色块或明暗切换 |
| 字太小 | 标题不到画面高度 1/12，说明文字不可读 | 爆款标题占画面高度 1/6 到 1/4，每屏 ≤ 6 词 |
| 原理幕一张看板停 14 秒 | 看板卡片小、三步在同一画面微调 | 功能幕每幕 1–2.5 秒换取景，产品 UI 占画面宽 45–70% |
| 证据幕 10 秒三个数字不动 | 没有计数、没有口径说明的视觉层级 | 大数字滚动到位 + 旁边一行小字口径 |
| 没有可感的拍点 | cue 对齐了但画面没有"每拍一件事" | 120 BPM 左右，每拍有可见变化，切点落在拍上 |
| 安装命令是底部小字 | 收尾 4 秒，命令行不可读 | 收尾 logo + 一句话 + 命令/URL 停 ≥ 3 秒，最后一帧就是海报帧 |

## 跨片共性（写分镜前对照）

1. **开场 2 秒内有钩子**：产品真实交互（打字 → 发送）、痛点可视化（计时器、堆满的窗口）、或主角出生。不要从 logo 开始。
2. **大字**：主标题占画面高度 1/6 以上，每屏 ≤ 6 词，强调词只给一个颜色；两行标题第二行强调。
3. **镜头短**：功能 / 机制幕 1–2.5 秒一换；30 秒片 12–20 个镜头；痛点与证据可停 3 秒给人读。
4. **产品 UI 大**：占画面宽度 45–70%，正文 ≥ 22 px（1080p）；完整窗口只作建立镜头，之后放大到具体区域。
5. **功能幕有模板**：小标签 + 两行大标题 + UI 卡；或 "动词 it yours." 两词句。全片一套。
6. **数字滚动**：`counter` 滚到真实值，旁边一行小字写口径；一屏只一个大数字。
7. **明暗交替**：浅底痛点 / 亮相 → 深底机制 → 浅底证据 / 收尾，或反过来；全片至少一次全屏色块砸屏。
8. **一个主角或母题贯穿**：形状变形、品牌几何、光标；换幕靠它位移或变形，不靠淡入淡出。
9. **收尾停够**：logo + 一句话 + URL 或安装命令停 ≥ 3 秒；最后一帧 = 海报帧；首帧也必须是完整画面（平台抓首帧做封面）。
10. **卡拍**：100–120 BPM，每拍有一件事，切点落在拍上；音效按峰值对齐事件。
11. **禁用清单要点名**：泛泛说"别像模板"无效，要写具体模式。高端极简路线禁：冲击波圆环、粒子爆发、RGB 错位、镜头抖动、镜头光晕、霓虹发光、网格地面、闪烁背景、回弹缓动。单形态变形路线禁：交叉淡入、模糊入场、3D 翻转、停留 >1 s。

## 可直接改写的 prompt 骨架（来自 @twoclipping，按本 skill 术语对应）

```
<inputs>     产品名、一句承诺、3–5 个要展示的 UI 时刻、一个强调色、真实素材清单、BPM
<direction>  一句话定调 + 取景与字体规则 + 转场语法 + 禁用清单（点名具体模式）
<structure>  N 拍 @ BPM，每拍一件事；按幕写：开场钩子 → 机制 → 证据 → 收尾；末帧 = 海报帧
<build>      seek(t) 纯函数；闭式弹簧；真实素材抽帧逐帧换；音效按峰值对齐；渲染前先抽 20 帧检查
<gotchas>    preserve-3d 元素不能设 opacity/filter；全屏色块要过扫角落且 ≥ 0.3 s；变形容器里换文字要各自遮罩
<start>      先给节拍表和 4 张关键静帧，再写全片
```

本 skill 里：`<inputs>` 对应第 1 步取证，`<direction>` 对应 `DIRECTION.md`，`<structure>` 对应分镜表，`<build>` 对应 `engine.js` 与 `render.mjs`，`<start>` 对应试样与静帧检查。
