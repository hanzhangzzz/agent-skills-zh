#!/usr/bin/env python3
"""Offline checks for pinned WeChat routing and trustworthy diagnostics."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import Mock, mock_open, patch

import requests

spec = importlib.util.spec_from_file_location('publish', Path(__file__).with_name('publish.py'))
publish = importlib.util.module_from_spec(spec)
with patch('builtins.open', mock_open(read_data=json.dumps({'wechat': {
    'app_id': 'test-id', 'app_secret': 'do-not-print-this-secret',
}}))):
    spec.loader.exec_module(publish)


class PublishNetworkTests(unittest.TestCase):
    def test_explicit_proxy_ignores_environment_and_no_proxy(self):
        with patch.dict('os.environ', {'HTTPS_PROXY': 'http://wrong:9999', 'NO_PROXY': '*'}):
            session = publish.build_wechat_session({'wechat': {'api_proxy': 'http://127.0.0.1:17897'}})
            settings = session.merge_environment_settings('https://api.weixin.qq.com', {}, False, None, None)
        self.assertFalse(session.trust_env)
        self.assertEqual(settings['proxies'], {'http': 'http://127.0.0.1:17897', 'https': 'http://127.0.0.1:17897'})

    def test_unavailable_proxy_does_not_fall_back_to_reachable_target(self):
        with socket.socket() as target, socket.socket() as unavailable:
            target.bind(('127.0.0.1', 0)); target.listen(); target.settimeout(0.1)
            unavailable.bind(('127.0.0.1', 0))  # Reserved but deliberately not listening.
            proxy = f'http://127.0.0.1:{unavailable.getsockname()[1]}'
            session = publish.build_wechat_session({'wechat': {'api_proxy': proxy}})
            with self.assertRaises(requests.exceptions.ProxyError):
                session.get(f'http://127.0.0.1:{target.getsockname()[1]}/', timeout=1)
            with self.assertRaises(socket.timeout):
                target.accept()

    def test_whitelist_error_reports_wechat_ip_without_ipify(self):
        response = Mock()
        response.json.return_value = {'errcode': 40164, 'errmsg': 'invalid ip 192.0.2.1 ipv6 ::ffff:192.0.2.1'}
        output = io.StringIO()
        with patch.object(publish._session, 'get', return_value=response) as request, contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit):
                publish.get_access_token()
        self.assertEqual(request.call_count, 1)
        self.assertIn('微信实际识别的出口 IP: 192.0.2.1', output.getvalue())
        self.assertNotIn('ipify', output.getvalue())

    def test_proxy_error_never_prints_credential_url_or_retries_direct(self):
        output = io.StringIO()
        with patch.object(publish._session, 'get', side_effect=requests.exceptions.ProxyError('url?secret=do-not-print-this-secret')) as request, contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit):
                publish.get_access_token()
        self.assertEqual(request.call_count, 1)
        self.assertNotIn('do-not-print-this-secret', output.getvalue())
        self.assertIn('不会自动切换出口', output.getvalue())


if __name__ == '__main__':
    unittest.main()
