#!/usr/bin/env python3
"""Synthesize a background track, ambience beds and a foley kit with the standard library only.

Everything is generated from code with fixed seeds, so the output is reproducible and
carries no third-party licence. Output: <out>/bgm.wav, <out>/sfx/<name>.wav and
<out>/amb/<name>.wav (only the beds asked for with --amb).

Usage: synth_audio.py --out DIR [--duration 30] [--mood calm] [--bpm <mood default>] [--amb wind,room]
Moods (pick the one listed for the chosen style in references/styles.md):
  calm        soft pad + sine arpeggio            editorial, UI demo, glass, data
  bright      major pop, claps, bouncy plucks     flat vector, clay, kinetic type, promo, sticker
  synthwave   saw pads, pulsing 8th bass, gated snare   80s synthwave, neon, chrome type
  chiptune    square lead, triangle bass, noise hats    pixel art
  pentatonic  plucked strings on a pentatonic scale, drone, sparse drum   ink wash, papercut, one-line
  pulse       dark drone, ticking hats, sub pulse, bleeps   HUD, glitch, particles, space, 3D product
SFX (UI): click tick pop chime snap whoosh reveal type thud blip glitch drop
SFX (foley): pour paper glass metal wood crackle impact riser swoosh-soft
  riser is a 2.4 s swell that ENDS on its cue time (mix.py places it so it lands on the hit).
Ambience beds (8 s seamless loops, stereo): wind room hum water fire city space
"""
import argparse
import math
import os
import random
import wave
from array import array

SR = 44100
TAU = 2 * math.pi
SFX_NAMES = ("click", "tick", "pop", "chime", "snap", "whoosh", "reveal", "type", "thud", "blip", "glitch", "drop",
             "pour", "paper", "glass", "metal", "wood", "crackle", "impact", "riser", "swoosh-soft")
END_ANCHORED = ("riser",)   # cue time = where the sound ends
BED_NAMES = ("wind", "room", "hum", "water", "fire", "city", "space")
LOOP, XF = 8.0, 1.0          # bed loop length and the crossfade that closes the loop (s)
MOOD_BPM = {"calm": 100, "bright": 118, "synthwave": 100, "chiptune": 140, "pentatonic": 72, "pulse": 96}


def write_wav(path, samples, peak=0.89, right=None, rms=None):
    """Write 16-bit stereo. Scale to `peak`, or to `rms` (linear) when given, never above `peak`.
    `right` is an optional second channel (same length); default: mono duplicated."""
    chans = [samples] if right is None else [samples, right]
    top = max(1e-9, max(max(abs(s) for s in c) for c in chans))
    k = peak / top
    if rms is not None:
        cur = math.sqrt(sum(s * s for c in chans for s in c) / sum(len(c) for c in chans)) or 1e-9
        k = min(k, rms / cur)
    left = array("h", (int(max(-1.0, min(1.0, s * k)) * 32767) for s in samples))
    frames = array("h", [0]) * (2 * len(left))
    frames[0::2] = left
    frames[1::2] = left if right is None else array("h", (int(max(-1.0, min(1.0, s * k)) * 32767) for s in right))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames.tobytes())


def lowpass(samples, cutoff_fn):
    """One-pole low-pass whose cutoff (Hz) may vary per sample index."""
    out, y = [], 0.0
    for i, x in enumerate(samples):
        a = 1 - math.exp(-TAU * cutoff_fn(i) / SR)
        y += a * (x - y)
        out.append(y)
    return out


def lp1(samples, fc):
    """Fixed one-pole low-pass."""
    a, y, out = 1 - math.exp(-TAU * fc / SR), 0.0, []
    for x in samples:
        y += a * (x - y)
        out.append(y)
    return out


def hp1(samples, fc):
    return [x - y for x, y in zip(samples, lp1(samples, fc))]


def svf(samples, fc, q=.7, mode="bp"):
    """Chamberlin state-variable filter; fc is Hz or a list of Hz per sample. mode lp | bp | hp."""
    low = band = 0.0
    damp = 1 / q
    var = isinstance(fc, list)
    f = 2 * math.sin(math.pi * min(fc, 7000) / SR) if not var else 0.0
    out = []
    for i, x in enumerate(samples):
        if var:
            f = 2 * math.sin(math.pi * min(fc[i], 7000) / SR)
        low += f * band
        high = x - low - damp * band
        band += f * high
        out.append(band if mode == "bp" else low if mode == "lp" else high)
    return out


