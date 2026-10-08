#!/usr/bin/env python3
"""Meaningful offline regression tests; no real account or platform requests."""
import importlib.util
import json
import socket
import struct
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / 'scripts'))
import xhs
from core import CDP, Failure, Library, write_json

NID = 'a' * 24


class Behavior(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_packages_and_offline_recall_account_isolation(self):
        for account, title in [('one', '只属于甲的游戏'), ('two', '只属于乙的游戏')]:
            db = Library(self.root, account)
            db.save({'id': NID, 'title': title, 'body': '100%游戏', 'transcript': '', 'url': 'https://www.xiaohongshu.com/explore/' + NID, 'type': 'normal'})
            db.save({'id': NID, 'title': title, 'body': '100%游戏', 'transcript': '', 'url': 'https://www.xiaohongshu.com/explore/' + NID, 'type': 'normal'})
            self.assertEqual(db.db.execute('SELECT count(*) FROM notes').fetchone()[0], 1)
            db.close()
        write_json(self.root / 'current-account.json', {'id': 'one'})
        result = subprocess.run([sys.executable, '-S', str(HERE / 'scripts/xhs.py'), '--data-dir', str(self.root), 'recall', '100%'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)['data']
        self.assertEqual([i['title'] for i in data['items']], ['只属于甲的游戏'])

    def test_rc4_and_bundled_signer_without_site_packages(self):
        code = '''import sys;sys.path.insert(0,sys.argv[1]);from xhshow.generators.rc4 import ARC4;from xhshow import Xhshow
assert ARC4.new(b'Key').encrypt(b'Plaintext').hex()=='bbf316e8d940af0ad3'
headers=Xhshow().sign_headers_post('/api/sns/web/v1/feed',{'a1':'fixture'},payload={'source_note_id':'a'*24})
assert all(k in headers for k in ['x-s','x-t','x-s-common'])
'''
        result = subprocess.run([sys.executable, '-S', '-c', code, str(HERE / 'scripts/vendor')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_items_is_not_empty_search(self):
        api = xhs.API({'a1': 'fixture'})
        api.request = lambda *a, **k: {'has_more': False}
        with self.assertRaises(Failure) as exc:
            api.search('游戏', 1, 'general', 'all', ('SID', False))
        self.assertEqual(exc.exception.code, 'INCOMPLETE_RESPONSE')
        api.request = lambda *a, **k: {'items': [], 'has_more': False}
        self.assertEqual(api.search('游戏', 1, 'general', 'all', ('SID', False)), ([], False))

    def test_search_prewarm_failure_is_tolerated_but_risk_control_stops(self):
        api = xhs.API({'a1': 'fixture'})
        calls = []
        def request(path, payload=None, params=None):
            calls.append((path.rsplit('/', 1)[1], payload, params))
            if 'onebox' in path:
                raise Failure('API_ERROR', 'Platform error 0')
            return {'items': [], 'has_more': False}
        api.request = request
        self.assertEqual(api.search('游戏', 1, 'general', 'all', ('SID', True)), ([], False))
        self.assertEqual([c[0] for c in calls], ['onebox', 'filter', 'notes'])
        self.assertEqual(calls[1][1:], (None, {'keyword': '游戏', 'search_id': 'SID'}), 'GET query must be passed as params for signing')
        calls.clear()
        api.search('游戏', 2, 'general', 'all', ('SID', False))
        self.assertEqual(len(calls), 1, 'reused session must not prewarm again')
        def risky(path, payload=None, params=None):
            raise Failure('RISK_CONTROL', 'stop')
        api.request = risky
        with self.assertRaises(Failure) as exc:
            api.search('游戏', 1, 'general', 'all', ('SID', True))
        self.assertEqual(exc.exception.code, 'RISK_CONTROL')

    def test_search_session_reused_within_ttl_and_expires(self):
        db = Library(self.root, 'one')
        first, fresh = db.search_session('游戏', 'general', 'all')
        self.assertTrue(fresh)
        self.assertEqual(db.search_session('游戏', 'general', 'all'), (first, False))
        self.assertNotEqual(db.search_session('游戏', 'latest', 'all')[0], first)
        db.db.execute('UPDATE sessions SET used=used-1000')
        db.db.commit()
        other, fresh = db.search_session('游戏', 'general', 'all')
        self.assertTrue(fresh)
        self.assertNotEqual(other, first)
        db.close()

    def test_risk_stops_immediately_without_retry(self):
        api = xhs.API({'a1': 'secret-fixture'})
        with patch.object(xhs, 'json_request', return_value={'success': False, 'code': 300012}) as request:
            with self.assertRaises(Failure) as exc:
                api.request('/api/sns/web/v2/user/me')
        self.assertEqual(request.call_count, 1)
        self.assertEqual(exc.exception.code, 'RISK_CONTROL')
        self.assertNotIn('secret-fixture', exc.exception.message)

    def test_media_failure_retains_body_and_reports_partial(self):
        api = xhs.API({'a1': 'fixture'})
        api.note = lambda *a: {'id': NID, 'title': '完整正文', 'body': '需要保留', 'type': 'video', 'url': 'https://www.xiaohongshu.com/explore/' + NID, 'images': [], 'transcript': ''}
        db = Library(self.root, 'one')
        with patch.object(xhs, 'tool', side_effect=Failure('TOOL_FAILED', 'fixture')):
            with self.assertRaises(Failure):
                xhs.fetch(api, db, NID, True, False)
        saved = json.loads((db.directory / 'notes' / NID / 'source.json').read_text())
        self.assertEqual(saved['body'], '需要保留')
        self.assertEqual(saved['processing']['media'], 'partial')
        self.assertEqual(len(db.recall('需要', 5)), 1)
        db.close()

    def test_tools_installed_per_user_are_found_without_a_login_shell_path(self):
        folder = self.root / 'user-bin'
        folder.mkdir()
        binary = folder / 'yt-dlp'
        binary.write_text('#!/bin/sh\necho downloaded\n')
        binary.chmod(0o755)
        with patch.object(xhs.shutil, 'which', return_value=None), patch.object(xhs, 'TOOL_PATHS', (str(folder),)):
            self.assertEqual(xhs.tool('yt-dlp', []), 'downloaded\n')
            with self.assertRaises(Failure) as exc:
                xhs.tool('whisper', [])
        self.assertEqual(exc.exception.code, 'MISSING_TOOL')

    def test_credentials_not_forwarded_to_other_domains(self):
        with self.assertRaises(Failure):
            xhs.note_reference('https://example.com/explore/' + NID)
        with self.assertRaises(Failure):
            xhs.note_reference('https://xiaohongshu.com.evil.invalid/explore/' + NID)

    def test_install_and_restore_preserve_old_skill_and_data(self):
        for name in ('.codex', '.claude'):
            old = self.root / name / 'skills/xiaohongshu-publisher'
            old.mkdir(parents=True)
            (old / 'SKILL.md').write_text('original')
        saved_data = self.root / '.local/share/xiaohongshu/sentinel'
        saved_data.parent.mkdir(parents=True)
        saved_data.write_text('knowledge')
        plan = xhs.install(self.root, False)
        self.assertEqual(plan['mode'], 'dry_run')
        result = xhs.install(self.root, True)
        for name in ('.codex', '.claude'):
            self.assertTrue((self.root / name / 'skills/xiaohongshu').is_symlink())
            self.assertFalse((self.root / name / 'skills/xiaohongshu-publisher').exists())
        xhs.install(self.root, False, Path(result['backup']))
        for name in ('.codex', '.claude'):
            self.assertEqual((self.root / name / 'skills/xiaohongshu-publisher/SKILL.md').read_text(), 'original')
        self.assertEqual(saved_data.read_text(), 'knowledge')

    def test_bad_import_is_structured_and_private_state_not_written(self):
        path = self.root / 'bad.json'
        path.write_text('["bad"]')
        result = subprocess.run([sys.executable, '-S', str(HERE / 'scripts/xhs.py'), '--data-dir', str(self.root), 'login', '--session-file', str(path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['error']['code'], 'INVALID_SESSION')
        self.assertFalse((self.root / 'profiles/default/credentials.json').exists())

    def test_install_does_not_archive_its_own_installed_source(self):
        source = self.root / '.codex/skills/xiaohongshu'
        (source / 'scripts').mkdir(parents=True)
        (source / 'SKILL.md').write_text('canonical source')
        with patch.object(xhs, 'HERE', source / 'scripts'):
            xhs.install(self.root, True)
        self.assertFalse(source.is_symlink())
        self.assertEqual((source / 'SKILL.md').read_text(), 'canonical source')
        self.assertEqual((self.root / '.claude/skills/xiaohongshu').resolve(), source.resolve())

    def test_cdp_handles_ping_fragmentation_and_masked_messages(self):
        class Wire:
            def __init__(self):
                self.sent = []
            def sendall(self, data):
                self.sent.append(data)
        cdp = CDP.__new__(CDP)
        cdp.socket = Wire()
        payload = b'{"id":1,"result":{}}'
        cut = 5
        cdp.buffer = bytes([0x89, 1]) + b'x' + bytes([0x01, cut]) + payload[:cut] + bytes([0x80, len(payload) - cut]) + payload[cut:]
        self.assertEqual(cdp.receive(), {'id': 1, 'result': {}})
        self.assertEqual(cdp.socket.sent[0][0] & 15, 10)

    def test_full_route_search_fetch_and_new_process_recall(self):
        cookies = self.root / 'import.json'
        cookies.write_text(json.dumps({'a1': 'fixture', 'web_session': 'private-fixture'}))
        def response(url, payload=None, headers=None):
            if '/user/me' in url:
                data = {'user_id': 'account-one', 'nickname': 'fixture', 'guest': False}
            elif '/search/notes' in url:
                self.assertEqual(payload['page_size'], 20)
                data = {'items': [{'id': NID, 'xsec_token': 'private-token', 'note_card': {'display_title': '案例', 'type': 'normal'}}]}
            elif '/v1/feed' in url:
                self.assertEqual(payload['xsec_token'], 'private-token')
                data = {'items': [{'note_card': {'note_id': NID, 'title': '案例', 'desc': '完整的中文游戏正文', 'type': 'normal', 'image_list': []}}]}
            else:
                data = {}
            return {'success': True, 'data': data}
        base = ['--data-dir', str(self.root)]
        with patch.object(xhs, 'json_request', side_effect=response), patch.object(xhs.time, 'sleep'):
            xhs.execute(xhs.parser().parse_args([*base, 'login', '--session-file', str(cookies)]))
            result = xhs.execute(xhs.parser().parse_args([*base, 'search', '游戏']))
            self.assertNotIn('private-token', json.dumps(result))
            xhs.execute(xhs.parser().parse_args([*base, 'fetch', NID]))
        result = subprocess.run([sys.executable, '-S', str(HERE / 'scripts/xhs.py'), *base, 'recall', '游戏'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['data']['items'][0]['body'], '完整的中文游戏正文')
        self.assertEqual((self.root / 'profiles/default/credentials.json').stat().st_mode & 0o777, 0o600)

    def test_share_redirect_rejects_foreign_destination_before_request(self):
        class Opener:
            def open(self, *args, **kwargs):
                raise xhs.Redirect('https://example.com/explore/' + NID)
        with patch.object(xhs.urllib.request, 'build_opener', return_value=Opener()) as build:
            with self.assertRaises(Failure) as error:
                xhs.note_reference('https://xhslink.com/fixture')
            self.assertEqual(build.call_count, 1)
            self.assertEqual(error.exception.code, 'INVALID_INPUT')



class FakePage:
    """Stands in for the creator page: enough behaviour to pin the bugs this flow actually hit."""

    def __init__(self, title_commits_on=1, newest_override=None):
        self.title = ''
        self.committed = ''
        self.body = ''
        self.images = 0
        self.video = None
        self.drafts = []
        self.saved_toast = False
        self.fills = 0
        self.title_commits_on = title_commits_on
        self.newest_override = newest_override
        self.closed_hosts = []
        self.opened = []
        self.closed_targets = []
        self.card_text = None

    # -- CDP surface -------------------------------------------------
    def close_tabs(self, host):
        self.closed_hosts.append(host)
        return 0

    def open(self, url):
        self.opened.append(url)
        return f'T{len(self.opened)}', f'S{len(self.opened)}'

    def call(self, method, params=None, session=None):
        if method == 'Target.closeTarget':
            self.closed_targets.append(params['targetId'])
        return {}

    def close(self):
        pass

    def text(self, session):
        listing = ' '.join(f'{t} 保存于2026-10-07 00:0{i}:00 编辑 删除' for i, t in enumerate(reversed(self.drafts)))
        return (f'草稿箱({len(self.drafts)}) 上传图文 请及时发布。 {listing} '
                + (f'{self.committed} ' if self.committed else '') + ('保存成功' if self.saved_toast else ''))

    def evaluate(self, session, expression):
        if 'location.href' in expression and 'publish' in expression:
            return True
        if expression == 'location.href':
            return xhs.PUBLISH_URL
        if 'includes(' in expression:
            return json.loads(expression[expression.index('(') + 1:-1]) == self.committed
        if '.innerText' in expression and 'ProseMirror' in expression:
            return self.body
        return True

    def wait(self, session, expression, seconds, step=1.0):
        if '草稿箱' in expression:
            return True
        if 'upload-input' in expression:
            return True
        if '/18' in expression:
            return f"'{self.images}'" in expression
        if 'ProseMirror' in expression:
            return True
        if 'edit-text-button-text' in expression or '下一步' in expression:
            return True
        if 'd-text' in expression:
            return True
        if 'save-disabled' in expression:
            return True
        if '保存成功' in expression:
            return self.saved_toast
        return self.evaluate(session, expression)

    def fill_input(self, session, selector, value):
        self.fills += 1
        self.title = value
        if self.fills >= self.title_commits_on:
            self.committed = value
        return value

    def insert_text(self, session, text):
        self.card_text = (self.card_text or '') + text
        self.body += text

    def press(self, session, key, code):
        if key == 'Enter':
            self.body += '\n'

    def set_files(self, session, selector, files):
        if any(str(f).endswith('.mp4') for f in files):
            self.video = files
        else:
            self.images = len(files)

    def click_text(self, session, text):
        if text == '暂存离开':
            self.drafts.append(self.committed or '暂无笔记标题')
            self.saved_toast = True


class Drafting(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.media = self.root / 'a.webp'
        self.media.write_bytes(b'x')
        patch_sleep = patch.object(xhs.time, 'sleep')
        patch_sleep.start()
        self.addCleanup(patch_sleep.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def run_draft(self, page, title='标题', body='正文', images=(), video=None):
        browser = unittest.mock.Mock()
        browser.connect.return_value = page
        return xhs.draft(browser, title, body, list(images), video)

    def test_missing_media_and_empty_fields_never_open_a_browser(self):
        browser = unittest.mock.Mock()
        for kwargs in ({'images': [self.root / 'gone.webp']}, {'title': ' '}, {'body': ' '}):
            with self.assertRaises(Failure) as exc:
                xhs.draft(browser, kwargs.get('title', '标题'), kwargs.get('body', '正文'), kwargs.get('images', []), None)
            self.assertEqual(exc.exception.code, 'INVALID_INPUT')
        browser.connect.assert_not_called()

    def test_too_many_images_is_refused_before_opening_a_browser(self):
        browser = unittest.mock.Mock()
        with self.assertRaises(Failure) as exc:
            xhs.draft(browser, '标题', '正文', [self.media] * 19, None)
        self.assertEqual(exc.exception.code, 'INVALID_INPUT')
        browser.connect.assert_not_called()

    def test_title_is_rewritten_until_the_editor_echoes_it(self):
        page = FakePage(title_commits_on=3)  # editor drops the first writes while hydrating
        result = self.run_draft(page, title='会被丢弃的标题', images=[self.media])
        self.assertEqual(page.fills, 3)
        self.assertEqual(page.drafts, ['会被丢弃的标题'])
        self.assertEqual(result['mode'], 'image')

    def test_title_never_committed_saves_nothing(self):
        page = FakePage(title_commits_on=99)
        with self.assertRaises(Failure) as exc:
            self.run_draft(page, images=[self.media])
        self.assertEqual(exc.exception.code, 'DRAFT_UNCONFIRMED')
        self.assertEqual(page.drafts, [])

    def test_untitled_newest_draft_is_reported_not_claimed_as_saved(self):
        page = FakePage()
        page.click_text = lambda session, text: (page.drafts.append('暂无笔记标题'), setattr(page, 'saved_toast', True))
        with self.assertRaises(Failure) as exc:
            self.run_draft(page, title='我的标题', images=[self.media])
        self.assertEqual(exc.exception.code, 'DRAFT_UNCONFIRMED')
        self.assertIn('暂无笔记标题', exc.exception.message)

    def test_text_mode_uses_the_card_flow_and_does_not_retype_the_body(self):
        page = FakePage()
        result = self.run_draft(page, body='第一行\n第二行')
        self.assertEqual(result['mode'], 'text')
        self.assertEqual(page.images, 0)
        self.assertEqual(page.card_text, '第一行 第二行')  # newlines flattened for the card, typed once

    def test_stale_creator_tabs_are_closed_before_drafting(self):
        page = FakePage()
        self.run_draft(page, images=[self.media])
        self.assertEqual(page.closed_hosts, ['creator.xiaohongshu.com'])

    def test_cleanup_failure_does_not_mask_a_saved_draft(self):
        page = FakePage()
        def call(method, params=None, session=None):
            if method == 'Target.closeTarget':
                raise Failure('CDP_ERROR', 'Browser command failed')
            return {}
        page.call = call
        self.assertEqual(self.run_draft(page, images=[self.media])['title'], '标题')


class FakeProfile:
    """Stands in for the profile album tab: the list is rendered, so duplicates and labels are the risk."""

    def __init__(self, links, href='https://www.xiaohongshu.com/user/profile/u?tab=fav&subTab=board'):
        self.links, self.href, self.closed = links, href, []

    def open(self, url):
        self.opened = url
        return 'T1', 'S1'

    def evaluate(self, session, expression):
        if expression == 'location.href':
            return self.href
        return self.links

    def wait(self, session, expression, seconds, step=1.0):
        return True

    def call(self, method, params=None, session=None):
        self.closed.append(params['targetId'])
        return {}

    def close(self):
        pass


class Collections(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.library = Library(self.root, 'one')
        self.addCleanup(self.library.close)
        self.addCleanup(self.tmp.cleanup)

    def api_with_pages(self, pages):
        api = xhs.API({'a1': 'fixture'})
        self.requests = []
        def request(path, payload=None, params=None):
            self.requests.append((path, params))
            return pages[len(self.requests) - 1]
        api.request = request
        return api

    def page(self, titles, cursor='', more=False):
        return {'cursor': cursor, 'has_more': more,
                'notes': [{'note_id': f'{index:024x}', 'display_title': title, 'type': 'video',
                           'user': {'nickname': '作者'}, 'xsec_token': f'token-{index}'} for index, title in enumerate(titles)]}

    def test_collected_prefilters_by_title_and_keeps_tokens_for_the_download(self):
        api = self.api_with_pages([self.page(['UI 设计规范', '炒饭'], 'C1', True), self.page(['ui 组件库', '烤串'])])
        result = xhs.collected(api, self.library, 'uid', None, ['Ui'], 20, 5)
        self.assertEqual([i['title'] for i in result['items']], ['UI 设计规范', 'ui 组件库'])
        self.assertEqual(result['scanned_pages'], 2)
        self.assertFalse(result['has_more'])
        self.assertNotIn('xsec_token', result['items'][0])
        self.assertEqual(self.library.reference(result['items'][0]['id'])['token'], 'token-0', 'fetch needs the token this listing saw')
        self.assertEqual(self.requests[1][1]['cursor'], 'C1', 'the second page must continue the first')

    def test_collected_stops_at_the_page_budget_instead_of_walking_the_whole_collection(self):
        api = self.api_with_pages([self.page(['无关'], f'C{i}', True) for i in range(5)])
        result = xhs.collected(api, self.library, 'uid', None, ['ui'], 20, 2)
        self.assertEqual((result['scanned_pages'], result['matched'], result['has_more']), (2, 0, True))

    def test_album_scope_reads_the_album_not_the_whole_collection(self):
        self.library.albums_save([{'id': 'b' * 24, 'name': 'ui 设计', 'notes': 3}])
        api = self.api_with_pages([self.page(['随便一篇'])])
        result = xhs.collected(api, self.library, 'uid', 'ui', [], 20, 5)
        self.assertEqual(result['scope'], 'album:ui 设计')
        self.assertEqual(self.requests[0][0], '/api/sns/web/v1/board/note')
        self.assertEqual(self.requests[0][1]['board_id'], 'b' * 24)

    def test_unknown_or_ambiguous_album_never_reaches_the_platform(self):
        self.library.albums_save([{'id': 'b' * 24, 'name': 'ui 设计', 'notes': 1}, {'id': 'c' * 24, 'name': 'ui 组件', 'notes': 1}])
        api = self.api_with_pages([])
        for value, code in (('不存在', 'ALBUM_UNKNOWN'), ('ui', 'ALBUM_AMBIGUOUS')):
            with self.assertRaises(Failure) as exc:
                xhs.collected(api, self.library, 'uid', value, [], 20, 5)
            self.assertEqual(exc.exception.code, code)
        self.assertEqual(self.requests, [])

    def test_a_broken_entry_is_skipped_instead_of_crashing_the_listing(self):
        api = self.api_with_pages([{'cursor': '', 'has_more': False, 'notes': [
            {'note_id': None, 'display_title': '占位'}, {'display_title': '没有 id'},
            {'note_id': 'a' * 24, 'display_title': '正常一篇', 'type': 'normal', 'user': {'nickname': '作者'}, 'xsec_token': 't'}]}])
        result = xhs.collected(api, self.library, 'uid', None, [], 20, 5)
        self.assertEqual([i['title'] for i in result['items']], ['正常一篇'])

    def test_missing_notes_is_not_an_empty_collection(self):
        api = self.api_with_pages([{'has_more': False}])
        with self.assertRaises(Failure) as exc:
            xhs.collected(api, self.library, 'uid', None, [], 20, 5)
        self.assertEqual(exc.exception.code, 'INCOMPLETE_RESPONSE')

    def test_albums_are_deduped_and_counted_from_the_rendered_page(self):
        page = FakeProfile([['/board/' + 'b' * 24 + '?source=web_user_page', 'ui 设计\n笔记・12'],
                            ['/board/' + 'b' * 24, 'ui 设计\n笔记・12'],
                            ['/board/' + 'c' * 24, '娃'],
                            ['/livelist?channel_type=web_board_page', '直播']])
        browser = unittest.mock.Mock()
        browser.connect.return_value = page
        result = xhs.albums(browser, self.library, 'uid')
        self.assertEqual([(a['name'], a['notes']) for a in result['albums']], [('ui 设计', 12), ('娃', None)])
        self.assertEqual({a['name'] for a in self.library.albums_list()}, {'ui 设计', '娃'})
        self.assertEqual(page.closed, ['T1'], 'the page opened for reading must be closed again')

    def test_albums_report_a_login_redirect_instead_of_an_empty_list(self):
        page = FakeProfile([], href='https://www.xiaohongshu.com/login')
        browser = unittest.mock.Mock()
        browser.connect.return_value = page
        with self.assertRaises(Failure) as exc:
            xhs.albums(browser, self.library, 'uid')
        self.assertEqual(exc.exception.code, 'NEED_LOGIN')
        self.assertEqual(self.library.albums_list(), [])

    def test_batch_download_survives_one_bad_note_but_stops_on_risk_control(self):
        plan = {'good-1': None, 'bad': Failure('INVALID_INPUT', 'fixture'), 'risky': Failure('RISK_CONTROL', 'stop'), 'after': None}
        def one(api, library, reference, media, transcribe):
            if plan[reference]:
                raise plan[reference]
            return {'note': {'id': reference}, 'processing': {}}
        with patch.object(xhs, 'fetch', side_effect=one):
            result = xhs.fetch_many(None, self.library, list(plan), False, False)
        self.assertEqual([n['note']['id'] for n in result['notes']], ['good-1'])
        self.assertEqual([(f['reference'], f['code']) for f in result['failed']],
                         [('bad', 'INVALID_INPUT'), ('risky', 'RISK_CONTROL'), ('after', 'SKIPPED')])
        self.assertEqual(result['stopped_after'], 'RISK_CONTROL')

    def test_batch_download_with_nothing_saved_is_an_error_not_an_empty_success(self):
        with patch.object(xhs, 'fetch', side_effect=Failure('INCOMPLETE_RESPONSE', 'fixture')):
            with self.assertRaises(Failure) as exc:
                xhs.fetch_many(None, self.library, ['one', 'two'], False, False)
        self.assertEqual(exc.exception.code, 'INCOMPLETE_RESPONSE')


class Signin(unittest.TestCase):
    """Scanning is the user's only step; everything after it is the script's job."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        sleeper = patch.object(xhs.time, 'sleep')
        sleeper.start()
        self.addCleanup(sleeper.stop)

    def browser(self, cookies_sequence):
        browser = unittest.mock.Mock()
        browser.cookies.side_effect = list(cookies_sequence)
        return browser

    def identity(self, *accounts):
        answers = list(accounts)
        def response(url, payload=None, headers=None):
            return {'success': True, 'data': answers.pop(0) if len(answers) > 1 else answers[0]}
        return patch.object(xhs, 'json_request', side_effect=response)

    def test_login_waits_through_the_scan_and_finishes_by_itself(self):
        pending = Failure('NEED_LOGIN', 'Complete login in the dedicated browser')
        browser = self.browser([pending, pending, {'a1': 'fixture', 'web_session': 'scanned'}])
        with self.identity({'user_id': 'account-one', 'nickname': '甲', 'guest': False}):
            cookies = xhs.wait_for_scan(browser, 60)
        self.assertEqual(cookies['web_session'], 'scanned')
        self.assertEqual(browser.launch.call_count, 1, 'the window opens once and stays open while the user scans')
        self.assertEqual(browser.cookies.call_count, 3)

    def test_a_guest_session_is_not_mistaken_for_a_finished_scan(self):
        guest = {'a1': 'fixture', 'web_session': 'guest'}
        browser = self.browser([guest, {'a1': 'fixture', 'web_session': 'scanned'}])
        with self.identity({'guest': True, 'user_id': ''}, {'user_id': 'account-one', 'nickname': '甲', 'guest': False}):
            self.assertEqual(xhs.wait_for_scan(browser, 60)['web_session'], 'scanned')

    def test_waiting_out_without_a_scan_reports_a_timeout_and_stores_nothing(self):
        browser = self.browser([Failure('NEED_LOGIN', 'not scanned')] * 50)
        with patch.object(xhs.time, 'monotonic', side_effect=[0, 999, 999]):
            with self.assertRaises(Failure) as exc:
                xhs.wait_for_scan(browser, 60)
        self.assertEqual(exc.exception.code, 'LOGIN_TIMEOUT')
        self.assertFalse((self.root / 'profiles/default/credentials.json').exists())

    def test_login_stores_the_session_the_scan_produced(self):
        pending = Failure('NEED_LOGIN', 'not scanned yet')
        with patch.object(xhs, 'Browser') as factory, self.identity({'user_id': 'account-one', 'nickname': '甲', 'guest': False}):
            factory.return_value.cookies.side_effect = [pending, {'a1': 'fixture', 'web_session': 'scanned'}]
            result = xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), '--profile', '小号', 'login']))
        self.assertEqual((result['user']['nickname'], result['profile']), ('甲', '小号'))
        self.assertEqual(json.loads((self.root / 'profiles/小号/credentials.json').read_text())['cookies']['web_session'], 'scanned')

    def test_finish_takes_what_is_there_instead_of_waiting(self):
        with patch.object(xhs, 'Browser') as factory, self.identity({'user_id': 'account-one', 'nickname': '甲', 'guest': False}):
            factory.return_value.cookies.return_value = {'a1': 'fixture', 'web_session': 'already-there'}
            xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), 'login', '--finish']))
            factory.return_value.launch.assert_not_called()
            self.assertEqual(factory.return_value.cookies.call_count, 1)


class Accounts(unittest.TestCase):
    """Several accounts on one machine: the risk is state leaking between them."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def login(self, label, account, nickname):
        cookies = self.root / f'{label}.json'
        cookies.write_text(json.dumps({'a1': 'fixture', 'web_session': f'secret-{label}'}))
        def response(url, payload=None, headers=None):
            return {'success': True, 'data': {'user_id': account, 'nickname': nickname, 'guest': False}}
        with patch.object(xhs, 'json_request', side_effect=response), patch.object(xhs.time, 'sleep'):
            return xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), '--profile', label, 'login', '--session-file', str(cookies)]))

    def test_two_accounts_keep_separate_sessions_and_browser_profiles(self):
        self.assertEqual(self.login('工作号', 'account-one', '甲')['user']['nickname'], '甲')
        self.assertEqual(self.login('小号', 'account-two', '乙')['user']['nickname'], '乙')
        first, second = self.root / 'profiles/工作号', self.root / 'profiles/小号'
        self.assertEqual(json.loads((first / 'credentials.json').read_text())['cookies']['web_session'], 'secret-工作号')
        self.assertEqual(json.loads((second / 'credentials.json').read_text())['cookies']['web_session'], 'secret-小号')
        self.assertNotEqual(xhs.Browser(first).connection, xhs.Browser(second).connection)
        self.assertEqual((self.root / 'default-profile').read_text(), '工作号', 'the first verified account becomes the default')

    def test_default_account_is_used_when_no_profile_is_given(self):
        self.login('工作号', 'account-one', '甲')
        self.login('小号', 'account-two', '乙')
        listed = xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), 'profiles', '--set-default', '小号']))
        self.assertEqual(listed['default'], '小号')
        self.assertEqual({p['label']: p['nickname'] for p in listed['profiles']}, {'工作号': '甲', '小号': '乙'})
        self.assertNotIn('secret-', json.dumps(listed), 'the account list must not carry cookies')
        used = []
        def response(url, payload=None, headers=None):
            used.append(headers['cookie'])
            return {'success': True, 'data': {'user_id': 'account-two', 'nickname': '乙', 'guest': False}}
        with patch.object(xhs, 'json_request', side_effect=response), patch.object(xhs.time, 'sleep'):
            status = xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), 'status']))
        self.assertEqual((status['profile'], status['user']['nickname']), ('小号', '乙'))
        self.assertIn('secret-小号', used[0], 'status without --profile must use the default account session')

    def test_setting_a_default_requires_a_verified_login(self):
        with self.assertRaises(Failure) as exc:
            xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), 'profiles', '--set-default', '没登录过']))
        self.assertEqual(exc.exception.code, 'NEED_LOGIN')
        self.assertFalse((self.root / 'default-profile').exists())

    def test_profile_labels_cannot_escape_the_data_directory(self):
        for label in ('../evil', 'a/b', '', '.', 'x' * 33):
            with self.assertRaises(Failure) as exc:
                xhs.profile_path(self.root, label)
            self.assertEqual(exc.exception.code, 'INVALID_INPUT')
        self.assertFalse((self.root.parent / 'evil').exists())

    def test_existing_single_account_install_is_migrated_without_a_new_login(self):
        write_json(self.root / 'credentials.json', {'cookies': {'a1': 'fixture'}, 'user': {'id': 'account-one'}})
        write_json(self.root / 'current-account.json', {'id': 'account-one', 'nickname': '甲'})
        (self.root / 'browser-profile').mkdir()
        (self.root / 'browser-profile/Cookies').write_text('chrome state')
        listed = xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), 'profiles']))
        self.assertEqual(listed['migrated'], 'default')
        self.assertEqual([(p['label'], p['nickname'], p['logged_in']) for p in listed['profiles']], [('default', '甲', True)])
        self.assertEqual((self.root / 'profiles/default/browser-profile/Cookies').read_text(), 'chrome state')
        self.assertFalse((self.root / 'credentials.json').exists())
        self.assertIsNone(xhs.migrate_single_profile(self.root), 'migration must not run twice')

    def test_migration_closes_the_running_browser_before_moving_its_profile(self):
        write_json(self.root / 'credentials.json', {'cookies': {'a1': 'fixture'}, 'user': {'id': 'account-one'}})
        write_json(self.root / 'browser.json', {'port': 1, 'websocket': 'ws://127.0.0.1:1/x'})
        (self.root / 'browser-profile').mkdir()
        (self.root / 'browser-profile/Cookies').write_text('chrome state')
        closed = []
        class Fake:
            def __init__(self, path):
                self.path = path
            def running(self):
                return True
            def close(self):
                closed.append(self.path)
        with patch.object(xhs, 'Browser', Fake):
            self.assertEqual(xhs.migrate_single_profile(self.root), 'default')
        self.assertEqual(closed, [self.root], 'moving a live Chrome user data directory splits the profile')
        self.assertEqual((self.root / 'profiles/default/browser-profile/Cookies').read_text(), 'chrome state')

    def test_closing_the_browser_during_migration_does_not_break_the_move(self):
        write_json(self.root / 'credentials.json', {'cookies': {'a1': 'fixture'}, 'user': {'id': 'account-one'}})
        write_json(self.root / 'browser.json', {'port': 1, 'websocket': 'ws://127.0.0.1:1/x'})
        (self.root / 'browser-profile').mkdir()
        root = self.root
        class Fake:
            def __init__(self, path):
                self.path = path
            def running(self):
                return True
            def close(self):
                (root / 'browser.json').unlink()  # the real close removes its own endpoint file
        with patch.object(xhs, 'Browser', Fake):
            self.assertEqual(xhs.migrate_single_profile(self.root), 'default')
        self.assertTrue((self.root / 'profiles/default/credentials.json').is_file())
        self.assertFalse((self.root / 'profiles/default/browser.json').exists(), 'a closed endpoint is not carried over')

    def test_a_leftover_at_the_old_path_never_overwrites_the_migrated_profile(self):
        write_json(self.root / 'profiles/default/credentials.json', {'cookies': {'a1': 'live'}, 'user': {'id': 'account-one'}})
        (self.root / 'profiles/default/browser-profile').mkdir()
        (self.root / 'profiles/default/browser-profile/Cookies').write_text('live state')
        (self.root / 'browser-profile').mkdir()
        (self.root / 'browser-profile/Cookies').write_text('stale shell')
        self.assertIsNone(xhs.migrate_single_profile(self.root))
        self.assertEqual((self.root / 'profiles/default/browser-profile/Cookies').read_text(), 'live state')

    def test_only_two_accounts_work_at_once(self):
        with xhs.parallel_slot(self.root), xhs.parallel_slot(self.root):
            with self.assertRaises(Failure) as exc:
                with xhs.parallel_slot(self.root):
                    pass
        self.assertEqual(exc.exception.code, 'BUSY')
        with xhs.parallel_slot(self.root):
            pass  # the slots are released again

    def test_the_same_account_cannot_run_twice_at_once(self):
        profile = xhs.profile_path(self.root, 'default')
        with (profile / 'run.lock').open('w') as holder:
            __import__('fcntl').flock(holder, __import__('fcntl').LOCK_EX | __import__('fcntl').LOCK_NB)
            with self.assertRaises(Failure) as exc:
                xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), 'status']))
        self.assertEqual(exc.exception.code, 'BUSY')

    def test_close_all_reports_each_account_and_clears_dead_endpoints(self):
        for label in ('一号', '二号', '三号'):
            write_json(xhs.profile_path(self.root, label) / 'browser.json', {'port': 1, 'websocket': 'ws://127.0.0.1:1/x'})
        xhs.profile_path(self.root, '没开浏览器的号')
        class Fake:
            def __init__(self, profile):
                self.profile = profile
            def close(self):
                if self.profile.name == '二号':
                    raise Failure('NETWORK_ERROR', 'already gone')
                if self.profile.name == '三号':
                    raise Failure('BROWSER_CLOSE_UNCONFIRMED', 'still running')
        with patch.object(xhs, 'Browser', Fake):
            result = xhs.execute(xhs.parser().parse_args(['--data-dir', str(self.root), 'close', '--all']))
        self.assertEqual(result['closed'], ['一号'])
        self.assertEqual(result['already_gone'], ['二号'])
        self.assertEqual([f['profile'] for f in result['failed']], ['三号'])
        self.assertFalse((self.root / 'profiles/二号/browser.json').exists())
        self.assertTrue((self.root / 'profiles/三号/browser.json').exists(), 'an unconfirmed close must not drop the endpoint')

    def test_recall_can_cross_accounts_because_the_material_is_public(self):
        for account, title in (('account-one', '甲号存的 UI 规范'), ('account-two', '乙号存的 UI 调研')):
            library = Library(self.root, account)
            library.save({'id': account.encode().hex()[:24], 'title': title, 'body': 'ui', 'transcript': '',
                          'url': 'https://www.xiaohongshu.com/explore/' + account.encode().hex()[:24], 'type': 'normal'})
            library.close()
        write_json(self.root / 'profiles/甲/current-account.json', {'id': 'account-one'})
        base = ['--data-dir', str(self.root), '--profile', '甲', 'recall', 'UI']
        mine = xhs.execute(xhs.parser().parse_args(base))
        self.assertEqual([i['title'] for i in mine['items']], ['甲号存的 UI 规范'])
        both = xhs.execute(xhs.parser().parse_args([*base, '--all-accounts']))
        self.assertEqual({i['title'] for i in both['items']}, {'甲号存的 UI 规范', '乙号存的 UI 调研'})
        self.assertEqual(both['scope'], 'all_accounts')


if __name__ == '__main__':
    unittest.main()
