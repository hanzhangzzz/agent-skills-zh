#!/usr/bin/env python3
"""refcompare.py — 与参考片并排对比（仅标准库 + ffmpeg）。

用法：python3 refcompare.py --ref ref.mp4 (--ours-video film.mp4 | --ours a.png b.png ...) [--n 6] [--ref-crop WxH+X+Y] [--our-crop WxH+X+Y] --out out/ref-compare.jpg
布局：第 1 行 参考片均匀 n 帧（跳过首尾各 5%），第 2 行 我方 n 帧，每格等高 360；
      第 3 行 参考片中间帧与我方对应帧的「原尺寸中心裁切」(720x360，不缩放)，用来比细节密度（线多细、字多小）。
      --ref-crop / --our-crop：第 3 行改用指定区域（原尺寸像素，不缩放），默认仍是中心 720x360。
横竖版不同也行，等高缩放。打印两边分辨率、取帧时间、两边裁切区域，以及裁切区「每 100 px 的亮线数」
（对裁切区逐行水平扫描，数亮度高于阈值的游程，取各行平均；阈值 = 均值与最大值的中点）。
"""
import argparse, os, re, subprocess, sys, tempfile

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


def parse_crop(spec):
    m = re.fullmatch(r"(\d+)x(\d+)\+(\d+)\+(\d+)", spec or "")
    if not m:
        sys.exit(f"裁切格式应为 WxH+X+Y，收到 {spec!r}")
    return tuple(int(v) for v in m.groups())


def crop_region(src, out, region, size):
    """region=None -> 中心 CROP_W x H（小图先补黑边）；否则按 (w,h,x,y) 原尺寸裁切。返回 (w,h,x,y)。"""
    if region is None:
        iw, ih = size
        w, h = CROP_W, H
        x, y = (max(iw, w) - w) // 2, (max(ih, h) - h) // 2
        vf = f"pad=w='max(iw,{w})':h='max(ih,{h})':x=(ow-iw)/2:y=(oh-ih)/2:color=black,crop={w}:{h}:{x}:{y}"
        region = (w, h, x, y)
    else:
        w, h, x, y = region
        if x + w > size[0] or y + h > size[1]:
            sys.exit(f"裁切区 {w}x{h}+{x}+{y} 超出画面 {size[0]}x{size[1]}")
        vf = f"crop={w}:{h}:{x}:{y}"
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, out])
    return region


def line_density(path, w, h):
    """裁切区每 100 px 水平宽度里的亮线数：逐行数亮度 >= 阈值的游程，取各行平均 / w * 100。返回 (密度, 阈值)。"""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", "format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    if len(raw) < w * h:
        return 0.0, 0
    raw = raw[:w * h]
    thr = (sum(raw) / len(raw) + max(raw)) / 2
    runs = 0
    for r in range(h):
        row = raw[r * w:(r + 1) * w]
        prev = False
        for v in row:
            cur = v >= thr
            if cur and not prev:
                runs += 1
            prev = cur
    return runs / h / w * 100, int(thr)


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
    ap.add_argument("--ref-crop", help="WxH+X+Y，参考片第 3 行裁切区（原尺寸像素），默认中心")
    ap.add_argument("--our-crop", help="WxH+X+Y，我方第 3 行裁切区（原尺寸像素），默认中心")
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
    reg_r = crop_region(ref_raw[len(ref_raw) // 2], cr, parse_crop(a.ref_crop) if a.ref_crop else None, (rw, rh))
    reg_o = crop_region(our_raw[len(our_raw) // 2], co, parse_crop(a.our_crop) if a.our_crop else None, (ow, oh))
    for tag, reg, f in (("参考", reg_r, cr), ("我方", reg_o, co)):
        dens, thr = line_density(f, reg[0], reg[1])
        print(f"{tag}裁切 {reg[0]}x{reg[1]}+{reg[2]}+{reg[3]}（原尺寸）· 每 100 px 约 {dens:.1f} 条亮线（阈值 {thr}/255）")
    mh = max(reg_r[1], reg_o[1])                       # 两边高度不同时补黑到同高再并排，不缩放
    padded = []
    for f, reg in ((cr, reg_r), (co, reg_o)):
        o = f.replace(".png", "p.png")
        run(["ffmpeg", "-v", "error", "-y", "-i", f, "-vf", f"pad=w=iw:h={mh}:x=0:y=0:color=black", o]); padded.append(o)
    r3 = os.path.join(tmp, "row3.png"); hstack(padded, r3)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    run(["ffmpeg", "-v", "error", "-y", "-i", r1, "-i", r2, "-i", r3, "-filter_complex",
         "[0:v][1:v][2:v]xstack=inputs=3:layout=0_0|0_h0|0_h0+h1:fill=black[o]",
         "-map", "[o]", "-frames:v", "1", "-q:v", "3", a.out])
    print(f"{a.out}: 行1 参考 / 行2 我方 / 行3 原尺寸裁切（左参考 右我方）")


if __name__ == "__main__":
    main()