def white(n, rnd):
    r = rnd.random
    return [2 * r() - 1 for _ in range(n)]


def pink(n, rnd):
    """Paul Kellet's economy pink filter."""
    b0 = b1 = b2 = 0.0
    out = []
    r = rnd.random
    for _ in range(n):
        w = 2 * r() - 1
        b0 = .99765 * b0 + w * .0990460
        b1 = .96300 * b1 + w * .2965164
        b2 = .57000 * b2 + w * 1.0526913
        out.append(b0 + b1 + b2 + w * .1848)
    return out


def brown(n, rnd):
    y, out, r = 0.0, [], rnd.random
    for _ in range(n):
        y = .996 * y + .06 * (2 * r() - 1)
        out.append(y)
    return out


def lfo(n, rate, rnd, lo=0.0, hi=1.0):
    """Smooth random control curve: a random point every 1/rate s, cosine-interpolated, in [lo, hi]."""
    step = SR / rate
    pts = [rnd.uniform(lo, hi) for _ in range(int(n / step) + 3)]
    out = []
    for i in range(n):
        x = i / step
        k = int(x)
        w = (1 - math.cos(math.pi * (x - k))) / 2
        out.append(pts[k] * (1 - w) + pts[k + 1] * w)
    return out


def modes(n, partials, rnd=None, detune=0.0):
    """Modal synthesis: sum of decaying sines [(freq, amp, decay_s)], optional detuned twin for beating."""
    out = [0.0] * n
    for f, a, d in partials:
        for ff, aa in ((f, a), (f * (1 + detune), a * .5)) if detune else ((f, a),):
            ph = rnd.uniform(0, TAU) if rnd else 0.0
            w, kd = TAU * ff / SR, 1 / (d * SR)
            for i in range(min(n, int(d * SR * 9))):
                out[i] += aa * math.sin(w * i + ph) * math.exp(-i * kd)
    return out


