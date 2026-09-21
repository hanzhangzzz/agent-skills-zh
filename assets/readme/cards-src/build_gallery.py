#!/usr/bin/env python3
"""从 cards.json 的 preview 字段生成双语 README 案例；从市场清单统计 Skills 与纯 hook。"""
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
START = "<!-- cards-gallery-start -->"
END = "<!-- cards-gallery-end -->"


def render(cards, language, root=ROOT):
    examples = []
    for card in cards:
        preview = card.get("preview")
        if not preview:
            continue  # 流程说明卡不是运行截图，不自动进入首页。
        name = card["name"]
        image = preview["image"]
        instruction = f"{name}/SKILL.md"
        for path in (image, instruction):
            if not (root / path).is_file():
                raise SystemExit(f"✗ 案例文件不存在：{path}")
        caption = preview[language]
        examples.append(
            f"### [{name}](./{instruction})\n\n{caption}\n\n"
            f"[![{name}](./{image})](./{image})")
    if not examples:
        raise SystemExit("✗ README 至少需要一个有来源的结果案例")
    return "\n\n".join(examples)


def update_badges(text, skill_count, hook_count):
    for prefix, color, count in (("skills", "blue", skill_count), ("hook_plugins", "purple", hook_count)):
        pattern = rf"{prefix}-\d+-{color}"
        if len(re.findall(pattern, text)) != 1:
            raise SystemExit(f"✗ {prefix} badge 必须恰好一个")
        text = re.sub(pattern, f"{prefix}-{count}-{color}", text, count=1)
    return text


def update_readme(text, block, skill_count, hook_count):
    if text.count(START) != 1 or text.count(END) != 1:
        raise SystemExit("✗ README 画廊区段标记必须各恰好一个")
    pre, rest = text.split(START, 1)
    _, post = rest.split(END, 1)
    return update_badges(pre + START + "\n" + block + "\n" + END + post, skill_count, hook_count)


def main():
    cards = json.loads((HERE / "cards.json").read_text())
    plugins = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())["plugins"]
    skill_count = len({path for plugin in plugins for path in plugin.get("skills", [])})
    hook_count = sum(not plugin.get("skills") for plugin in plugins)
    updates = []
    for language, filename in (("zh", "README.md"), ("en", "README.en.md")):
        path = ROOT / filename
        original = path.read_text()
        expected = update_readme(original, render(cards, language), skill_count, hook_count)
        updates.append((path, original, expected))
    if "--check" in sys.argv:
        if any(original != expected for _, original, expected in updates):
            raise SystemExit("✗ 双语案例或技能数量不一致：运行 assets/readme/cards-src/build_gallery.py")
        print("✓ 双语案例与 Skills / hook 数量一致")
        return
    for path, _, expected in updates:
        path.write_text(expected)
    print(f"✓ 双语案例已生成：{skill_count} Skills，{hook_count} hook-only plugins")


if __name__ == "__main__":
    main()
