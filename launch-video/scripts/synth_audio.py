#!/usr/bin/env python3
"""Synthesize a background track and a small SFX kit with the standard library only.

Everything is generated from code with fixed seeds, so the output is reproducible and
carries no third-party licence. Output: <out>/bgm.wav and <out>/sfx/<name>.wav.

Usage: synth_audio.py --out DIR [--duration 30] [--mood calm] [--bpm <mood default>]
Moods (pick the one listed for the chosen style in references/styles.md):
  calm        soft pad + sine arpeggio            editorial, UI demo, glass, data
  bright      major pop, claps, bouncy plucks     flat vector, clay, kinetic type, promo, sticker
  synthwave   saw pads, pulsing 8th bass, gated snare   80s synthwave, neon, chrome type
  chiptune    square lead, triangle bass, noise hats    pixel art
  pentatonic  plucked strings on a pentatonic scale, drone, sparse drum   ink wash, papercut, one-line
  pulse       dark drone, ticking hats, sub pulse, bleeps   HUD, glitch, particles, space, 3D product
"""
import argparse
import math
import os
import random
import struct
import wave

SR = 44100
TAU = 2 * math.pi
SFX_NAMES = ("click", "tick", "pop", "chime", "snap", "whoosh", "reveal", "type", "thud", "blip", "glitch", "drop")
MOOD_BPM = {"calm": 100, "bright": 118, "synthwave": 100, "chiptune": 140, "pentatonic": 72, "pulse": 96}


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
    if name == "thud":  # soft heavy landing: clay drop, big type slamming in
        n, ph, out = int(SR * .5), 0.0, []
        for i in range(n):
            t = i / SR
            ph += TAU * (55 + 90 * math.exp(-t / .04)) / SR
            out.append(math.sin(ph) * math.exp(-t / .16) + .3 * rnd.uniform(-1, 1) * math.exp(-t / .012))
        return out
    if name == "blip":  # 8-bit square sweep up
        n, ph, out = int(SR * .12), 0.0, []
        for i in range(n):
            t = i / SR
            ph += TAU * (660 * 2 ** (t / .06)) / SR
            out.append((1 if math.sin(ph) >= 0 else -1) * .5 * (1 - t / .12))
        return out
    if name == "glitch":  # stuttered, bit-crushed bursts
        n, out = int(SR * .32), []
        hold, v = 0, 0.0
        for i in range(n):
            t = i / SR
            if hold <= 0:
                v, hold = round(rnd.uniform(-1, 1) * 4) / 4, rnd.choice((6, 12, 24, 48))
            hold -= 1
            gate = 1 if int(t / .04) % 3 != 1 else 0
            out.append(gate * (v * .7 + .3 * math.sin(TAU * 140 * t)) * (1 - t / .32))
        return out
    if name == "drop":  # water / ink drop
        n, ph, out = int(SR * .35), 0.0, []
        for i in range(n):
            t = i / SR
            ph += TAU * (300 + 1100 * math.exp(-t / .03)) / SR
            out.append(math.sin(ph) * math.exp(-t / .07) * min(1, t / .001))
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


# ---------------------------------------------------------------- styled moods
def osc(kind, f, t):
    """Band-limited enough for a 30 s bed: few harmonics, no aliasing at the notes used here."""
    x = TAU * f * t
    if kind == "sine":
        return math.sin(x)
    if kind == "saw":
        return sum(math.sin(k * x) / k for k in range(1, 7)) * .6
    if kind == "square":
        return 1.0 if math.sin(x) >= 0 else -1.0
    if kind == "triangle":
        return 2 / math.pi * math.asin(math.sin(x))
    raise ValueError(kind)


def pluck(f, length, rnd, damp=.996):
    """Karplus-Strong plucked string."""
    period = max(2, int(SR / f))
    buf = [rnd.uniform(-1, 1) for _ in range(period)]
    out = []
    for i in range(int(length * SR)):
        a = buf[i % period]
        b = buf[(i + 1) % period]
        buf[i % period] = damp * .5 * (a + b)
        out.append(a)
    return out


MOODS = {
    # chords as MIDI tuples, two bars each
    "bright": {"chords": [(60, 64, 67, 72), (55, 59, 62, 67), (57, 60, 64, 69), (53, 57, 60, 65)],
               "pad": ("sine", .03), "arp": ("triangle", 8, .12, .12), "bass": ("sine", "beats"), "drums": "pop"},
    "synthwave": {"chords": [(57, 60, 64, 69), (53, 57, 60, 65), (48, 52, 55, 60), (55, 59, 62, 67)],
                  "pad": ("saw", .022), "arp": ("saw", 16, .09, .05), "bass": ("saw", "eighths"), "drums": "gated"},
    "chiptune": {"chords": [(60, 64, 67, 72), (57, 60, 64, 69), (53, 57, 60, 65), (55, 59, 62, 67)],
                 "pad": None, "arp": ("square", 16, .07, .04), "bass": ("triangle", "eighths"), "drums": "chip"},
    "pulse": {"chords": [(50, 57, 62, 65), (50, 57, 62, 65), (46, 53, 58, 62), (48, 55, 60, 64)],
              "pad": ("sine", .03), "arp": ("sine", 4, .06, .05), "bass": ("sine", "pulse"), "drums": "ticks"},
}
PENTA = (62, 64, 66, 69, 71, 74, 76, 78, 81)  # D gong pentatonic over two octaves


