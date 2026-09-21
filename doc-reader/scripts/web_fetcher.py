#!/usr/bin/env python3
"""
web_fetcher.py - 高质量网页/PDF 转 Markdown 工具

特点：
1. 使用 html-to-markdown (Rust 内核) 进行高性能转换
2. BeautifulSoup 预处理，处理表格中的 ul/li 结构
3. 保留 <br> 标签在表格单元格中
4. 完整保留文章结构、图片、链接
5. 支持本地 PDF 文件解析

使用方式：
    # 网页
    python3 web_fetcher.py <URL>
    python3 web_fetcher.py <URL> --output article.md

    # 本地 PDF
    python3 web_fetcher.py <PDF_PATH>
    python3 web_fetcher.py /path/to/file.pdf --output article.md

依赖安装：
    pip install html-to-markdown beautifulsoup4 pymupdf
"""

import sys
import re
import argparse
import urllib.request
import ssl
from typing import Optional, Tuple
from pathlib import Path
import os

try:
    import html_to_markdown
    from html_to_markdown import ConversionOptions
except ImportError:
    print("错误：请先安装 html-to-markdown 库")
    print("运行：pip install html-to-markdown")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("错误：请先安装 beautifulsoup4 库")
    print("运行：pip install beautifulsoup4")
    sys.exit(1)

try:
    import fitz  # PyMuPDF
except ImportError:
    print("警告：未安装 PyMuPDF，PDF 功能不可用")
    print("要启用 PDF 支持，请运行：pip install pymupdf")
    fitz = None


def fetch_html(url: str, timeout: int = 30, insecure: bool = False) -> str:
    """获取网页 HTML 内容

    Args:
        url: 网页 URL
        timeout: 超时时间（秒）
        insecure: 为 True 时跳过 SSL 证书校验（仅在目标站点证书异常时显式开启）

    Returns:
        HTML 内容字符串
    """
    context = ssl._create_unverified_context() if insecure else None

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=context) as response:
        return response.read().decode('utf-8')


def preprocess_html(html: str) -> str:
    """预处理 HTML，优化表格结构

    主要处理：
    1. 将表格单元格内的 <ul><li> 列表转换为 • item<br> 格式
    2. 清理不必要的空白

    Args:
        html: 原始 HTML

    Returns:
        预处理后的 HTML
    """
    soup = BeautifulSoup(html, 'html.parser')

    # 处理表格单元格中的 ul 元素
    for td in soup.find_all(['td', 'th']):
        for ul in td.find_all('ul'):
            items = []
            for li in ul.find_all('li'):
                text = li.get_text(strip=True)
                if text:
                    items.append(f'• {text}')

            if items:
                # 用 <br> 连接列表项
                new_content = '<br>'.join(items)
                ul.replace_with(BeautifulSoup(new_content, 'html.parser'))

    return str(soup)


def html_to_md(html: str) -> str:
    """将 HTML 转换为 Markdown

    使用优化的配置选项：
    - preserve_tags={'br'}: 保留 br 标签（特别是表格中）
    - heading_style='atx': 使用 # 风格标题
    - code_block_style='backticks': 使用 ``` 代码块

    Args:
        html: HTML 内容

    Returns:
        Markdown 内容
    """
    opts = ConversionOptions(
        preserve_tags=['br'],      # 保留 br 标签（html-to-markdown 3.x 要求 Sequence，set 会 TypeError）
        heading_style='atx',       # 使用 # 风格标题
        code_block_style='backticks',  # 使用 ``` 代码块
        autolinks=True,            # 自动识别链接
    )

    result = html_to_markdown.convert(html, options=opts)
    # html-to-markdown 3.x 返回 ConversionResult，markdown 正文在 .content
    return result.content if hasattr(result, "content") else str(result)


def extract_title(html: str) -> str:
    """提取页面标题

    尝试按优先级提取标题:
    1. <title> 标签
    2. <h1> 标签
    3. og:title meta 标签

    Args:
        html: 完整 HTML

    Returns:
        页面标题,如果找不到返回 "Untitled"
    """
    soup = BeautifulSoup(html, 'html.parser')

    # 优先从 title 标签提取
    title_tag = soup.find('title')
    if title_tag and title_tag.string:
        return title_tag.string.strip()

    # 尝试从第一个 h1 标签提取
    h1_tag = soup.find('h1')
    if h1_tag:
        return h1_tag.get_text(strip=True)

    # 尝试从 og:title meta 标签提取
    og_title = soup.find('meta', property='og:title')
    if og_title and og_title.get('content'):
        return og_title['content'].strip()

    return "Untitled"


