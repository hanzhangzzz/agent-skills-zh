#!/usr/bin/env python3
"""Exercise wrapper exit paths without a browser, network, or package installation."""

import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest


WRAPPER = Path(__file__).resolve().parents[1] / "scripts/download_wechat_article.sh"


class DownloadWrapperTests(unittest.TestCase):
    def test_payload_cleanup_on_success_and_downstream_failures(self):
        for failure, expected in [("", 0), ("extract", 17), ("save", 23)]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as scratch:
                root = Path(scratch)
                scripts = root / "skill/scripts"
                commands = root / "bin"
                payloads = root / "payloads"
                modules = root / "modules"
                for directory in (scripts, commands, payloads, modules):
                    directory.mkdir(parents=True)
                shutil.copyfile(WRAPPER, scripts / WRAPPER.name)
                (scripts / "extract_wechat_article.mjs").write_text("// replaced by node fixture\n")
                (scripts / "save_wechat_article.py").write_text(
                    "import json, os, sys\nfrom pathlib import Path\n"
                    "json.loads(Path(sys.argv[sys.argv.index('--input') + 1]).read_text())\n"
                    "sys.exit(23 if os.environ['WRAPPER_TEST_FAILURE'] == 'save' else 0)\n"
                )
                package = root / "skill/node_modules/playwright-core/package.json"
                package.parent.mkdir(parents=True)
                package.write_text("{}\n")
                for module in ("requests", "bs4", "markdownify"):
                    (modules / f"{module}.py").write_text("")
                for command in ("dirname", "rm"):
                    (commands / command).symlink_to(shutil.which(command))
                (commands / "python3").symlink_to(sys.executable)
                # No `python` alias: this also exercises the python3-first path.
                node = commands / "node"
                node.write_text(
                    "#!/bin/sh\n"
                    '[ "$WRAPPER_TEST_FAILURE" = extract ] && exit 17\n'
                    "printf '%s' '{\"title\":\"fixture\"}'\n"
                )
                node.chmod(0o755)
                mktemp = commands / "mktemp"
                mktemp.write_text(
                    "#!/bin/sh\nexec " + shlex.quote(shutil.which("mktemp"))
                    + ' "$WRAPPER_TEST_TMP/payload.XXXXXX"\n'
                )
                mktemp.chmod(0o755)
                result = subprocess.run(
                    [shutil.which("bash"), str(scripts / WRAPPER.name),
                     "https://mp.weixin.qq.com/s/fixture", str(root / "output")],
                    env={**os.environ, "PATH": str(commands), "PYTHONPATH": str(modules),
                         "WECHAT_CHROME_PATH": str(node), "WRAPPER_TEST_TMP": str(payloads),
                         "WRAPPER_TEST_FAILURE": failure},
                    text=True, capture_output=True,
                )
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertEqual([], list(payloads.iterdir()), "wrapper left a temporary payload")


if __name__ == "__main__":
    unittest.main()
