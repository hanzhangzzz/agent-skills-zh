#!/usr/bin/env python3
"""行为锁定：文档选择、家族解析、密钥打码、SKILL 契约。零网络。"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = ROOT / 'model-prompt-audit'
sys.path.insert(0, str(SKILL_DIR / 'scripts'))
import fetch_guides  # noqa: E402
import inventory  # noqa: E402

LLMS = """
- [Prompting best practices](https://example.test/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices.md)
- [Prompting Claude Alpha 2.1](https://example.test/docs/en/build-with-claude/prompt-engineering/prompting-claude-alpha-2-1.md)
- [Prompting Claude Alpha 2](https://example.test/docs/en/build-with-claude/prompt-engineering/prompting-claude-alpha-2.md)
- [Prompting Claude Beta 3](https://example.test/docs/en/build-with-claude/prompt-engineering/prompting-claude-beta-3.md)
- [What's new](https://example.test/docs/en/models/alpha-2-1/whats-new-alpha-2-1.md)
- [Migration guide](https://example.test/docs/en/models/alpha-2-1/migration-guide.md)
- [Overview](https://example.test/docs/en/models/alpha-2-1/overview.md)
- [Pricing](https://example.test/docs/en/about-claude/pricing.md)
"""


class FamilyTest(unittest.TestCase):
    def test_strips_prefixes_suffixes(self):
        self.assertEqual(fetch_guides.family('claude-alpha-2-1[1m]'), ('alpha-2-1', 'alpha'))
        self.assertEqual(fetch_guides.family('us.anthropic.claude-beta-3-20260101-v1:0'), ('beta-3', 'beta'))
        self.assertEqual(fetch_guides.family('claude-haiku-4-5-20251001'), ('haiku-4-5', 'haiku'))


class SelectTest(unittest.TestCase):
    def test_selects_guides_best_practices_and_family_pages(self):
        urls = [e['url'] for e in fetch_guides.rank(fetch_guides.select_urls(LLMS, 'claude-alpha-2-1'), 'claude-alpha-2-1')]
        self.assertTrue(urls[0].endswith('prompting-claude-alpha-2-1.md'), '当前模型指引排第一')
        self.assertIn('https://example.test/docs/en/models/alpha-2-1/whats-new-alpha-2-1.md', urls)
        self.assertIn('https://example.test/docs/en/models/alpha-2-1/migration-guide.md', urls)
        self.assertIn('https://example.test/docs/en/build-with-claude/prompt-engineering/prompting-claude-beta-3.md', urls, '其它家族指引也要读，用于代际对比')
        self.assertTrue(any(u.endswith('claude-prompting-best-practices.md') for u in urls))
        self.assertFalse(any('overview.md' in u or 'pricing.md' in u for u in urls), '与提示词无关的页面不抓')

    def test_missing_own_guide_is_visible(self):
        entries = fetch_guides.select_urls(LLMS, 'claude-gamma-9')
        self.assertFalse(any('gamma-9' in e['url'] for e in entries))


class InventoryTest(unittest.TestCase):
    def test_masks_secrets_but_not_counts(self):
        s = inventory.summarize_settings({'model': 'm', 'env': {'ANTHROPIC_API_KEY': 'sk-x', 'FOO_TOKEN': 't', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS': '128000'}})
        self.assertEqual(s['env']['ANTHROPIC_API_KEY'], '***')
        self.assertEqual(s['env']['FOO_TOKEN'], '***')
        self.assertEqual(s['env']['CLAUDE_CODE_MAX_OUTPUT_TOKENS'], '128000')

    def test_frontmatter_multiline_description(self):
        meta = inventory.frontmatter('---\nname: x\ndescription: |\n  first line\n  second line\ntrigger: /x\n---\nbody')
        self.assertEqual(meta['name'], 'x')
        self.assertEqual(meta['description'], 'first line second line')


class SkillContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = (SKILL_DIR / 'SKILL.md').read_text(encoding='utf-8')

    def test_frontmatter(self):
        self.assertIn('name: model-prompt-audit', self.skill)
        self.assertIn('trigger: /model-prompt-audit', self.skill)

    def test_live_docs_and_approval_gate(self):
        self.assertIn('不用记忆', self.skill)
        self.assertIn('fetch_guides.py', self.skill)
        self.assertIn('批准', self.skill)
        self.assertIn('备份', self.skill)

    def test_no_hardcoded_install_path_or_personal_data(self):
        for bad in ('~/.claude/skills/model-prompt-audit', '/Users/', '/home/'):
            self.assertNotIn(bad, self.skill)
        seeds = (SKILL_DIR / 'references' / 'antipattern-seeds.md').read_text(encoding='utf-8')
        self.assertIn('重新核实', seeds)


if __name__ == '__main__':
    unittest.main()
