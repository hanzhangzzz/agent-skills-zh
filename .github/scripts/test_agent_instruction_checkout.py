#!/usr/bin/env python3
"""Keep both agent entrypoints usable when Git cannot materialize symlinks."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class AgentInstructionCheckoutTest(unittest.TestCase):
    def test_instruction_import_survives_checkout(self):
        for symlinks in ("true", "false"):
            with self.subTest(core_symlinks=symlinks), tempfile.TemporaryDirectory() as tmp:
                repo = Path(tmp) / "repo"
                checkout = Path(tmp) / "checkout"
                repo.mkdir()
                checkout.mkdir()
                env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}

                def git(*args):
                    return subprocess.check_output(
                        ["git", "-C", str(repo), *args], env=env, text=True,
                        stderr=subprocess.PIPE,
                    )

                git("init", "-q")
                # Preserve the actual source file types so reintroducing a symlink
                # is tested under core.symlinks=false, not hidden by copying.
                for name in ("AGENTS.md", "CLAUDE.md"):
                    shutil.copy2(ROOT / name, repo / name, follow_symlinks=False)
                git("add", "AGENTS.md", "CLAUDE.md")
                git("-c", f"core.symlinks={symlinks}", "checkout-index", "--all",
                    f"--prefix={checkout}{os.sep}")

                entrypoint = checkout / "CLAUDE.md"
                self.assertFalse(entrypoint.is_symlink())
                import_line = entrypoint.read_text().strip()
                self.assertTrue(import_line.startswith("@"), import_line)
                imported = entrypoint.parent / import_line[1:]
                self.assertEqual(imported.resolve(), (checkout / "AGENTS.md").resolve())
                self.assertEqual(imported.read_bytes(), (ROOT / "AGENTS.md").read_bytes())
                self.assertIn("bash .github/scripts/run_behavior_tests.sh", imported.read_text())


if __name__ == "__main__":
    unittest.main()