def extract_main_content(html: str) -> str:
    """提取页面主要内容区域

    尝试找到文章主体，排除导航、侧边栏等

    Args:
        html: 完整 HTML

    Returns:
        主要内容区域的 HTML
    """
    soup = BeautifulSoup(html, 'html.parser')

    # 移除明显的非内容区域
    for tag in soup.find_all(['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript']):
        tag.decompose()

    # 尝试找到主要内容区域
    main_selectors = [
        'article',
        '[role="main"]',
        'main',
        '.post-content',
        '.article-content',
        '.entry-content',
        '#content',
        '.content',
    ]

    for selector in main_selectors:
        if selector.startswith('['):
            # 属性选择器
            attr_match = re.match(r'\[(\w+)="([^"]+)"\]', selector)
            if attr_match:
                main = soup.find(attrs={attr_match.group(1): attr_match.group(2)})
        elif selector.startswith('.'):
            main = soup.find(class_=selector[1:])
        elif selector.startswith('#'):
            main = soup.find(id=selector[1:])
        else:
            main = soup.find(selector)

        if main:
            return str(main)

    # 如果找不到特定区域，返回 body
    body = soup.find('body')
    return str(body) if body else str(soup)


def clean_markdown(md: str) -> str:
    """清理 Markdown 输出

    - 移除多余空行
    - 修复图片路径
    - 清理 YAML frontmatter
    - 过滤 base64 编码的 SVG 图片

    Args:
        md: 原始 Markdown

    Returns:
        清理后的 Markdown
    """
    # 移除 YAML frontmatter（如果存在）
    md = re.sub(r'^---\n.*?\n---\n', '', md, flags=re.DOTALL)

    # 修复 Next.js 图片路径
    md = re.sub(
        r'!\[(.*?)\]\(/_next/image\?url=([^&]+).*?\)',
        lambda m: f'![{m.group(1)}]({urllib.request.unquote(m.group(2))})',
        md
    )

    # 过滤掉 base64 编码的 SVG 图片（通常是装饰性图标）
    # 匹配格式: ![alt text](data:image/svg+xml;base64,...)
    md = re.sub(r'!\[.*?\]\(data:image/svg\+xml;base64,[^\)]+\)', '', md)

    # 清理标题中的 SVG Image 文字残留（通常是装饰性图标的 alt 文本）
    # 匹配格式: ## [​ SVG Image](#anchor)Title
    md = re.sub(r'\[​ SVG Image\]', '', md)

    # 清理可能留下的多余换行
    md = re.sub(r'\n\n\n+', '\n\n', md)

    # 移除连续的空行（保留最多2个）
    md = re.sub(r'\n{4,}', '\n\n\n', md)

    # 移除开头的空行
    md = md.lstrip('\n')

    return md


def is_url(input_str: str) -> bool:
    """判断输入是否为 URL

    Args:
        input_str: 输入字符串

    Returns:
        如果是 URL 返回 True，否则返回 False
    """
    return input_str.startswith(('http://', 'https://'))


def is_pdf_file(input_str: str) -> bool:
    """判断输入是否为 PDF 文件路径

    Args:
        input_str: 输入字符串

    Returns:
        如果是 PDF 文件返回 True，否则返回 False
    """
    if not os.path.exists(input_str):
        return False
    return input_str.lower().endswith('.pdf')


def extract_pdf_metadata(pdf_doc) -> Tuple[str, str]:
    """提取 PDF 元数据

    Args:
        pdf_doc: PyMuPDF Document 对象

    Returns:
        (标题, 作者) 元组
    """
    metadata = pdf_doc.metadata

    # 提取标题
    title = metadata.get('title', '')
    if not title:
        # 如果没有元数据标题，使用文件名
        title = os.path.basename(pdf_doc.name).replace('.pdf', '')

    # 提取作者
    author = metadata.get('author', '')

    return title.strip(), author.strip()


