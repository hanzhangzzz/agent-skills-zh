#!/usr/bin/env python3
"""Synthesize a background track and a small SFX kit with the standard library only.

Everything is generated from code with fixed seeds, so the output is reproducible and
carries no third-party licence. Output: <out>/bgm.wav and <out>/sfx/<name>.wav.

Usage: synth_audio.py --out DIR [--duration 30] [--bpm 100]
"""
import argparse
import math
import os
import random
import struct
import wave

SR = 44100
TAU = 2 * math.pi
SFX_NAMES = ("click", "tick", "pop", "chime", "snap", "whoosh", "reveal", "type")


def write_wav(path, samples, peak=0.89):
    """Normalise mono float samples to `peak` and write 16-bit stereo."""
    top = max(1e-9, max(abs(s) for s in samples))
    k = peak / top
    frames = bytearray()
    for s in samples:
        v = int(max(-1.0, min(1.0, s * k)) * 32767)
        frames += struct.pack("<hh", v, v)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))


def lowpass(samples, cutoff_fn):
    """One-pole low-pass whose cutoff (Hz) may vary per sample index."""
    out, y = [], 0.0
    for i, x in enumerate(samples):
        a = 1 - math.exp(-TAU * cutoff_fn(i) / SR)
        y += a * (x - y)
        out.append(y)
    return out


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


# ---------------------------------------------------------------- SFX
def sfx(name):
    rnd = random.Random(name)
    if name == "click":
        n = int(SR * .04)
        return [(rnd.uniform(-1, 1) * math.exp(-i / SR / .0018) + .6 * math.sin(TAU * 2900 * i / SR) * math.exp(-i / SR / .006)) for i in range(n)]
    if name == "tick":
        n = int(SR * .08)
        return [math.sin(TAU * 1750 * i / SR) * math.exp(-i / SR / .014) for i in range(n)]
    if name == "pop":
        n, ph, out = int(SR * .14), 0.0, []
        for i in range(n):
            t = i / SR
            ph += TAU * (480 + 620 * min(1, t / .05)) / SR
            out.append(math.sin(ph) * math.exp(-t / .045) * min(1, t / .002))
        return out
    if name == "chime":
        n, out = int(SR * .9), []
        for i in range(n):
            t = i / SR
            s = math.sin(TAU * midi(88) * t) * math.exp(-t / .35)
            if t > .07:
                s += .9 * math.sin(TAU * midi(93) * (t - .07)) * math.exp(-(t - .07) / .45)
            out.append(s * min(1, t / .003))
        return out
    if name == "snap":
        n = int(SR * .16)
        return [(.7 * rnd.uniform(-1, 1) * math.exp(-i / SR / .006) + math.sin(TAU * 170 * i / SR) * math.exp(-i / SR / .045)) for i in range(n)]
    if name == "whoosh":
        n = int(SR * .75)
        noise = [rnd.uniform(-1, 1) for _ in range(n)]
        shape = lambda i: math.sin(math.pi * i / n) ** 2  # noqa: E731
        f = lowpass(noise, lambda i: 250 + 3800 * shape(i))
        return [x * shape(i) for i, x in enumerate(f)]
    if name == "reveal":
        n, out, ph = int(SR * 1.8), [], 0.0
        for i in range(n):
            t = i / SR
            ph += TAU * (38 + 30 * math.exp(-t / .12)) / SR
            boom = math.sin(ph) * math.exp(-t / .35)
            shimmer = sum(math.sin(TAU * midi(m) * t * (1 + d)) for m, d in ((69, 0), (73, .002), (76, -.002), (81, .001))) / 4
            shimmer *= min(1, t / .08) * math.exp(-t / .7) * .6
            out.append(boom + shimmer)
        return out
    if name == "type":
        n, out, keys, t = int(SR * .9), [0.0] * int(SR * .9), [], 0.0
        while t < .82:
            keys.append(t)
            t += rnd.uniform(.05, .11)
        for k in keys:
            start, g = int(k * SR), rnd.uniform(.6, 1)
            for j in range(int(SR * .025)):
                if start + j < n:
                    out[start + j] += g * (rnd.uniform(-1, 1) * math.exp(-j / SR / .002) + .4 * math.sin(TAU * 2100 * j / SR) * math.exp(-j / SR / .005))
        return out
    raise ValueError(name)


# ---------------------------------------------------------------- BGM
# Am7 → Fmaj7 → Cmaj7 → G6, two bars each. Calm, neutral "product film" bed.
CHORDS = [(57, 60, 64, 67), (53, 57, 60, 64), (48, 55, 59, 64), (55, 59, 62, 64)]


def bgm(duration, bpm):
    beat = 60 / bpm
    bar = beat * 4
    span = bar * 2
    n = int(SR * duration)
    rnd = random.Random("bgm")
    out = [0.0] * n
    # pad: chord voices with a short crossfade between chords
    for i in range(n):
        t = i / SR
        ci = int(t / span)
        local = t - ci * span
        cur, prev = CHORDS[ci % 4], CHORDS[(ci - 1) % 4]
        x = min(1.0, local / .6)
        s = 0.0
        for notes, w in ((cur, x), (prev, 1 - x)):
            if w <= 0:
                continue
            for m in notes:
                f = midi(m)
                s += w * (math.sin(TAU * f * t) + .25 * math.sin(TAU * 2 * f * t + .3))
        out[i] = s * .05 * (1 + .12 * math.sin(TAU * .25 * t))
    # bass pluck each bar, arpeggio 8ths, soft kick on beats, hats on off-beats
    def add(start, length, fn):
        a = int(start * SR)
        for j in range(int(length * SR)):
            if 0 <= a + j < n:
                out[a + j] += fn(j / SR)

    t = 0.0
    while t < duration:
        root = CHORDS[int(t / span) % 4][0] - 12
        add(t, bar, lambda u, f=midi(root): .32 * math.sin(TAU * f * u) * math.exp(-u / .9) * min(1, u / .01))
        t += bar
    step, k = beat / 2, 0
    while k * step < duration:
        t = k * step
        notes = CHORDS[int(t / span) % 4]
        m = notes[[0, 2, 1, 3, 2, 1, 3, 2][k % 8]] + 12
        add(t, .45, lambda u, f=midi(m): .09 * math.sin(TAU * f * u) * math.exp(-u / .16) * min(1, u / .004))
        if t >= span:  # rhythm enters after the first two bars
            if k % 2 == 0:
                add(t, .25, lambda u: .35 * math.sin(TAU * (45 + 70 * math.exp(-u / .03)) * u) * math.exp(-u / .09))
            else:
                g = .05 * rnd.uniform(.7, 1)
                add(t, .05, lambda u, g=g: g * rnd.uniform(-1, 1) * math.exp(-u / .01))
        k += 1
    fade_in, fade_out = 1.0, 2.0
    for i in range(n):
        t = i / SR
        out[i] *= min(1, t / fade_in) * min(1, (duration - t) / fade_out)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, default=30)
    ap.add_argument("--bpm", type=float, default=100)
    a = ap.parse_args()
    if a.duration <= 0 or a.duration > 600:
        ap.error("--duration must be in (0, 600]")
    for name in SFX_NAMES:
        write_wav(os.path.join(a.out, "sfx", f"{name}.wav"), sfx(name))
    write_wav(os.path.join(a.out, "bgm.wav"), bgm(a.duration, a.bpm), peak=.7)
    print(f"✓ {os.path.join(a.out, 'bgm.wav')} ({a.duration:.1f}s) + {len(SFX_NAMES)} sfx")


if __name__ == "__main__":
    main()
