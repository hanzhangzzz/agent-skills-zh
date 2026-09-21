#!/usr/bin/env python3
"""锁定 do-something 的 MR 标题必须来自交付成果，而不是长期目的。"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "do-something" / "SKILL.md"
MR_OPS = ROOT / "do-something" / "references" / "mr-ops.md"


def title_contract_errors(skill: str, mr_ops: str) -> list[str]:
    errors = []
    combined = skill + "\n" + mr_ops
    if "do: <目的一句话>" in combined:
        errors.append("MR 标题仍取自长期目的")
    if "origin/<default>...HEAD" not in skill:
        errors.append("SKILL.md 未要求按完整 diff 概括标题")

    for command in ("gh pr create", "gh pr edit", "glab mr create", "glab mr update"):
        matching_lines = [line for line in mr_ops.splitlines() if line.startswith(command)]
        if not matching_lines or '--title "$TITLE"' not in matching_lines[0]:
            errors.append(f"{command} 未显式设置成果标题")
    return errors


class MrTitleContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skill = SKILL.read_text(encoding="utf-8")
        cls.mr_ops = MR_OPS.read_text(encoding="utf-8")

    def test_repository_contract(self) -> None:
        self.assertEqual([], title_contract_errors(self.skill, self.mr_ops))

    def test_rejects_old_purpose_based_title(self) -> None:
        errors = title_contract_errors(
            self.skill + "\n标题 `do: <目的一句话>`",
            self.mr_ops,
        )
        self.assertIn("MR 标题仍取自长期目的", errors)

    def test_rejects_existing_pr_that_does_not_refresh_title(self) -> None:
        mutated = self.mr_ops.replace(
            'gh pr edit <n> --title "$TITLE"',
            "gh pr edit <n>",
        )
        errors = title_contract_errors(self.skill, mutated)
        self.assertIn("gh pr edit 未显式设置成果标题", errors)


if __name__ == "__main__":
    unittest.main()
