#!/usr/bin/env python3
"""渲染单文件 HTML 并检查：JS 语法、运行时报错、画布溢出、文字重叠、最小字号。

  python3 render_check.py out.html                  渲染 + 抓运行时错误
  python3 render_check.py out.html --scale 2        2 倍分辨率，看清小字
  python3 render_check.py out.html --slice          按 svg 分块输出，便于逐块看
  python3 render_check.py out.html --height 4000    指定窗口高度（默认自动测量）

截图落在系统临时目录，路径会打印出来，之后用 Read 工具逐张看。
"""
import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME = next((p for p in [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
] if Path(p).exists()), None)


def check_syntax(html: str) -> list:
    """把 <script> 内容抽出来过 node --check。"""
    errs = []
    scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    if not scripts:
        return errs
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write("\n".join(scripts))
        tmp = f.name
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode:
        errs.append("[语法] " + (r.stderr.strip().splitlines() or ["node --check 失败"])[0])
    Path(tmp).unlink(missing_ok=True)
    return errs


def measure_height(path: Path) -> int:
    """先量一次页面真实高度。不量就得靠人猜：猜大了截图一半是空白，会被误读成排版有问题；
    猜小了内容被截断，又会漏掉真正的排版错误。"""
    tmp = path.with_suffix(".h.html")
    tmp.write_text(path.read_text(encoding="utf-8").replace(
        "</body>",
        "<script>addEventListener('load',()=>setTimeout(()=>{document.title='H'+"
        "Math.ceil(document.documentElement.scrollHeight)},800))</script></body>"),
        encoding="utf-8")
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=6000",
                        "--window-size=1420,900", "--dump-dom", f"file://{tmp.resolve()}"],
                       capture_output=True, text=True, timeout=180)
    tmp.unlink(missing_ok=True)
    m = re.search(r"<title>H(\d+)</title>", r.stdout)
    return int(m.group(1)) + 40 if m else 3000


