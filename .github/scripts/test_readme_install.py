#!/usr/bin/env python3
"""Run the published copy commands against isolated first-install directories."""
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ReadmeInstallTest(unittest.TestCase):
    def test_manual_install_in_fresh_and_existing_directories(self):
        for filename in ('README.md', 'README.en.md'):
            text = (ROOT / filename).read_text()
            block = text.split('<!-- manual-install-start -->')[1].split('<!-- manual-install-end -->')[0]
            command = re.search(r'```bash\n(.*?)\n```', block, re.S).group(1)
            for existing in (False, True):
                with self.subTest(readme=filename, skills_directory_exists=existing), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    source = root / 'doc-reader'
                    source.mkdir()
                    (source / 'SKILL.md').write_text('skill fixture')
                    (source / 'scripts').mkdir()
                    (source / 'scripts/example.py').write_text('script fixture')
                    destination = root / 'user/.claude/skills'
                    if existing:
                        destination.mkdir(parents=True)
                        (destination / 'unrelated').mkdir()
                        (destination / 'unrelated/SKILL.md').write_text('keep me')
                    isolated = command.replace('~/.claude', shlex.quote(str(root / 'user/.claude')))
                    subprocess.run(['bash', '-e', '-c', isolated], cwd=root, check=True)
                    self.assertEqual('skill fixture', (destination / 'doc-reader/SKILL.md').read_text())
                    self.assertTrue((destination / 'doc-reader/scripts/example.py').is_file())
                    self.assertFalse((destination / 'SKILL.md').exists())
                    if existing:
                        self.assertEqual('keep me', (destination / 'unrelated/SKILL.md').read_text())


if __name__ == '__main__':
    unittest.main()