def burst(out, at, length, decay, gain, rnd, tone=None):
    """Add a short noise burst (or a decaying sine when tone is Hz) into out at sample `at`."""
    for j in range(int(length * SR)):
        if 0 <= at + j < len(out):
            env = math.exp(-j / SR / decay)
            out[at + j] += gain * env * (math.sin(TAU * tone * j / SR) if tone else rnd.uniform(-1, 1))


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
    # ---- foley: each one modelled on its material
    if name == "pour":  # liquid into a vessel: chirping bubbles over a stream whose resonance rises as it fills
        n = int(SR * 1.8)
        out = [0.0] * n
        t = .03
        while t < 1.6:
            p = t / 1.8
            f0, dec, at = rnd.uniform(380, 1100) * (1 + .7 * p), rnd.uniform(.006, .026), int(t * SR)
            g = rnd.uniform(.15, .45)
            for j in range(int(dec * 6 * SR)):
                if at + j < n:
                    u = j / SR
                    out[at + j] += g * math.sin(TAU * f0 * u * (1 + u / dec * .35)) * math.exp(-u / dec) * min(1, u / .0015)
            t += rnd.expovariate(70)
        stream = svf(white(n, rnd), [600 + 1300 * (i / n) for i in range(n)], q=3)
        env = [min(1, i / SR / .08) * min(1, (n - i) / SR / .3) for i in range(n)]
        return [(o + .8 * x) * e for o, x, e in zip(out, stream, env)]
    if name == "paper":  # page turn: a bright airy swish made of many tiny crinkles
        n = int(SR * .6)
        crinkle = [0.0] * n
        t = 0.0
        while t < .55:
            burst(crinkle, int(t * SR), .006, .0012, rnd.uniform(.2, 1), rnd)
            t += rnd.expovariate(160)
        air = svf(white(n, rnd), 3200, q=.8)
        swish = [math.sin(math.pi * min(1, i / n)) ** 1.5 * (1 + .6 * math.sin(i / n * 7)) for i in range(n)]
        return [(.9 * c + .5 * a) * w for c, a, w in zip(hp1(crinkle, 1400), air, swish)]
    if name == "glass":  # clink: high inharmonic partials with long ring and slow beating
        n = int(SR * 1.3)
        ring = modes(n, [(2350, 1, .9), (5452, .55, .45), (9990, .3, .22), (3110, .25, .6)], rnd, detune=.0035)
        tickn = hp1([rnd.uniform(-1, 1) * math.exp(-i / SR / .0012) for i in range(n)], 3000)
        return [r + .6 * k for r, k in zip(ring, tickn)]
    if name == "metal":  # clank: mid inharmonic partials, hard transient, a smaller rattle bounce
        n = int(SR * 1.1)
        part = [(523, .5, .8), (1187, 1, .5), (1931, .7, .35), (2766, .5, .26), (3989, .35, .18), (5210, .2, .1)]
        out = modes(n, part, rnd, detune=.002)
        bounce = modes(n, [(f * 1.03, a * .35, d * .4) for f, a, d in part], rnd)
        hit = svf([rnd.uniform(-1, 1) * math.exp(-i / SR / .006) for i in range(n)], 3000, q=1.5)
        body = [math.sin(TAU * 180 * i / SR) * math.exp(-i / SR / .05) for i in range(n)]
        lag = int(.085 * SR)
        return [out[i] + 1.4 * hit[i] + .5 * body[i] + (bounce[i - lag] if i >= lag else 0) for i in range(n)]
    if name == "wood":  # knock: short low resonant body + soft click, no ring
        n = int(SR * .28)
        body = modes(n, [(212, 1, .05), (563, .7, .032), (1043, .45, .018), (1720, .25, .01)], rnd)
        clk = lp1([rnd.uniform(-1, 1) * math.exp(-i / SR / .0015) for i in range(n)], 3000)
        return [b + 1.2 * c for b, c in zip(body, clk)]
    if name == "crackle":  # short fire / static crackle: sparse sharp pops of uneven size
        n = int(SR * .45)
        out = [0.0] * n
        t = 0.0
        while t < .4:
            burst(out, int(t * SR), .004, rnd.uniform(.0004, .0015), rnd.random() ** 2.5, rnd)
            t += rnd.expovariate(70)
        for _ in range(2):
            burst(out, int(rnd.uniform(0, .3) * SR), .03, .008, .5, rnd, tone=rnd.uniform(350, 800))
        return [x * (1 - i / n) for i, x in enumerate(hp1(out, 900))]
    if name == "impact":  # deep boom for big reveals: pitch-dropping sub + punch + rumble tail
        n, ph, out = int(SR * 2.2), 0.0, []
        rumble = lp1(white(n, rnd), 140)
        crack = lp1([rnd.uniform(-1, 1) * math.exp(-i / SR / .02) for i in range(n)], 1800)
        for i in range(n):
            t = i / SR
            ph += TAU * (34 + 75 * math.exp(-t / .07)) / SR
            boom = math.tanh(1.8 * math.sin(ph)) * math.exp(-t / .6)   # saturation adds harmonics for small speakers
            punch = .45 * math.sin(TAU * 118 * t) * math.exp(-t / .08)
            out.append((boom + punch + 1.3 * crack[i] + 6 * rumble[i] * math.exp(-t / .9)) * min(1, t / .0015))
        return out
    if name == "riser":  # 2.4 s rising swell; the last sample is the hit point (mix.py ends it on the cue time)
        n = int(SR * 2.4)
        p = [i / n for i in range(n)]
        hiss = svf(white(n, rnd), [250 * 26 ** (x ** 1.4) for x in p], q=2.5)
        air = hp1(white(n, rnd), 5000)
        out, phs = [], [0.0, 0.0, 0.0]
        for i, x in enumerate(p):
            f = 110 * 8 ** (x ** 1.6)
            tone = 0.0
            for k, d in enumerate((1, 1.006, .994)):
                phs[k] += TAU * f * d / SR
                tone += math.sin(phs[k]) + .3 * math.sin(2 * phs[k])
            env = x ** 2.2 * min(1, (n - i) / (SR * .006))
            out.append(env * (1.2 * hiss[i] + .12 * tone + .4 * air[i] * x ** 3))
        return out
    if name == "swoosh-soft":  # gentle, darker whoosh for small moves
        n = int(SR * .55)
        shape = lambda i: math.sin(math.pi * i / n) ** 2 * (1 - .4 * i / n)  # noqa: E731
        f = svf(white(n, rnd), [180 + 1100 * shape(i) for i in range(n)], q=.9, mode="lp")
        return [x * shape(i) for i, x in enumerate(f)]
    raise ValueError(name)