def probe(path: Path, out: Path, scale: float, height: int) -> tuple:
    """渲染并回传 (运行时错误, 页面自检结果)。页面自检在浏览器里跑，查溢出/重叠/字号。"""
    js = r"""
    (() => {
      // 用视口坐标（getBoundingClientRect）而非 getBBox：后者返回未经 <g transform> 的局部坐标，
      // 跨坐标系比较会大量误报重叠。
      const bad = [], seen = new Set();
      document.querySelectorAll("svg").forEach(svg => {
        const sid = svg.id || "svg", sr = svg.getBoundingClientRect();
        const items = [...svg.querySelectorAll("text")].map(t => {
          const r = t.getBoundingClientRect();
          return { t, r, s: (t.textContent || "").trim() };
        }).filter(o => o.r.width > 0.5 && o.s);

        items.forEach(({ t, r, s }) => {
          if (r.left < sr.left - 2 || r.right > sr.right + 2 || r.top < sr.top - 2 || r.bottom > sr.bottom + 2)
            bad.push(`[溢出] ${sid}：「${s.slice(0,22)}」超出画布`);
          // getComputedStyle 对 SVG text 返回的已是用户坐标单位（= viewBox 单位），不需要再换算
          const fs = parseFloat(getComputedStyle(t).fontSize);
          if (fs && fs < 8.4) bad.push(`[字号] ${sid}：「${s.slice(0,22)}」仅 ${fs.toFixed(1)}px`);
        });

        // 泳道居中：虚线不是实体，两条虚线之间的区域才是实体，内容应在泳道内居中。
        // 贴着某一边画（典型症状：左间距恒为 2–3px）是最常见的排版错误。
        // 泳道居中与列归属共用同一组列线，先把列线算出来
        // 列归属：列位置从竖虚线本身推断（虚线就是列的可见载体，不必写死 X[]）
        // 只认贯穿性的长虚线：短的竖虚线可能是刻度、连接线、装饰，不是列
        const vbH = +(svg.getAttribute("viewBox") || "0 0 0 0").split(/\s+/)[3] || 1;
        const rails = [...svg.querySelectorAll("line[stroke-dasharray]")]
          .filter(l => Math.abs(+l.getAttribute("x1") - +l.getAttribute("x2")) < .5 &&
                       Math.abs(+l.getAttribute("y2") - +l.getAttribute("y1")) > vbH * 0.3)
          .map(l => +l.getAttribute("x1"));
        const cols = [...new Set(rails.map(x => Math.round(x)))].sort((a, b) => a - b);
        if (cols.length >= 3) {
          const gaps = cols.slice(1).map((x, i) => x - cols[i]).sort((a, b) => a - b);
          const unit = gaps[Math.floor(gaps.length / 2)];               // 列间距取中位数
          let undecl = 0, sample = [];
          svg.querySelectorAll("rect").forEach(r => {
            const x = +r.getAttribute("x"), w = +r.getAttribute("width");
            if (!(w > unit * 1.2)) return;                              // 窄于 1.2 列的不算跨列
            const crossed = cols.filter(c => c > x + 2 && c < x + w - 2).length;
            if (crossed < 1) return;                                    // 没跨过任何一条列线
            if (r.closest("[data-cols]")) return;                       // 已声明归属
            undecl++;
            if (sample.length < 3) {
              const t = (r.parentNode.textContent || "").trim().slice(0, 18);
              sample.push(`宽${Math.round(w)}·跨${crossed}条列线${t ? "「" + t + "」" : ""}`);
            }
          });
          if (undecl) bad.push(`[列归属] ${sid}：${undecl} 个横跨多列的区块没有声明 data-cols —— ${sample.join("；")}`);

          // 泳道居中：完全落在单个泳道内的矩形，左右间距应大致相等
          const edges = [...cols, +(svg.getAttribute("viewBox")||"0 0 0 0").split(/\s+/)[2]];
          let off = 0, offSample = [];
          svg.querySelectorAll("rect").forEach(r => {
            const x = +r.getAttribute("x"), w = +r.getAttribute("width");
            if (!(w > 24)) return;
            const holder = r.closest("[data-cols]");
            if (holder && holder.getAttribute("data-cols").match(/none|-/)) return;   // 不按列读 / 跨泳道
            for (let i = 0; i < edges.length - 1; i++) {
              const L = edges[i], R = edges[i+1], lw = R - L;
              if (x >= L - 2 && x + w <= R + 2) {
                const gl = x - L, gr = R - (x + w);
                if (Math.abs(gl - gr) > lw * 0.18) {
                  off++;
                  if (offSample.length < 3) {
                    const t = (r.parentNode.textContent || "").trim().slice(0, 14);
                    offSample.push(`泳道${i+1} 左${Math.round(gl)}/右${Math.round(gr)}${t ? "「"+t+"」" : ""}`);
                  }
                }
                break;
              }
            }
          });
          if (off) bad.push(`[泳道居中] ${sid}：${off} 个矩形没有在泳道内居中（虚线之间的区域才是实体）—— ${offSample.join("；")}`);
        }

        // 重叠：同一行（垂直中心差 < 该行高一半）且水平区间实际相交 > 2px
        const sorted = items.slice().sort((a, b) => a.r.left - b.r.left);
        for (let i = 0; i < sorted.length; i++) {
          const a = sorted[i];
          for (let j = i + 1; j < sorted.length; j++) {
            const b = sorted[j];
            if (b.r.left >= a.r.right - 2) break;                    // 已无水平交集，后面更靠右
            const gap = Math.abs((a.r.top + a.r.bottom) / 2 - (b.r.top + b.r.bottom) / 2);
            if (gap > Math.min(a.r.height, b.r.height) * 0.6) continue;
            const key = sid + a.s + b.s;
            if (seen.has(key)) continue;
            seen.add(key);
            bad.push(`[重叠] ${sid}：「${a.s.slice(0,16)}」压住「${b.s.slice(0,16)}」`);
          }
        }
      });
      return bad;
    })()
    """
    args = [CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=5000",
            f"--window-size=1420,{height}", "--enable-logging=stderr", "--v=0",
            f"--screenshot={out}"]
    if scale != 1:
        args.append(f"--force-device-scale-factor={scale}")
    args.append(f"file://{path.resolve()}")
    r = subprocess.run(args, capture_output=True, text=True, timeout=180)
    runtime = [l.strip() for l in (r.stderr or "").splitlines()
               if re.search(r"uncaught|referenceerror|typeerror|syntaxerror", l, re.I)]

    # 页面自检：用 --dump-dom 注入不便，改用一个临时副本把结果写进 title
    tmp_html = path.with_suffix(".probe.html")
    html = path.read_text(encoding="utf-8")
    tmp_html.write_text(html.replace("</body>",
        f"<script>addEventListener('load',()=>{{setTimeout(()=>{{document.title=JSON.stringify({js});}},900)}})</script></body>"),
        encoding="utf-8")
    d = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=6000",
                        f"--window-size=1420,{height}", "--dump-dom", f"file://{tmp_html.resolve()}"],
                       capture_output=True, text=True, timeout=180)
    tmp_html.unlink(missing_ok=True)
    m = re.search(r"<title>(.*?)</title>", d.stdout, re.S)
    issues = []
    if m and m.group(1).strip().startswith("["):
        import json
        try:
            issues = json.loads(m.group(1))
        except Exception:
            pass
    return runtime, issues


