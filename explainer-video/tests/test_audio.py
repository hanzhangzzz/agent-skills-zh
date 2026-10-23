#!/usr/bin/env python3
"""synth_audio.py + mix.py: every sound renders, beds are clean, hush dips, risers end on the cue, -14 LUFS master."""
import array
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import unittest
import wave

SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
sys.path.insert(0, SCRIPTS)
import synth_audio as sa  # noqa: E402


def read_wav(path):
    with wave.open(path) as w:
        return array.array("h", w.readframes(w.getnframes()))


def decode(path, sr=44100):
    """Mono float samples of a media file's audio."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
                       capture_output=True, check=True)
    return array.array("f", r.stdout)


def rms_db(x):
    return 10 * math.log10(max(1e-20, sum(v * v for v in x) / max(1, len(x))))


def window(x, t0, t1, sr=44100):
    return x[int(t0 * sr):int(t1 * sr)]


def lufs(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True)
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)[-1])


class AudioTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.d = cls.tmp.name
        cls.video = os.path.join(cls.d, "v.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=8",
                        "-pix_fmt", "yuv420p", cls.video], check=True)
        subprocess.run([sys.executable, os.path.join(SCRIPTS, "synth_audio.py"), "--out", os.path.join(cls.d, "kit"),
                        "--duration", "2", "--amb", ",".join(sa.BED_NAMES)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def mix(self, name, spec, *extra):
        cues = os.path.join(self.d, name + ".json")
        with open(cues, "w") as f:
            json.dump(spec, f)
        out = os.path.join(self.d, name, "out.mp4")
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "mix.py"), "--video", self.video, "--cues", cues,
                            "--out", out, *extra], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return out, r.stdout

    def test_every_sfx_renders(self):
        self.assertEqual(len(set(sa.SFX_NAMES)), 21)
        for name in sa.SFX_NAMES:
            x = read_wav(os.path.join(self.d, "kit", "sfx", f"{name}.wav"))
            self.assertGreater(len(x), 1000, name)
            self.assertGreater(max(abs(v) for v in x), 10000, f"{name} is near-silent")

    def test_beds_are_textured_and_clean(self):
        for name in sa.BED_NAMES:
            x = read_wav(os.path.join(self.d, "kit", "amb", f"{name}.wav"))
            self.assertAlmostEqual(len(x) / 2 / sa.SR, sa.LOOP, places=2, msg=name)
            f = [v / 32768 for v in x]
            self.assertLess(max(abs(v) for v in f), .99, f"{name} clips")
            level = rms_db(f)
            self.assertGreater(level, -30, f"{name} is too quiet ({level:.1f} dBFS)")
            # texture, not a flat hiss or a steady tone: short-term level moves around
            blocks = [rms_db(f[i:i + 8820]) for i in range(0, len(f) - 8820, 8820)]
            self.assertGreater(max(blocks) - min(blocks), .3, f"{name} has no movement")
            # seamless loop: the wrap-around step is no bigger than ordinary sample-to-sample steps
            left = f[0::2]
            steps = sorted(abs(left[i + 1] - left[i]) for i in range(len(left) - 1))
            self.assertLessEqual(abs(left[0] - left[-1]), steps[int(len(steps) * .9999)] + 1e-3, f"{name} loop clicks")

    def test_hush_dips_music_and_ambience(self):
        out, _ = self.mix("hush", {"mood": "calm", "cues": [], "amb": [{"t0": 0, "t1": 8, "name": "room"}],
                                   "hush": [[3, 5]], "duck": True})
        x = decode(out)
        inside = rms_db(window(x, 3.05, 4.95))
        outside = rms_db(window(x, 1.0, 2.6) + window(x, 5.4, 6.0))
        self.assertGreaterEqual(outside - inside, 15, f"hush only {outside - inside:.1f} dB")

    def test_riser_ends_on_its_cue(self):
        silence = os.path.join(self.d, "silence.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "8",
                        silence], check=True)
        out, _ = self.mix("riser", {"cues": [{"t": 4, "sfx": "riser", "gain": .8}]}, "--music", silence)
        x = decode(out)
        self.assertGreater(rms_db(window(x, 3.7, 3.98)) - rms_db(window(x, 2.0, 2.3)), 10, "riser does not swell")
        self.assertLess(rms_db(window(x, 4.05, 4.5)), rms_db(window(x, 3.7, 3.98)) - 40, "riser runs past its cue")

    def test_master_is_minus_14_lufs(self):
        out, log = self.mix("loud", {"mood": "pulse", "cues": [{"t": 2, "sfx": "impact", "gain": .9},
                                                             {"t": 5, "sfx": "metal", "gain": .6}],
                                     "amb": [{"t0": 0, "t1": 4, "name": "wind"}, {"t0": 4, "t1": 8, "name": "fire"}],
                                     "duck": True})
        self.assertIn("LUFS", log)
        self.assertLessEqual(abs(lufs(out) + 14), 1.0)
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out],
                               capture_output=True, text=True).stdout.split()
        self.assertEqual(sorted(probe), ["audio", "video"])

    def test_unknown_bed_is_rejected(self):
        cues = os.path.join(self.d, "bad.json")
        with open(cues, "w") as f:
            json.dump({"amb": [{"t0": 0, "t1": 2, "name": "jungle"}]}, f)
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "mix.py"), "--video", self.video, "--cues", cues,
                            "--out", os.path.join(self.d, "bad", "o.mp4")], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("jungle", r.stderr)


if __name__ == "__main__":
    unittest.main()
