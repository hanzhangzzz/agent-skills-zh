# 反范式种子清单（需每次用当前文档重新核实）

这些是以往模型指引里反复出现的判定，只作为"去文档里找什么"的线索。任何一条在本次抓取的文档里找不到依据，就不能用于判定。每条附带当时的出处小节名，便于在新版文档里定位。

| 种子 | 曾见于 | 判定方向 |
|---|---|---|
| 提示词要求"逐步思考""把推理写进回复" | 模型指引 "Prompts written for thinking disabled" / "Safeguard refusals"（reasoning_extraction） | thinking 常开的模型上删除；需要推理可见性改读 thinking 块 |
| "再检查一遍""用子代理验证你的工作" | Opus 指引 "Task scope and over-verification" / "Self-correction" | 自我验证已内建的模型上删除；长时间无人值守任务另有说法，按当前指引判 |
| "每 N 次工具调用汇报一次进度" | 指引 "User-facing progress updates" | 有的世代要删，有的世代要显式索要开场句与收尾；看当前指引方向 |
| "结果留到最后一起说" | Fable 指引 "Ask for user-facing progress updates" | 删除，它压制了模型本来会给的进度文本 |
| 反格式化规则（禁 bullet、禁加粗） | Fable 5.1 指引 "Formatting in chat" | 格式化已变少的模型上改为"何时该用格式"的正向规则 |
| "CRITICAL: 你必须使用工具 X" | best-practices "Tool usage" | 过触发；降为普通语气 |
| "不确定就停下来问" | Fable 指引 "Finish the whole task" / "Delivering work" | 与"先做不依赖答案的部分并声明假设"冲突，改写 |
| "先写测试再实现"作为通用要求 | Fable 5.1 指引 "Keep changes and tests to what the task asks for" | 只按仓库惯例或用户要求加测试 |
| 逐条枚举禁止行为的长清单 | Fable 指引 "Strong instruction following"；best-practices "Migration considerations" | 一句意图指令等效；过度 prescriptive 会降质 |
| 写死子代理档位或"尽量少派子代理" | Opus 指引 "Controlling subagent spawning"；Fable 指引 "Parallel subagents" | 用 harness 硬上限（并发、深度）兜底，提示词只写何时该派 |
| 展示剩余 token 倒计时 | Fable 指引 "Rare cases of context-budget concern"；Sonnet 指引 "Mid-turn user messages" | 避免暴露；必要时加"上下文充足"的安慰句 |
| max_tokens 按无 thinking 时代设置 | 各 5.5 指引 "Calibrate effort" | 给 thinking 留空间，通常设到模型上限 |
| effort 沿用上一代的档位 | 各指引 "Calibrate effort"/"Consider all effort levels" | 档位名跨代不等价，重新扫一遍 |
| 通用模板规则（外来语言、带示例代码的 checklist） | 无直接出处，但与用户自述原则冲突即为信号 | 删除或压缩为用户自己的一句原则 |
| 同一规则散落多文件 | 无直接出处；重复会叠加为过度指令 | 只留一处 |