def slice_png(png: Path, n: int = 4) -> list:
    try:
        from PIL import Image
    except ImportError:
        print("  （未安装 Pillow，跳过分块；pip install Pillow 可启用）")
        return []
    im = Image.open(png)
    w, h = im.size
    step = h // n
    out = []
    for i in range(n):
        p = png.with_name(f"{png.stem}_{i+1}.png")
        im.crop((0, i * step, w, min(h, (i + 1) * step + 60))).save(p)
        out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("--scale", type=float, default=1)
    ap.add_argument("--height", type=int, default=0, help="0 = 自动测量页面真实高度")
    ap.add_argument("--slice", action="store_true")
    a = ap.parse_args()
    path = Path(a.html)
    if not path.exists():
        sys.exit(f"找不到 {path}")
    if not CHROME:
        sys.exit("找不到 Chrome / Chromium")

    if not a.height:
        a.height = measure_height(path)
        print(f"页面高度：自动测得 {a.height}px")
    errs = check_syntax(path.read_text(encoding="utf-8"))
    print("语法检查：" + ("通过" if not errs else "\n  " + "\n  ".join(errs)))

    out = Path(tempfile.gettempdir()) / f"{path.stem}.png"
    runtime, issues = probe(path, out, a.scale, a.height)
    print("运行时：" + ("无报错" if not runtime else "\n  " + "\n  ".join(runtime[:5])))

    hard = [i for i in issues if not i.startswith("[列归属]")]
    soft = [i for i in issues if i.startswith("[列归属]")]
    if hard:
        kinds = {}
        for i in hard:
            kinds.setdefault(i.split("]")[0] + "]", []).append(i)
        print(f"页面自检：{len(hard)} 处")
        for k, v in kinds.items():
            print(f"  {k} {len(v)} 处")
            for x in v[:4]:
                print("    ", x)
            if len(v) > 4:
                print(f"     …… 另 {len(v)-4} 处")
    else:
        print("页面自检：无溢出、无重叠、字号达标")
    if soft:
        print("待确认：横向跨度是在向读者宣称列归属，逐个确认后用 place() 声明")
        for x in soft:
            print("  ", x)

    print(f"\n截图：{out}（{a.height}px，已按页面真实高度截取，不应有大片空白）")
    if a.slice:
        for p in slice_png(out):
            print(f"  分块：{p}")
    print("用 Read 工具打开上面的路径逐张看，不要只看有没有报错。")
    sys.exit(1 if (errs or runtime) else 0)


if __name__ == "__main__":
    main()
