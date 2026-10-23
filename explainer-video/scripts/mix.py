#!/usr/bin/env python3
"""Lay a background track, ambience beds and timed SFX cues under a silent render, then master to -14 LUFS.

cues.json (window.__cues from explainer.js, exported by render.mjs --cues-out):
  {"mood": "calm", "bpm": 100, "bgm_gain": 0.5,
   "cues": [{"t": 1.8, "sfx": "click", "gain": 0.6}, ...],
   "amb": [{"t0": 0, "t1": 7.5, "name": "wind"}, ...], "amb_gain": 0.5,
   "hush": [[12.0, 14.2]], "duck": true}
`mood` / `bpm` pick the synthesized bed (see synth_audio.py; both optional).
`sfx` is a name from synth_audio.py or a path to your own audio file (relative to cues.json):
  click tick pop chime snap whoosh reveal type thud blip glitch drop
  pour paper glass metal wood crackle impact riser swoosh-soft
  A riser's `t` is where it ENDS (the hit point), not where it starts.
`amb` segments play an ambience bed (wind room hum water fire city space) from t0 to t1, looping; a change of
  bed crossfades over 0.6 s centred on the boundary. `amb_gain` scales all beds (default 0.5).
`hush` windows dip music and ambience to -24 dB: down over the 0.3 s before t0, held to t1, back over 0.25 s.
`duck` (written by explainer.js) dips the music 5 dB under every impact / riser / chime cue.
All three keys are optional; a cues.json without them mixes as before. The mix is then loudness-normalised
(two-pass ffmpeg loudnorm, -14 LUFS integrated, -1 dBTP) and the measured result is printed.

Usage: mix.py --video silent.mp4 --cues cues.json --out final.mp4 [--music licensed.mp3]
Without --music a synthesized, licence-free bed is generated for the exact video length.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from synth_audio import BED_NAMES, END_ANCHORED  # noqa: E402

AMB_XF = 0.6                                   # crossfade between beds (s)
HUSH_DB, HUSH_IN, HUSH_OUT = -24, 0.3, 0.25
DUCK_DB, DUCK_SFX, DUCK_ATTACK, DUCK_RELEASE = -5, ("impact", "riser", "chime"), 0.05, 0.4
TARGET_I, TARGET_TP, TARGET_LRA = -14, -1, 11
LIMIT_DB = -2.0                                # peak ceiling before the final pass (limited at 4x rate ≈ true peak)
TP_HEADROOM = 0.5                              # AAC encoding overshoots the true peak by ~0.3 dB


def probe_duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit(f"ffprobe could not read {path}: {r.stderr.strip()}")
    return float(r.stdout.strip())


def wav_seconds(path):
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


def dip(windows):
    """ffmpeg volume expression: product of trapezoid dips [(a, b, gain, fade_in, fade_out)] over time t."""
    terms = [f"(1-{1 - g:.4f}*clip(min((t-{a - fi:.3f})/{fi},({b + fo:.3f}-t)/{fo}),0,1))" for a, b, g, fi, fo in windows]
    return "*".join(terms)


def envelope(windows):
    """Filter chain applying `dip` sample-accurately enough (expression re-evaluated every 256 samples)."""
    return f",asetnsamples=n=256:p=0,volume='{dip(windows)}':eval=frame" if windows else ""


def measure(path, norm):
    """loudnorm first-pass statistics of an audio file, with I and TP from the ebur128 meter."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", norm + ":print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    if r.returncode != 0 or not m:
        sys.exit(f"loudnorm measurement failed: {r.stderr[-400:]}")
    stats = json.loads(m.group(0))
    if stats["input_i"] == "-inf":
        sys.exit("the mix is silent; nothing to normalise")
    # loudnorm's own integrated reading drifts ~0.4 LU from the BS.1770 meter on short films; trust ebur128
    i, tp = loudness(path)
    stats["input_i"], stats["input_tp"] = f"{i:.2f}", f"{tp:.2f}"
    return stats


