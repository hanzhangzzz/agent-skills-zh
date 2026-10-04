#!/usr/bin/env python3
"""motion_check.py flags a clip that stands still and passes one that keeps moving."""
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "motion_check.py")


def clip(path, moving):
    """3s clip: a box either sweeps across the frame or sits still."""
    x = "t*150" if moving else "200"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=640x360:r=30:d=3",
         "-f", "lavfi", "-i", "color=c=white:s=120x120:r=30:d=3",
         "-filter_complex", f"overlay=x='{x}':y=100", "-pix_fmt", "yuv420p", path],
        check=True)


def check(video):
    return subprocess.run([sys.executable, SCRIPT, "--video", video, "--still", "2"], capture_output=True, text=True)


class MotionCheckTest(unittest.TestCase):
    def test_still_is_flagged_and_moving_passes(self):
        with tempfile.TemporaryDirectory() as d:
            still, moving = os.path.join(d, "still.mp4"), os.path.join(d, "moving.mp4")
            clip(still, moving=False)
            clip(moving, moving=True)
            r = check(still)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("STILL", r.stdout)
            r = check(moving)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("no still run", r.stdout)


if __name__ == "__main__":
    unittest.main()