# ---------------------------------------------------------------- ambience beds
def bed(name):
    """One seamless 8 s stereo loop. Each bed = periodic tones (exact cycles per loop) + noise texture whose tail
    is equal-power crossfaded into its head. Right channel = left rotated half a loop (decorrelated, still seamless)."""
    rnd = random.Random("amb-" + name)
    L, X = int(LOOP * SR), int(XF * SR)
    n = L + X
    tone = [0.0] * L

    def periodic(partials):  # [(cycles per loop, amp, am_cycles, am_depth)]
        for cyc, a, amc, amd in partials:
            w, wa, ph = TAU * cyc / L, TAU * amc / L, rnd.uniform(0, TAU)
            for i in range(L):
                tone[i] += a * math.sin(w * i + ph) * (1 - amd + amd * math.sin(wa * i + ph * 2))

    if name == "wind":  # gusts: band-passed noise whose centre and level follow a slow random gust curve
        g = lfo(n, .45, rnd)
        body = svf(white(n, rnd), [300 + 650 * x for x in g], q=1.1)
        whistle = svf(white(n, rnd), [700 + 900 * x for x in g], q=10)
        low = lp1(white(n, rnd), 140)
        noise = [(b * (.25 + .75 * x) + .35 * w * x * x + 1.6 * lo) for b, w, lo, x in zip(body, whistle, low, g)]
    elif name == "room":  # room tone: soft pink air, a hint of HVAC low end, faint high air
        pk = pink(n, rnd)
        air = hp1(pk, 4000)
        noise = [a + .03 * h for a, h in zip(svf(hp1(pk, 90), 650, q=.6, mode="lp"), air)]
        periodic([(120 * LOOP, .004, 1, .3)])
    elif name == "hum":  # machine / electric hum: 60 Hz mains harmonics + fan noise with a slow wobble
        periodic([(c * LOOP, a, 4, .15) for c, a in ((60, .35), (120, 1), (180, .55), (240, .3), (300, .3), (360, .12), (420, .14), (540, .07))])
        wob = lfo(n, 1.5, rnd, .7, 1)
        noise = [.25 * x * w for x, w in zip(svf(pink(n, rnd), 450, q=.7, mode="lp"), wob)]
    elif name == "water":  # stream / light rain: dense bubble chirps over a moving hiss with droplet ticks
        noise = [0.0] * n
        t = 0.0
        while t * SR < n:
            f0, dec, at, g = rnd.uniform(350, 1700), rnd.uniform(.004, .02), int(t * SR), rnd.uniform(.05, .3)
            for j in range(int(dec * 5 * SR)):
                if at + j < n:
                    u = j / SR
                    noise[at + j] += g * math.sin(TAU * f0 * u * (1 + u / dec * .5)) * math.exp(-u / dec)
            t += rnd.expovariate(110)
        flow = lfo(n, 3, rnd, .5, 1)
        hiss = svf(white(n, rnd), 1500, q=.6)
        drops = [0.0] * n
        t = 0.0
        while t * SR < n:
            burst(drops, int(t * SR), .003, .0007, rnd.uniform(.1, .5), rnd)
            t += rnd.expovariate(40)
        noise = [b + .45 * h * f + .3 * d for b, h, f, d in zip(noise, hiss, flow, hp1(drops, 3000))]
    elif name == "fire":  # crackling fire: flickering low roar, sharp crackles, a few resonant pops
        flick = lfo(n, 7, rnd, .4, 1)
        roar = [r * f for r, f in zip(svf(brown(n, rnd), 320, q=.8), flick)]
        crk = [0.0] * n
        t = 0.0
        while t * SR < n:
            burst(crk, int(t * SR), .004, rnd.uniform(.0003, .0012), rnd.random() ** 3, rnd)
            t += rnd.expovariate(28)
        t = 0.0
        while t * SR < n:
            burst(crk, int(t * SR), .03, .006, rnd.uniform(.2, .45), rnd, tone=rnd.uniform(300, 900))
            t += rnd.expovariate(1.6)
        hiss = hp1(white(n, rnd), 3500)
        noise = [3 * r + c + .03 * h for r, c, h in zip(roar, hp1(crk, 700), hiss)]
    elif name == "city":  # distant traffic: low murmur + slow car pass-bys (band-passed swells with a doppler drop)
        murmur = svf(brown(n, rnd), 260, q=.8)
        cars = [0.0] * n
        t = rnd.uniform(0, 1.5)
        while t < (n / SR):
            dur, f0 = rnd.uniform(2.5, 4.5), rnd.uniform(380, 650)
            a, m = int(t * SR), int(dur * SR)
            seg = svf(white(m, rnd), [f0 * (1.15 - .3 * j / m) for j in range(m)], q=1.6)
            g = rnd.uniform(.4, 1)
            for j in range(m):
                if a + j < n:
                    cars[a + j] += g * seg[j] * math.exp(-((j / m - .5) / .18) ** 2)
            t += rnd.uniform(1.2, 2.8)
        tyres = hp1(white(n, rnd), 2500)
        noise = [2 * mu + .8 * c + .02 * ty for mu, c, ty in zip(murmur, cars, tyres)]
        periodic([(c * LOOP, .006, 2, .5) for c in (311.13, 392)])  # a faint far-off horn chord, mostly masked
    elif name == "space":  # deep drone with slow beating and a high, sparkling shimmer
        periodic([(55 * LOOP, .35, 1, .2), (110 * LOOP, .6, 2, .25), (110.125 * LOOP, .45, 1, .3), (165 * LOOP, .3, 3, .4),
                  (220 * LOOP, .18, 1, .5), (330.25 * LOOP, .08, 2, .6)])
        periodic([(c * LOOP, .035, k, .95) for c, k in ((1760, 1), (2217.5, 2), (2637, 3), (3322.5, 1), (3951, 2))])
        noise = [.5 * x for x in svf(white(n, rnd), 2000, q=5)]
    else:
        raise ValueError(name)
    loop = noise[:L]
    for i in range(X):  # close the loop: noise[L + i] (continuation past the end) fades into the head
        w = (i + .5) / X
        loop[i] = noise[i] * math.sin(w * math.pi / 2) + noise[L + i] * math.cos(w * math.pi / 2)
    left = [a + b for a, b in zip(loop, tone)]
    half = L // 2
    return left, left[half:] + left[:half]


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
    ap.add_argument("--amb", default="", help="comma-separated ambience beds to write: " + " ".join(BED_NAMES))
    a = ap.parse_args()
    beds = [b for b in a.amb.split(",") if b]
    for b in beds:
        if b not in BED_NAMES:
            ap.error(f"unknown ambience bed {b!r}; choose from {' '.join(BED_NAMES)}")
    if a.duration <= 0 or a.duration > 600:
        ap.error("--duration must be in (0, 600]")
    bpm = a.bpm or MOOD_BPM[a.mood]
    if not 40 <= bpm <= 200:
        ap.error("--bpm must be in [40, 200]")
    for name in SFX_NAMES:
        write_wav(os.path.join(a.out, "sfx", f"{name}.wav"), sfx(name))
    music = bgm(a.duration, bpm) if a.mood == "calm" else styled_bgm(a.duration, bpm, a.mood)
    write_wav(os.path.join(a.out, "bgm.wav"), music, peak=.7)
    for b in beds:  # loudness-matched: every bed sits at the same RMS, so amb_gain means the same for all
        left, right = bed(b)
        write_wav(os.path.join(a.out, "amb", f"{b}.wav"), left, right=right, rms=.1)
    print(f"✓ {os.path.join(a.out, 'bgm.wav')} ({a.duration:.1f}s, {a.mood} @ {bpm:g} bpm) + {len(SFX_NAMES)} sfx"
          + (f" + amb {','.join(beds)}" if beds else ""))


if __name__ == "__main__":
    main()
