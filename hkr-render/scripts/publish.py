#!/usr/bin/env python3
"""微信公众号草稿箱发布工具

将 format.py 排版后的文章推送到微信公众号草稿箱。

用法:
    # 发布排版好的文章目录
    python3 publish.py --dir /path/to/formatted/article/

    # 指定封面图
    python3 publish.py --dir /path/to/formatted/article/ --cover cover.jpg

    # 直接从 Markdown 一步到位（自动排版+发布）
    python3 publish.py --input article.md --theme elegant
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import html as html_module
import tempfile

import requests

# ── 路径 ──────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent

with open(SKILL_DIR / "config.json", encoding="utf-8") as f:
    CONFIG = json.load(f)


def build_wechat_session(config):
    """Use the configured API route without environment-proxy fallback.

    trust_env=False alone does not bypass OS-level TUN routing. A local proxy
    listener pinned to DIRECT can enforce a consistent direct path.
    """
    session = requests.Session()
    session.trust_env = False
    api_proxy = config.get("wechat", {}).get("api_proxy")
    if api_proxy:
        session.proxies = {"http": api_proxy, "https": api_proxy}
    return session


_session = build_wechat_session(CONFIG)


# ── 微信 API ─────────────────────────────────────────────────────────
def get_access_token():
    """获取微信 API access_token"""
    wechat = CONFIG.get("wechat", {})
    app_id = wechat.get("app_id")
    app_secret = wechat.get("app_secret")

    if not app_id or not app_secret:
        print("错误: config.json 中未配置 wechat.app_id 或 wechat.app_secret")
        sys.exit(1)

    url = (
        "https://api.weixin.qq.com/cgi-bin/token"
        f"?grant_type=client_credential&appid={app_id}&secret={app_secret}"
    )
    try:
        resp = _session.get(url, timeout=15)
    except requests.RequestException as exc:
        # Never print exception URLs: token requests include AppSecret.
        print(f"错误: 微信 API 连接失败 ({type(exc).__name__})。"
              "请检查配置的 api_proxy 入口及网络；不会自动切换出口。")
        sys.exit(1)
    data = resp.json()

    if "access_token" in data:
        print(f"  token 有效期: {data.get('expires_in', '?')} 秒")
        return data["access_token"]
    else:
        errcode = data.get("errcode", "?")
        errmsg = data.get("errmsg", "未知错误")
        print(f"错误: 获取 access_token 失败 (errcode={errcode}: {errmsg})")
        if errcode == 40164:
            match = re.search(r"invalid ip\s+([0-9a-fA-F:.]+)", errmsg)
            if match:
                print(f"  → 微信实际识别的出口 IP: {match.group(1)}")
            print("  → 请检查该公众号的 IP 白名单，以微信返回的 IP 为准；"
                  "其他网站查询到的出口可能不同。")
        elif errcode in (40001, 40125):
            print("  → AppSecret 无效，请检查 config.json 中的 app_secret")
        sys.exit(1)


def upload_thumb_image(token, image_path, max_retries=3):
    """上传封面图到永久素材库，返回 media_id（失败自动重试，与正文图片对齐）"""
    import time
    url = (
        "https://api.weixin.qq.com/cgi-bin/material/add_material"
        f"?access_token={token}&type=image"
    )

    filename = os.path.basename(image_path)
    ext = Path(image_path).suffix.lower()
    content_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
    }.get(ext, "image/jpeg")

    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            with open(image_path, "rb") as f:
                files = {"media": (filename, f, content_type)}
                resp = _session.post(url, files=files, timeout=30)
            data = resp.json()
            if "media_id" in data:
                return data["media_id"]
            last_err = data
        except requests.RequestException as e:
            last_err = str(e)
        if attempt < max_retries:
            time.sleep(2 * attempt)
    print(f"错误: 上传封面图失败 - {last_err}")
    return None


def upload_content_image(token, image_path, max_retries=3):
    """上传正文图片（返回 CDN URL），失败自动重试"""
    import time
    url = f"https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token={token}"

    filename = os.path.basename(image_path)
    ext = Path(image_path).suffix.lower()
    content_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
    }.get(ext, "image/jpeg")

    for attempt in range(1, max_retries + 1):
        try:
            with open(image_path, "rb") as f:
                files = {"media": (filename, f, content_type)}
                resp = _session.post(url, files=files, timeout=30)

            data = resp.json()
            if "url" in data:
                return data["url"]
            else:
                print(f"  ✗ 上传失败 ({attempt}/{max_retries}) - {filename}: {data}")
        except Exception as e:
            print(f"  ✗ 上传异常 ({attempt}/{max_retries}) - {filename}: {e}")

        if attempt < max_retries:
            time.sleep(2 * attempt)  # 递增等待

    print(f"  ✗ 上传彻底失败 - {filename}")
    return None


def download_external_image(url):
    """下载外部图片到临时文件，返回本地路径"""
    try:
        # 还原 HTML 实体（&amp; → &）
        url = html_module.unescape(url)
        resp = requests.get(url, timeout=30, headers={
            "User-Agent": "Mozilla/5.0"
        })
        resp.raise_for_status()

        # 从 URL 或 Content-Type 推断扩展名
        content_type = resp.headers.get("Content-Type", "")
        if "png" in content_type:
            ext = ".png"
        elif "gif" in content_type:
            ext = ".gif"
        elif "webp" in content_type:
            ext = ".webp"
        else:
            ext = ".jpg"

        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp.write(resp.content)
        tmp.close()
        return tmp.name
    except Exception as e:
        print(f"  ✗ 下载失败: {url[:60]}... ({e})")
        return None


def replace_all_images(html, article_dir, token):
    """替换 HTML 中的所有图片（本地+外部）为微信 CDN URL"""
    image_dir = article_dir / "images"
    replaced = 0
    failed = 0

    def replace_src(match):
        nonlocal replaced, failed
        src = match.group(1)

        # 已经是微信 CDN 的图片，跳过
        if "mmbiz.qpic.cn" in src:
            return match.group(0)

        # 外部 URL：先下载再上传
        if src.startswith("http://") or src.startswith("https://"):
            local_path = download_external_image(src)
            if local_path:
                cdn_url = upload_content_image(token, local_path)
                os.unlink(local_path)  # 清理临时文件
                if cdn_url:
                    replaced += 1
                    print(f"  ✓ 外部图片: {src[:60]}...")
                    return f'src="{cdn_url}"'
            failed += 1
            return match.group(0)

        # 本地图片
        local_path = article_dir / src
        if not local_path.exists() and image_dir.exists():
            local_path = image_dir / os.path.basename(src)

        if local_path.exists():
            cdn_url = upload_content_image(token, str(local_path))
            if cdn_url:
                replaced += 1
                print(f"  ✓ {os.path.basename(src)}")
                return f'src="{cdn_url}"'
            else:
                failed += 1
                return match.group(0)
        else:
            print(f"  ✗ 未找到: {src}")
            failed += 1
            return match.group(0)

    html = re.sub(r'src="([^"]+)"', replace_src, html)
    return html, replaced, failed


def push_draft(token, articles):
    """推送草稿箱。articles 为文章 dict 列表（一条草稿最多 8 篇 = 多图文）"""
    url = f"https://api.weixin.qq.com/cgi-bin/draft/add?access_token={token}"

    data = {
        "articles": [
            {
                "title": a["title"],
                "author": a.get("author", ""),
                "digest": a.get("digest", ""),
                "content": a["content"],
                "content_source_url": "",
                "thumb_media_id": a["thumb_media_id"],
                "need_open_comment": 0,
                "only_fans_can_comment": 0,
            }
            for a in articles
        ]
    }

    # 必须用 ensure_ascii=False，否则中文被转义为 \uXXXX 导致微信计算标题长度错误
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    resp = _session.post(url, data=body,
                         headers={"Content-Type": "application/json"}, timeout=30)
    result = resp.json()

    if "media_id" in result:
        return result["media_id"]
    else:
        errcode = result.get("errcode", "?")
        errmsg = result.get("errmsg", "未知错误")
        print(f"错误: 推送草稿箱失败 (errcode={errcode}: {errmsg})")
        return None


# ── 辅助函数 ──────────────────────────────────────────────────────────
def extract_title_from_html(html):
    """从 HTML 中提取标题：优先读 format.py 写入的 TITLE 注释，回退 h1（旧版产物）"""
    match = re.search(r"<!--TITLE:(.*?)-->", html, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.DOTALL)
    if match:
        return re.sub(r"<[^>]+>", "", match.group(1)).strip()
    return None


def extract_digest_from_html(html, limit=100):
    """自动摘要：取正文第一个有实质内容的段落纯文本（微信 digest 上限 120 字）"""
    for m in re.finditer(r"<p[^>]*>(.*?)</p>", html, re.DOTALL):
        text = re.sub(r"<[^>]+>", "", m.group(1))
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 20:
            return text[:limit]
    return ""


def cover_bottom_luminance(image_path):
    """封面下部 40% 的平均亮度（0-255）。微信会在封面下沿叠白色标题，过亮会导致标题隐形。"""
    try:
        from PIL import Image
    except ImportError:
        return None
    img = Image.open(image_path).convert("L")
    w, h = img.size
    bottom = img.crop((0, int(h * 0.6), w, h))
    hist = bottom.histogram()
    total = sum(hist)
    if not total:
        return None
    return sum(i * c for i, c in enumerate(hist)) / total


def darken_cover_bottom(image_path):
    """给封面加从中部向底部渐深的黑色遮罩，保证白字标题可读。输出 <stem>-darkened.jpg，返回新路径。"""
    from PIL import Image
    src = Path(image_path)
    img = Image.open(src).convert("RGB")
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    start = h // 2
    for y in range(start, h):
        alpha = int(150 * (y - start) / max(1, h - start))
        mask.paste(alpha, (0, y, w, y + 1))
    black = Image.new("RGB", (w, h), (0, 0, 0))
    out = Image.composite(black, img, mask)
    dst = src.with_name(f"{src.stem}-darkened.jpg")
    out.save(dst, quality=92)
    return dst


def find_cover_image(article_dir, cover_arg=None, original_dir=None):
    """找到封面图路径

    优先在 article_dir/images/ 找，其次在 original_dir/images/（--input 模式）找。
    """
    if cover_arg:
        p = Path(cover_arg)
        if p.exists():
            return p
        # 尝试在 article_dir 下找
        p = article_dir / cover_arg
        if p.exists():
            return p
        print(f"警告: 指定的封面图不存在: {cover_arg}")

    # 在 images/ 目录下找封面图：*-cover.png
    candidates = [article_dir / "images"]
    if original_dir is not None:
        candidates.append(original_dir / "images")
    for img_dir in candidates:
        if img_dir and img_dir.exists():
            covers = sorted(img_dir.glob("*-cover.png"))
            if covers:
                return covers[0]

    return None


def prepare_article(article_dir, original_dir, cover_arg, token, *, author="",
                    title_override=None, digest_override=None,
                    darken_cover=False, assume_yes=False):
    """处理单篇文章：读 HTML → 标题/摘要 → 上传正文图片 → 封面。返回草稿 article dict。

    任何不可恢复错误直接退出进程（发布是全有或全无，半条多图文没有意义）。
    """
    article_path = article_dir / "article.html"
    if not article_path.exists():
        # 兼容旧版：从 preview.html 提取
        preview_path = article_dir / "preview.html"
        if preview_path.exists():
            print("未找到 article.html，从 preview.html 提取...")
            match = re.search(
                r'<div id="wechatHtml">(.*?)</div>\s*<script>',
                preview_path.read_text(encoding="utf-8"), re.DOTALL
            )
            if not match:
                print("错误: 无法从 preview.html 提取文章内容")
                sys.exit(1)
            html = match.group(1).strip()
        else:
            print(f"错误: 未找到 article.html 或 preview.html - {article_dir}")
            sys.exit(1)
    else:
        html = article_path.read_text(encoding="utf-8")

    title = title_override or extract_title_from_html(html) or article_dir.name
    digest = digest_override or extract_digest_from_html(html)
    print(f"标题: {title}")
    if digest:
        print(f"摘要: {digest[:50]}{'...' if len(digest) > 50 else ''}")

    # original_dir 兜底：从 HTML 的绝对路径图片反推封面目录
    if original_dir is None and not cover_arg:
        for src_match in re.findall(r'src="(?!https?://)([^"]+)"', html):
            p = Path(src_match)
            if p.is_absolute():
                for candidate in (p.parent.parent / "images", p.parent):
                    if sorted(candidate.glob("*-cover.png")):
                        original_dir = candidate
                        print(f"  从 HTML 图片路径推导出封面图目录: {original_dir}")
                        break
            if original_dir:
                break

    # 上传正文图片（按 HTML 实际引用计数，不按目录文件数）
    local_count = len(re.findall(r'src="(?!https?://)[^"]+"', html))
    external_count = len(re.findall(r'src="https?://[^"]+"', html))
    external_count -= len(re.findall(r'src="https?://mmbiz\.qpic\.cn[^"]*"', html))

    if local_count + external_count > 0:
        print(f"上传正文图片 ({local_count} 本地 + {external_count} 外部)...")
        html, replaced, failed = replace_all_images(html, article_dir, token)
        print(f"  上传完成: {replaced} 成功, {failed} 失败")
        if failed > 0 and replaced == 0:
            print("  错误: 所有图片上传失败，中止发布（不推空图草稿）")
            sys.exit(1)
        elif failed > 0:
            print("  警告: 部分图片上传失败，文章中对应位置可能显示空白")
            if assume_yes:
                print("  --yes 已指定，继续发布")
            elif not sys.stdin.isatty():
                print("  非交互环境默认中止（加 --yes 可放行）")
                sys.exit(1)
            else:
                resp = input("  继续发布？(y/N) ").strip().lower()
                if resp != "y":
                    print("  已中止")
                    sys.exit(0)
    else:
        print("无正文图片需上传")

    # 封面
    cover_path = find_cover_image(article_dir, cover_arg, original_dir)
    if not cover_path:
        print("错误: 微信要求每篇文章必须有封面图。")
        print("  请用 --cover 指定封面图路径，或在 images/ 目录放一张 *-cover.png")
        sys.exit(1)

    if darken_cover:
        cover_path = darken_cover_bottom(cover_path)
        print(f"封面已加底部渐暗遮罩: {cover_path.name}")
    else:
        lum = cover_bottom_luminance(cover_path)
        if lum is not None and lum > 175:
            print(f"⚠ 封面下部平均亮度 {lum:.0f}/255，偏亮。"
                  f"微信分享卡片会在封面下沿叠加白色标题，浅底会让标题隐形。"
                  f"建议加 --darken-cover 重新推送，或换深色封面。")

    print(f"上传封面图: {cover_path.name}")
    thumb_media_id = upload_thumb_image(token, str(cover_path))
    if not thumb_media_id:
        print("错误: 封面上传失败")
        sys.exit(1)
    print(f"  ✓ media_id: {thumb_media_id[:20]}...")

    return {
        "title": title,
        "author": author,
        "digest": digest,
        "content": html,
        "thumb_media_id": thumb_media_id,
    }


# ── 主流程 ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="微信公众号草稿箱发布工具")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dir", "-d", help="format.py 的输出目录（含 article.html 和 images/，单篇）")
    group.add_argument("--input", "-i", nargs="+",
                       help="Markdown 文件路径，可传多个（多个文件 = 一条多图文草稿，微信上限 8 篇）")
    parser.add_argument("--cover", "-c", nargs="+",
                        help="封面图片路径，与 --input 一一对应（省略则按 *-cover.png 自动搜索）")
    parser.add_argument("--title", "-t", help="文章标题（默认从 HTML 提取；多图文时仅作用于第一篇）")
    parser.add_argument("--digest", help="文章摘要（默认自动取首段前 100 字；多图文时仅作用于第一篇）")
    parser.add_argument("--theme", default=None,
                        help="排版主题（仅 --input 模式有效，默认读取 gallery 选中的主题）")
    parser.add_argument("--author", "-a",
                        default=CONFIG.get("wechat", {}).get("author", ""),
                        help="作者名")
    parser.add_argument("--darken-cover", action="store_true",
                        help="封面下部自动加渐深黑色遮罩（微信分享卡片会在封面下沿叠白色标题，浅底封面必开）")
    parser.add_argument("--yes", "-y", action="store_true",
                        help="跳过交互确认（非交互环境下部分图片失败时默认中止，需此参数放行）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只做排版和图片上传，不推送草稿箱（用于测试）")
    parser.add_argument("--source-dir",
                        help="源文件目录（用于 --dir 模式下查找封面图和源 markdown 路径）")
    args = parser.parse_args()

    # ── 1. 组装文章任务列表 ──────────────────────────────────────────
    inputs = [Path(p).resolve() for p in (args.input or [])]
    covers = list(args.cover or [])
    if covers and inputs and len(covers) != len(inputs):
        print(f"错误: --cover 数量({len(covers)})须与 --input 数量({len(inputs)})一一对应")
        sys.exit(1)
    if len(inputs) > 8:
        print("错误: 微信多图文一条草稿最多 8 篇")
        sys.exit(1)
    if len(inputs) > 1 and (args.title or args.digest):
        print("提示: 多图文模式下 --title/--digest 仅作用于第一篇")

    tasks = []  # (article_dir, original_dir, cover_arg)
    if inputs:
        # 确定主题：优先命令行指定 > gallery 选中 > 默认
        theme = args.theme
        if not theme:
            gallery_theme_file = Path("/tmp/wechat-format/selected-theme.txt")
            if gallery_theme_file.exists():
                saved = gallery_theme_file.read_text(encoding="utf-8").strip()
                if saved:
                    theme = saved
                    print(f"  使用 gallery 选中的主题: {theme}")
        if not theme:
            theme = CONFIG["settings"]["default_theme"]

        output_base = Path(CONFIG["output_dir"])
        for idx, input_path in enumerate(inputs):
            print(f"\n=== 排版 ({idx + 1}/{len(inputs)}): {input_path.name} ===")
            format_cmd = [
                sys.executable, str(SCRIPT_DIR / "format.py"),
                "--input", str(input_path),
                "--theme", theme,
                "--no-open",
            ]
            result = subprocess.run(format_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"排版失败:\n{result.stderr}")
                sys.exit(1)
            print(result.stdout)
            file_stem = re.sub(r"-(公众号|小红书|微博)$", "", input_path.stem)
            tasks.append((output_base / file_stem, input_path.parent,
                          covers[idx] if covers else None))
    else:
        original_dir = Path(args.source_dir).resolve() if args.source_dir else None
        if original_dir:
            print(f"  使用 --source-dir 指定源目录: {original_dir}")
        tasks.append((Path(args.dir), original_dir, covers[0] if covers else None))

    for article_dir, _, _ in tasks:
        if not article_dir.exists():
            print(f"错误: 目录不存在 - {article_dir}")
            sys.exit(1)

    # ── 2. 获取 token ────────────────────────────────────────────────
    print(f"\n获取 access_token...")
    token = get_access_token()
    print("✓ token 获取成功")

    # ── 3. 逐篇处理（读 HTML → 传图 → 封面）─────────────────────────
    print(f"作者: {args.author}")
    articles = []
    for idx, (article_dir, original_dir, cover_arg) in enumerate(tasks):
        print(f"\n=== 准备第 {idx + 1}/{len(tasks)} 篇: {article_dir.name} ===")
        first = idx == 0
        articles.append(prepare_article(
            article_dir, original_dir, cover_arg, token,
            author=args.author,
            title_override=args.title if first else None,
            digest_override=args.digest if first else None,
            darken_cover=args.darken_cover,
            assume_yes=args.yes,
        ))

    # ── 4. 推送草稿箱 ────────────────────────────────────────────────
    if args.dry_run:
        print(f"\n[dry-run] 跳过推送草稿箱")
        for a in articles:
            print(f"  标题: {a['title']}")
            print(f"  摘要: {a['digest'][:50]}")
            print(f"  封面 media_id: {a['thumb_media_id'][:24]}...")
            print(f"  HTML 长度: {len(a['content'])} 字符")
        return

    print(f"\n推送到草稿箱...")
    media_id = push_draft(token, articles)

    if media_id:
        n = len(articles)
        print(f"\n{'='*40}")
        print(f"  发布成功!{f' (多图文 {n} 篇)' if n > 1 else ''}")
        print(f"  草稿 media_id: {media_id}")
        print(f"  → 请到微信公众号后台 → 草稿箱 查看和发布")
        print(f"{'='*40}")
    else:
        print(f"\n发布失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
