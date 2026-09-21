#!/usr/bin/env python3
"""从 cards.json 生成 README 画廊表格区段（单一事实源，消灭手改吞格事故）。

用法: python3 build_gallery.py [--check]
  默认  : 重写 README.md 中 <!-- cards-gallery-start --> 到 <!-- cards-gallery-end -->
          之间的表格区段（含两标记本身）。
  --check: 只校验 README 现有区段与生成结果一致，不一致退出码 1（供市场门禁调用）。

卡片顺序 = cards.json 顺序；每行 2 格；飞轮实景格固定收尾。
tagline（·后的一句话）以 cards.json 的 tagline 字段为准，缺失则报错。
"""
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
README = HERE.parent.parent.parent / "README.md"
README_EN = HERE.parent.parent.parent / "README.en.md"
START = "<!-- cards-gallery-start -->"
END = "<!-- cards-gallery-end -->"
FLYWHEEL = ('<td>飞轮实景：do-something 提出方向并实践 → ci-review 验证质量 → 下一轮先回应评论 → '
            '人类只在想收割时出现。<br><br>本仓 PR #8 实录：机器人在审查规范的安装副本里发现一处'
            '逻辑矛盾（带失败场景与复现命令），开发者修复 push 后，增量审查确认"矛盾已由此 commit '
            '消除"，零重复评论。</td>')
BADGE_RE = re.compile(r"skills-\d+-blue")


def render(cards):
    cells = []
    for c in cards:
        name = c.get("name", "")
        if not name:
            raise SystemExit("✗ cards.json 某条目缺 name 字段，拒绝生成空链接格")
        tagline = c.get("tagline")
        if not tagline:
            raise SystemExit(f"✗ cards.json 的 {name} 缺 tagline 字段")
        skill_dir = HERE.parent.parent.parent / name   # 仓库根 = cards-src 上三级
        # 只验目录存在（链接活性）：hook-only skill（如 git-push-guard）本就没有 SKILL.md
        if not skill_dir.is_dir():
            raise SystemExit(f"✗ cards.json 的 {name} 没有对应 skill 目录（{skill_dir}），拒绝生成死链")
        # HTML 转义：tagline/name 里的 <>"& 只能当字面文本，防撑爆表格结构
        q = html.escape(name, quote=True)
        cells.append(
            f'<td><a href="./{q}/"><img src="./assets/readme/cards/{q}.png" '
            f'alt="{q} 展示卡"></a><br><b>{q}</b> · {html.escape(tagline)}</td>')
    cells.append(FLYWHEEL)
    rows = []
    for i in range(0, len(cells), 2):
        left = cells[i]
        right = cells[i + 1] if i + 1 < len(cells) else "<td></td>"
        rows.append("<tr>\n" + left + "\n" + right + "\n</tr>")
    return "<table>\n" + "\n".join(rows) + "\n</table>"


def update_badge(text, skill_count, label):
    badges = BADGE_RE.findall(text)
    if len(badges) != 1:
        raise SystemExit(f"✗ {label} skill 数量 badge 必须恰好一个")
    return BADGE_RE.sub(f"skills-{skill_count}-blue", text, count=1)


def update_readme(text, block, skill_count):
    if text.count(START) != 1 or text.count(END) != 1:
        raise SystemExit("✗ README.md 画廊区段标记必须各恰好一个")
    pre, rest = text.split(START, 1)
    _, post = rest.split(END, 1)
    updated = pre + START + "\n" + block + "\n" + END + post
    return update_badge(updated, skill_count, "README.md")


def main():
    cards = json.loads((HERE / "cards.json").read_text(encoding="utf-8"))
    block = render(cards)
    t = README.read_text(encoding="utf-8")
    t_en = README_EN.read_text(encoding="utf-8")
    expected = update_readme(t, block, len(cards))
    expected_en = update_badge(t_en, len(cards), "README.en.md")
    if "--check" in sys.argv:
        if t != expected or t_en != expected_en:
            print("✗ README 画廊或中英文 skill badge 与 cards.json 不一致——运行 build_gallery.py 重新生成", file=sys.stderr)
            sys.exit(1)
        print("✓ 画廊与中英文 skill badge 均和 cards.json 一致")
        return
    README.write_text(expected, encoding="utf-8")
    README_EN.write_text(expected_en, encoding="utf-8")
    print(f"✓ 画廊与中英文 skill badge 已从 cards.json 生成（{len(cards)} 卡 + 飞轮格）")


if __name__ == "__main__":
    main()
