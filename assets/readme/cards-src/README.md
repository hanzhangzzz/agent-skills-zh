# 首页案例与说明卡

`cards.json` 保存每项能力的流程、输出格式与来源。其中标记 `preview` 的条目提供现有结果截图，以及中英文说明；只有这些截图进入首页。普通说明卡、模板和历史文本摘录不自动成为“真实效果图”。

在仓库根目录运行：

```bash
python3 assets/readme/cards-src/build_cards.py
python3 assets/readme/cards-src/build_gallery.py
python3 assets/readme/cards-src/build_gallery.py --check
```

- `build_cards.py` 生成单项 HTML 与 `index.html`，可本地打开。默认标签是“输出格式示例”，历史摘录须写明来源。不要再截图成 PNG 充当运行结果。
- `build_gallery.py` 从 `preview` 生成两个 README 的案例区段；从市场清单分别计算 Skills 和纯 hook 插件数量。无截图条目仍保留在完整目录。
- 修改卡片数据或生成器后重新生成 HTML；修改案例后重新生成两个 README。不要手改生成区段或 HTML。
- 新案例必须附可核验来源与准确边界。CI 检查文件存在和生成一致性，不能代替真实使用验证、隐私检查或视觉复核。
