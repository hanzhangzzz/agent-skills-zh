"""cocoon · the score written for this film (信息茧房是怎么织成的), synthesized with score_kit, licence-free.
It follows the picture instead of looping: single piano notes on the first lines → the pad swells into the flood →
the gate is slow motion (sparse piano over a low drone) → the loop builds one layer every bar (积少成多) →
the cocoon holds a tense pedal, drops out for the hush → riser → impact on the pull-back (full chord) and a cascade
of bright notes for the lighting wave → the crack turns minor to major → the closing resolves with a long tail.
Event times come from cues.json (render.mjs --cues-out) and from the same timeline constants as world.js.

Usage:  PYTHONPATH=<skill>/scripts python3 compose_score.py cues.json out/score.wav
Check:  python3 <skill>/scripts/audio_check.py out/score.wav --out out/      (the per-second curve must follow the plan)
"""
import json, sys
try:
    import numpy as np
    import score_kit as kit
    from score_kit import piano, pad, sub, pluck, strings, boom, riser
except ImportError as e:
    sys.exit(f"{e}: run with PYTHONPATH=<skill>/scripts (score_kit.py) and numpy installed")

SR = kit.SR
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
B = lambda n: n * BEAT
DUR = dict(flood=B(15), gate=B(20), loop=B(20), cocoon=B(16), many=B(22), end=B(14))
T1 = DUR["flood"]; T2 = T1 + DUR["gate"]; T3 = T2 + DUR["loop"]; T4 = T3 + DUR["cocoon"]; T5 = T4 + DUR["many"]; T6 = T5 + DUR["end"]
HUSH = (T3 + 4.9, T3 + 6.3)
IMPACT = T4 + 3.4
CRACK = T4 + 10.2
TITLE = T5 + 5.4

cues = json.load(open(sys.argv[1]))
cues = cues if isinstance(cues, list) else cues.get("cues", [])
TICKS = [c["t"] for c in cues if c.get("sfx") == "tick" and c["t"] < 4]
BLIPS = [c["t"] for c in cues if c.get("sfx") == "blip"]

score = kit.Score(T6)
place = score.place
rng = np.random.default_rng(7)

# chords (MIDI): D minor world; the crack turns it to D major
Dm, Bb, F, C = (50, 57, 62, 65), (46, 53, 58, 62), (53, 57, 60, 65), (48, 55, 60, 64)
PROG = [Dm, Bb, F, C]
DMAJ = (50, 57, 62, 66, 69, 76)          # D A D F# A E: D major add9

# ---- A · the first lines: one piano note each, then the swell into the flood
pent = [81, 86, 77, 84, 76, 81, 74]
for k, tt in enumerate(TICKS):
    place(piano(pent[k % len(pent)], 4.5, .55), tt, pan=(-.4 if k % 2 else .4))
place(pad((38, 45), T1 + 2, bright=lambda x: .1, att=3.5, rel=2.0), 0.3, gain=.3)          # low drone, under the first notes
place(pad(Dm, T1 - 3.2 + 1.5, bright=lambda x: .15 + .8 * x ** 2, att=3.5, rel=1.4), 3.2, gain=1.9)
t = 4.4
while t < T1 - .4:                                                          # arpeggio emerges with the flood
    k = int((t - 4.4) / (BEAT / 4))
    g = min(1, (t - 4.4) / 3.5)
    place(pluck([62, 65, 69, 74, 69, 65][k % 6] + 12, .5, g), t, pan=.3 * np.sin(k))
    t += BEAT / 4
place(riser(2.4), T1 - .4 - 2.4)

# ---- B · the gate: slow motion. Drone + a slow piano line, a note on each like
place(pad((38, 45, 50), DUR["gate"] + 2, bright=lambda x: .12, att=1.0, rel=2.5), T1 - .2, gain=.55)
place(pad(Bb, DUR["gate"] / 2 + 1.5, bright=lambda x: .18, att=2.0, rel=1.5), T1 + 1.0, gain=.32)
place(pad(Dm, DUR["gate"] / 2 + 1.5, bright=lambda x: .2, att=2.0, rel=1.5), T1 + DUR["gate"] / 2, gain=.32)
melody = [(0, 74), (2, 77), (4, 76), (6, 69), (8.5, 72), (10.5, 74)]
for dt, m in melody:
    place(piano(m, 5, .5), T1 + 1.2 + dt, pan=-.2)
for tt in BLIPS:
    place(piano(86, 3, .28), tt, pan=.5)

