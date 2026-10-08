#!/usr/bin/env python3
"""Unified Xiaohongshu CLI: deterministic execution, JSON results, local knowledge.

Read endpoint payloads/signing configuration adapted from jackwener/xiaohongshu-cli
(Apache-2.0). See ../THIRD_PARTY_NOTICES.md. No external CLI, MCP or RAG server.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from core import Browser, Failure, Library, NoRedirect, json_request, write_json

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'vendor'))
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'


class API:
    def __init__(self, cookies):
        from xhshow import CryptoConfig, SessionManager, Xhshow
        config = CryptoConfig().with_overrides(
            PUBLIC_USERAGENT=UA,
            SIGNATURE_DATA_TEMPLATE={'x0': '4.2.6', 'x1': 'xhs-pc-web', 'x2': 'macOS', 'x3': '', 'x4': ''},
            SIGNATURE_XSCOMMON_TEMPLATE={'s0': 5, 's1': '', 'x0': '1', 'x1': '4.2.6', 'x2': 'macOS', 'x3': 'xhs-pc-web', 'x4': '4.86.0', 'x5': '', 'x6': '', 'x7': '', 'x8': '', 'x9': -596800761, 'x10': 0, 'x11': 'normal'})
        self.signer, self.sign_session = Xhshow(config), SessionManager(config)
        self.cookies, self.last = cookies, 0

    def request(self, path, payload=None, params=None):
        """GET when payload is None (query goes in params, signed and encoded by the bundled signer); POST otherwise."""
        time.sleep(max(0, 5 - (time.monotonic() - self.last)))
        if payload is None:
            signed = self.signer.sign_headers_get(path, self.cookies, params=params, session=self.sign_session)
            path = self.signer.build_url(path, params)
        else:
            signed = self.signer.sign_headers_post(path, self.cookies, payload=payload, session=self.sign_session)
        headers = {'user-agent': UA, 'content-type': 'application/json;charset=UTF-8', 'cookie': '; '.join(f'{k}={v}' for k, v in self.cookies.items()),
                   'origin': 'https://www.xiaohongshu.com', 'referer': 'https://www.xiaohongshu.com/',
                   'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
                   'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"', 'accept': 'application/json, text/plain, */*',
                   'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', **signed}
        try:
            result = json_request('https://edith.xiaohongshu.com' + path, payload, headers)
        finally:
            self.last = time.monotonic()
        if not isinstance(result, dict):
            raise Failure('INVALID_RESPONSE', 'Invalid API envelope')
        if not result.get('success'):
            code = result.get('code')
            if code in (300012, 300015):
                raise Failure('RISK_CONTROL', f'Platform rejected request ({code}); stop, do not retry')
            if code == -100:
                raise Failure('NEED_LOGIN', 'Session expired; run login')
            raise Failure('API_ERROR', f'Platform error {code}; no automatic retry')
        data = result.get('data', {})
        if not isinstance(data, dict):
            raise Failure('INVALID_RESPONSE', 'Expected an object in API data')
        return data

    def identity(self):
        data = self.request('/api/sns/web/v2/user/me')
        basic = data.get('basic_info', data)
        uid = str(basic.get('user_id') or basic.get('userid') or basic.get('id') or '')
        guest = data.get('guest', basic.get('guest', False))
        if guest or not uid:
            raise Failure('NEED_LOGIN', 'Guest session; finish manual login')
        return {'id': uid, 'nickname': basic.get('nickname', '')}

    def search(self, query, page, sort, kind, session):
        search_id, fresh = session
        if fresh:
            # The web client warms a new search session with onebox/filter; the platform may answer
            # success=false for them, and upstream treats that as non-fatal. Risk control and login loss still stop.
            request_id = f'{random.randint(1_000_000_000, 2_147_483_647)}-{int(time.time() * 1000)}'
            for path, payload, params in (('/api/sns/web/v1/search/onebox', {'keyword': query, 'search_id': search_id, 'biz_type': 'web_search_user', 'request_id': request_id}, None),
                                          ('/api/sns/web/v1/search/filter', None, {'keyword': query, 'search_id': search_id})):
                try:
                    self.request(path, payload, params)
                except Failure as exc:
                    if exc.code not in ('API_ERROR', 'INVALID_RESPONSE', 'INCOMPLETE_RESPONSE'):
                        raise
        data = self.request('/api/sns/web/v1/search/notes', {
            'keyword': query, 'page': page, 'page_size': 20, 'search_id': search_id,
            'sort': sort, 'note_type': {'all': 0, 'video': 1, 'image': 2}[kind], 'ext_flags': [],
            'filters': [{'tags': [sort], 'type': 'sort_type'}, {'tags': ['不限'], 'type': 'filter_note_type'}, {'tags': ['不限'], 'type': 'filter_note_time'}, {'tags': ['不限'], 'type': 'filter_note_range'}, {'tags': ['不限'], 'type': 'filter_pos_distance'}],
            'geo': '', 'image_formats': ['jpg', 'webp', 'avif']})
        if not isinstance(data, dict) or not isinstance(data.get('items'), list):
            raise Failure('INCOMPLETE_RESPONSE', 'Search response lacks items; this does not mean zero results')
        items = []
        for item in data['items']:
            card = item.get('note_card') or {}
            nid = item.get('id', '')
            if card and re.fullmatch('[0-9a-f]{24}', nid):
                items.append({'id': nid, 'title': card.get('display_title') or card.get('title', ''), 'type': card.get('type'),
                              'author': card.get('user', {}).get('nickname', ''), 'url': f'https://www.xiaohongshu.com/explore/{nid}', 'xsec_token': item.get('xsec_token', '')})
        return items, bool(data.get('has_more'))

    def collected(self, uid, cursor):
        """One page of the account's collected notes, newest collection first (platform order)."""
        data = self.request('/api/sns/web/v2/note/collect/page', None,
                            {'num': '30', 'cursor': cursor, 'user_id': uid, 'image_formats': 'jpg,webp,avif', 'xsec_token': '', 'xsec_source': ''})
        return self.listing(data, 'pc_collect')

    def album_notes(self, board_id, cursor):
        """One page of the notes kept in a single album (收藏夹)."""
        data = self.request('/api/sns/web/v1/board/note', None,
                            {'board_id': board_id, 'cursor': cursor, 'num': '30', 'image_formats': 'jpg,webp,avif'})
        return self.listing(data, 'pc_board')

    @staticmethod
    def listing(data, source):
        if not isinstance(data.get('notes'), list):
            raise Failure('INCOMPLETE_RESPONSE', 'Collection response lacks notes; this does not mean the collection is empty')
        items = []
        for note in data['notes']:
            nid = note.get('note_id')
            if not isinstance(nid, str) or not re.fullmatch('[0-9a-f]{24}', nid):
                continue
            user = note.get('user') or {}
            items.append({'id': nid, 'title': note.get('display_title', ''), 'type': note.get('type'),
                          'author': user.get('nickname') or user.get('nick_name', ''),
                          'url': f'https://www.xiaohongshu.com/explore/{nid}', 'xsec_token': note.get('xsec_token', ''), 'source': source})
        return items, data.get('cursor') or '', bool(data.get('has_more'))

    def note(self, nid, token, source):
        data = self.request('/api/sns/web/v1/feed', {'source_note_id': nid, 'image_formats': ['jpg', 'webp', 'avif'], 'extra': {'need_body_topic': '1'}, 'xsec_source': source, 'xsec_token': token})
        items = data.get('items', [])
        card = next((i.get('note_card') for i in items if i.get('note_card')), None)
        if not card or (card.get('note_id') and card['note_id'] != nid):
            raise Failure('INCOMPLETE_RESPONSE', 'Expected note detail not returned')
        return {'id': nid, 'title': card.get('title', ''), 'body': card.get('desc', ''), 'type': card.get('type', 'normal'),
                'url': f'https://www.xiaohongshu.com/explore/{nid}', 'images': [i.get('url_default') or i.get('url_pre') or i.get('url', '') for i in card.get('image_list', [])], 'transcript': ''}


