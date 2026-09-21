#!/usr/bin/env python3
"""市场质量门禁：把 CLAUDE.md 的 skill 质量清单固化为可执行检查。

用法：python3 .github/scripts/validate_marketplace.py [仓库根目录，默认 .]
全部通过退出码 0；任何违规打印 "✗" 行并退出码 1。

frontmatter 解析用 PyYAML（唯一路径：能识别全部合法 YAML 格式，非法 frontmatter 直接拦截，
description 非字符串如实上报）。依赖：python3 -m pip install pyyaml（workflow 已自动安装）。

检查范围（对应 CLAUDE.md「Skill 质量检查清单」）：
- marketplace.json 可解析、entry name 唯一、skills 路径存在且 name 与目录一致
- SKILL.md：frontmatter name 与目录一致、description 存在且 ≤1024 字符、不超过 500 行
- SKILL.md 内无硬编码安装路径（~/.claude/skills/、/Users/、/home/；README 是给人看的文档，不检查）
- SKILL.md 里反引号引用的 scripts/、references/ 路径真实存在
- scripts/ 下的 .sh/.py 有可执行位
- 索引一致：README/README.en/MARKETPLACE/画廊的 skill 集合与 marketplace.json 完全一致，
  README badge 数量等于 plugin entry 数；hook-only entry 也不能从索引消失
"""

import json
import os
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("需要 PyYAML：python3 -m pip install pyyaml")

MAX_SKILL_LINES = 500
MAX_DESC_CHARS = 1024
# 禁的是「假设 skill 装在固定位置」的路径（CLAUDE.md §5）；~/.claude/settings.json 这类
# 用户级配置文件本来就在那里，属合法引用，不查。
HARDCODED_PATTERNS = ("~/.claude/skills/", "/Users/", "/home/")


def fail(msg):
    print(f"✗ {msg}")
    global failures
    failures += 1


failures = 0
root = sys.argv[1] if len(sys.argv) > 1 else "."
root = os.path.abspath(root)


def rel(path):
    return os.path.relpath(path, root)


def parse_frontmatter(text):
    """返回 (frontmatter 文本, 正文)。无闭合 --- 视为无 frontmatter。"""
    if not text.startswith("---"):
        return "", text
    end = text.find("\n---", 3)
    if end == -1:
        return "", text
    return text[3:end], text[end + 4:]


# ── marketplace.json ──────────────────────────────────────────────
mp_path = os.path.join(root, ".claude-plugin/marketplace.json")
try:
    with open(mp_path) as f:
        mp = json.load(f)
    plugins = mp["plugins"]
except Exception as e:
    print(f"✗ marketplace.json 无法解析：{e}")
    sys.exit(1)

entry_names = set()
entry_skill_dirs = set()
for p in plugins:
    name = p.get("name")
    if not name:
        fail("marketplace.json 有 entry 缺 name")
        continue
    if name in entry_names:
        fail(f"marketplace.json entry name 重复：{name}")
    entry_names.add(name)
    for s in p.get("skills") or []:
        d = os.path.normpath(os.path.join(root, s))
        if not os.path.isdir(d):
            fail(f"entry {name} 的 skills 路径不存在：{s}")
            continue
        entry_skill_dirs.add(os.path.basename(d))

# ── 逐 skill 检查 ─────────────────────────────────────────────────
skill_dirs = set()
for name in sorted(os.listdir(root)):
    skill_md = os.path.join(root, name, "SKILL.md")
    if not os.path.isfile(skill_md):
        continue
    skill_dirs.add(name)
    text = open(skill_md).read()
    lines = text.split("\n")

    fm, _ = parse_frontmatter(text)
    try:
        meta = yaml.safe_load(fm) or {}
    except yaml.YAMLError as e:
        fail(f"{name}/SKILL.md：frontmatter 不是合法 YAML（{type(e).__name__}）")
        meta = {}
    fm_name = meta.get("name")
    fm_name = fm_name.strip() if isinstance(fm_name, str) else fm_name
    desc = meta.get("description")
    if desc is not None and not isinstance(desc, str):
        # 含「: 」「- 」的 plain 续行会被解析成 dict/list——对 skill 加载器就是坏值，如实报因
        fail(f"{name}/SKILL.md：description 不是字符串（YAML 解析为 {type(desc).__name__}）")
        desc = None
    if fm_name != name:
        fail(f"{name}/SKILL.md：frontmatter name=({fm_name}) 与目录名不一致")

    if not desc:
        fail(f"{name}/SKILL.md：缺 description")
    elif len(desc) > MAX_DESC_CHARS:
        fail(f"{name}/SKILL.md：description {len(desc)} 字符超 {MAX_DESC_CHARS}")

    n_lines = len([l for l in lines]) - 1 if text.endswith("\n") else len(lines)
    if n_lines > MAX_SKILL_LINES:
        fail(f"{name}/SKILL.md：{n_lines} 行超 {MAX_SKILL_LINES}")

    for pat in HARDCODED_PATTERNS:
        for i, line in enumerate(lines, 1):
            if pat in line:
                print(f"✗ {name}/SKILL.md:{i}：硬编码路径 {pat}（skill 可能装在任意目录）")
                failures += 1

    for ref in set(re.findall(r"`((?:scripts|references)/[\w./-]+)`", text)):
        if not os.path.exists(os.path.join(root, name, ref)):
            fail(f"{name}/SKILL.md：引用的 {ref} 不存在")

    sdir = os.path.join(root, name, "scripts")
    if os.path.isdir(sdir):
        for f in sorted(os.listdir(sdir)):
            if f.endswith((".sh", ".py")):
                mode = os.stat(os.path.join(sdir, f)).st_mode
                if not mode & 0o111:
                    fail(f"{name}/scripts/{f}：无可执行位（chmod +x）")

