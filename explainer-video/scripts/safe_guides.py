#!/usr/bin/env python3
"""safe_guides.py — 给画面叠平台安全区参考线并拼成网格（仅标准库 + ffmpeg）。

用法：
  python3 safe_guides.py --preset xhs|landscape [--cols 7] --out grid.jpg img1.png img2.png ...
  python3 safe_guides.py --preset xhs --video film.mp4 --times 1,2.5,8 --out grid.jpg
preset xhs（1080x1920 小红书竖版）：绿框 = 中间 3:4 卡片区 y240-1680；红线 = 底部 22%（y=1498，标题/作者栏）；
                                    黄线 = 右侧 150 px（x=930，点赞评论按钮）。
preset landscape（1920x1080）：绿框 = 安全区 x80-1840, y180-900。
每格宽 360，按列数换行；输入尺寸与 preset 不符则报错退出。
"""
import argparse, os, subprocess, sys, tempfile

PRESETS = {
    "xhs": {"size": (1080, 1920), "boxes": [
        ("drawbox=x=0:y=240:w=1080:h=1440:color=lime@0.9:t=4",
         "drawbox=x=0:y=1498:w=1080:h=4:color=red@0.9:t=fill",
         "drawbox=x=930:y=0:w=4:h=1920:color=yellow@0.9:t=fill")]},
    "landscape": {"size": (1920, 1080), "boxes": [
        ("drawbox=x=80:y=180:w=1760:h=720:color=lime@0.9:t=4",)]},
}
CELL_W = 360


def run(cmd):
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        sys.exit("ffmpeg 失败: " + p.stderr.decode(errors="replace")[-400:])


def probe_size(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    if p.returncode != 0 or "," not in p.stdout:
        sys.exit("无法读取尺寸: " + path)
    w, h = p.stdout.strip().split(",")[:2]
    return int(w), int(h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", required=True, choices=PRESETS)
    ap.add_argument("--cols", type=int, default=7)
    ap.add_argument("--out", required=True)
    ap.add_argument("--video")
    ap.add_argument("--times", help="逗号分隔秒数，配合 --video")
    ap.add_argument("images", nargs="*")
    a = ap.parse_args()
    pre = PRESETS[a.preset]
    tmp = tempfile.mkdtemp(prefix="safeguides-")
    srcs = list(a.images)
    if a.video:
        if not a.times:
            sys.exit("--video 需要 --times")
        if probe_size(a.video) != pre["size"]:
            sys.exit(f"视频尺寸 {probe_size(a.video)} 与 preset {a.preset} {pre['size']} 不符")
        for i, t in enumerate(a.times.split(",")):
            f = os.path.join(tmp, f"f{i}.png")
            run(["ffmpeg", "-v", "error", "-y", "-ss", t.strip(), "-i", a.video, "-frames:v", "1", f])
            if not os.path.exists(f):
                sys.exit(f"时间 {t} 超出视频长度")
            srcs.append(f)
    if not srcs:
        sys.exit("没有输入图片（给图片路径或 --video --times）")
    for s in srcs:
        if probe_size(s) != pre["size"]:
            sys.exit(f"{s} 尺寸 {probe_size(s)} 与 preset {a.preset} {pre['size']} 不符")

    cell_h = CELL_W * pre["size"][1] // pre["size"][0]
    cells = []
    for i, s in enumerate(srcs):
        c = os.path.join(tmp, f"c{i}.png")
        vf = ",".join(pre["boxes"][0] + (f"scale={CELL_W}:{cell_h}",))
        run(["ffmpeg", "-v", "error", "-y", "-i", s, "-vf", vf, c])
        cells.append(c)
    cols = max(1, min(a.cols, len(cells)))
    cmd = ["ffmpeg", "-v", "error", "-y"]
    for c in cells:
        cmd += ["-i", c]
    if len(cells) == 1:
        fc, last = "[0:v]null[o]", None
    else:
        layout = "|".join(f"{(i % cols) * CELL_W}_{(i // cols) * cell_h}" for i in range(len(cells)))
        fc = "".join(f"[{i}:v]" for i in range(len(cells))) + f"xstack=inputs={len(cells)}:layout={layout}:fill=black[o]"
    cmd += ["-filter_complex", fc, "-map", "[o]", "-frames:v", "1", "-q:v", "3", a.out]
    run(cmd)
    print(f"{a.out}: {len(cells)} 格, {cols} 列, 每格 {CELL_W}x{cell_h}")


if __name__ == "__main__":
    main()
