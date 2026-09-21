#!/usr/bin/env python3
"""生成可本地打开的流程与输出格式说明卡；不是运行截图。
内容来自 cards.json，真实结果截图由 build_gallery.py 单独选入 README。"""
import json, html
from pathlib import Path
HERE = Path(__file__).resolve().parent
cards = json.loads((HERE / "cards.json").read_text(encoding="utf-8"))

CSS = """
*{box-sizing:border-box} body{margin:0;background:#F5F0E6;font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif;color:#2B2622}
.card{width:1200px;height:675px;padding:44px 52px;display:flex;flex-direction:column;position:relative;overflow:hidden}
.top{display:flex;align-items:baseline;gap:18px;margin-bottom:8px}
.name{font:700 40px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#5D4037}
.tag{font-size:16px;color:#fff;background:#5D4037;border-radius:999px;padding:5px 14px}
.one{font-size:22px;color:#6B5E52;margin:4px 0 22px}
.grid{display:grid;grid-template-columns:5fr 7fr;gap:22px;flex:1;min-height:0}
.pane{background:#fff;border:2px solid #5D4037;border-radius:18px;padding:18px 22px;box-shadow:0 6px 0 rgba(93,64,55,.12);display:flex;flex-direction:column;min-height:0}
.pane h4{margin:0 0 10px;font-size:15px;letter-spacing:.12em;color:#8C7B6E;text-transform:uppercase}
pre{margin:0;white-space:pre-wrap;word-break:break-all;font:16px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#2B2622;overflow:hidden}
.pane.in pre{font-size:20px;line-height:1.6}
.hl{color:#2F6FB3;font-weight:700}
.ok{color:#2E7D32}.warn{color:#C62828}
.foot{position:absolute;right:52px;bottom:26px;font-size:15px;color:#9A8B7E}
.arrow{position:absolute;left:calc(5fr);}
.src{font-size:13px;color:#9A8B7E;margin-top:auto;padding-top:8px}
"""

def esc(s):  # 支持 <hl>/<ok>/<warn> 标记
    s = html.escape(s)
    for t in ("hl", "ok", "warn"):
        s = s.replace(f"&lt;{t}&gt;", f'<span class="{t}">').replace(f"&lt;/{t}&gt;", "</span>")
    return s

for c in cards:
    body = f"""<!doctype html><meta charset="utf-8"><style>{CSS}</style>
<div class="card">
  <div class="top"><span class="name">{esc(c['name'])}</span><span class="tag">{esc(c['tag'])}</span></div>
  <div class="one">{esc(c['one'])}</div>
  <div class="grid">
    <div class="pane in"><h4>{esc(c.get('in_label','输入 · 触发'))}</h4><pre>{esc(c['input'])}</pre></div>
    <div class="pane"><h4>{esc(c.get('out_label','输出格式示例'))}</h4><pre>{esc(c['output'])}</pre><div class="src">{esc(c.get('src',''))}</div></div>
  </div>
  <div class="foot">agent-skills-zh · 流程与输出格式说明，非运行截图</div>
</div>"""
    (HERE / f"{c['name']}.html").write_text(body, encoding="utf-8")
parts=[]; css=None
for c in cards:
    h=(HERE / f"{c['name']}.html").read_text(encoding="utf-8")
    if css is None: css=h.split("<style>")[1].split("</style>")[0]
    parts.append(h.split("</style>",1)[1])
(HERE / "index.html").write_text(f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>技能流程与输出格式</title><style>{css} body{{width:1200px}} header{{padding:24px 52px}}</style><header><h1>流程与输出格式</h1><p>这些说明卡包含格式约定和标注来源的历史摘录，不是运行截图。使用条件请看仓库 README 与各技能说明。</p></header>'+"".join(parts)+'</html>', encoding="utf-8")
print("built", len(cards), "cards + index.html")