def note_reference(value):
    if re.fullmatch('[0-9a-f]{24}', value):
        return value, '', ''
    match = re.search(r'https?://[^\s<>]+', value)
    if not match:
        raise Failure('INVALID_INPUT', 'Provide a note ID or Xiaohongshu share link')
    url = match.group().rstrip('，。；,;')
    for _ in range(6):
        parsed = urllib.parse.urlsplit(url)
        host = (parsed.hostname or '').lower()
        if parsed.scheme != 'https' or not (host == 'xiaohongshu.com' or host.endswith('.xiaohongshu.com') or host == 'xhslink.com' or host.endswith('.xhslink.com')):
            raise Failure('INVALID_INPUT', 'Only HTTPS Xiaohongshu/xhslink URLs are accepted')
        found = re.search(r'/(?:explore|discovery/item)/([0-9a-f]{24})(?:/|$)', parsed.path)
        if found:
            args = urllib.parse.parse_qs(parsed.query)
            return found[1], args.get('xsec_token', [''])[0], args.get('xsec_source', ['pc_feed'])[0]
        # Resolve share-link redirects explicitly, validating every destination.
        class Capture(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise Redirect(newurl)
        try:
            urllib.request.build_opener(Capture).open(url, timeout=20).close()
        except Redirect as redirect:
            url = redirect.url
            continue
        except (OSError, ValueError):
            raise Failure('NETWORK_ERROR', 'Share link could not be resolved') from None
        break
    raise Failure('INVALID_INPUT', 'No note ID in share link')


class Redirect(Exception):
    def __init__(self, url):
        self.url = url


TOOL_PATHS = ('~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '~/bin')


def tool(command, args):
    # PATH is not the same everywhere this runs: cron, launchd and desktop launchers do not read a
    # login shell, so a tool the user installed per-user is invisible there. Look where they live.
    binary = shutil.which(command) or next((str(found) for found in (Path(folder).expanduser() / command for folder in TOOL_PATHS)
                                            if found.is_file() and os.access(found, os.X_OK)), None)
    if not binary:
        raise Failure('MISSING_TOOL', f'Install {command}, or put it on PATH or in one of {", ".join(TOOL_PATHS)}')
    result = subprocess.run([binary, *args], capture_output=True, text=True)
    if result.returncode:
        raise Failure('TOOL_FAILED', f'{command} failed (exit {result.returncode}); partial output is retained, no automatic retry')
    return result.stdout


def download_image(url, target):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or not (parsed.hostname.endswith('.xhscdn.com') or parsed.hostname.endswith('.xiaohongshu.com')):
        raise Failure('INVALID_MEDIA_URL', 'Unexpected image CDN; no credentials sent')
    url = urllib.parse.urlunsplit(parsed._replace(scheme='https'))
    fd, tmp = tempfile.mkstemp(dir=target.parent)
    try:
        with urllib.request.build_opener(NoRedirect).open(url, timeout=30) as response, os.fdopen(fd, 'wb') as output:
            fd = None
            mime = response.headers.get_content_type()
            extensions = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif'}
            if mime not in extensions:
                raise Failure('INVALID_IMAGE', 'CDN response is not a supported image')
            target = target.with_suffix(extensions[mime])
            shutil.copyfileobj(response, output)
        if not Path(tmp).stat().st_size:
            raise Failure('EMPTY_MEDIA', 'Empty image response')
        os.replace(tmp, target)
    finally:
        if fd is not None:
            os.close(fd)
        Path(tmp).unlink(missing_ok=True)


def fetch(api, library, value, media, transcribe):
    nid, token, source = note_reference(value)
    reference = library.reference(nid)
    token, source = token or reference['token'], source or reference['source']
    folder = library.directory / 'notes' / nid
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    note_path = folder / 'source.json'
    note = json.loads(note_path.read_text()) if note_path.is_file() else api.note(nid, token, source)
    status = {'detail': 'complete', 'media': 'not_requested', 'transcription': 'not_requested', 'ocr': 'not_run'}
    library.save(note)
    write_json(note_path, note)
    try:
        if media or transcribe:
            status['media'] = 'partial'
            if note['type'] == 'video':
                video = folder / 'video.mp4'
                if not video.is_file():
                    url = note['url'] + '?' + urllib.parse.urlencode({'xsec_token': token, 'xsec_source': source})
                    tool('yt-dlp', ['--no-playlist', '--merge-output-format', 'mp4', '-o', str(video), url])
                probe = json.loads(tool('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', str(video)]))
                if not video.is_file() or not video.stat().st_size or not any(s.get('codec_type') == 'video' for s in probe.get('streams', [])):
                    raise Failure('INVALID_VIDEO', 'Downloaded file has no verified video stream')
            else:
                for index, url in enumerate(note['images']):
                    target = folder / f'image-{index + 1:03}.jpg'
                    if not any(folder.glob(f'image-{index + 1:03}.*')):
                        download_image(url, target)
            status['media'] = 'complete'
        if transcribe:
            status['transcription'] = 'partial'
            if note['type'] != 'video':
                raise Failure('INVALID_INPUT', 'Only video notes have a voice transcript')
            transcript = folder / 'video.txt'
            if not transcript.is_file():
                tool('whisper', [str(folder / 'video.mp4'), '--model', 'medium', '--device', 'cpu', '--threads', '4', '--output_format', 'all', '--output_dir', str(folder), '--verbose', 'False'])
            if not transcript.is_file() or not transcript.read_text().strip():
                raise Failure('EMPTY_TRANSCRIPT', 'No speech transcript produced')
            note['transcript'] = transcript.read_text().strip()
            status['transcription'] = 'complete_unreviewed'
    finally:
        note['processing'] = status
        write_json(note_path, note)
        library.save(note)
        text = '# ' + note['title'] + '\n\n来源：' + note['url'] + '\n\n' + note['body']
        if note['transcript']:
            text += '\n\n## 口播转录（Whisper medium，未人工校对）\n\n' + note['transcript']
        (folder / 'note.md').write_text(text, encoding='utf-8')
    return {'note': note, 'directory': str(folder), 'processing': status}


STOP_CODES = ('RISK_CONTROL', 'NEED_LOGIN')


def fetch_many(api, library, references, media, transcribe):
    """Download several notes in one run, one after another.

    A single bad reference must not cost the whole batch, but risk control or a lost session must:
    continuing then only trains the platform on us, so the rest is reported as skipped.
    """
    notes, failed, stopped = [], [], None
    for reference in references:
        if stopped:
            failed.append({'reference': reference, 'code': 'SKIPPED', 'message': f'Stopped after {stopped}; nothing was requested for this note'})
            continue
        try:
            notes.append(fetch(api, library, reference, media, transcribe))
        except Failure as exc:
            failed.append({'reference': reference, 'code': exc.code, 'message': exc.message})
            if exc.code in STOP_CODES:
                stopped = exc.code
    if not notes:
        raise Failure(failed[0]['code'], failed[0]['message'])
    return {'notes': notes, 'failed': failed, 'stopped_after': stopped}


PROFILE_ALBUMS = 'https://www.xiaohongshu.com/user/profile/{}?tab=fav&subTab=board'
ALBUM_LINKS = "[...document.querySelectorAll('a[href*=\"/board/\"]')].map(a => [a.getAttribute('href'), (a.innerText || '').trim()])"


def attach(browser):
    try:
        return browser.connect()
    except Failure as exc:
        if exc.code != 'NEED_LOGIN':
            raise
        browser.launch()
        return browser.connect()


def albums(browser, library, uid):
    """Read the account's album (收藏夹) list from the dedicated browser.

    The web client renders albums without an XHR this script could sign; /api/sns/web/v1/board/user
    answers code -1 for every parameter set, so the rendered page is the only source for the list.
    The notes inside an album still come from the API.
    """
    cdp = attach(browser)
    try:
        target, session = cdp.open(PROFILE_ALBUMS.format(uid))
        try:
            if not cdp.wait(session, f"/\\/login/.test(location.href) || {ALBUM_LINKS}.length > 0 || /还没有|暂无/.test(document.body.innerText)", 40):
                raise Failure('PAGE_CHANGED', 'Album list did not render on the profile page')
            if '/login' in (cdp.evaluate(session, 'location.href') or ''):
                raise Failure('NEED_LOGIN', 'Profile page asked for login; sign in inside the dedicated browser')
            found = {}
            for href, label in cdp.evaluate(session, ALBUM_LINKS) or []:
                match = re.search(r'/board/([0-9a-f]{24})', href or '')
                lines = [line.strip() for line in (label or '').split('\n') if line.strip()]
                if not match or not lines:
                    continue
                count = re.search(r'(\d+)', lines[-1]) if len(lines) > 1 else None
                found[match[1]] = {'id': match[1], 'name': lines[0], 'notes': int(count[1]) if count else None}
            library.albums_save(found.values())
            return {'albums': list(found.values()), 'source': 'dedicated_browser_page'}
        finally:
            try:
                cdp.call('Target.closeTarget', {'targetId': target})
            except Failure:
                pass  # cleanup must not mask the list that was read
    finally:
        cdp.close()


def resolve_album(library, value):
    """Accept an album id, an album link, or a cached album name."""
    value = value.strip()
    found = re.search(r'/board/([0-9a-f]{24})', value)
    if found or re.fullmatch('[0-9a-f]{24}', value):
        return {'id': found[1] if found else value, 'name': ''}
    known = library.albums_list()
    matches = [a for a in known if a['name'] == value] or [a for a in known if value and value in a['name']]
    if not matches:
        raise Failure('ALBUM_UNKNOWN', f'No known album matches {value!r}; run albums first to read the list from the dedicated browser')
    if len(matches) > 1:
        raise Failure('ALBUM_AMBIGUOUS', 'Several albums match: ' + '、'.join(a['name'] for a in matches))
    return matches[0]


def collected(api, library, uid, album, keywords, limit, pages):
    """Candidate notes from the account's collection, filtered by title keyword only.

    Deciding which candidates are actually about the user's topic stays with the caller: the platform
    returns truncated titles and no body here, so keyword filtering is a prefilter, not an answer.
    """
    chosen = resolve_album(library, album) if album else None
    terms = [term.strip().lower() for term in keywords if term.strip()]
    items, cursor, more, scanned = [], '', True, 0
    while more and scanned < pages and len(items) < limit:
        items_page, cursor, more = api.album_notes(chosen['id'], cursor) if chosen else api.collected(uid, cursor)
        scanned += 1
        library.reference_save(items_page)
        items.extend(item for item in items_page if not terms or any(term in item['title'].lower() for term in terms))
        if not cursor:
            more = False
    return {'scope': ('album:' + (chosen['name'] or chosen['id'])) if chosen else 'collected',
            'filter': terms, 'scanned_pages': scanned, 'matched': len(items), 'has_more': more,
            'items': [{k: v for k, v in item.items() if k != 'xsec_token'} for item in items[:limit]]}


PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'
TITLE_INPUT = "document.querySelector('input.d-text[placeholder=\"填写标题会有更多赞哦\"]')"
EDITOR = "document.querySelector('.tiptap.ProseMirror')"


def draft_count(text):
    found = re.search(r'草稿箱\((\d+)\)', text)
    return int(found[1]) if found else None


def fill_title(cdp, session, title):
    """Write the title and wait until the editor echoes it in the note preview.

    An input value alone proves nothing: while the editor hydrates it keeps the typed value but not its own
    state, and the draft then saves untitled. The preview renders that state, so it is the signal to trust.
    """
    committed = 'document.body.innerText.includes(%s)' % json.dumps(title)
    for _ in range(6):
        if cdp.fill_input(session, TITLE_INPUT, title) != title:
            raise Failure('INVALID_INPUT', 'Title was not accepted in full (platform limit); nothing was saved')
        if cdp.wait(session, committed, 4, 0.5):
            return
        time.sleep(1)
    raise Failure('DRAFT_UNCONFIRMED', 'Editor never echoed the title in its preview; nothing was saved')


def open_draft_box(cdp, tab):
    """Read the draft box in its own tab: navigating the editor tab makes it autosave over the draft just written."""
    target, session = cdp.open(PUBLISH_URL)
    try:
        if not cdp.wait(session, "/草稿箱\\(\\d+\\)/.test(document.body.innerText)", 30):
            raise Failure('PAGE_CHANGED', 'Draft box counter not found on the publish page')
        for label in ('草稿箱', tab):
            cdp.evaluate(session, f"[...document.querySelectorAll('*')].filter(e => e.children.length <= 1 && (e.innerText || '').trim().startsWith('{label}')).slice(-1)[0].click()")
            time.sleep(2)
        return cdp.text(session)
    finally:
        try:
            cdp.call('Target.closeTarget', {'targetId': target})
        except Failure:
            pass


def newest_draft(text):
    """Title of the most recently saved draft listed in the open draft-box tab."""
    tail = text.split('请及时发布。', 1)[-1]
    entries = re.findall(r'(.*?)\s*保存于\s*([\d-]+ [\d:]+)\s*编辑\s*删除', tail)
    return (entries[0][0].strip(), entries[0][1]) if entries else (None, None)


def type_lines(cdp, session, text):
    for index, line in enumerate(text.split('\n')):
        if index:
            cdp.press(session, 'Enter', 13)
        if line:
            cdp.insert_text(session, line)
    cdp.press(session, 'Escape', 27)  # closes the topic/mention suggestion popup that '#' or '@' opens


def draft(browser, title, body, images, video):
    """Save a note draft on the creator site through the dedicated Chrome. Drafts live in that browser's local storage."""
    for path in [*images, *([video] if video else [])]:
        if not path.is_file():
            raise Failure('INVALID_INPUT', f'Media file not found: {path.name}')
    if not title.strip() or not body.strip():
        raise Failure('INVALID_INPUT', 'Title and body are required')
    if len(images) > 18:
        raise Failure('INVALID_INPUT', 'The editor accepts at most 18 images')
    cdp = attach(browser)
    cdp.close_tabs('creator.xiaohongshu.com')
    target, session = cdp.open(PUBLISH_URL)
    try:
        if not cdp.wait(session, "/publish\\/publish/.test(location.href) && document.querySelector('.creator-tab') ? true : (/\\/login/.test(location.href) ? 'login' : false)", 30) or '/login' in cdp.evaluate(session, 'location.href'):
            raise Failure('NEED_LOGIN', 'Creator site asked for login; sign in inside the dedicated browser')
        cdp.wait(session, "/草稿箱\\(\\d+\\)/.test(document.body.innerText)", 20)
        before = draft_count(cdp.text(session))
        box = '视频笔记' if video else '图文笔记'
        if video:
            mode = 'video'
            cdp.set_files(session, 'input.upload-input', [str(video)])
            state = cdp.wait(session, "(t => /上传失败/.test(t) ? 'failed' : (/重新上传/.test(t) && !/上传中/.test(t) ? 'done' : ''))(document.body.innerText)", 900, 3)
            if state != 'done':
                raise Failure('UPLOAD_FAILED', 'Video upload did not complete; nothing was saved')
        else:
            cdp.evaluate(session, "[...document.querySelectorAll('.creator-tab')].find(e => e.innerText.trim() === '上传图文' && e.getBoundingClientRect().width).click()")
            if images:
                mode = 'image'
                if not cdp.wait(session, "!!document.querySelector('input.upload-input')", 15):
                    raise Failure('PAGE_CHANGED', 'Image upload input not found')
                cdp.set_files(session, 'input.upload-input', [str(i) for i in images])
                if not cdp.wait(session, f"(document.body.innerText.match(/(\\d+)\\/18/) || [])[1] === '{len(images)}'", 30 + 10 * len(images)):
                    raise Failure('UPLOAD_FAILED', 'Not every image was accepted by the editor; nothing was saved')
            else:
                mode = 'text'  # platform "写文字": the body becomes a text card image, then the normal editor opens prefilled
                cdp.evaluate(session, "[...document.querySelectorAll('button, .d-button')].find(e => e.innerText.trim() === '文字配图').click()")
                if not cdp.wait(session, f"!!{EDITOR}", 15):
                    raise Failure('PAGE_CHANGED', 'Text card editor not found')
                cdp.evaluate(session, f"{EDITOR}.focus()")
                cdp.insert_text(session, body.replace('\n', ' '))
                if not cdp.wait(session, "(b => b && !b.className.includes('disabled'))(document.querySelector('.edit-text-button-text'))", 10):
                    raise Failure('INVALID_INPUT', 'Platform rejected the text card content (length or format)')
                cdp.evaluate(session, "document.querySelector('.edit-text-button').click()")
                if not cdp.wait(session, "[...document.querySelectorAll('button')].some(b => b.innerText.trim() === '下一步')", 120, 2):
                    raise Failure('UPLOAD_FAILED', 'Text card image was not generated')
                cdp.evaluate(session, "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '下一步').click()")
        if not cdp.wait(session, f"!!{TITLE_INPUT}", 30):
            raise Failure('PAGE_CHANGED', 'Note editor did not open')
        cdp.evaluate(session, "(document.querySelector('.feature-guide__btn') || {click() {}}).click()")
        fill_title(cdp, session, title)
        if mode != 'text':
            cdp.evaluate(session, f"{EDITOR}.focus()")
            type_lines(cdp, session, body)
        written = cdp.evaluate(session, f"{EDITOR}.innerText") or ''
        if ''.join(written.split()) != ''.join(body.split()):
            raise Failure('INVALID_INPUT', 'Body was not accepted in full (platform limit); nothing was saved')
        if not cdp.wait(session, "(b => b && b.getAttribute('save-disabled') === 'false')(document.querySelector('xhs-publish-btn'))", 15):
            raise Failure('PAGE_CHANGED', 'Save-draft button is not available')
        confirmed = None
        for _ in range(2):  # the toast is brief; one retry covers a click swallowed while the editor settles
            cdp.click_text(session, '暂存离开')
            confirmed = cdp.wait(session, "/保存成功/.test(document.body.innerText)", 8, 0.3)
            if confirmed:
                break
        if not confirmed:
            raise Failure('DRAFT_UNCONFIRMED', 'No save confirmation from the platform; check the dedicated browser')
        # Confirm the saved draft itself, not just the toast: a stale editor tab elsewhere can overwrite the entry.
        listed = open_draft_box(cdp, box)
        after = draft_count(listed)
        newest, saved_at = newest_draft(listed)
        if newest != title:
            raise Failure('DRAFT_UNCONFIRMED', f'Newest draft is {newest!r}, not {title!r}; close other creator tabs and retry')
        if before is not None and after is not None and after <= before:
            raise Failure('DRAFT_UNCONFIRMED', f'Draft box still holds {after} notes; verify in the dedicated browser')
        return {'mode': mode, 'title': title, 'media': [p.name for p in images] + ([video.name] if video else []),
                'draft_count': after, 'saved_at': saved_at, 'storage': 'dedicated_browser_local',
                'note': 'Open the dedicated browser (xhs.py login) to review or publish the draft'}
    finally:
        try:
            cdp.call('Target.closeTarget', {'targetId': target})
        except Failure:
            pass  # cleanup must not mask the outcome; a tab already gone is fine
        finally:
            cdp.close()


PROFILE_STATE = ('credentials.json', 'current-account.json', 'browser.json', 'browser-profile')
PROFILE_LABEL = r'[\w-]{1,32}'
MAX_PARALLEL_PROFILES = 2


def profile_path(root, label):
    """Per-account state: its own cookies, its own Chrome user data directory, its own lock.

    Accounts must not share a browser profile: one cookie jar can only hold one logged-in account.
    """
    if not re.fullmatch(PROFILE_LABEL, label):
        raise Failure('INVALID_INPUT', 'A profile label may only use letters, digits, Chinese characters, underscore and hyphen (at most 32)')
    path = root / 'profiles' / label
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def migrate_single_profile(root):
    """Move a pre-multi-account installation under profiles/default, login included.

    Moving the files keeps the session: making the user scan a QR code again is the one cost this
    refactor must not impose. A leftover at the old path, once profiles/default already holds that
    state, is no longer the live state, so it is left alone instead of overwriting the new one.
    """
    target = root / 'profiles' / 'default'
    pending = [name for name in PROFILE_STATE if (root / name).exists() and not (target / name).exists()]
    if not pending:
        return None
    # Chrome keeps writing to its user data directory; moving it out from under a live browser
    # splits the profile in two, so the old browser is closed before the move.
    if 'browser-profile' in pending and (root / 'browser.json').is_file() and Browser(root).running():
        Browser(root).close()
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in pending:
        source = root / name
        if source.exists():  # closing the browser above already removes its endpoint file
            source.rename(target / name)
    return 'default'


def default_label(root):
    pointer = root / 'default-profile'
    if pointer.is_file():
        label = pointer.read_text().strip()
        if re.fullmatch(PROFILE_LABEL, label):
            return label
    return 'default'


@contextlib.contextmanager
def parallel_slot(root):
    """Cap how many profiles work at once: each extra account means another Chrome and another
    request stream from the same address, which is what the platform's risk control watches."""
    handles = []
    try:
        for index in range(MAX_PARALLEL_PROFILES):
            handle = (root / f'slot-{index}.lock').open('w')
            handles.append(handle)
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                continue
            yield
            return
        raise Failure('BUSY', f'{MAX_PARALLEL_PROFILES} accounts are already working; wait for one to finish instead of widening the footprint')
    finally:
        for handle in handles:
            handle.close()


def catalog(root, set_default, migrated):
    """List the known accounts. The label the user chose is the key: nicknames change and repeat."""
    if set_default:
        if not (profile_path(root, set_default) / 'credentials.json').is_file():
            raise Failure('NEED_LOGIN', f'Profile {set_default!r} has no verified login yet; run login --profile {set_default} first')
        (root / 'default-profile').write_text(set_default)
    current, items = default_label(root), []
    for profile in sorted((root / 'profiles').glob('*')) if (root / 'profiles').is_dir() else []:
        if not profile.is_dir():
            continue
        account = profile / 'current-account.json'
        user = json.loads(account.read_text()) if account.is_file() else {}
        credentials = profile / 'credentials.json'
        items.append({'label': profile.name, 'nickname': user.get('nickname', ''), 'account_id': user.get('id', ''),
                      'logged_in': credentials.is_file(), 'browser_running': Browser(profile).running(),
                      'default': profile.name == current,
                      'last_verified': time.strftime('%Y-%m-%d %H:%M', time.localtime(credentials.stat().st_mtime)) if credentials.is_file() else ''})
    return {'profiles': items, 'default': current, 'migrated': migrated}


def close_all(root):
    """Close every profile's dedicated browser; leftover Chrome instances are the real cost of several accounts."""
    closed, already_gone, failed = [], [], []
    for profile in sorted((root / 'profiles').glob('*')) if (root / 'profiles').is_dir() else []:
        if not (profile / 'browser.json').is_file():
            continue
        try:
            Browser(profile).close()
            closed.append(profile.name)
        except Failure as exc:
            if exc.code == 'NETWORK_ERROR':
                (profile / 'browser.json').unlink(missing_ok=True)
                already_gone.append(profile.name)
            else:
                failed.append({'profile': profile.name, 'code': exc.code, 'message': exc.message})
    return {'closed': closed, 'already_gone': already_gone, 'failed': failed}


def recall_all(root, query, limit):
    """Keyword recall across every account library.

    The saved material is public notes, so an answer archived under one account is still the right
    answer for a question asked under another; only the platform sessions are account bound.
    """
    found = {}
    for directory in sorted((root / 'accounts').glob('*')):
        if not (directory / 'library.sqlite').is_file():
            continue
        with contextlib.closing(Library.at(directory)) as library:
            for note in library.recall(query, limit):
                found.setdefault(note['id'], note)
    return sorted(found.values(), key=lambda note: note['updated'], reverse=True)[:limit]


def wait_for_scan(browser, seconds):
    """Open the dedicated browser and wait while the user scans, then return a verified session.

    Scanning is the only part a person has to do; watching for the result is not, so the script waits
    instead of handing the user a second command to run afterwards. Cookies are read locally while
    waiting — only once a session cookie appears is the platform asked who it belongs to.
    """
    browser.launch()
    deadline = time.monotonic() + seconds
    while True:
        cookies = None
        try:
            cookies = browser.cookies()
        except Failure as exc:
            if exc.code != 'NEED_LOGIN':
                raise
        if cookies is not None:
            try:
                API(cookies).identity()
                return cookies
            except Failure as exc:
                if exc.code != 'NEED_LOGIN':
                    raise
        if time.monotonic() >= deadline:
            raise Failure('LOGIN_TIMEOUT', 'No finished scan in the dedicated browser yet; the window stays open, run login again when the user is ready')
        time.sleep(3)


def install(home, apply, restore=None):
    source = HERE.parent.resolve()
    home = home.expanduser().resolve()
    roots = [home / '.codex' / 'skills', home / '.claude' / 'skills']
    old_names = ('xiaohongshu', 'xiaohongshu-publisher', 'xiaohongshu-downloader', 'xiaohongshu-research')
    if restore:
        restore = restore.resolve()
        manifest = json.loads((restore / 'restore.json').read_text())
        moved = [(Path(p), Path(q)) for p, q in manifest['moved']]
        links = [Path(p) for p in manifest['links']]
        for p, q in moved:
            if p.parent not in roots or p.name not in old_names or q.parent != restore or not (q.exists() or q.is_symlink()):
                raise Failure('INVALID_BACKUP', 'Backup paths or archived entries are invalid')
            if (p.exists() or p.is_symlink()) and p not in links:
                raise Failure('RESTORE_CONFLICT', 'An original installation path now contains new work')
        for p in links:
            if p.parent not in roots or p.name != 'xiaohongshu' or not p.is_symlink() or p.resolve() != source:
                raise Failure('RESTORE_CONFLICT', 'Unified link was changed; nothing removed')
        for root in roots:
            fd, temporary = tempfile.mkstemp(dir=root)
            os.close(fd)
            os.unlink(temporary)
        for p in links:
            p.unlink()
        for p, q in moved:
            q.rename(p)
        return {'mode': 'restored', 'backup': str(restore)}
    actions = []
    for root in roots:
        for name in old_names:
            p = root / name
            if p.exists() and p.resolve() == source and name == 'xiaohongshu':
                continue
            if p.exists() or p.is_symlink():
                actions.append({'archive': str(p)})
        destination = root / 'xiaohongshu'
        actions.append({'keep': str(destination)} if destination.exists() and destination.resolve() == source else {'link': str(destination), 'source': str(source)})
    if not apply:
        return {'mode': 'dry_run', 'actions': actions}
    # Preflight both installation roots before moving any existing skill.
    for root in roots:
        root.mkdir(parents=True, exist_ok=True)
        fd, path = tempfile.mkstemp(dir=root)
        os.close(fd)
        os.unlink(path)
    backup_root = home / '.local' / 'share' / 'xiaohongshu' / 'skill-backups'
    backup_root.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix=time.strftime('%Y%m%d-%H%M%S-'), dir=backup_root))
    moved, linked = [], []
    try:
        for index, root in enumerate(roots):
            for name in old_names:
                p = root / name
                if p.exists() and p.resolve() == source and name == 'xiaohongshu':
                    continue
                if p.exists() or p.is_symlink():
                    target = backup / f'{index}-{name}'
                    p.rename(target)
                    moved.append((p, target))
            link = root / 'xiaohongshu'
            if not link.exists():
                link.symlink_to(source, target_is_directory=True)
                linked.append(link)
        write_json(backup / 'restore.json', {'moved': [[str(p), str(q)] for p, q in moved], 'links': [str(p) for p in linked]})
    except Exception:
        for p in reversed(linked):
            p.unlink(missing_ok=True)
        for p, target in reversed(moved):
            target.rename(p)
        raise
    return {'mode': 'installed', 'backup': str(backup), 'actions': actions}


