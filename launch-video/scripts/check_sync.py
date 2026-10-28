#!/usr/bin/env python3
"""List sound cues whose on-screen motion starts or peaks late.

For every cue in cues.json, count changed pixels per frame in a window around the cue:
- motion: first frame reaching 25% of the window's strongest change
- peak:   frame with the strongest change
The window runs from 0.2s before the cue to 0.6s after it, or to the next cue if sooner.
A cue is flagged LATE when motion starts more than --tolerance after the sound, and
SLOW when the peak lands more than 0.2s after it (skipped for continuous `type` cues).

    python3 check_sync.py --video out/silent.mp4 --cues cues.json [--tolerance 0.1]

Flags are suspects, not verdicts: confirm each with a frame strip around the cue.
Exit code 1 when any cue is flagged.
"""
import argparse
import json
import subprocess
import sys

FPS = 30
BEFORE, AFTER = 0.2, 0.6   # search window around each cue, seconds
PIXEL = 12                 # grey-level change that counts a pixel as changed
NOISE = 40                 # changed pixels (at 960x540) below this count as still
SLOW_PEAK = 0.2


def frame_diffs(video):
    """Changed-pixel count per frame at 960x540, computed inside ffmpeg."""
    vf = (f"fps={FPS},scale=960:540,format=gray,tblend=all_mode=difference,"
          f"lut=y='if(gt(val,{PIXEL}),255,0)',signalstats,"
          "metadata=print:key=lavfi.signalstats.YAVG:file=-")
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", vf, "-f", "null", "-"],
                         check=True, capture_output=True, text=True).stdout
    avgs = [float(line.split("=")[1]) for line in out.splitlines() if "YAVG=" in line]
    return [0.0] + [a / 255 * 960 * 540 for a in avgs]   # tblend output starts at frame 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--video", required=True)
    ap.add_argument("--cues", required=True)
    ap.add_argument("--tolerance", type=float, default=0.1, help="max allowed motion lag in seconds")
    args = ap.parse_args()

    cues = json.load(open(args.cues))["cues"]
    diffs = frame_diffs(args.video)
    at = lambda s: min(len(diffs), max(0, round(s * FPS)))
    flagged = 0
    print(f"{'cue':>7}  {'sfx':<7} {'motion':>7} {'lag':>6} {'peak':>7} {'lag':>6}")
    starts = sorted(c["t"] for c in cues)
    for cue in cues:
        t, sfx = cue["t"], cue["sfx"]
        nxt = min((s for s in starts if s > t), default=t + AFTER)
        lo, hi = at(t - BEFORE), at(min(t + AFTER, nxt - .05)) + 1
        window = diffs[lo:hi]
        peak = max(window, default=0)
        if peak < NOISE:
            print(f"{t:7.2f}  {sfx:<7} {'-':>7} {'-':>6} {'-':>7} {'-':>6}  NO MOTION")
            flagged += 1
            continue
        onset = (lo + next(i for i, d in enumerate(window) if d >= peak * .25)) / FPS
        top = (lo + window.index(peak)) / FPS
        flags = []
        if onset - t > args.tolerance:
            flags.append("LATE")
        if sfx != "type" and top - t > SLOW_PEAK:
            flags.append("SLOW")
        flagged += bool(flags)
        print(f"{t:7.2f}  {sfx:<7} {onset:7.2f} {onset - t:+6.2f} {top:7.2f} {top - t:+6.2f}  {' '.join(flags)}")
    print(f"\n{flagged} of {len(cues)} cues flagged (motion tolerance {args.tolerance}s, peak {SLOW_PEAK}s)")
    sys.exit(1 if flagged else 0)


if __name__ == "__main__":
    main()
