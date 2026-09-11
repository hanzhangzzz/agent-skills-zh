#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("ocr_book.py")
SPEC = importlib.util.spec_from_file_location("ocr_book", MODULE_PATH)
assert SPEC and SPEC.loader
ocr_book = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ocr_book)


class OcrBookTests(unittest.TestCase):
    def test_normalize_text_is_stable(self) -> None:
        self.assertEqual(ocr_book.normalize_text("\r\n甲  \r\n\r\n乙\r\n"), "甲\n\n乙\n")
        text = "甲\n\n乙\n"
        self.assertEqual(ocr_book.normalize_text(text), text)

    def test_parse_pages_and_reject_descending_range(self) -> None:
        self.assertEqual(ocr_book.parse_pages("3,1-2,2", 3), [1, 2, 3])
        with self.assertRaises(ValueError):
            ocr_book.parse_pages("3-1", 3)

    def test_partition_is_complete_balanced_and_ordered(self) -> None:
        groups = ocr_book.partition_pages(list(range(1, 11)), 3)
        self.assertEqual(groups, [[1, 4, 7, 10], [2, 5, 8], [3, 6, 9]])
        self.assertEqual(sorted(page for group in groups for page in group), list(range(1, 11)))

    def test_combined_text_has_exact_page_markers(self) -> None:
        combined = ocr_book.build_combined({2: "乙\n", 1: "甲\n"})
        self.assertEqual(
            combined,
            "=== PDF_PAGE 0001 ===\n甲\n\n=== PDF_PAGE 0002 ===\n乙\n",
        )

    def test_chapter_pages_ignore_running_headers(self) -> None:
        pages = {
            40: "示例教程 第2章 基础知识 29\n正文\n",
            88: "## 第6章\n\nChapter6\n\n# 认识植物\n",
            100: "第7章\nChapter7\n观察叶片形状\n",
        }
        self.assertEqual(ocr_book.chapter_pages(pages), [88, 100])

    def test_atomic_write_text_replaces_complete_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "value.txt"
            ocr_book.atomic_write_text(path, "first\n")
            ocr_book.atomic_write_text(path, "second\n")
            self.assertEqual(path.read_text(encoding="utf-8"), "second\n")
            self.assertFalse(path.with_name("value.txt.tmp").exists())


if __name__ == "__main__":
    unittest.main()
