#!/usr/bin/env python3
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class FlywheelPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skill = (ROOT / "do-something/SKILL.md").read_text(encoding="utf-8")
        cls.mr_ops = (ROOT / "do-something/references/mr-ops.md").read_text(encoding="utf-8")
        cls.state = (ROOT / "DO.md").read_text(encoding="utf-8")

    def test_value_gate_requires_evidence_purpose_durability_and_completion(self) -> None:
        for term in ("证据", "目的关联", "持久成果", "真正完成"):
            self.assertIn(term, self.skill)

    def test_noop_is_evidence_based_not_quota_based(self) -> None:
        self.assertIn("NO-OP", self.skill)
        self.assertIn("证据指纹", self.skill)
        self.assertNotIn("每天最多", self.skill)
        self.assertNotIn("连续 2 次", self.skill)
        self.assertNotIn("6 小时冷却", self.skill)

    def test_verification_only_work_does_not_create_pr(self) -> None:
        self.assertIn("只运行已有测试", self.skill)
        self.assertIn("不 commit、不 push、不创建 MR", self.skill)

    def test_mr_body_exposes_value_and_runtime_evidence(self) -> None:
        for heading in ("## 证据", "## 为什么现在做", "## 持久化产出", "## 完成度", "## 验证", "## 运行版本"):
            self.assertIn(heading, self.mr_ops)
        self.assertIn("git hash-object", self.mr_ops)

    def test_do_md_is_bounded_state_not_append_only_history(self) -> None:
        headings = [line for line in self.state.splitlines() if line.startswith("# ")]
        self.assertEqual(
            ["# 目的", "# 约束", "# 当前状态", "# 已证实不变量", "# 开放风险与候选"],
            headings,
        )
        self.assertNotIn("# 日志", self.state)


if __name__ == "__main__":
    unittest.main()
