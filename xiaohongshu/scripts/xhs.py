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


def tool(command, args):
    binary = shutil.which(command)
    if not binary:
        raise Failure('MISSING_TOOL', f'Install {command} for this operation')
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
    sub = p.add_subparsers(dest='command', required=True)
    login = sub.add_parser('login'); login.add_argument('--finish', action='store_true')
    login.add_argument('--session-file', type=Path, help='Explicit one-time import of an already authorized cookie JSON; never auto-scan browsers')
    sub.add_parser('status'); sub.add_parser('close')
    search = sub.add_parser('search'); search.add_argument('query'); search.add_argument('--page', type=int, default=1)
    search.add_argument('--sort', choices=['general', 'popular', 'latest'], default='general'); search.add_argument('--type', choices=['all', 'video', 'image'], default='all')
    download = sub.add_parser('fetch'); download.add_argument('reference'); download.add_argument('--media', action='store_true'); download.add_argument('--transcribe', action='store_true')
    recall = sub.add_parser('recall'); recall.add_argument('query'); recall.add_argument('--limit', type=int, default=5)
    installation = sub.add_parser('install'); installation.add_argument('--home', type=Path, default=Path.home())
    group = installation.add_mutually_exclusive_group(); group.add_argument('--apply', action='store_true'); group.add_argument('--restore', type=Path)
    return p


def execute(args):
    if args.command == 'install':
        return install(args.home, args.apply, args.restore)
    root = args.data_dir.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / 'run.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure('BUSY', 'Another operation is running for this profile') from None
        return operation(args, root)


def operation(args, root):
    browser = Browser(root)
    if args.command == 'close':
        browser.close()
        return {'browser': 'closed'}
    if args.command == 'login' and not args.finish and not args.session_file:
        return browser.launch()
    current = root / 'current-account.json'
    credentials = root / 'credentials.json'
    if args.command == 'recall':
        if not 1 <= args.limit <= 50:
            raise Failure('INVALID_INPUT', 'Limit must be 1–50')
        if not current.is_file():
            raise Failure('NEED_LOGIN', 'No local account selected')
        with contextlib.closing(Library(root, json.loads(current.read_text())['id'])) as library:
            return {'mode': 'offline_keyword', 'items': library.recall(args.query, args.limit)}
    if args.command == 'login':
        cookies = json.loads(args.session_file.read_text()) if args.session_file else browser.cookies()
        if not isinstance(cookies, dict):
            raise Failure('INVALID_SESSION', 'Expected a cookie JSON object')
        cookies.pop('saved_at', None)
        if not all(isinstance(k, str) and re.fullmatch(r'[A-Za-z0-9_-]+', k) and isinstance(v, str) and '\r' not in v and '\n' not in v for k, v in cookies.items()) or not cookies.get('a1') or not cookies.get('web_session'):
            raise Failure('INVALID_SESSION', 'Expected an authenticated cookie JSON object')
    else:
        if not credentials.is_file():
            raise Failure('NEED_LOGIN', 'Run login then login --finish')
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
        if args.command == 'fetch':
            return fetch(api, library, args.reference, args.media, args.transcribe)


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