# ── 索引一致性 ────────────────────────────────────────────────────
readme = open(os.path.join(root, "README.md")).read()
readme_names = set(re.findall(r"^\| \[([\w-]+)\]\(\./", readme, re.M))
readme_en = open(os.path.join(root, "README.en.md")).read()
readme_en_names = set(re.findall(r"^\| \[([\w-]+)\]\(\./", readme_en, re.M))
mkt = open(os.path.join(root, "MARKETPLACE.md")).read()
mkt_names = set(re.findall(r"^### ([\w-]+)\s*$", mkt, re.M))

hook_only = entry_names - entry_skill_dirs
for d in sorted(skill_dirs):
    if d not in readme_names:
        fail(f"目录 {d} 不在 README.md 的 Skills 表格里")
    if d not in mkt_names:
        fail(f"目录 {d} 不在 MARKETPLACE.md 索引里")
    if d not in entry_names:
        fail(f"目录 {d} 不在 marketplace.json 里")
for name in sorted(readme_names | mkt_names):
    if name not in skill_dirs and name not in hook_only:
        fail(f"索引里的 {name} 没有对应目录（且非 hook-only entry）")


def check_exact_index(label, actual):
    missing = entry_names - actual
    extra = actual - entry_names
    if missing:
        fail(f"{label} 缺 entry：{', '.join(sorted(missing))}")
    if extra:
        fail(f"{label} 多出未知 entry：{', '.join(sorted(extra))}")


check_exact_index("README.md Skills 表格", readme_names)
check_exact_index("README.en.md Skills 表格", readme_en_names)
check_exact_index("MARKETPLACE.md", mkt_names)

def check_badge(label, text):
    badges = re.findall(r"skills-(\d+)-blue", text)
    if len(badges) != 1:
        fail(f"{label} skill badge 数量应为 1，实际 {len(badges)}")
    elif int(badges[0]) != len(entry_names):
        fail(f"{label} skill badge={badges[0]}，实际 plugin entry={len(entry_names)}")


check_badge("README.md", readme)
check_badge("README.en.md", readme_en)

cards_path = os.path.join(root, "assets/readme/cards-src/cards.json")
try:
    cards = json.load(open(cards_path))
    card_names_list = [c.get("name") for c in cards]
    invalid_names = [name for name in card_names_list if not isinstance(name, str) or not name]
    if invalid_names:
        fail("cards.json 存在缺失或非字符串 name")
    valid_names = [name for name in card_names_list if isinstance(name, str) and name]
    card_names = set(valid_names)
    if len(valid_names) != len(card_names):
        fail("cards.json 存在重复 name")
    check_exact_index("cards.json", card_names)
except Exception as e:
    fail(f"cards.json 无法解析：{e}")

# ── 画廊单一事实源 ────────────────────────────────────────────────
gallery_gen = os.path.join(root, "assets/readme/cards-src/build_gallery.py")
if os.path.exists(gallery_gen):
    import subprocess
    r = subprocess.run([sys.executable, gallery_gen, "--check"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        detail = (r.stdout + r.stderr).strip()
        # traceback 的根因（异常类型+消息）在最后一个非空行
        last = [l for l in detail.splitlines() if l.strip()]
        reason = last[-1][:200] if last else "运行 assets/readme/cards-src/build_gallery.py 重新生成"
        fail("画廊校验未通过——" + reason)

if failures:
    print(f"\n共 {failures} 处违规")
    sys.exit(1)
print(f"✓ 市场校验通过：{len(skill_dirs)} 个 skill，{len(plugins)} 个 plugin entry")
