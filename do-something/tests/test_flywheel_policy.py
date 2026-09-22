#!/usr/bin/env python3
from pathlib import Path
import unittest
import json
import shlex
import subprocess


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

    def test_feedback_includes_plain_comments_on_both_platforms(self) -> None:
        # 只查可解决线程会漏掉 GitLab resolvable=false 的普通评论和 GitHub 对话区评论
        self.assertIn("新普通评论", self.skill)
        self.assertIn("feedback_seen", self.skill)
        for endpoint in ("issues/<n>/comments", "pulls/<n>/reviews", "merge_requests/<iid>/notes"):
            self.assertIn(endpoint, self.mr_ops)
        self.assertIn(".system == false", self.mr_ops)
        self.assertIn("<!-- do-something -->", self.mr_ops)

    def test_documented_feedback_filters_accept_null_and_missing_bodies(self) -> None:
        filters = []
        for line in self.mr_ops.splitlines():
            if "startswith" not in line:
                continue
            if '--jq "' in line:
                filters.append((shlex.split(line.strip())[1].replace("$W", "2026-01-01T00:00:00Z"), False))
            elif "jq -s" in line:
                filters.append((shlex.split(line.strip())[6], True))
        self.assertEqual(3, len(filters))
        records = [
            {"id": 1, "body": None}, {"id": 2},
            {"id": 3, "body": ""},
            {"id": 4, "body": "<!-- do-something --> already handled"},
            {"id": 5, "body": "Please fix this"},
            {"id": 6, "body": "<!-- ci-review last=abc execution=fail --> review feedback"},
        ]
        for record in records:
            record.update(created_at="2026-01-02T00:00:00Z", submitted_at="2026-01-02T00:00:00Z", system=False)
        for expression, slurp in filters:
            with self.subTest(filter=expression):
                command = ["jq", "-c", "--arg", "w", "2026-01-01T00:00:00Z"]
                if slurp:
                    command.append("-s")
                result = subprocess.run(command + [expression], input=json.dumps(records), text=True, capture_output=True)
                self.assertEqual(0, result.returncode, result.stderr)
                ids = [json.loads(line)["id"] for line in result.stdout.splitlines()]
                self.assertIn(5, ids)
                self.assertIn(6, ids)
                self.assertNotIn(4, ids)

    def test_do_md_is_bounded_state_not_append_only_history(self) -> None:
        headings = [line for line in self.state.splitlines() if line.startswith("# ")]
        self.assertEqual(
            ["# 目的", "# 约束", "# 当前状态", "# 已证实不变量", "# 开放风险与候选"],
            headings,
        )
        self.assertNotIn("# 日志", self.state)


if __name__ == "__main__":
    unittest.main()
