#!/usr/bin/env python3
"""audio_check / safe_guides / refcompare / score_kit 的行为测试。运行：python3 explainer-video/tests/test_tools.py"""
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import wave

SCRIPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
TMP = tempfile.mkdtemp(prefix="test_tools-")


def py(script, *args):
    return subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args], capture_output=True, text=True)


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def write_wav(name, fn, secs=12, sr=32000, stereo=False):
    p = os.path.join(TMP, name)
    with wave.open(p, "wb") as w:
        w.setnchannels(2 if stereo else 1)
        w.setsampwidth(2)
        w.setframerate(sr)
        buf = bytearray()
        for i in range(secs * sr):
            v = max(-32768, min(32767, int(fn(i / sr))))
            buf += struct.pack("<hh", v, v) if stereo else struct.pack("<h", v)
        w.writeframes(bytes(buf))
    return p


def tone(t, amp=1.0):
    return amp * sum(math.sin(2 * math.pi * 440 * n * t) / n for n in (1, 2, 3))


def music(t):
    env = (0.5 + 0.5 * math.sin(2 * math.pi * t / 8 - 1.2)) ** 3  # 8 s 周期的尖峰起伏，峰值比中位数高 >6 dB
    return tone(t) * 6000 * (0.05 + env)


class AudioCheck(unittest.TestCase):
    def test_music_clean(self):
        r = py("audio_check.py", write_wav("music.wav", music, 24))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("FLAG", r.stdout)

    def test_hiss(self):
        import random
        rnd = random.Random(1)
        r = py("audio_check.py", write_wav("hiss.wav", lambda t: music(t) + (rnd.uniform(-1, 1) * 6000 if 8 <= t < 11 else 0), 24))
        self.assertEqual(r.returncode, 1)
        self.assertIn("FLAG HISS", r.stdout)

    def test_clip(self):
        r = py("audio_check.py", write_wav("clip.wav", lambda t: min(32767, music(t) * 30), 24))
        self.assertIn("FLAG CLIP", r.stdout)

    def test_flat(self):
        r = py("audio_check.py", write_wav("flat.wav", lambda t: tone(t) * 3000, 12))
        self.assertIn("FLAG FLAT", r.stdout)
        self.assertNotIn("FLAG CLIP", r.stdout)
        # a finished mix (sfx + loudness normalisation) is flat by nature: --mix skips FLAT
        r = py("audio_check.py", write_wav("flat-mix.wav", lambda t: tone(t) * 3000, 12), "--mix")
        self.assertNotIn("FLAG FLAT", r.stdout)
        self.assertEqual(r.returncode, 0)

    def test_stereo_peak_not_summed(self):
        # 立体声双声道各 -6 dBFS：若混成单声道相加会误报 CLIP
        r = py("audio_check.py", write_wav("st.wav", lambda t: music(t) / 6000 * 16000, 24, stereo=True))
        self.assertNotIn("FLAG CLIP", r.stdout)


class SafeGuides(unittest.TestCase):
    def img(self, name, w, h):
        p = os.path.join(TMP, name)
        ff("-f", "lavfi", "-i", f"color=c=gray:s={w}x{h}", "-frames:v", "1", p)
        return p

    def width(self, p):
        return int(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", p],
                                  capture_output=True, text=True).stdout.split()[0])

    def test_grid(self):
        a, b = self.img("a.png", 1080, 1920), self.img("b.png", 1080, 1920)
        out = os.path.join(TMP, "grid.jpg")
        r = py("safe_guides.py", "--preset", "xhs", "--cols", "2", "--out", out, a, b)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.width(out), 720)

    def test_size_mismatch(self):
        a = self.img("w.png", 1920, 1080)
        r = py("safe_guides.py", "--preset", "xhs", "--out", os.path.join(TMP, "x.jpg"), a)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("不符", r.stderr)


class RefCompare(unittest.TestCase):
    def test_compare(self):
        ref, ours = os.path.join(TMP, "ref.mp4"), os.path.join(TMP, "ours.mp4")
        ff("-f", "lavfi", "-i", "testsrc=s=720x900:d=3:r=10", "-pix_fmt", "yuv420p", ref)
        ff("-f", "lavfi", "-i", "testsrc=s=1920x1080:d=3:r=10", "-pix_fmt", "yuv420p", ours)
        out = os.path.join(TMP, "sub", "cmp.jpg")
        r = py("refcompare.py", "--ref", ref, "--ours-video", ours, "--n", "3", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.getsize(out) > 1000)
        self.assertIn("720x900", r.stdout)
        self.assertIn("1920x1080", r.stdout)

    def test_crop_and_density(self):
        ref = os.path.join(TMP, "ref2.mp4")
        ours = os.path.join(TMP, "ours2.mp4")
        ff("-f", "lavfi", "-i", "testsrc=s=720x900:d=3:r=10", "-pix_fmt", "yuv420p", ref)
        ff("-f", "lavfi", "-i", "testsrc=s=1920x1080:d=3:r=10", "-pix_fmt", "yuv420p", ours)
        out = os.path.join(TMP, "sub2", "cmp.jpg")
        r = py("refcompare.py", "--ref", ref, "--ours-video", ours, "--n", "3", "--ref-crop", "300x200+50+100",
               "--our-crop", "500x300+200+100", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("300x200+50+100", r.stdout)
        self.assertIn("500x300+200+100", r.stdout)
        self.assertEqual(r.stdout.count("条亮线"), 2)
        bad = py("refcompare.py", "--ref", ref, "--ours-video", ours, "--ref-crop", "9999x10+0+0", "--out", out)
        self.assertNotEqual(bad.returncode, 0)


class ScoreKit(unittest.TestCase):
    def test_render(self):
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("numpy 缺失：score_kit 需要 numpy（python3 -m pip install numpy）")
        sys.path.insert(0, SCRIPTS)
        import array
        import score_kit as k
        s = k.Score(5)
        s.place(k.piano(81, 3, .6), .3)
        s.place(k.pad((50, 57, 62), 4, att=.5), .5)
        s.place(k.pluck(74, .5), 1)
        s.place(k.strings((74, 77), 3), 1)
        s.place(k.riser(1.5), 2)
        s.place(k.boom(2), 3.5)
        s.place(k.sub(38, 1), 3.5)
        p = s.write(os.path.join(TMP, "score.wav"))
        with wave.open(p) as w:
            self.assertEqual(w.getnchannels(), 2)
            self.assertAlmostEqual(w.getnframes() / w.getframerate(), 5, delta=.05)
            a = array.array("h", w.readframes(w.getnframes()))
        peak = max(max(a), -min(a)) / 32768
        self.assertLessEqual(20 * math.log10(peak), -0.5)
        self.assertGreater(peak, .5)
        self.assertTrue(all(math.isfinite(x) for x in a[::97]))
        r = py("audio_check.py", p)  # 合成物过一遍自检：不应有 HISS/CLIP
        self.assertNotIn("FLAG HISS", r.stdout)
        self.assertNotIn("FLAG CLIP", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
