---
name: xiaohongshu
description: |
  小红书统一入口：登录自己的专用账号、搜索帖子、下载单篇图文或视频并提取口播、检索逐次积累的本地材料；也支持小红书文案起草及已授权发布的浏览器指引。用于搜小红书、下载小红书、提取口播、基于小红书材料回答、写小红书文案。不依赖独立小红书 CLI、MCP 或 RAG 服务。
license: Apache-2.0
metadata:
  trigger: /xiaohongshu
  compatibility: Codex, Claude Code; macOS/Linux, Python 3.10+
  version: "3.1.0"
---

# 小红书统一入口

只做意图路由、参数选择、材料筛选和带来源的回答。让 `scripts/xhs.py` 执行登录、搜索、下载、入库与召回；不要在对话中重新拼接 Cookie、签名或临时爬虫。

## 前置检查

- 从本 SKILL.md 的实际安装位置定位脚本；不假设安装在某个用户目录。
- 登录、搜索、正文读取、本地召回只需要 Python 3.10+ 标准库与内置签名源码；首次登录还需要 Google Chrome。当前不支持 Windows。
- 视频下载需要 yt-dlp、ffprobe；口播提取另需 Whisper medium 与 ffmpeg。缺少相应工具时报告 `MISSING_TOOL`，不要自动全局安装。
- 只在用户请求相应能力时使用媒体工具；普通搜索不自动下载全部帖子。

示例中的 `$SKILL_DIR` 代表已定位的本 Skill 目录。所有命令输出单个 JSON 对象，包含 `ok`、`schema_version` 和 `data` 或 `error`。检查真实字段，不根据退出码独自推断内容完整。

## 路由

| 用户意图 | 执行 |
|---|---|
| 首次登录 | `python3 "$SKILL_DIR/scripts/xhs.py" login`；让用户在有头专用 Chrome 完成登录，再执行 `login --finish` |
| 登录检查 | `python3 "$SKILL_DIR/scripts/xhs.py" status` |
| 搜索帖子 | `python3 "$SKILL_DIR/scripts/xhs.py" search "关键词"`；可用 `--page`、`--sort general/popular/latest`、`--type all/video/image` |
| 读取并保存帖子正文 | `python3 "$SKILL_DIR/scripts/xhs.py" fetch "帖子链接或ID"` |
| 下载单篇图文/视频 | 在 fetch 后加 `--media` |
| 下载视频并提取口播 | 在 fetch 后加 `--transcribe`；产物标记为未人工校对 |
| 查询已有材料 | `python3 "$SKILL_DIR/scripts/xhs.py" recall "关键词"`；离线关键词召回，最多默认5篇，不是向量语义检索 |
| 存成平台草稿 | `python3 "$SKILL_DIR/scripts/xhs.py" draft --title "标题" --body "正文"`；加 `--image 路径`（可重复，最多18张）存图文，加 `--video 路径` 存视频，都不加则走平台「写文字」生成文字卡片。正文长可用 `--body-file 路径` |
| 写文案、人工发布 | 阅读 `references/publishing.md`；draft 只存草稿，发布由用户在专用浏览器点击 |
| 结束使用专用浏览器 | `python3 "$SKILL_DIR/scripts/xhs.py" close`；用户还在查看或处理登录时保留窗口 |

## 搜索与回答

1. 根据问题先 recall 已有材料；需要新证据时再 search。默认最多三个搜索词，深入读取最多十篇，有足够证据就停止。
2. 根据标题和相关性选择帖子，调用 fetch 读正文。搜索卡片只能当线索。
3. 视频正文只有标签时，不能假装已经理解视频。重要视频用 `--transcribe`；图文信息主要在图片时，阅读已下载图片，说明图片文字尚未进入自动索引。
4. 将答案连接到实际读过的正文、口播或图片，并附帖子链接或本地 note.md。区分作者经验、评论、模型推断与转录错误；不把点赞量当真实性证明。
5. 缺少材料或作者说法冲突时明确指出；不用已有常识填充成“小红书搜索结论”。

## 数据与账号

数据默认放在用户主目录下 `.local/share/xiaohongshu`，可在子命令前用 `--data-dir` 指定。每个已核实账号使用独立的 SQLite 和笔记目录；Skill 源码与用户知识分离。

search 保存候选记录与详情访问引用；只有 fetch 保存的完整材料进入本地召回。按帖子 ID 去重，已保存正文、媒体和字幕可复用，不重复跑转录。价格、日期等需要新鲜数据时不要把旧缓存当现状；当前需要更新单篇内容时先说明缓存范围，由用户决定是否重新获取。

账号凭证只保存在本地私有文件，不输出到回答、日志、Git 或外部模型。只连接本脚本创建的 Chrome endpoint，不扫描主浏览器、不注入旧 Cookie。不承诺登录永久有效。

draft 只写入草稿箱，不发布、不定时发布、不改动已发布笔记。草稿存在专用浏览器的本地存储里，不在账号云端：换浏览器或清除该 profile 数据即消失，也不会出现在手机 App。draft 会先关掉遗留的创作页标签，再开新标签操作，结束后回查草稿箱确认最新一条就是本次标题；标题未被确认时不会留下草稿。用户要求真正发布时，让其本人在专用浏览器里点击发布。

## 错误处理

- `NEED_LOGIN`：用户在专用窗口重新登录，然后 login --finish；不自动切账号。
- `RISK_CONTROL`：停止本次平台请求，让用户查看专用浏览器，不更换代理、伪造验证或循环重试。
- `INCOMPLETE_RESPONSE`：响应缺少必要数据，不能报告“没有结果”或“帖子已删除”。
- `TOOL_FAILED`、`INVALID_VIDEO`：报告阶段未完成，保留已经保存的正文与部分文件；不要声称完整下载成功。
- `BUSY`：同一 profile 有操作进行中，等待其结束，不绕开锁并行访问账号。
- `UPLOAD_FAILED`：素材未被编辑器接收，此时没有保存任何草稿；检查文件格式与大小后重试，不要声称已存草稿。
- `DRAFT_UNCONFIRMED`：没有拿到平台确认，或草稿箱里最新一条不是本次标题。报告未确认，让用户在专用浏览器核对；不要重复提交。
- `PAGE_CHANGED`：创作页结构与脚本预期不符，可能是平台改版。报告具体步骤，不要改用猜测的选择器硬点。
- `PERMISSION_DENIED`：报告不可写的安装/数据边界，不尝试绕过。

## 单入口安装

先运行 `python3 "$SKILL_DIR/scripts/xhs.py" install` 查看迁移对象。用户已要求统一本机入口时执行 `install --apply`：旧小红书入口移到不可发现的备份目录，Codex 与 Claude 各保留指向同一源码的 xiaohongshu 链接。

恢复使用 `install --restore "返回的备份目录"`。安装程序不修改已有用户知识或 Chrome profile；安装成功不表示当前会话已经重新加载技能，必要时新开会话验证发现结果。

源码来源、许可证和修改范围见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