def loudness(path):
    """Integrated loudness (LUFS) and true peak (dBTP) of an audio or video file, via ffmpeg ebur128."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-map", "0:a", "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    summary = r.stderr[r.stderr.rfind("Summary:"):]
    i, tp = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", summary), re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", summary)
    if r.returncode != 0 or not i:
        sys.exit(f"loudness measurement failed: {r.stderr[-400:]}")
    return float(i.group(1)), float(tp.group(1)) if tp else float("nan")


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
    amb = sorted(spec.get("amb", []), key=lambda s: float(s["t0"]))
    for s in amb:
        if s["name"] not in BED_NAMES:
            sys.exit(f"unknown ambience bed {s['name']!r}; choose from {' '.join(BED_NAMES)}")
        if not float(s["t0"]) < float(s["t1"]):
            sys.exit(f"ambience segment {s} has t1 <= t0")
    hush = spec.get("hush", [])
    for h in hush:
        if not (len(h) == 2 and 0 <= float(h[0]) < float(h[1])):
            sys.exit(f"hush window {h} must be [t0, t1] with 0 <= t0 < t1")

    cache = os.path.join(os.path.dirname(os.path.abspath(a.out)), ".audio")
    synth = [sys.executable, os.path.join(HERE, "synth_audio.py"), "--out", cache, "--duration", f"{dur:.3f}",
             "--mood", spec.get("mood", "calm")]
    if spec.get("bpm"):
        synth += ["--bpm", str(spec["bpm"])]
    beds = sorted({s["name"] for s in amb})
    if beds:
        synth += ["--amb", ",".join(beds)]
    if subprocess.run(synth).returncode != 0:
        sys.exit("synth_audio.py failed (check mood / bpm in cues.json)")
    music = os.path.abspath(a.music) if a.music else os.path.join(cache, "bgm.wav")
    if not os.path.exists(music):
        sys.exit(f"music file not found: {music}")

    base = os.path.dirname(os.path.abspath(a.cues))
    inputs = ["-i", a.video, "-i", music]
    fade_out = min(2.0, dur / 4)
    hush_w = [(float(h0), float(h1), 10 ** (HUSH_DB / 20), HUSH_IN, HUSH_OUT) for h0, h1 in hush]

    sfx = []  # (input path, start s, offset into the sound s, gain, name)
    for c in cues:
        src = c["sfx"]
        path = os.path.join(cache, "sfx", f"{src}.wav") if "/" not in src and "." not in src else os.path.join(base, src)
        if not os.path.exists(path):
            sys.exit(f"sfx not found: {src}")
        start, length = float(c["t"]), wav_seconds(path)
        if src in END_ANCHORED:
            start -= length
        sfx.append((path, max(0.0, start), max(0.0, -start), float(c.get("gain", 0.5)), src, length))

    duck_w = []
    if spec.get("duck"):
        for path, start, off, g, src, length in sfx:
            if src in DUCK_SFX:
                duck_w.append((start, start + min(length - off, 2.5), 10 ** (DUCK_DB / 20), DUCK_ATTACK, DUCK_RELEASE))
    graph = [f"[1:a]atrim=0:{dur:.3f},afade=t=in:d=0.4,afade=t=out:st={dur - fade_out:.3f}:d={fade_out:.3f},"
             f"volume={float(spec.get('bgm_gain', 0.5))}{envelope(hush_w + duck_w)}[bgm]"]
    labels = ["[bgm]"]
    idx = 2

    # ambience: merge touching segments of the same bed (it continues without restarting), then one looping
    # input per run, faded in / out over AMB_XF centred on its edges so neighbouring beds crossfade
    runs = []
    for s in amb:
        t0, t1 = max(0.0, float(s["t0"])), min(dur, float(s["t1"]))
        if t1 <= t0:
            continue
        if runs and runs[-1][2] == s["name"] and t0 - runs[-1][1] < 1e-3:
            runs[-1][1] = max(runs[-1][1], t1)
        else:
            runs.append([t0, t1, s["name"]])
    amb_labels = []
    for t0, t1, name in runs:
        a0 = max(0.0, t0 - (AMB_XF / 2 if t0 > 0 else 0))
        a1 = min(dur, t1 + (AMB_XF / 2 if t1 < dur else 0))
        length = a1 - a0
        fi = AMB_XF if t0 > 0 else 0.3
        fo = AMB_XF if t1 < dur else min(fade_out, length / 2)
        fi, fo = min(fi, length / 2), min(fo, length / 2)
        inputs += ["-stream_loop", "-1", "-i", os.path.join(cache, "amb", f"{name}.wav")]
        ms = int(round(a0 * 1000))
        graph.append(f"[{idx}:a]atrim=0:{length:.3f},asetpts=PTS-STARTPTS,afade=t=in:d={fi:.3f}:curve=qsin,"
                     f"afade=t=out:st={length - fo:.3f}:d={fo:.3f}:curve=qsin,adelay={ms}|{ms}[m{idx}]")
        amb_labels.append(f"[m{idx}]")
        idx += 1
    if amb_labels:
        src = amb_labels[0] if len(amb_labels) == 1 else f"{''.join(amb_labels)}amix=inputs={len(amb_labels)}:normalize=0,"
        graph.append(f"{src}volume={float(spec.get('amb_gain', 0.5))}{envelope(hush_w)}[amb]")
        labels.append("[amb]")

    for path, start, off, g, src, length in sfx:
        inputs += ["-i", path]
        ms = int(round(start * 1000))
        trim = f"atrim=start={off:.3f},asetpts=PTS-STARTPTS," if off > 0 else ""
        graph.append(f"[{idx}:a]{trim}volume={g},adelay={ms}|{ms}[s{idx}]")
        labels.append(f"[s{idx}]")
        idx += 1
    # the bed is first, so duration=first keeps the mix exactly as long as the video
    graph.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first,"
                 f"alimiter=limit=0.95,atrim=0:{dur:.3f}[a]")

    os.makedirs(cache, exist_ok=True)
    premix = os.path.join(cache, "premix.wav")
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(graph),
           "-map", "[a]", "-c:a", "pcm_f32le", premix]
    if subprocess.run(cmd).returncode != 0:
        sys.exit("ffmpeg mix failed")

    # loudness. Pass 1 measures the premix; a gain to the target plus a peak limiter makes room so that the
    # final loudnorm can run in linear mode (one gain, dynamics and hush dips untouched); pass 2 measures that
    # and loudnorm applies it while muxing (the video stream is copied).
    norm = f"loudnorm=I={TARGET_I}:TP={TARGET_TP - TP_HEADROOM}:LRA={TARGET_LRA}"
    first = measure(premix, norm)
    master = os.path.join(cache, "master.wav")
    gain = TARGET_I - float(first["input_i"]) + 0.5   # slightly over: limiting costs loudness; pass 2 trims it
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", premix, "-af",
           f"aresample=176400,volume={gain:.2f}dB,alimiter=limit={10 ** (LIMIT_DB / 20):.4f}:attack=3:release=60:level=0,"
           "aresample=48000",
           "-c:a", "pcm_f32le", master]
    if subprocess.run(cmd).returncode != 0:
        sys.exit("ffmpeg limiter failed")
    meas = measure(master, norm)
    apply = (f"{norm}:measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:measured_LRA={meas['input_lra']}"
             f":measured_thresh={meas['input_thresh']}:offset={meas['target_offset']}:linear=true:print_format=json,"
             f"aresample=48000")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-y", "-i", a.video, "-i", master, "-filter_complex", f"[1:a]{apply}[a]",
           "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           "-shortest", "-movflags", "+faststart", a.out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"ffmpeg loudnorm / mux failed: {r.stderr[-400:]}")
    mode = re.search(r'"normalization_type"\s*:\s*"(\w+)"', r.stderr)
    i, tp = loudness(a.out)
    print(f"✓ {a.out} ({dur:.2f}s, {len(cues)} cues, {len(runs)} ambience runs, {len(hush)} hush, "
          f"music: {'custom' if a.music else 'synthesized'})")
    print(f"  loudness: premix {float(first['input_i']):.1f} LUFS → final {i:.1f} LUFS integrated, true peak {tp:.1f} dBTP "
          f"(target {TARGET_I} LUFS / {TARGET_TP} dBTP, loudnorm {mode.group(1) if mode else '?'})")


if __name__ == "__main__":
    main()
