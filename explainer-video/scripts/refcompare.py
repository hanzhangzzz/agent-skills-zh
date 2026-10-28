#!/usr/bin/env python3
"""refcompare.py — 与参考片并排对比（仅标准库 + ffmpeg）。

用法：python3 refcompare.py --ref ref.mp4 (--ours-video film.mp4 | --ours a.png b.png ...) [--n 6] --out out/ref-compare.jpg
布局：第 1 行 参考片均匀 n 帧（跳过首尾各 5%），第 2 行 我方 n 帧，每格等高 360；
      第 3 行 参考片中间帧与我方对应帧的「原尺寸中心裁切」(720x360，不缩放)，用来比细节密度（线多细、字多小）。
横竖版不同也行，等高缩放。打印两边分辨率和取帧时间。
"""
import argparse, os, subprocess, sys, tempfile

H = 360
CROP_W = 720


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit("命令失败: " + p.stderr[-400:])
    return p.stdout


def probe(path):
    w, h = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                "-of", "csv=p=0", path]).strip().split(",")[:2]
    d = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).strip()
    return int(w), int(h), float(d) if d and d != "N/A" else 0.0


def pick_times(dur, n):
    lo, hi = dur * 0.05, dur * 0.95
    return [lo + (hi - lo) * (i + 0.5) / n for i in range(n)]


def grab(video, t, out):
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1", out])


def scale_h(src, out):
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"scale=-2:{H}", out])


def crop_center(src, out):
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf",
         f"pad=w='max(iw,{CROP_W})':h='max(ih,{H})':x=(ow-iw)/2:y=(oh-ih)/2:color=black,"
         f"crop={CROP_W}:{H}:(iw-{CROP_W})/2:(ih-{H})/2", out])


def hstack(files, out):
    if len(files) == 1:
        run(["ffmpeg", "-v", "error", "-y", "-i", files[0], out])
        return
    cmd = ["ffmpeg", "-v", "error", "-y"]
    for f in files:
        cmd += ["-i", f]
    cmd += ["-filter_complex", "".join(f"[{i}:v]" for i in range(len(files))) + f"hstack=inputs={len(files)}", out]
    run(cmd)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--ours-video")
    ap.add_argument("--ours", nargs="*")
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if bool(a.ours_video) == bool(a.ours):
        sys.exit("--ours-video 与 --ours 二选一")
    tmp = tempfile.mkdtemp(prefix="refcompare-")

    rw, rh, rd = probe(a.ref)
    rt = pick_times(rd, a.n)
    ref_raw = []
    for i, t in enumerate(rt):
        f = os.path.join(tmp, f"r{i}.png"); grab(a.ref, t, f); ref_raw.append(f)
    print(f"参考 {rw}x{rh} {rd:.1f}s 取帧 " + ", ".join(f"{t:.1f}" for t in rt))

    if a.ours_video:
        ow, oh, od = probe(a.ours_video)
        ot = pick_times(od, a.n)
        our_raw = []
        for i, t in enumerate(ot):
            f = os.path.join(tmp, f"o{i}.png"); grab(a.ours_video, t, f); our_raw.append(f)
        print(f"我方 {ow}x{oh} {od:.1f}s 取帧 " + ", ".join(f"{t:.1f}" for t in ot))
    else:
        our_raw = a.ours
        ow, oh, _ = probe(our_raw[0])
        print(f"我方 {ow}x{oh} 图片 {len(our_raw)} 张")

    def row(raws, tag):
        fs = []
        for i, r in enumerate(raws):
            o = os.path.join(tmp, f"{tag}s{i}.png"); scale_h(r, o); fs.append(o)
        o = os.path.join(tmp, f"{tag}row.png"); hstack(fs, o); return o

    r1, r2 = row(ref_raw, "r"), row(our_raw, "o")
    cr = os.path.join(tmp, "cr.png"); co = os.path.join(tmp, "co.png")
    crop_center(ref_raw[len(ref_raw) // 2], cr)
    crop_center(our_raw[len(our_raw) // 2], co)
    r3 = os.path.join(tmp, "row3.png"); hstack([cr, co], r3)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    run(["ffmpeg", "-v", "error", "-y", "-i", r1, "-i", r2, "-i", r3, "-filter_complex",
         "[0:v][1:v][2:v]xstack=inputs=3:layout=0_0|0_h0|0_h0+h1:fill=black[o]",
         "-map", "[o]", "-frames:v", "1", "-q:v", "3", a.out])
    print(f"{a.out}: 行1 参考 / 行2 我方 / 行3 中心裁切 {CROP_W}x{H}（左参考 右我方）")


if __name__ == "__main__":
    main()
