#!/usr/bin/env python3
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ReviewPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.prompt = (ROOT / "ci-review/prompts/review.md").read_text(encoding="utf-8")
        cls.github = (ROOT / "ci-review/templates/github-ci-review.yml").read_text(encoding="utf-8")
        cls.gitlab = (ROOT / "ci-review/templates/gitlab-ci-review.yml").read_text(encoding="utf-8")

    def test_markdown_is_not_blanket_exempt(self) -> None:
        self.assertNotIn("纯文档改动直接 pass", self.prompt)
        self.assertNotIn("只改了 DO.md 及其他 *.md 文档", self.prompt)
        for behavior_path in ("*/SKILL.md", "*/references/**", "CLAUDE.md"):
            self.assertIn(behavior_path, self.prompt)

    def test_do_branches_require_value_and_execution(self) -> None:
        self.assertIn("execution=pass|fail value=pass|fail|na", self.prompt)
        self.assertIn("证据", self.prompt)
        self.assertIn("持久", self.prompt)
        self.assertIn("NO-OP", self.prompt)

    def test_findings_converge(self) -> None:
        # 零发现门槛 + 每轮新增代码会让审查永远过不了：必须有分级、按类、后续轮收敛
        self.assertIn("非阻断备注", self.prompt)
        self.assertIn("要人为构造才触发", self.prompt)
        self.assertIn("同类位置", self.prompt)
        self.assertIn("上一轮没修好", self.prompt)
        self.assertIn("后续轮收敛", self.prompt)
        self.assertIn("审查环境缺依赖", self.prompt)

    def test_dogfood_copies_match_sources(self) -> None:
        # 本仓库是 skill 源，自装副本必须与源一致，否则策略测试只锁住了模板。
        # CI 文件顶部的 CI_REVIEW_MERGE* 是文档化的仓库本地配置（install.sh merge on|off 会改），比较前抹掉。
        import re
        local = re.compile(r"^(\s*CI_REVIEW_MERGE\w*:).*$", re.M)
        pairs = {
            "ci-review/prompts/review.md": ".github/ci-review.md",
            "ci-review/scripts/verdict_gate.sh": ".github/scripts/ci-review-verdict.sh",
            "ci-review/templates/github-ci-review.yml": ".github/workflows/ci-review.yml",
        }
        for src, dst in pairs.items():
            a = local.sub(r"\1", (ROOT / src).read_text(encoding="utf-8"))
            b = local.sub(r"\1", (ROOT / dst).read_text(encoding="utf-8"))
            self.assertEqual(a, b, f"{dst} 与 {src} 不一致：本仓库是 skill 源，先改 {src} 再拷到 {dst}")

if __name__ == "__main__":
    unittest.main()
