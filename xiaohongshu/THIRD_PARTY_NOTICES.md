# 源码来源与致谢

本 Skill 的路由、存储、媒体处理与安装管理由本仓库维护；不要求安装下面这些项目或启动其服务。

## xiaohongshu-cli

- 上游：<https://github.com/jackwener/xiaohongshu-cli>
- 参考版本：commit `526ee628c7f139b4d6ca131029ba1dc346715543`，项目声明 Apache-2.0。
- 来源：`xhs_cli/constants.py`、`signing.py`、`client.py`、`client_mixins.py`。
- `scripts/xhs.py` 改写复用了请求头、签名配置、搜索预热/筛选/详情请求结构、search ID 算法及错误码处理。
- 修改：标准库 HTTP 传输、只读 API、遇风控立即停止、私有本地状态、统一 JSON 输出；不复制其发布、互动、浏览器扫描或 CLI 框架。
- Apache-2.0 完整许可证随附 `LICENSE-APACHE-2.0`。源文件头标记了适用来源；不能只保留致谢而去掉许可证。

## xhshow

- 上游：<https://github.com/cloxl/xhshow>
- 版本：PyPI `xhshow==0.2.0`，内置在 `scripts/vendor/xhshow`。
- Copyright (c) 2024 Cloxl；完整 MIT 许可证保留在该目录 LICENSE。
- 只复制 Python 源码，不携带模型、凭证、缓存或字节码。
- 修改 `generators/fingerprint.py`，以同目录 `rc4.py` 的标准库实现替代 Crypto.Cipher.ARC4；用已知向量及上游调用对照验证兼容。不将 RC4 用于本地凭证加密。

## 设计参考

<https://github.com/HeyDemons/rednote-rag> 的增量缓存、正文与派生文字分离、来源回溯启发了本地知识库设计。当前未复制该项目的代码，也不依赖它的 FastAPI、ChromaDB、OCR 或模型服务。

现有 xiaohongshu-downloader 的 yt-dlp/Whisper 工作流合并进统一脚本。转录本身仍需要 Whisper；它是可选基础工具，不是独立的小红书项目依赖。
