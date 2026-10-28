#!/usr/bin/env python3
"""score_kit.py — 给知识短片合成无版权配乐的乐器与母带模块（依赖 numpy，不用 scipy）。

API（音色算法取自 explainer-filter-bubble 的 compose_score.py）
  Score(duration, sr=48000)
    .place(sig, t0, pan=0, gain=1)      在 t0 秒放一个信号，pan -1(左)..1(右)
    .write(path, fade_in=.4, fade_out=1.5, reverb=.55)   合成混响 + 淡入淡出 + 归一化到峰值 0.89 + 16-bit 立体声 wav
  乐器：hz(midi) piano(m,dur,vel) pad(notes,dur,bright,att,rel,voices) sub(m,dur,gain) pluck(m,dur,gain)
        strings(notes,dur,gain,att) boom(dur) riser(dur)   （riser 是带通、随时间打开的噪声，不是全频白噪声）
  MIDI 69 = A4 = 440 Hz。duration 要覆盖最后一个音的起点；尾音超出会被截断，混响尾巴靠 write 里多留的 1 s。

示例（呼应画面：首个元素一个钢琴音 → 铺底渐强 → 静默 → 冲击 → 结尾长尾音）
  import score_kit as k
  s = k.Score(24)
  s.place(k.piano(81, 4, .55), 0.5)                                   # 首个元素：一个钢琴音
  s.place(k.pad((50, 57, 62, 65), 9, bright=lambda x: .15 + .8 * x ** 2, att=3.5), 3, gain=1.6)  # 铺底渐强
  s.place(k.riser(2.4), 10.6)                                         # 14 s 冲击前 2.4 s 起 riser，中间静默
  s.place(k.boom(5), 13, gain=.9)                                     # 冲击
  for m in (62, 66, 69, 76): s.place(k.piano(m, 8, .5), 13.2)         # 冲击后和弦
  s.place(k.pad((38, 50, 57, 66), 10, att=.4, rel=2.5), 13.2)         # 结尾长尾音
  s.write("score.wav")
"""
import sys
import wave

try:
    import numpy as np
except ImportError:
    sys.exit("score_kit 需要 numpy：python3 -m pip install numpy")

SR = 48000
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def _t(dur):
    return np.arange(int(dur * SR)) / SR


