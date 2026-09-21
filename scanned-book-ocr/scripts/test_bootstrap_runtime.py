#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("bootstrap_runtime.py")
SPEC = importlib.util.spec_from_file_location("bootstrap_runtime", MODULE_PATH)
assert SPEC and SPEC.loader
bootstrap_runtime = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bootstrap_runtime
SPEC.loader.exec_module(bootstrap_runtime)


class BootstrapRuntimeTests(unittest.TestCase):
    def make_archive(self, path: Path, link_target: str) -> None:
        with tarfile.open(path, "w:gz") as archive:
            directory = tarfile.TarInfo("pkg/lib")
            directory.type = tarfile.DIRTYPE
            directory.mode = 0o755
            archive.addfile(directory)

            data = b"runtime"
            regular = tarfile.TarInfo("pkg/lib/libx.1.dylib")
            regular.size = len(data)
            regular.mode = 0o644
            archive.addfile(regular, io.BytesIO(data))

            link = tarfile.TarInfo("pkg/lib/libx.dylib")
            link.type = tarfile.SYMTYPE
            link.linkname = link_target
            archive.addfile(link)

    def test_safe_relative_symlink_is_extracted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "runtime.tgz"
            output = root / "output"
            output.mkdir()
            self.make_archive(archive, "libx.1.dylib")
            bootstrap_runtime.extract_tar(archive, output)
            link = output / "pkg/lib/libx.dylib"
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.resolve().read_bytes(), b"runtime")

    def test_escaping_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "runtime.tgz"
            output = root / "output"
            output.mkdir()
            self.make_archive(archive, "../../../outside")
            with self.assertRaises(RuntimeError):
                bootstrap_runtime.extract_tar(archive, output)

    def test_find_one_ignores_dsym_debug_payload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            primary = root / "lib/libx.dylib"
            debug = root / "lib/libx.dylib.dSYM/Contents/Resources/DWARF/libx.dylib"
            primary.parent.mkdir(parents=True)
            debug.parent.mkdir(parents=True)
            primary.write_bytes(b"primary")
            debug.write_bytes(b"debug")
            self.assertEqual(bootstrap_runtime._find_one(root, "libx.dylib"), primary)


if __name__ == "__main__":
    unittest.main()
