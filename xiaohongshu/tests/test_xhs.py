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
        self.assertFalse((self.root / 'credentials.json').exists())

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
        self.assertEqual((self.root / 'credentials.json').stat().st_mode & 0o777, 0o600)

    def test_share_redirect_rejects_foreign_destination_before_request(self):
        class Opener:
            def open(self, *args, **kwargs):
                raise xhs.Redirect('https://example.com/explore/' + NID)
        with patch.object(xhs.urllib.request, 'build_opener', return_value=Opener()) as build:
            with self.assertRaises(Failure) as error:
                xhs.note_reference('https://xhslink.com/fixture')
            self.assertEqual(build.call_count, 1)
            self.assertEqual(error.exception.code, 'INVALID_INPUT')


if __name__ == '__main__':
    unittest.main()
