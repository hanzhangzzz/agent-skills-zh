#!/usr/bin/env python3
"""Report where a render stands still and how much each second moves.

Counts changed pixels per frame (same measure as check_sync.py), then prints one row per second
with a motion bar, and flags every run of at least --still seconds whose motion never exceeds the
noise floor. A STILL run is a suspect, not a verdict: a title left on screen for reading is fine,
a screenshot sitting in a frame for 10 s is the slideshow problem.

    python3 motion_check.py --video out/silent.mp4 [--still 2.0] [--scenes 0,4.8,9.6,24,30]

--scenes lists scene start times; the report then also prints the motion in the 0.5 s around each
cut, so a cut carried by a cross-fade (one soft bump) reads differently from one carried by a
moving element (sustained motion across the boundary). Exit code 1 when any STILL run is found.
"""
import argparse
import subprocess
import sys

FPS = 30
PIXEL = 12                 # grey-level change that counts a pixel as changed
NOISE = 40                 # changed pixels (at 960x540) below this count as still


def frame_diffs(video):
    vf = (f"fps={FPS},scale=960:540,format=gray,tblend=all_mode=difference,"
          f"lut=y='if(gt(val,{PIXEL}),255,0)',signalstats,"
          "metadata=print:key=lavfi.signalstats.YAVG:file=-")
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", vf, "-f", "null", "-"],
                         check=True, capture_output=True, text=True).stdout
    avgs = [float(line.split("=")[1]) for line in out.splitlines() if "YAVG=" in line]
    return [0.0] + [a / 255 * 960 * 540 for a in avgs]


def still_runs(diffs, min_seconds):
    """[(start_s, end_s)] for every run of frames below NOISE lasting at least min_seconds."""
    runs, start = [], None
    for i, d in enumerate(diffs + [NOISE + 1]):
        if d < NOISE and start is None:
            start = i
        elif d >= NOISE and start is not None:
            if (i - start) / FPS >= min_seconds:
                runs.append((start / FPS, i / FPS))
            start = None
    return runs


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--video", required=True)
    ap.add_argument("--still", type=float, default=2.0, help="flag still runs at least this long (seconds)")
    ap.add_argument("--scenes", default="", help="comma-separated scene start times to inspect the cuts")
    args = ap.parse_args()

    diffs = frame_diffs(args.video)
    total = len(diffs) / FPS
    per_sec = [sum(diffs[s * FPS:(s + 1) * FPS]) / FPS for s in range(int(total + .999))]
    top = max(per_sec) or 1
    print(f"{'sec':>4}  motion (changed px / frame, avg)")
    for s, m in enumerate(per_sec):
        print(f"{s:4d}  {'█' * int(40 * m / top):<40} {m:8.0f}")

    cuts = [float(x) for x in args.scenes.split(",") if x.strip()]
    if cuts:
        print("\ncuts (motion per frame, 0.5 s before → 0.5 s after)")
        for c in cuts:
            lo, hi = max(0, int((c - .5) * FPS)), min(len(diffs), int((c + .5) * FPS))
            w = diffs[lo:hi]
            if not w:
                continue
            bar = "".join("▇" if d > top * .5 else "▅" if d > top * .15 else "▂" if d >= NOISE else "·" for d in w)
            print(f"{c:6.2f}s  {bar}")

    runs = still_runs(diffs, args.still)
    print()
    if runs:
        for a, b in runs:
            print(f"STILL  {a:6.2f}s → {b:6.2f}s  ({b - a:.1f}s without motion)")
        print(f"\n{len(runs)} still run(s) ≥ {args.still}s. Add protagonist motion, pulse or dashFlow, or note it as a deliberate hold.")
    else:
        print(f"no still run ≥ {args.still}s")
    sys.exit(1 if runs else 0)


if __name__ == "__main__":
    main()
