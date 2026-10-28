#!/usr/bin/env python3
"""audio_check.py — 不靠耳朵自检成片音频（仅标准库 + ffmpeg）。

用法：python3 audio_check.py <file.wav|file.mp4> [--out DIR]

输出：每秒 RMS dBFS、文字火花图，以及问题标记（每类一行 `FLAG <名字> <时间段> <说明>`）：
  HISS   连续 >= 2 s 高频(>9 kHz)相对全频只低不到 HISS_DB（宽带噪声块：白噪声 riser、嘶嘶底噪）
  CLIP   原始各声道样本峰值 >= -0.1 dBFS（不混单声道测峰值，ffmpeg 立体声转单声道会把两路相加）
  SILENT 除首尾各 1 s 外，连续 >= 3 s 低于 -50 dBFS
  FLAT   全片没有任何 3 s 滑动平均比中位数响 >= 6 dB（配乐没有起伏，只是平铺的底）。只对配乐轨有意义：
         成片里拟音持续不断、再经响度归一，最响段只比中位数高 2–3 dB 是常态（实测《信息茧房》配乐 6 dB、
         成片 2.6 dB，降环境声也只回到 2.6）。检查成片时加 --mix，跳过 FLAT，只看 HISS / CLIP / SILENT。
--out DIR 额外生成 DIR/spectrum.png（1600x300 对数频率频谱图）。有任何 FLAG 退出码 1，否则 0。

HISS 阈值校准（HISS_DB，hf 与全频 dB 差，越接近 0 越像宽带噪声）：
  白噪声：约 -3.5 dB（32 kHz 采样，9k 以上占 16k 带宽的 44%）
  440 Hz 基音+泛音(到 8 次，3520 Hz)的“音乐”：< -60 dB；带 12 kHz 以内高频泛音的亮钢琴/弦乐也 < -20 dB
  取中间值 -12 dB：白噪声稳报，乐器不报，留足两侧余量。仅在全频 > -50 dBFS 的秒数里判定。
"""
import argparse, array, math, os, subprocess, sys

SR = 32000
HISS_DB = -12.0
SPARK = "▁▂▃▄▅▆▇█"


def decode(path, af=None, ac=1, resample=True):  # ac=None 保留原声道数
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vn"]
    if af:
        cmd += ["-af", af]
    cmd += (["-ac", str(ac)] if ac else []) + (["-ar", str(SR)] if resample else []) + ["-f", "s16le", "-"]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        sys.exit("ffmpeg 解码失败: " + p.stderr.decode(errors="replace")[:300])
    a = array.array("h")
    a.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def db(x):
    return 20 * math.log10(x / 32768) if x > 0 else -100.0


def per_second_db(a, ch=1):
    step = SR * ch
    out = []
    for i in range(0, len(a) - step + 1, step):  # 丢弃不足 1 s 的尾巴
        seg = a[i:i + step]
        out.append(db(math.sqrt(sum(x * x for x in seg) / step)))
    return out


def runs(mask, min_len):
    res, i = [], 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j < len(mask) and mask[j]:
                j += 1
            if j - i >= min_len:
                res.append((i, j))
            i = j
        else:
            i += 1
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--out")
    ap.add_argument("--mix", action="store_true", help="成片（含拟音、环境声）：跳过只适用于配乐轨的 FLAT")
    args = ap.parse_args()
    if not os.path.exists(args.file):
        sys.exit("文件不存在: " + args.file)

    full = per_second_db(decode(args.file))
    hf = per_second_db(decode(args.file, "highpass=f=9000"))
    n = min(len(full), len(hf))
    if n == 0:
        sys.exit("音频不足 1 s")
    full, hf = full[:n], hf[:n]
    print("RMS dBFS/s: " + " ".join(f"{i}:{round(v)}" for i, v in enumerate(full)))
    print("spark: " + "".join(SPARK[max(0, min(7, int((v + 45) / 35 * 7.999)))] for v in full))
    gap = [h - f for h, f in zip(hf, full)]
    print(f"HF-全频差 dB(max {max(gap):.1f}, 阈值 {HISS_DB})")

    flags = []
    mask = [full[i] > -50 and gap[i] > HISS_DB for i in range(n)]
    for a, b in runs(mask, 2):
        flags.append(f"FLAG HISS {a}-{b}s 高频仅比全频低 {-max(gap[a:b]):.1f} dB 起，宽带噪声块")

    st = decode(args.file, ac=None, resample=False)  # 原声道、不重采样（-ac 2 会给单声道降 3 dB），逐样本取峰值
    pk = max(max(st), -min(st), 1) if len(st) else 0
    if db(pk) >= -0.1:
        flags.append(f"FLAG CLIP 全片 样本峰值 {db(pk):.2f} dBFS >= -0.1")

    sil = [0 < i < n - 1 and full[i] < -50 for i in range(n)]
    for a, b in runs(sil, 3):
        flags.append(f"FLAG SILENT {a}-{b}s 连续 {b - a} s 低于 -50 dBFS")

    if n >= 6 and not args.mix:
        ma = [sum(full[i:i + 3]) / 3 for i in range(n - 2)]
        med = sorted(full)[n // 2]
        if max(ma) - med < 6:
            flags.append(f"FLAG FLAT 0-{n}s 最响 3 s 仅比中位数高 {max(ma) - med:.1f} dB (<6)，配乐无起伏")

    if args.out:
        os.makedirs(args.out, exist_ok=True)
        png = os.path.join(args.out, "spectrum.png")
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", args.file, "-lavfi",
                            "showspectrumpic=s=1600x300:scale=log:legend=0", png], capture_output=True)
        print(png if r.returncode == 0 else "频谱图生成失败: " + r.stderr.decode(errors="replace")[:200])

    print(f"峰值 {db(pk):.2f} dBFS, 时长约 {n} s")
    for f in flags:
        print(f)
    if not flags:
        print("OK 未发现问题")
    sys.exit(1 if flags else 0)


if __name__ == "__main__":
    main()
