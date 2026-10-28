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


def flash_clip(path):
    """3s moving clip with one white frame at 1.5s: a single-frame pop that is not a cut."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=640x360:r=30:d=3",
         "-f", "lavfi", "-i", "color=c=white:s=120x120:r=30:d=3",
         "-f", "lavfi", "-i", "color=c=white:s=640x360:r=30:d=3",
         "-filter_complex", "[0][1]overlay=x='t*150':y=100[m];[m][2]overlay=enable='eq(n,45)'",
         "-pix_fmt", "yuv420p", path],
        check=True)


def check(video, *extra):
    return subprocess.run([sys.executable, SCRIPT, "--video", video, "--still", "2", *extra], capture_output=True, text=True)


class MotionCheckTest(unittest.TestCase):
    def test_single_frame_pop_is_flagged_unless_it_is_a_planned_cut(self):
        with tempfile.TemporaryDirectory() as d:
            flash = os.path.join(d, "flash.mp4")
            flash_clip(flash)
            r = check(flash)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("POP      1.50s", r.stdout)
            r = check(flash, "--scenes", "1.5")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("(planned cut)", r.stdout)

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
