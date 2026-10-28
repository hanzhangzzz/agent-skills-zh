#!/usr/bin/env python3
"""motion_check.py: flags still runs, finds single-frame spikes, and reads cut times from cues.json."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "motion_check.py")
spec = importlib.util.spec_from_file_location("motion_check", SCRIPT)
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)


def clip(path, moving):
    """3s clip: a box either sweeps across the frame or sits still."""
    x = "t*150" if moving else "200"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=640x360:r=30:d=3",
         "-f", "lavfi", "-i", "color=c=white:s=120x120:r=30:d=3",
         "-filter_complex", f"overlay=x='{x}':y=100", "-pix_fmt", "yuv420p", path],
        check=True)


def run(*args):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True)


class MotionCheckTest(unittest.TestCase):
    def test_still_is_flagged_and_moving_passes(self):
        with tempfile.TemporaryDirectory() as d:
            still, moving = os.path.join(d, "still.mp4"), os.path.join(d, "moving.mp4")
            clip(still, moving=False)
            clip(moving, moving=True)
            r = run("--video", still, "--still", "2")
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("STILL", r.stdout)
            r = run("--video", moving, "--still", "2")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("no still run", r.stdout)

    def test_pops_finds_one_and_two_frame_spikes_only(self):
        quiet, spike = 500.0, 50000.0
        diffs = [quiet] * 30
        diffs[10] = spike                 # one-frame cut
        diffs[20] = diffs[21] = spike     # two-frame flash (in and out)
        found = mc.pops(diffs, 3.0)
        self.assertEqual([round(t * mc.FPS) for t, _, _ in found], [10, 20])
        # a sustained move is not a pop
        self.assertEqual(mc.pops([quiet] * 5 + [spike] * 10 + [quiet] * 5, 3.0), [])
        # spikes below the floor are noise, not pops
        self.assertEqual(mc.pops([10.0] * 5 + [200.0] + [10.0] * 5, 3.0), [])

    def test_cues_file_supplies_cut_times(self):
        with tempfile.TemporaryDirectory() as d:
            moving, cues = os.path.join(d, "moving.mp4"), os.path.join(d, "cues.json")
            clip(moving, moving=True)
            with open(cues, "w") as f:
                json.dump({"mood": "calm", "cues": [], "scenes": [0, 1.5]}, f)
            r = run("--video", moving, "--cues", cues, "--table")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("cuts (motion per frame", r.stdout)
            self.assertIn("1.50s", r.stdout)


if __name__ == "__main__":
    unittest.main()