# ---- C · the loop: one more layer every bar — the sound accumulates with the days
nbar = int(round(DUR["loop"] / BAR))
for b in range(nbar):
    t0 = T2 + b * BAR
    ch = PROG[b % 4]
    lift = b / max(1, nbar - 1)
    place(pad(ch, BAR + 1.6, bright=lambda x, l=lift: .2 + .6 * l, att=.5, rel=1.2), t0, gain=.9 + .4 * lift)
    if b >= 1:
        for q in range(4):
            place(sub(ch[0] - 12, BEAT * .95, .8 + .4 * lift), t0 + q * BEAT)
    if b >= 2:
        div = 2 if b < 3 else 4
        for q in range(4 * div):
            place(pluck(ch[[0, 1, 2, 3, 2, 1][q % 6]] + 12, .45, .55 + .45 * lift), t0 + q * BEAT / div, pan=.35 * np.sin(q))
    if b >= 3:
        place(strings((ch[2] + 12, ch[3] + 12), BAR + 1.5, .7 * lift, att=1.2), t0)

# ---- D · the cocoon: one held chord, the arpeggio narrows to a single repeated note; out for the hush; riser
place(pad(Dm, HUSH[0] - T3 + .3, bright=lambda x: .7 - .4 * x, att=.3, rel=.3), T3, gain=1.25)
place(strings((74, 77, 81), HUSH[0] - T3 + .3, .9, att=1.0), T3)
t = T3
while t < HUSH[0] - .2:
    place(pluck(74 + 12, .35, .8), t, pan=.2)
    t += BEAT / 4
for q in range(int((HUSH[0] - T3) / BEAT)):
    place(sub(38, BEAT * .9, 1.0), T3 + q * BEAT)
place(pad(Dm, IMPACT - HUSH[1] + .2, bright=lambda x: .2 + .7 * x, att=2.0, rel=.2), HUSH[1], gain=1.0)
t = HUSH[1] + 1.0
while t < IMPACT - .1:                                                       # the arpeggio returns, accelerating
    x = (t - HUSH[1]) / (IMPACT - HUSH[1])
    place(pluck([62, 65, 69, 74][int(t * 8) % 4] + 12, .4, .4 + .6 * x), t)
    t += BEAT / (2 if x < .5 else 4)
place(riser(3.2), IMPACT - 3.2)

# ---- E · the pull-back: impact and the full chord; the crack turns to D major
place(boom(5.0), IMPACT, gain=.9)
# the ignition wave: one bright note per neighbourhood of cocoons lighting up (people at distance d light at
# IMPACT + .3 + d / 8500; their number grows with d, so notes come in a quickening, then thinning cascade)
casc = [70, 72, 74, 77, 79, 82, 84, 86, 89, 91]
crng = np.random.default_rng(11)
for k in range(1, 49):
    d = 1600 + 14000 * np.sqrt(k / 48)
    tt = IMPACT + .3 + d / 8500
    m = casc[min(len(casc) - 1, int(k / 48 * len(casc) + crng.integers(-1, 2)))]
    place(piano(m, 2.5, .3 * (1 - .4 * k / 48)), tt, pan=float(crng.uniform(-.8, .8)))
    place(pluck(m, .4, .5), tt + .01, pan=float(crng.uniform(-.8, .8)))
place(pad(Bb + (70,), CRACK - IMPACT + 1.5, bright=lambda x: .7 - .3 * x, att=.08, rel=1.5), IMPACT, gain=1.5)
place(strings((70, 74, 77), CRACK - IMPACT + 1.5, 1.0, att=.6), IMPACT)
for q in range(int((CRACK - IMPACT) / BEAT)):
    place(sub(34, BEAT * .95, .9), IMPACT + q * BEAT)
place(pad(DMAJ, T6 - CRACK + 1, bright=lambda x: .5 - .35 * x, att=1.2, rel=3.0), CRACK, gain=1.4)
place(strings((78, 81, 86), T6 - CRACK, .9, att=1.8), CRACK + .3)
for k, m in enumerate([81, 78, 76, 74, 81, 78]):                            # a rising-then-settling motif in major
    place(piano(m, 5, .55), CRACK + .4 + k * BEAT * 1.5, pan=.3 * (-1) ** k)

# ---- F · closing: a slow descending line, the final chord at the title rings out
for k, m in enumerate([78, 76, 74, 69, 71, 74]):
    place(piano(m, 5, .45), T5 + .6 + k * BEAT * 2, pan=-.25 * (-1) ** k)
place(piano(62, 8, .6), TITLE); place(piano(66, 8, .5), TITLE + .02); place(piano(69, 8, .5), TITLE + .04); place(piano(76, 8, .45), TITLE + .07)
place(pad((38, 50, 57, 66), T6 - TITLE + 1, bright=lambda x: .3, att=.4, rel=2.5), TITLE, gain=1.0)

# ---- reverb (synthetic hall) and master
score.write(sys.argv[2], fade_in=.4, fade_out=1.5)
print(f"✓ {sys.argv[2]} ({T6:.2f}s) · ticks {len(TICKS)} · blips {len(BLIPS)} · impact {IMPACT:.2f}s · crack {CRACK:.2f}s")
