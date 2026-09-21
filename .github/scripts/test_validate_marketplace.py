#!/usr/bin/env python3
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = Path(".github/scripts/validate_marketplace.py")


def copy_repo(destination: Path) -> Path:
    target = destination / "repo"
    shutil.copytree(
        ROOT,
        target,
        ignore=shutil.ignore_patterns(".git", ".omx", "node_modules", "output"),
    )
    return target


def validate(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(repo / VALIDATOR), str(repo)],
        text=True,
        capture_output=True,
    )


class MarketplaceMutationTest(unittest.TestCase):
    def test_wrong_badge_count_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = copy_repo(Path(tmp))
            path = repo / "README.md"
            text = re.sub(r"skills-\d+-blue", "skills-999-blue", path.read_text(), count=1)
            path.write_text(text)
            result = validate(repo)
            self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)

    def test_missing_english_skill_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = copy_repo(Path(tmp))
            path = repo / "README.en.md"
            lines = [line for line in path.read_text().splitlines() if not line.startswith("| [hook-test-kit]")]
            path.write_text("\n".join(lines) + "\n")
            result = validate(repo)
            self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)

    def test_wrong_english_badge_count_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = copy_repo(Path(tmp))
            path = repo / "README.en.md"
            text = re.sub(r"skills-\d+-blue", "skills-999-blue", path.read_text(), count=1)
            path.write_text(text)
            result = validate(repo)
            self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)

    def test_missing_hook_only_skill_in_chinese_table_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = copy_repo(Path(tmp))
            path = repo / "README.md"
            lines = [line for line in path.read_text().splitlines() if not line.startswith("| [git-push-guard]")]
            path.write_text("\n".join(lines) + "\n")
            result = validate(repo)
            self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
