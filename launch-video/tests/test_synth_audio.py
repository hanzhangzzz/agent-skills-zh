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
NAMES = ("click", "tick", "pop", "chime", "snap", "whoosh", "reveal", "type")


def synth(out, duration):
    subprocess.run([sys.executable, SCRIPT, "--out", out, "--duration", str(duration)], check=True, capture_output=True)


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
            digest = lambda d: hashlib.sha256(open(os.path.join(d, "bgm.wav"), "rb").read()).hexdigest()  # noqa: E731
            self.assertEqual(digest(a), digest(b))

    def test_rejects_bad_duration(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, SCRIPT, "--out", d, "--duration", "0"], capture_output=True)
            self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
