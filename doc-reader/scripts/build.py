#!/usr/bin/env python3
"""
Doc Reader - HTML 构建脚本

将 Markdown 源文件和幻灯片图片内嵌到 HTML 预览页面中。
直接运行即可重新生成 preview.html，无需启动 HTTP 服务。

用法:
    python3 build.py
    # 或
    ./build.py  (需要先 chmod +x build.py)
"""

import base64
import glob
import html
import json
import os
import sys

def read_file(path, default=""):
    """安全读取文件，不存在则返回默认值"""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"⚠️  文件不存在: {path}")
        return default

def read_image_as_base64(path):
    """读取图片并转换为 base64 data URL"""
    try:
        with open(path, 'rb') as f:
            data = f.read()
        # 根据扩展名确定 MIME 类型
        ext = os.path.splitext(path)[1].lower()
        mime_types = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }
        mime = mime_types.get(ext, 'image/png')
        return f"data:{mime};base64,{base64.b64encode(data).decode('utf-8')}"
    except FileNotFoundError:
        return None

def escape_script_content(content):
    """转义 script 标签中的特殊内容，防止提前闭合"""
    return content.replace('</script>', '<\\/script>')

def collect_slide_images():
    """收集 slides 目录下的所有图片，返回 {index: base64_data} 映射

    支持 PNG、JPG、JPEG、WebP 格式，同一索引优先使用先找到的格式
    """
    images = {}
    # 支持多种图片格式
    supported_formats = ['png', 'jpg', 'jpeg', 'webp']

    for fmt in supported_formats:
        slide_files = sorted(glob.glob(f'slides/slide_*.{fmt}'))
        for path in slide_files:
            filename = os.path.basename(path)
            try:
                # 提取索引: slide_01.png -> 1, slide_01.jpg -> 1
                name_without_ext = os.path.splitext(filename)[0]
                index = int(name_without_ext.replace('slide_', ''))
                # 如果该索引已有图片，跳过（优先保留先找到的格式）
                if index in images:
                    continue
                base64_data = read_image_as_base64(path)
                if base64_data:
                    images[index] = base64_data
            except ValueError:
                continue
    return images