def parser():
    p = argparse.ArgumentParser(description='One Xiaohongshu skill, local scripts and knowledge')
    p.add_argument('--data-dir', type=Path, default=Path.home() / '.local/share/xiaohongshu')
    p.add_argument('--profile', help='Which account to act as (label from the profiles command); defaults to the recorded default profile')
    sub = p.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('profiles', help='List the known accounts and which one is the default')
    listing.add_argument('--set-default', help='Make this label the account used when --profile is omitted')
    login = sub.add_parser('login', help='Open the dedicated browser, wait for the user to scan, and store the verified session')
    login.add_argument('--finish', action='store_true', help='Take the session already present in the browser instead of waiting for a scan')
    login.add_argument('--wait', type=int, default=180, help='Seconds to wait for the scan (default 180)')
    login.add_argument('--session-file', type=Path, help='Explicit one-time import of an already authorized cookie JSON; never auto-scan browsers')
    sub.add_parser('status')
    shutdown = sub.add_parser('close'); shutdown.add_argument('--all', action='store_true', help='Close the dedicated browser of every account, not just the selected one')
    search = sub.add_parser('search'); search.add_argument('query'); search.add_argument('--page', type=int, default=1)
    search.add_argument('--sort', choices=['general', 'popular', 'latest'], default='general'); search.add_argument('--type', choices=['all', 'video', 'image'], default='all')
    download = sub.add_parser('fetch', help='Read and save one or more notes; repeat the reference to download a batch')
    download.add_argument('reference', nargs='+'); download.add_argument('--media', action='store_true'); download.add_argument('--transcribe', action='store_true')
    sub.add_parser('albums', help='List the account albums (收藏夹); reads the profile page in the dedicated browser')
    saved = sub.add_parser('collected', help='List collected notes, newest first, optionally one album only and prefiltered by title keyword')
    saved.add_argument('--album', help='Album name (as listed by albums), album id, or album link')
    saved.add_argument('--keyword', action='append', default=[], help='Keep candidates whose title contains this (repeatable, matched case-insensitively)')
    saved.add_argument('--limit', type=int, default=20); saved.add_argument('--pages', type=int, default=5, help='How many platform pages to scan (10 notes each)')
    recall = sub.add_parser('recall'); recall.add_argument('query'); recall.add_argument('--limit', type=int, default=5)
    recall.add_argument('--all-accounts', action='store_true', help='Search the material saved under every account, not only the selected one')
    note = sub.add_parser('draft', help='Save a note draft (text / images / video) in the creator site via the dedicated browser')
    note.add_argument('--title', required=True); text = note.add_mutually_exclusive_group(required=True)
    text.add_argument('--body'); text.add_argument('--body-file', type=Path)
    media = note.add_mutually_exclusive_group(); media.add_argument('--image', type=Path, action='append', default=[]); media.add_argument('--video', type=Path)
    installation = sub.add_parser('install'); installation.add_argument('--home', type=Path, default=Path.home())
    group = installation.add_mutually_exclusive_group(); group.add_argument('--apply', action='store_true'); group.add_argument('--restore', type=Path)
    return p


