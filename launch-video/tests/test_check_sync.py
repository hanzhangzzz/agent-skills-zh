#!/usr/bin/env python3
"""check_sync.py passes a cue whose picture moves on time and flags one that moves late."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "check_sync.py")


def clip(path, appear):
    """2s grey clip; a white box appears at `appear` seconds."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=640x360:r=30:d=2",
         "-vf", f"drawbox=x=200:y=100:w=200:h=150:c=white:t=fill:enable='gte(t,{appear})'",
         "-pix_fmt", "yuv420p", path],
        check=True)


def check(video, cues):
    return subprocess.run([sys.executable, SCRIPT, "--video", video, "--cues", cues],
                          capture_output=True, text=True)


class CheckSyncTest(unittest.TestCase):
    def test_on_time_passes_late_is_flagged(self):
        with tempfile.TemporaryDirectory() as d:
            cues = os.path.join(d, "cues.json")
            with open(cues, "w") as f:
                json.dump({"cues": [{"t": 1.0, "sfx": "pop"}]}, f)
            on_time, late = os.path.join(d, "on.mp4"), os.path.join(d, "late.mp4")
            clip(on_time, 1.0)
            clip(late, 1.3)

            ok = check(on_time, cues)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)

            bad = check(late, cues)
            self.assertEqual(bad.returncode, 1, bad.stdout + bad.stderr)
            self.assertIn("LATE", bad.stdout)


if __name__ == "__main__":
    unittest.main()