def styled_bgm(duration, bpm, mood):
    n = int(SR * duration)
    out = [0.0] * n
    rnd = random.Random("bgm-" + mood)
    beat = 60 / bpm
    bar = beat * 4

    def add(start, samples, gain=1.0):
        a = int(start * SR)
        for j, v in enumerate(samples):
            if 0 <= a + j < n:
                out[a + j] += gain * v

    def note(start, length, fn):
        add(start, [fn(j / SR) for j in range(int(length * SR))])

    def noise_hit(start, length, decay, gain, tone=0.0):
        add(start, [(rnd.uniform(-1, 1) + tone * math.sin(TAU * 190 * j / SR)) * math.exp(-j / SR / decay)
                    for j in range(int(length * SR))], gain)

    def kick(start, gain=.3):
        note(start, .3, lambda u: gain * math.sin(TAU * (45 + 80 * math.exp(-u / .03)) * u) * math.exp(-u / .1))

    if mood == "pentatonic":
        # drone on D + A, slow swell
        for i in range(n):
            t = i / SR
            out[i] += .03 * (math.sin(TAU * midi(50) * t) + .7 * math.sin(TAU * midi(57) * t)) * (1 + .3 * math.sin(TAU * .1 * t))
        # sparse plucked melody: random walk on the scale, phrases of 3-5 notes then a rest
        t, idx = beat, 3
        while t < duration - 1:
            for _ in range(rnd.randint(3, 5)):
                idx = max(0, min(len(PENTA) - 1, idx + rnd.choice((-2, -1, -1, 1, 1, 2))))
                add(t, pluck(midi(PENTA[idx]), 2.2, rnd), .32)
                if rnd.random() < .3:  # a low answer note
                    add(t + beat / 2, pluck(midi(PENTA[idx] - 12), 2.0, rnd, .995), .22)
                t += beat * rnd.choice((1, 1, 1.5, 2))
            t += beat * rnd.choice((2, 3))
        t = 0.0
        while t < duration:  # soft frame drum every bar
            note(t, .5, lambda u: .18 * math.sin(TAU * (90 + 50 * math.exp(-u / .05)) * u) * math.exp(-u / .2))
            t += bar * 2
    else:
        m = MOODS[mood]
        span = bar * 2
        chord_at = lambda t: m["chords"][int(t / span) % len(m["chords"])]  # noqa: E731
        if m["pad"]:
            kind, g = m["pad"]
            for i in range(n):
                t = i / SR
                out[i] += g * sum(osc(kind, midi(x), t) for x in chord_at(t)) * (1 + .1 * math.sin(TAU * .25 * t))
        kind, div, g, dec = m["arp"]
        step, k = bar / div, 0
        while k * step < duration:
            t = k * step
            notes = chord_at(t)
            x = notes[[0, 1, 2, 3, 2, 1][k % 6]] + 12
            note(t, dec * 4, lambda u, f=midi(x): g * osc(kind, f, u) * math.exp(-u / dec) * min(1, u / .003))
            k += 1
        bkind, pattern = m["bass"]
        step = {"beats": beat, "eighths": beat / 2, "pulse": beat}[pattern]
        t = 0.0
        while t < duration:
            # one octave below the chord (~100-130 Hz) plus overtones, so it still reads on phone speakers
            f = midi(chord_at(t)[0] - 12)
            gain = .14 if pattern != "pulse" else .18
            note(t, step * .9, lambda u, f=f, gain=gain: gain * (osc(bkind, f, u) + .5 * math.sin(TAU * 2 * f * u) + .25 * math.sin(TAU * 3 * f * u))
                 * math.exp(-u / (step * .6)) * min(1, u / .005))
            t += step
        drums = m["drums"]
        b = 0
        while b * beat < duration:
            t = b * beat
            if t >= span:  # rhythm enters after the first two bars
                if drums in ("pop", "gated"):
                    kick(t)
                    if b % 2 == 1:
                        noise_hit(t, .6 if drums == "gated" else .2, .14 if drums == "gated" else .05, .22, tone=.5)
                    noise_hit(t + beat / 2, .05, .01, .05)
                elif drums == "chip":
                    if b % 2 == 0:
                        note(t, .12, lambda u: .3 * osc("square", 80 * math.exp(-u / .05) + 40, u) * (1 - u / .12))
                    else:
                        noise_hit(t, .12, .04, .16)
                    noise_hit(t + beat / 2, .03, .008, .06)
                elif drums == "ticks":
                    for q in range(4):
                        noise_hit(t + q * beat / 4, .03, .004, .05 if q else .08)
                    if b % 8 == 7:  # a high bleep every two bars
                        note(t, .15, lambda u: .06 * math.sin(TAU * 1760 * u) * math.exp(-u / .05))
            b += 1
    fade_in, fade_out = 1.0, 2.0
    for i in range(n):
        t = i / SR
        out[i] *= min(1, t / fade_in) * min(1, (duration - t) / fade_out)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, default=30)
    ap.add_argument("--mood", choices=sorted(MOOD_BPM), default="calm")
    ap.add_argument("--bpm", type=float, help="defaults to the mood's tempo")
    a = ap.parse_args()
    if a.duration <= 0 or a.duration > 600:
        ap.error("--duration must be in (0, 600]")
    bpm = a.bpm or MOOD_BPM[a.mood]
    if not 40 <= bpm <= 200:
        ap.error("--bpm must be in [40, 200]")
    for name in SFX_NAMES:
        write_wav(os.path.join(a.out, "sfx", f"{name}.wav"), sfx(name))
    music = bgm(a.duration, bpm) if a.mood == "calm" else styled_bgm(a.duration, bpm, a.mood)
    write_wav(os.path.join(a.out, "bgm.wav"), music, peak=.7)
    print(f"✓ {os.path.join(a.out, 'bgm.wav')} ({a.duration:.1f}s, {a.mood} @ {bpm:g} bpm) + {len(SFX_NAMES)} sfx")


if __name__ == "__main__":
    main()
