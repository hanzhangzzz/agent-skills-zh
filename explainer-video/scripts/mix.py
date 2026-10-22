#!/usr/bin/env python3
"""Lay a background track and timed SFX cues under a silent render.

cues.json:
  {"mood": "calm", "bpm": 100, "bgm_gain": 0.5, "cues": [{"t": 1.8, "sfx": "click", "gain": 0.6}, ...]}
`mood` / `bpm` pick the synthesized bed (see synth_audio.py; both optional).
`sfx` is a name from synth_audio.py (click tick pop chime snap whoosh reveal type thud blip glitch drop)
or a path to your own audio file (relative to cues.json).

Usage: mix.py --video silent.mp4 --cues cues.json --out final.mp4 [--music licensed.mp3]
Without --music a synthesized, licence-free bed is generated for the exact video length.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def probe_duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit(f"ffprobe could not read {path}: {r.stderr.strip()}")
    return float(r.stdout.strip())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--cues", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--music", help="your own licensed music file; replaces the synthesized bed")
    a = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if subprocess.run(["which", tool], capture_output=True).returncode != 0:
            sys.exit(f"{tool} not found on PATH")
    dur = probe_duration(a.video)
    spec = json.load(open(a.cues))
    cues = spec.get("cues", [])
    for c in cues:
        if not (0 <= float(c["t"]) < dur):
            sys.exit(f"cue at t={c['t']} is outside the video (0–{dur:.2f}s)")

    cache = os.path.join(os.path.dirname(os.path.abspath(a.out)), ".audio")
    synth = [sys.executable, os.path.join(HERE, "synth_audio.py"), "--out", cache, "--duration", f"{dur:.3f}",
             "--mood", spec.get("mood", "calm")]
    if spec.get("bpm"):
        synth += ["--bpm", str(spec["bpm"])]
    if subprocess.run(synth).returncode != 0:
        sys.exit("synth_audio.py failed (check mood / bpm in cues.json)")
    music = os.path.abspath(a.music) if a.music else os.path.join(cache, "bgm.wav")
    if not os.path.exists(music):
        sys.exit(f"music file not found: {music}")

    base = os.path.dirname(os.path.abspath(a.cues))
    inputs = ["-i", a.video, "-i", music]
    fade_out = min(2.0, dur / 4)
    graph = [f"[1:a]atrim=0:{dur:.3f},afade=t=in:d=0.4,afade=t=out:st={dur - fade_out:.3f}:d={fade_out:.3f},"
             f"volume={float(spec.get('bgm_gain', 0.5))}[bgm]"]
    labels = ["[bgm]"]
    for i, c in enumerate(cues, start=2):
        src = c["sfx"]
        path = os.path.join(cache, "sfx", f"{src}.wav") if "/" not in src and "." not in src else os.path.join(base, src)
        if not os.path.exists(path):
            sys.exit(f"sfx not found: {src}")
        inputs += ["-i", path]
        ms = int(round(float(c["t"]) * 1000))
        graph.append(f"[{i}:a]volume={float(c.get('gain', 0.5))},adelay={ms}|{ms}[s{i}]")
        labels.append(f"[s{i}]")
    graph.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first,"
                 f"alimiter=limit=0.95,atrim=0:{dur:.3f}[a]")

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(graph),
           "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           "-shortest", "-movflags", "+faststart", a.out]
    if subprocess.run(cmd).returncode != 0:
        sys.exit("ffmpeg mix failed")
    print(f"✓ {a.out} ({dur:.2f}s, {len(cues)} cues, music: {'custom' if a.music else 'synthesized'})")


if __name__ == "__main__":
    main()
