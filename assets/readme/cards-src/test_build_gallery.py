#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("build_gallery.py")
SPEC = importlib.util.spec_from_file_location("build_gallery", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BuildGalleryTest(unittest.TestCase):
    def test_update_readme_updates_gallery_and_skill_badge(self) -> None:
        source = "head skills-99-blue\n<!-- cards-gallery-start -->\nold\n<!-- cards-gallery-end -->\ntail\n"
        actual = MODULE.update_readme(source, "<table>new</table>", 14)
        self.assertIn("skills-14-blue", actual)
        self.assertIn("<!-- cards-gallery-start -->\n<table>new</table>\n<!-- cards-gallery-end -->", actual)
        self.assertNotIn("skills-99-blue", actual)

    def test_update_readme_rejects_ambiguous_markers(self) -> None:
        source = "skills-1-blue\n<!-- cards-gallery-start -->\na\n<!-- cards-gallery-start -->\nb\n<!-- cards-gallery-end -->"
        with self.assertRaisesRegex(SystemExit, "画廊区段标记"):
            MODULE.update_readme(source, "x", 1)

    def test_update_badge_works_for_english_readme(self) -> None:
        self.assertEqual(
            "skills-14-blue",
            MODULE.update_badge("skills-11-blue", 14, "README.en.md"),
        )


if __name__ == "__main__":
    unittest.main()