def first_heading(markdown: str) -> str:
    """取 Markdown 的首个一级标题作为文档标题。

    代码块内的 ``#`` 不是标题，需跳过围栏区域。
    """
    in_fence = False
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith('```') or stripped.startswith('~~~'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if stripped.startswith('# '):
            return stripped[2:].strip()
    return ''


def build_html():
    """构建 preview.html"""

    # 内嵌 marked 库（离线可用，不依赖 CDN——jsdelivr 在大陆间歇性不可达）
    marked_lib = escape_script_content(read_file('marked.min.js'))
    if not marked_lib.strip():
        print("❌ marked.min.js 为空或仅含空白，无法构建自包含预览", file=sys.stderr)
        sys.exit(1)

    # 读取源文件
    original_md = read_file('original.md', '# 原文加载失败')
    translated_md = read_file('translated.md', '# 翻译加载失败')
    slides_json = read_file('slides_metadata.json', '{"slides":[]}')

    # 收集幻灯片图片
    slide_images = collect_slide_images()
    has_images = len(slide_images) > 0

    # 解析 slides JSON；标题以译文 H1 为准（元数据契约里没有 title 字段）
    try:
        slides_data = json.loads(slides_json)
        metadata_title = str(slides_data.get('title') or '').strip()
    except json.JSONDecodeError:
        metadata_title = ''
        slides_json = '{"total_slides":0,"slides":[]}'

    title = (
        metadata_title
        or first_heading(translated_md)
        or first_heading(original_md)
        or '文档阅读器'
    )
    title_html = html.escape(title)

    # 转义内容
    original_md_escaped = escape_script_content(original_md)
    translated_md_escaped = escape_script_content(translated_md)

    # 构建图片数据 JSON
    slide_images_json = json.dumps(slide_images)

    # HTML 模板
    html_template = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title_html} - Doc Reader</title>
    <script>
{marked_lib}
    </script>
    <style>
        :root {{
            --bg-primary: #0a0a0a;
            --bg-secondary: #141414;
            --bg-tertiary: #1a1a1a;
            --text-primary: #f5f5f7;
            --text-secondary: #a1a1a6;
            --accent: #2997ff;
            --border: #2d2d2d;
            --code-bg: #1e1e1e;
            --heading-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --font-scale: 1;
        }}
        /* 浅色模式 */
        body.light-mode {{
            --bg-primary: #ffffff;
            --bg-secondary: #f5f5f7;
            --bg-tertiary: #e8e8ed;
            --text-primary: #1d1d1f;
            --text-secondary: #6e6e73;
            --border: #d2d2d7;
            --code-bg: #f5f5f7;
        }}
        body.light-mode .header {{
            background: rgba(255, 255, 255, 0.8);
        }}
        body.light-mode .markdown-content h1 {{
            background: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}
        body.light-mode .slide-card {{
            background: #ffffff;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
        }}
        body.light-mode .slide-card:hover {{
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
        }}
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            overflow: hidden;
        }}
        .header {{
            position: fixed; top: 0; left: 0; right: 0; height: 56px;
            background: rgba(10, 10, 10, 0.8);
            backdrop-filter: saturate(180%) blur(20px);
            border-bottom: 1px solid var(--border);
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 24px; z-index: 100;
        }}
        .header-title {{ font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px; }}
        .header-controls {{ display: flex; gap: 8px; align-items: center; }}
        .control-btn {{
            padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border);
            background: transparent; color: var(--text-secondary); font-size: 12px;
            cursor: pointer; transition: all 0.2s;
        }}
        .control-btn:hover {{ background: var(--bg-tertiary); color: var(--text-primary); }}
        .control-btn.active {{ background: var(--accent); border-color: var(--accent); color: white; }}
        .control-divider {{ width: 1px; height: 20px; background: var(--border); margin: 0 4px; }}
        .font-controls {{ display: flex; align-items: center; gap: 4px; }}
        .font-controls .control-btn {{ padding: 6px 10px; min-width: 32px; }}
        .main-container {{ display: flex; height: calc(100vh - 56px); margin-top: 56px; }}
        .column {{
            flex: 1; overflow-y: auto; padding: 32px;
            border-right: 1px solid var(--border);
        }}
        .column:last-child {{ border-right: none; }}
        .column.hidden {{ display: none; }}
        .column-header {{
            position: sticky; top: 0; background: inherit;
            padding-bottom: 16px; margin-bottom: 24px;
            border-bottom: 1px solid var(--border); z-index: 10;
        }}
        .column-label {{
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 1px; color: var(--text-secondary);
        }}
        .original-column {{ background: var(--bg-secondary); }}
        .translated-column {{ background: var(--bg-primary); }}
        .slides-column {{ background: var(--bg-tertiary); max-width: 480px; min-width: 380px; }}
        .markdown-content {{ color: var(--text-secondary); line-height: 1.8; font-size: calc(1rem * var(--font-scale)); }}
        .markdown-content h1 {{
            font-size: 2em; font-weight: 700; margin: 24px 0 16px;
            background: var(--heading-gradient);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }}
        .markdown-content h2 {{
            font-size: 1.5em; font-weight: 600; color: #667eea;
            margin: 32px 0 16px; padding-bottom: 8px;
            border-bottom: 1px solid var(--border);
        }}
        .markdown-content h3 {{ font-size: 1.25em; font-weight: 600; color: var(--text-primary); margin: 24px 0 12px; }}
        .markdown-content p {{ margin: 16px 0; }}
        .markdown-content a {{ color: var(--accent); text-decoration: none; }}
        .markdown-content a:hover {{ text-decoration: underline; }}
        .markdown-content strong {{ color: var(--text-primary); font-weight: 600; }}
        .markdown-content ul, .markdown-content ol {{ margin: 16px 0; padding-left: 24px; }}
        .markdown-content li {{ margin: 8px 0; }}
        .markdown-content blockquote {{
            border-left: 3px solid var(--accent); padding-left: 16px;
            margin: 16px 0; color: var(--text-secondary); font-style: italic;
        }}
        .markdown-content code {{
            font-family: 'SF Mono', 'Fira Code', monospace;
            background: var(--code-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;
        }}
        .markdown-content pre {{
            background: var(--code-bg); padding: 16px; border-radius: 8px;
            overflow-x: auto; margin: 16px 0;
        }}
        .markdown-content pre code {{ background: none; padding: 0; }}
        /* 正文图片：站点靠自身 CSS 约束尺寸并提供卡片底色，脱离站点后
           1000x1000 的装饰插画会撑满整栏，透明底 SVG 在深色主题下也会失真。
           统一给高度上限和浅色底，两个主题下都保持原站观感。 */
        .markdown-content img {{
            max-width: 100%; max-height: 360px; width: auto;
            object-fit: contain; display: block;
            background: #FAF9F5; border-radius: 8px; margin: 16px 0;
        }}
        .markdown-content hr {{ border: none; border-top: 1px solid var(--border); margin: 32px 0; }}
        .markdown-content table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
        .markdown-content th, .markdown-content td {{
            border: 1px solid var(--border); padding: 12px; text-align: left;
        }}
        .markdown-content th {{ background: var(--bg-tertiary); color: var(--text-primary); }}

        /* 幻灯片卡片样式 */
        .slide-card {{
            background: var(--bg-secondary);
            border-radius: 12px;
            margin-bottom: 20px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            transition: transform 0.2s, box-shadow 0.2s;
        }}
        .slide-card:hover {{
            transform: translateY(-2px);
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
        }}
        .slide-card .slide-image {{
            width: 100%;
            aspect-ratio: 16/9;
            object-fit: cover;
            display: block;
            border-bottom: 1px solid var(--border);
        }}
        .slide-card .slide-info {{
            padding: 16px;
        }}
        .slide-card .slide-header {{
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }}
        .slide-card .slide-number {{
            font-size: 11px;
            color: var(--accent);
            font-weight: 600;
        }}
        .slide-card .slide-type {{
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            text-transform: uppercase;
        }}
        .slide-card .slide-title {{
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 8px;
            line-height: 1.4;
        }}
        .slide-card .slide-content {{
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.6;
            display: -webkit-box;
            -webkit-line-clamp: 4;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }}
        .slide-card .slide-content.expanded {{
            -webkit-line-clamp: unset;
        }}
        .slide-card .expand-btn {{
            font-size: 11px;
            color: var(--accent);
            cursor: pointer;
            margin-top: 8px;
            display: inline-block;
        }}
        .slide-card .expand-btn:hover {{
            text-decoration: underline;
        }}

        /* 无图片时的占位样式 */
        .slide-card .slide-placeholder {{
            width: 100%;
            aspect-ratio: 16/9;
            background: linear-gradient(145deg, #1e1e2e, #2a2a3e);
            display: flex;
            align-items: center;
            justify-content: center;
            border-bottom: 1px solid var(--border);
        }}
        .slide-card .slide-placeholder .placeholder-icon {{
            font-size: 48px;
            opacity: 0.5;
        }}

        .progress-bar {{ position: fixed; top: 56px; left: 0; right: 0; height: 2px; background: var(--border); z-index: 99; }}
        .progress-bar .progress {{ height: 100%; background: var(--accent); width: 0%; transition: width 0.3s; }}
        @media (max-width: 1200px) {{ .slides-column {{ max-width: 360px; min-width: 300px; }} }}
        @media (max-width: 900px) {{ .slides-column {{ display: none; }} }}
        @media (max-width: 768px) {{ .column {{ padding: 16px; }} .original-column {{ display: none; }} }}
        .column::-webkit-scrollbar {{ width: 8px; }}
        .column::-webkit-scrollbar-track {{ background: transparent; }}
        .column::-webkit-scrollbar-thumb {{ background: var(--border); border-radius: 4px; }}

        /* 图片查看器 */
        .image-viewer {{
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            cursor: zoom-out;
        }}
        .image-viewer.active {{ display: flex; }}
        .image-viewer img {{
            max-width: 90%;
            max-height: 90%;
            object-fit: contain;
            border-radius: 8px;
        }}
        .image-viewer .close-btn {{
            position: absolute;
            top: 20px; right: 20px;
            font-size: 32px;
            color: white;
            cursor: pointer;
            opacity: 0.7;
        }}
        .image-viewer .close-btn:hover {{ opacity: 1; }}
    </style>
</head>
<body>
    <header class="header">
        <div class="header-title">
            <span>📖</span>
            <span id="doc-title">{title_html}</span>
        </div>
        <div class="header-controls">
            <button class="control-btn active" onclick="toggleColumn('original')">原文</button>
            <button class="control-btn active" onclick="toggleColumn('translated')">译文</button>
            <button class="control-btn active" onclick="toggleColumn('slides')">幻灯片</button>
            <div class="control-divider"></div>
            <button class="control-btn" id="theme-btn" onclick="toggleTheme()" title="切换黑白模式">🌙</button>
            <div class="font-controls">
                <button class="control-btn" onclick="adjustFontSize(-0.1)" title="缩小字体">A-</button>
                <button class="control-btn" onclick="resetFontSize()" title="重置字体">A</button>
                <button class="control-btn" onclick="adjustFontSize(0.1)" title="放大字体">A+</button>
            </div>
        </div>
    </header>
    <div class="progress-bar"><div class="progress" id="progress"></div></div>
    <main class="main-container">
        <div class="column original-column" id="original-column">
            <div class="column-header"><span class="column-label">📝 Original</span></div>
            <div class="markdown-content" id="original-content"></div>
        </div>
        <div class="column translated-column" id="translated-column">
            <div class="column-header"><span class="column-label">🇨🇳 中文翻译</span></div>
            <div class="markdown-content" id="translated-content"></div>
        </div>
        <div class="column slides-column" id="slides-column">
            <div class="column-header"><span class="column-label">🎨 AI 幻灯片</span></div>
            <div id="slides-content"></div>
        </div>
    </main>

    <!-- 图片查看器 -->
    <div class="image-viewer" id="image-viewer" onclick="closeViewer()">
        <span class="close-btn">&times;</span>
        <img id="viewer-image" src="" alt="幻灯片大图">
    </div>

    <script id="original-md" type="text/markdown">
{original_md_escaped}
    </script>

    <script id="translated-md" type="text/markdown">
{translated_md_escaped}
    </script>

    <script id="slides-data" type="application/json">
{slides_json}
    </script>

    <script id="slide-images-data" type="application/json">
{slide_images_json}
    </script>

    <script>
        document.addEventListener('DOMContentLoaded', () => {{
            // 渲染原文
            const originalMd = document.getElementById('original-md').textContent;
            document.getElementById('original-content').innerHTML = marked.parse(originalMd);

            // 渲染译文
            const translatedMd = document.getElementById('translated-md').textContent;
            document.getElementById('translated-content').innerHTML = marked.parse(translatedMd);

            // 渲染幻灯片
            try {{
                const slidesData = JSON.parse(document.getElementById('slides-data').textContent);
                const slideImages = JSON.parse(document.getElementById('slide-images-data').textContent);

                if (slidesData.slides && slidesData.slides.length > 0) {{
                    const slidesHtml = slidesData.slides.map(slide => {{
                        const imageData = slideImages[slide.index];
                        const imageHtml = imageData
                            ? `<img class="slide-image" src="${{imageData}}" alt="${{slide.title}}" onclick="openViewer(this.src, event)">`
                            : `<div class="slide-placeholder"><span class="placeholder-icon">${{slide.icon || '🎨'}}</span></div>`;

                        // 当前元数据合同使用 description；兼容旧产物中的 content
                        const content = slide.description || slide.content || '';
                        const contentPreview = content.length > 150
                            ? content.substring(0, 150) + '...'
                            : content;
                        const hasMore = content.length > 150;

                        return `
                            <div class="slide-card">
                                ${{imageHtml}}
                                <div class="slide-info">
                                    <div class="slide-header">
                                        <span class="slide-number">#${{slide.index}}</span>
                                        <span class="slide-type">${{slide.type || 'feature'}}</span>
                                    </div>
                                    <h4 class="slide-title">${{slide.title}}</h4>
                                    <p class="slide-content" id="content-${{slide.index}}">${{contentPreview}}</p>
                                    ${{hasMore ? `<span class="expand-btn" onclick="toggleContent(${{slide.index}}, '${{escape(content)}}')">展开全文</span>` : ''}}
                                </div>
                            </div>
                        `;
                    }}).join('');
                    document.getElementById('slides-content').innerHTML = slidesHtml;
                }}
            }} catch (e) {{
                console.error('幻灯片数据解析失败:', e);
            }}

            // 滚动进度条
            const translatedColumn = document.getElementById('translated-column');
            translatedColumn.addEventListener('scroll', () => {{
                const scrollPct = translatedColumn.scrollTop / (translatedColumn.scrollHeight - translatedColumn.clientHeight);
                document.getElementById('progress').style.width = `${{scrollPct * 100}}%`;
            }});
        }});

        // 转义函数
        function escape(str) {{
            return str.replace(/'/g, "\\\\'").replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n');
        }}

        function toggleColumn(name) {{
            const column = document.getElementById(name + '-column');
            const btn = event.target;
            column.classList.toggle('hidden');
            btn.classList.toggle('active');
        }}

        // 黑白模式切换
        function toggleTheme() {{
            const body = document.body;
            const btn = document.getElementById('theme-btn');
            body.classList.toggle('light-mode');
            const isLight = body.classList.contains('light-mode');
            btn.textContent = isLight ? '🌞' : '🌙';
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
        }}

        // 字体缩放
        let currentScale = parseFloat(localStorage.getItem('fontScale')) || 1;
        document.documentElement.style.setProperty('--font-scale', currentScale);

        function adjustFontSize(delta) {{
            currentScale = Math.max(0.7, Math.min(1.5, currentScale + delta));
            document.documentElement.style.setProperty('--font-scale', currentScale);
            localStorage.setItem('fontScale', currentScale);
        }}

        function resetFontSize() {{
            currentScale = 1;
            document.documentElement.style.setProperty('--font-scale', 1);
            localStorage.setItem('fontScale', 1);
        }}

        // 初始化主题
        (function initTheme() {{
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'light') {{
                document.body.classList.add('light-mode');
                document.getElementById('theme-btn').textContent = '🌞';
            }}
        }})()

        function openViewer(src, event) {{
            event.stopPropagation();
            document.getElementById('viewer-image').src = src;
            document.getElementById('image-viewer').classList.add('active');
        }}

        function closeViewer() {{
            document.getElementById('image-viewer').classList.remove('active');
        }}

        // 展开/收起内容
        const expandedStates = {{}};
        function toggleContent(index, fullContent) {{
            const el = document.getElementById('content-' + index);
            const btn = el.nextElementSibling;
            if (expandedStates[index]) {{
                el.textContent = fullContent.substring(0, 150) + '...';
                btn.textContent = '展开全文';
                expandedStates[index] = false;
            }} else {{
                el.textContent = fullContent;
                btn.textContent = '收起';
                expandedStates[index] = true;
            }}
        }}

        // ESC 关闭查看器
        document.addEventListener('keydown', (e) => {{
            if (e.key === 'Escape') closeViewer();
        }});
    </script>
</body>
</html>'''

    # 写入文件
    with open('preview.html', 'w', encoding='utf-8') as f:
        f.write(html_template)

    print(f"✅ 构建完成: preview.html")
    print(f"📄 标题: {title}")
    print(f"🎨 幻灯片图片: {len(slide_images)} 张" + (" (已内嵌)" if has_images else " (未找到)"))
    print(f"💡 用浏览器打开 preview.html 即可预览")

if __name__ == '__main__':
    # 切换到脚本所在目录（支持从任意位置运行）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    # fail-fast：原文/译文缺失时预览无意义，拒绝产出废品（slides 元数据可选，--no-ppt 模式合法缺失）
    missing = [f for f in ('original.md', 'translated.md', 'marked.min.js') if not os.path.exists(f)]
    if missing:
        print(f"❌ 缺少必需文件: {', '.join(missing)}（当前目录: {os.getcwd()}）", file=sys.stderr)
        print("   请将 original.md、translated.md 与 scripts/ 下的 marked.min.js 放到脚本同目录后再运行", file=sys.stderr)
        sys.exit(1)

    build_html()