def execute(args):
    if args.command == 'install':
        return install(args.home, args.apply, args.restore)
    root = args.data_dir.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    migrated = migrate_single_profile(root)
    if args.command == 'profiles':
        return catalog(root, args.set_default, migrated)
    if args.command == 'close' and args.all:
        return close_all(root)
    label = args.profile or default_label(root)
    profile = profile_path(root, label)
    with (profile / 'run.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure('BUSY', f'Another operation is already running for account {label!r}') from None
        with parallel_slot(root):
            result = operation(args, root, profile)
    if not (root / 'default-profile').is_file() and (profile / 'credentials.json').is_file():
        (root / 'default-profile').write_text(label)  # the first verified account becomes the default
    return {**result, 'profile': label} if isinstance(result, dict) else result


def operation(args, root, profile):
    browser = Browser(profile)
    if args.command == 'close':
        browser.close()
        return {'browser': 'closed'}
    if args.command == 'draft':
        body = args.body_file.read_text(encoding='utf-8') if args.body_file else args.body
        return draft(browser, args.title.strip(), body.strip(), args.image, args.video)
    current = profile / 'current-account.json'
    credentials = profile / 'credentials.json'
    if args.command == 'recall':
        if not 1 <= args.limit <= 50:
            raise Failure('INVALID_INPUT', 'Limit must be 1–50')
        if args.all_accounts:
            return {'mode': 'offline_keyword', 'scope': 'all_accounts', 'items': recall_all(root, args.query, args.limit)}
        if not current.is_file():
            raise Failure('NEED_LOGIN', 'This account has no verified login yet; run login, or pass --all-accounts to search every saved account')
        with contextlib.closing(Library(root, json.loads(current.read_text())['id'])) as library:
            return {'mode': 'offline_keyword', 'scope': 'this_account', 'items': library.recall(args.query, args.limit)}
    if args.command == 'login':
        if args.session_file:
            cookies = json.loads(args.session_file.read_text())
        elif args.finish:
            cookies = browser.cookies()
        else:
            if not 10 <= args.wait <= 600:
                raise Failure('INVALID_INPUT', 'The scan wait must be 10–600 seconds')
            cookies = wait_for_scan(browser, args.wait)
        if not isinstance(cookies, dict):
            raise Failure('INVALID_SESSION', 'Expected a cookie JSON object')
        cookies.pop('saved_at', None)
        if not all(isinstance(k, str) and re.fullmatch(r'[A-Za-z0-9_-]+', k) and isinstance(v, str) and '\r' not in v and '\n' not in v for k, v in cookies.items()) or not cookies.get('a1') or not cookies.get('web_session'):
            raise Failure('INVALID_SESSION', 'Expected an authenticated cookie JSON object')
    else:
        if not credentials.is_file():
            raise Failure('NEED_LOGIN', 'This account has no stored session; run login (it opens the browser and waits for the scan)')
        cookies = json.loads(credentials.read_text())['cookies']
    api = API(cookies)
    user = api.identity()
    write_json(credentials, {'cookies': cookies, 'user': user})
    write_json(current, user)
    if args.command in ('login', 'status'):
        return {'authenticated': True, 'user': user}
    with contextlib.closing(Library(root, user['id'])) as library:
        if args.command == 'search':
            if not args.query.strip() or args.page < 1:
                raise Failure('INVALID_INPUT', 'Nonempty query and positive page required')
            items, more = api.search(args.query, args.page, args.sort, args.type, library.search_session(args.query, args.sort, args.type))
            library.search_record(args.query, items)
            return {'items': [{k: v for k, v in i.items() if k != 'xsec_token'} for i in items], 'has_more': more, 'archived_full_notes': 0}
        if args.command == 'albums':
            return albums(browser, library, user['id'])
        if args.command == 'collected':
            if not 1 <= args.limit <= 100 or not 1 <= args.pages <= 20:
                raise Failure('INVALID_INPUT', 'Limit must be 1–100 and pages 1–20')
            return collected(api, library, user['id'], args.album, args.keyword, args.limit, args.pages)
        if args.command == 'fetch':
            return fetch_many(api, library, args.reference, args.media, args.transcribe)


def main():
    os.umask(0o077)
    args = parser().parse_args()
    try:
        result = {'ok': True, 'schema_version': 1, 'data': execute(args)}
        code = 0
    except Failure as exc:
        result = {'ok': False, 'schema_version': 1, 'error': {'code': exc.code, 'message': exc.message}}
        code = 1
    except PermissionError:
        result = {'ok': False, 'schema_version': 1, 'error': {'code': 'PERMISSION_DENIED', 'message': 'Destination is not writable; no permission bypass attempted'}}
        code = 1
    except (OSError, ValueError, KeyError, sqlite3.Error, subprocess.SubprocessError):
        result = {'ok': False, 'schema_version': 1, 'error': {'code': 'EXECUTION_FAILED', 'message': 'Operation failed; do not retry blindly. Inspect local files without printing credentials.'}}
        code = 1
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == '__main__':
    sys.exit(main())