def pdf_to_markdown(pdf_path: str) -> str:
    """将 PDF 文件转换为 Markdown

    完整流程:
    1. 检查 PyMuPDF 是否可用
    2. 打开 PDF 文件
    3. 提取元数据（标题、作者）
    4. 逐页提取文本内容
    5. 格式化为 Markdown

    Args:
        pdf_path: PDF 文件路径

    Returns:
        Markdown 内容
    """
    if fitz is None:
        raise ImportError(
            "PDF 功能需要 PyMuPDF 库。\n"
            "请安装：pip install pymupdf"
        )

    print(f"正在读取 PDF: {pdf_path}")

    # 打开 PDF
    pdf_doc = fitz.open(pdf_path)
    print(f"PDF 页数: {len(pdf_doc)}")

    # 提取元数据
    print("提取元数据...")
    title, author = extract_pdf_metadata(pdf_doc)
    print(f"标题: {title}")
    if author:
        print(f"作者: {author}")

    # 提取文本内容
    print("提取文本内容...")
    pages_text = []
    for page_num in range(len(pdf_doc)):
        page = pdf_doc[page_num]
        text = page.get_text()
        if text.strip():  # 只保留非空页
            pages_text.append(text)

    # 合并所有页面文本
    full_text = '\n\n'.join(pages_text)

    print(f"提取字符数: {len(full_text):,}")

    # 关闭 PDF
    pdf_doc.close()

    # 基本清理
    # 移除过多的换行（PDF 提取常见问题）
    full_text = re.sub(r'\n{3,}', '\n\n', full_text)

    # 构建 Markdown 头部
    header_parts = [f"# {title}\n"]
    if author:
        header_parts.append(f"**作者**: {author}\n")
    header_parts.append(f"**来源**: PDF 文档 (`{os.path.basename(pdf_path)}`)\n")
    header_parts.append("\n---\n\n")

    header = ''.join(header_parts)

    # 组合最终 Markdown
    md = header + full_text

    print(f"Markdown 大小: {len(md):,} 字符")

    return md


def fetch_and_convert(url: str, extract_main: bool = True, insecure: bool = False) -> str:
    """获取网页并转换为 Markdown

    完整流程：
    1. 获取 HTML
    2. 提取标题
    3. 可选：提取主要内容
    4. 预处理 HTML（处理表格等）
    5. 转换为 Markdown
    6. 在开头添加标题链接
    7. 清理输出

    Args:
        url: 网页 URL
        extract_main: 是否只提取主要内容区域
        insecure: 是否跳过 SSL 证书校验

    Returns:
        Markdown 内容
    """
    print(f"正在获取: {url}")
    html = fetch_html(url, insecure=insecure)
    print(f"HTML 大小: {len(html):,} 字符")

    # 提取标题
    print("提取页面标题...")
    title = extract_title(html)
    print(f"标题: {title}")

    if extract_main:
        print("提取主要内容区域...")
        html = extract_main_content(html)
        print(f"内容区域大小: {len(html):,} 字符")

    print("预处理 HTML...")
    html = preprocess_html(html)

    print("转换为 Markdown...")
    md = html_to_md(html)

    print("清理输出...")
    md = clean_markdown(md)

    # 在 Markdown 开头添加标题和原文链接
    header = f"# [{title}]({url})\n\n---\n\n"
    md = header + md

    print(f"Markdown 大小: {len(md):,} 字符")

    return md


def main():
    parser = argparse.ArgumentParser(
        description='高质量网页/PDF 转 Markdown 工具',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    # 网页
    python3 web_fetcher.py https://example.com/article
    python3 web_fetcher.py https://example.com/article -o article.md
    python3 web_fetcher.py https://example.com/article --full

    # 本地 PDF
    python3 web_fetcher.py /path/to/document.pdf
    python3 web_fetcher.py document.pdf -o article.md
        """
    )
    parser.add_argument('input', help='网页 URL 或 PDF 文件路径')
    parser.add_argument('-o', '--output', help='输出文件路径')
    parser.add_argument('--full', action='store_true',
                        help='[仅网页] 保留完整页面（不提取主要内容）')
    parser.add_argument('--insecure', action='store_true',
                        help='[仅网页] 跳过 SSL 证书校验（目标站点证书异常时使用）')

    args = parser.parse_args()

    try:
        # 自动检测输入类型
        if is_pdf_file(args.input):
            # PDF 文件
            print("📄 检测到 PDF 文件")
            md = pdf_to_markdown(args.input)

        elif is_url(args.input):
            # 网页 URL
            print("🌐 检测到网页 URL")
            md = fetch_and_convert(args.input, extract_main=not args.full, insecure=args.insecure)

        else:
            print(f"❌ 错误: 无法识别输入类型", file=sys.stderr)
            print(f"输入: {args.input}", file=sys.stderr)
            print(f"不是有效的 URL，也不是存在的 PDF 文件", file=sys.stderr)
            return 1

        if args.output:
            output_path = Path(args.output)
            output_path.write_text(md, encoding='utf-8')
            print(f"\n✅ 已保存到: {output_path}")
        else:
            print("\n" + "="*60)
            print(md)

        return 0

    except Exception as e:
        print(f"\n❌ 错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