def fft_filter(x, lo=None, hi=None):
    """频域掩模滤波：lo=高通截止，hi=低通截止，同时给出为带通（替代 scipy butter/sosfilt，离线渲染用）。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= f >= lo
    if hi:
        m *= f <= hi
    return np.fft.irfft(X * m, len(x))


def piano(m, dur=4.0, vel=1.0):
    t = _t(dur)
    f = hz(m)
    s = np.zeros_like(t)
    for n in range(1, 9):
        fn = n * f * np.sqrt(1 + .0004 * n * n)
        if fn > 15000:
            break
        s += np.sin(2 * np.pi * fn * t) * n ** -1.4 * np.exp(-t * (.7 + .55 * n))
    s *= np.minimum(1, t / .004) * vel
    return s * .35


def pad(notes, dur, bright=lambda x: .3, att=1.5, rel=2.0, voices=3):
    t = _t(dur)
    b = bright(t / dur)
    s = np.zeros_like(t)
    for m in notes:
        for v in range(voices):
            f = hz(m) * 2 ** ((v - (voices - 1) / 2) * 7 / 1200)
            ph = rng.random() * 6.283
            for n in range(1, 13):
                if n * f > 9000:
                    break
                s += np.sin(2 * np.pi * n * f * t + ph * n) / n * np.exp(-(n - 1) / (1 + 7 * b))
    env = np.minimum(1, t / att) * np.minimum(1, (dur - t) / rel)
    return s * env / (len(notes) * voices) * .5


def sub(m, dur, gain=1.0):
    t = _t(dur)
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + .45 * np.sin(4 * np.pi * f * t) + .2 * np.sin(6 * np.pi * f * t)
    return s * np.exp(-t / (dur * .55)) * np.minimum(1, t / .006) * gain * .32


def pluck(m, dur=.6, gain=1.0):
    t = _t(dur)
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + .3 * np.sin(4 * np.pi * f * t) + .12 * np.sin(6 * np.pi * f * t)
    return s * np.exp(-t / .16) * np.minimum(1, t / .008) * gain * .16   # 8 ms 起音，避免咔哒声


def strings(notes, dur, gain=1.0, att=2.5):
    t = _t(dur)
    s = np.zeros_like(t)
    for m in notes:
        vib = 1 + .004 * np.sin(2 * np.pi * 5.2 * t + rng.random() * 6)
        ph = np.cumsum(2 * np.pi * hz(m) * vib / SR)
        s += np.sin(ph) + .35 * np.sin(2 * ph) + .15 * np.sin(3 * ph)
    env = np.minimum(1, t / att) * np.minimum(1, (dur - t) / 2.0)
    return s * env / len(notes) * gain * .2


def boom(dur=4.0):
    t = _t(dur)
    f = 32 + 40 * np.exp(-t / .12)
    s = np.sin(np.cumsum(2 * np.pi * f / SR)) * np.exp(-t / 1.4)
    nz = fft_filter(rng.standard_normal(len(t)), hi=900) * np.exp(-t / .25) * .5
    return (s + nz) * .9


def riser(dur):
    """带通噪声：300–1500 Hz 交叉渐变到 300–5000 Hz（滤波器随上升打开），加一条上扫正弦；幅度 0.06。"""
    t = _t(dur)
    x = t / dur
    nz = rng.standard_normal(len(t))
    lo, hi = fft_filter(nz, 300, 1500), fft_filter(nz, 300, 5000)
    s = (lo * (1 - x) + hi * x) * x ** 2.5 * .06
    s += np.sin(np.cumsum(2 * np.pi * (220 + 660 * x ** 2) / SR)) * x ** 3 * .06
    return s


class Score:
    def __init__(self, duration, sr=48000):
        if sr != SR:
            raise ValueError("score_kit 固定 48000 Hz 采样率")
        self.dur = duration
        self.N = int(duration * SR) + SR
        self.L = np.zeros(self.N)
        self.R = np.zeros(self.N)

    def place(self, sig, t0, pan=0.0, gain=1.0):
        i = int(t0 * SR)
        if i >= self.N or i < 0:
            return
        sig = sig[: self.N - i] * gain
        self.L[i:i + len(sig)] += sig * np.sqrt(.5 * (1 - pan))
        self.R[i:i + len(sig)] += sig * np.sqrt(.5 * (1 + pan))

    def write(self, path, fade_in=.4, fade_out=1.5, reverb=.55):
        N = self.N
        n_ir = int(3.2 * SR)
        ti = np.arange(n_ir) / SR
        irs = []
        for _ in range(2):  # 合成大厅：指数衰减(τ=.65 s)的低通(5.5 kHz)噪声冲激响应
            ir = fft_filter(rng.standard_normal(n_ir), hi=5500) * np.exp(-ti / .65)
            irs.append(ir / np.sqrt(np.sum(ir ** 2)))
        size = 1 << (N + n_ir).bit_length()
        wet = [np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:N]
               for x, ir in ((self.L, irs[0]), (self.R, irs[1]))]
        n = int(self.dur * SR)
        outs = [(x * .75 + w * reverb)[:n] for x, w in ((self.L, wet[0]), (self.R, wet[1]))]
        i = np.arange(n)
        fade = np.minimum(1, i / max(1, fade_in * SR)) * np.minimum(1, (n - i) / max(1, fade_out * SR))
        outs = [o * fade for o in outs]
        peak = max(np.abs(outs[0]).max(), np.abs(outs[1]).max(), 1e-9)
        st = (np.stack(outs, 1) / peak * .89 * 32767).astype("<i2")
        with wave.open(path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(st.tobytes())
        return path
