#!/usr/bin/env python3
"""synth_audio.py produces every documented SFX and a bed of the requested length, deterministically."""
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
import wave

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "synth_audio.py")
NAMES = ("click", "tick", "pop", "chime", "snap", "whoosh", "reveal", "type", "thud", "blip", "glitch", "drop")
MOODS = ("calm", "bright", "synthwave", "chiptune", "pentatonic", "pulse")


def synth(out, duration, *extra):
    subprocess.run([sys.executable, SCRIPT, "--out", out, "--duration", str(duration), *extra], check=True, capture_output=True)


def digest(d):
    return hashlib.sha256(open(os.path.join(d, "bgm.wav"), "rb").read()).hexdigest()


class SynthAudioTest(unittest.TestCase):
    def test_outputs_and_determinism(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            synth(a, 3.5)
            synth(b, 3.5)
            with wave.open(os.path.join(a, "bgm.wav")) as w:
                self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (2, 2, 44100))
                self.assertAlmostEqual(w.getnframes() / w.getframerate(), 3.5, places=2)
            for name in NAMES:
                path = os.path.join(a, "sfx", f"{name}.wav")
                self.assertTrue(os.path.getsize(path) > 1000, name)
            self.assertEqual(digest(a), digest(b))

    def test_every_mood_is_distinct_and_audible(self):
        seen = set()
        for mood in MOODS:
            with tempfile.TemporaryDirectory() as d:
                synth(d, 6, "--mood", mood)
                with wave.open(os.path.join(d, "bgm.wav")) as w:
                    self.assertAlmostEqual(w.getnframes() / w.getframerate(), 6, places=2)
                    frames = w.readframes(w.getnframes())
                self.assertGreater(max(frames), 0, mood)
                seen.add(digest(d))
        self.assertEqual(len(seen), len(MOODS))

    def test_rejects_bad_arguments(self):
        for extra in (["--duration", "0"], ["--mood", "jazz"], ["--bpm", "500"]):
            with tempfile.TemporaryDirectory() as d:
                r = subprocess.run([sys.executable, SCRIPT, "--out", d, *extra], capture_output=True)
                self.assertNotEqual(r.returncode, 0, extra)


if __name__ == "__main__":
    unittest.main()
