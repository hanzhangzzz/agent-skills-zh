#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('build_gallery', Path(__file__).with_name('build_gallery.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BuildGalleryTest(unittest.TestCase):
    def test_badges_separate_skills_from_hook_plugins(self):
        source = 'skills-99-blue hook_plugins-99-purple\n<!-- cards-gallery-start -->\nold\n<!-- cards-gallery-end -->\ntail'
        actual = MODULE.update_readme(source, 'new', 15, 1)
        self.assertIn('skills-15-blue hook_plugins-1-purple', actual)
        self.assertIn('<!-- cards-gallery-start -->\nnew\n<!-- cards-gallery-end -->', actual)
        self.assertTrue(actual.endswith('tail'))

    def test_rejects_duplicate_markers(self):
        with self.assertRaisesRegex(SystemExit, '区段标记'):
            MODULE.update_readme(MODULE.START * 2 + MODULE.END, 'x', 15, 1)

    def test_only_sourced_previews_are_shown_in_both_languages(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'sample').mkdir()
            (root / 'sample/SKILL.md').write_text('sample')
            (root / 'result.png').write_bytes(b'fixture')
            cards = [{'name': 'format-only', 'output': 'not a real result'},
                     {'name': 'sample', 'preview': {'image': 'result.png', 'zh': '中文来源', 'en': 'English source'}}]
            for language, caption in [('zh', '中文来源'), ('en', 'English source')]:
                output = MODULE.render(cards, language, root)
                self.assertNotIn('format-only', output)
                self.assertIn(caption, output)
                self.assertIn('[sample](./sample/SKILL.md)', output)
                self.assertIn('[![sample](./result.png)](./result.png)', output)
            (root / 'result.png').unlink()
            with self.assertRaisesRegex(SystemExit, '案例文件不存在'):
                MODULE.render(cards, 'zh', root)


if __name__ == '__main__':
    unittest.main()
