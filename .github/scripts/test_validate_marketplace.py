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
    def test_malformed_catalog_row_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = copy_repo(Path(tmp))
            path = repo / "README.md"
            text = path.read_text()
            line = next(line for line in text.splitlines() if line.startswith("| [hook-test-kit]"))
            path.write_text(text.replace(line, line.rsplit("|", 1)[0]))
            self.assertNotEqual(0, validate(repo).returncode)

    def test_stale_english_gallery_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = copy_repo(Path(tmp))
            path = repo / "README.en.md"
            text = path.read_text().replace("Original article, Chinese translation", "outdated claim")
            path.write_text(text)
            self.assertNotEqual(0, validate(repo).returncode)

    def test_missing_readme_target_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = copy_repo(Path(tmp))
            path = repo / "README.md"
            path.write_text(path.read_text().replace("./AGENTS.md", "./missing-instructions.md"))
            self.assertNotEqual(0, validate(repo).returncode)

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
