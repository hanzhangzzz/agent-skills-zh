"""Local storage and browser sessions. No third-party Python packages."""
import base64
import hashlib
import json
import os
import random
import shutil
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class Failure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Failure('REDIRECT_BLOCKED', 'Unexpected redirect; credentials were not forwarded')


def json_request(url, payload=None, headers=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
    request = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code in (461, 471, 429):
            raise Failure('RISK_CONTROL', 'Verification or rate limit required; stop and inspect the dedicated browser') from None
        raise Failure('HTTP_ERROR', f'HTTP {exc.code}; no automatic retry') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise Failure('NETWORK_ERROR', 'Network request failed; no automatic retry') from None
    except (ValueError, UnicodeError):
        raise Failure('INVALID_RESPONSE', 'Expected JSON response') from None


class CDP:
    """Small synchronous WebSocket transport for Chrome CDP, localhost only."""
    def __init__(self, url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'ws' or parsed.hostname not in ('127.0.0.1', 'localhost'):
            raise Failure('INVALID_CDP', 'Only local Chrome connections are allowed')
        self.socket = socket.create_connection((parsed.hostname, parsed.port), timeout=15)
        self.buffer = b''
        self.sequence = 0
        key = base64.b64encode(os.urandom(16)).decode()
        request = (f'GET {parsed.path} HTTP/1.1\r\nHost: {parsed.netloc}\r\nUpgrade: websocket\r\n'
                   f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
        self.socket.sendall(request.encode())
        header = b''
        while b'\r\n\r\n' not in header:
            chunk = self.socket.recv(4096)
            if not chunk or len(header) > 65536:
                self.close()
                raise Failure('CDP_ERROR', 'Invalid browser handshake')
            header += chunk
        head, self.buffer = header.split(b'\r\n\r\n', 1)
        expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        if not head.startswith(b'HTTP/1.1 101') or expected not in head:
            self.close()
            raise Failure('CDP_ERROR', 'Browser rejected WebSocket handshake')

    def read(self, size):
        while len(self.buffer) < size:
            chunk = self.socket.recv(max(4096, size - len(self.buffer)))
            if not chunk:
                raise Failure('CDP_ERROR', 'Browser connection closed')
            self.buffer += chunk
        value, self.buffer = self.buffer[:size], self.buffer[size:]
        return value

    def send(self, payload, opcode=1):
        mask = os.urandom(4)
        size = len(payload)
        header = bytes([0x80 | opcode])
        if size < 126:
            header += bytes([0x80 | size])
        elif size < 65536:
            header += bytes([0x80 | 126]) + struct.pack('!H', size)
        else:
            header += bytes([0x80 | 127]) + struct.pack('!Q', size)
        self.socket.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def receive(self):
        fragments = b''
        while True:
            first, second = self.read(2)
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', self.read(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self.read(8))[0]
            if size > 16 * 1024 * 1024:
                raise Failure('CDP_ERROR', 'Browser message too large')
            mask = self.read(4) if second & 128 else None
            payload = self.read(size)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            opcode = first & 15
            if opcode == 8:
                raise Failure('CDP_ERROR', 'Browser closed connection')
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 10:
                continue
            if opcode not in (0, 1):
                raise Failure('CDP_ERROR', 'Unsupported browser frame')
            fragments += payload
            if len(fragments) > 16 * 1024 * 1024:
                raise Failure('CDP_ERROR', 'Fragmented browser message too large')
            if first & 128:
                return json.loads(fragments)

    def call(self, method, params=None):
        self.sequence += 1
        self.send(json.dumps({'id': self.sequence, 'method': method, 'params': params or {}}).encode())
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            result = self.receive()
            if result.get('id') == self.sequence:
                if 'error' in result:
                    raise Failure('CDP_ERROR', 'Browser command failed')
                return result.get('result', {})
        raise Failure('CDP_ERROR', 'Browser command timed out')

    def close(self):
        self.socket.close()


class Browser:
    def __init__(self, root):
        self.root = root
        self.connection = root / 'browser.json'

    def connect(self):
        if not self.connection.is_file():
            raise Failure('NEED_LOGIN', 'Run login to open the dedicated Chrome profile')
        connection = json.loads(self.connection.read_text())
        version = json_request(f"http://127.0.0.1:{connection['port']}/json/version")
        if version.get('webSocketDebuggerUrl') != connection['websocket']:
            raise Failure('NEED_LOGIN', 'Dedicated browser has changed; run login again')
        return CDP(connection['websocket'])

    def launch(self):
        try:
            cdp = self.connect()
            cdp.close()
            return {'browser': 'already_running'}
        except Failure as exc:
            if exc.code not in ('NEED_LOGIN', 'NETWORK_ERROR'):
                raise
        profile = self.root / 'browser-profile'
        profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' if sys.platform == 'darwin' else shutil.which('google-chrome') or shutil.which('chromium')
        if not chrome or not Path(chrome).is_file():
            raise Failure('MISSING_TOOL', 'Install Google Chrome')
        args = [f'--user-data-dir={profile}', f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', 'https://www.xiaohongshu.com/login']
        if sys.platform == 'darwin':
            subprocess.run(['open', '-g', '-n', '-a', 'Google Chrome', '--args', *args], check=True, capture_output=True)
        else:
            subprocess.Popen([chrome, *args], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                version = json_request(f'http://127.0.0.1:{port}/json/version')
                write_json(self.connection, {'port': port, 'websocket': version['webSocketDebuggerUrl']})
                return {'browser': 'opened', 'next': 'Log in manually, then run login --finish'}
            except Failure:
                time.sleep(0.3)
        raise Failure('BROWSER_START_FAILED', 'Chrome did not expose its dedicated debugging endpoint; do not close other browsers')

    def cookies(self):
        cdp = self.connect()
        try:
            values = cdp.call('Storage.getCookies').get('cookies', [])
            cookies = {c['name']: c['value'] for c in values if c['domain'].lstrip('.') == 'xiaohongshu.com' or c['domain'].endswith('.xiaohongshu.com')}
            if not cookies.get('a1') or not cookies.get('web_session'):
                raise Failure('NEED_LOGIN', 'Complete login in the dedicated browser')
            return cookies
        finally:
            cdp.close()

    def close(self):
        cdp = self.connect()
        acknowledged = False
        try:
            cdp.call('Browser.close')
            acknowledged = True
        except (Failure, OSError) as exc:
            if isinstance(exc, Failure) and exc.code != 'CDP_ERROR':
                raise
            pass  # Chrome can close the transport before acknowledging Browser.close.
        finally:
            cdp.close()
        if not acknowledged:
            try:
                check = self.connect()
                check.close()
            except Failure as exc:
                if exc.code != 'NETWORK_ERROR':
                    raise
            else:
                raise Failure('BROWSER_CLOSE_UNCONFIRMED', 'Dedicated browser is still running')
        self.connection.unlink(missing_ok=True)


class Library:
    def __init__(self, root, account):
        self.directory = root / 'accounts' / hashlib.sha256(account.encode()).hexdigest()[:20]
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.directory / 'library.sqlite')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,transcript TEXT NOT NULL DEFAULT '',url TEXT NOT NULL,type TEXT NOT NULL,updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS refs(id TEXT PRIMARY KEY,token TEXT NOT NULL,source TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS searches(query TEXT NOT NULL,created REAL NOT NULL,items TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY,search_id TEXT NOT NULL,used REAL NOT NULL);
        ''')

    def search_session(self, query, sort, kind, ttl=600):
        """Reuse one platform search_id per (query, sort, kind) so later pages continue the same result set."""
        key, now = json.dumps([query, sort, kind], ensure_ascii=False), time.time()
        self.db.execute('DELETE FROM sessions WHERE used<?', (now - ttl,))
        row = self.db.execute('SELECT search_id FROM sessions WHERE key=?', (key,)).fetchone()
        if row:
            self.db.execute('UPDATE sessions SET used=? WHERE key=?', (now, key))
            self.db.commit()
            return row['search_id'], False
        number = (int(now * 1000) << 64) + random.randint(0, 2147483646)
        search_id = ''
        while number:
            number, digit = divmod(number, 36)
            search_id = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[digit] + search_id
        self.db.execute('INSERT INTO sessions VALUES(?,?,?)', (key, search_id, now))
        self.db.commit()
        return search_id, True

    def search_record(self, query, items):
        self.db.execute('INSERT INTO searches VALUES(?,?,?)', (query, time.time(), json.dumps(items, ensure_ascii=False)))
        for item in items:
            self.db.execute('INSERT OR REPLACE INTO refs VALUES(?,?,?)', (item['id'], item.get('xsec_token', ''), 'pc_search'))
        self.db.commit()

    def reference(self, note_id):
        row = self.db.execute('SELECT token,source FROM refs WHERE id=?', (note_id,)).fetchone()
        return dict(row) if row else {'token': '', 'source': 'pc_feed'}

    def save(self, note):
        self.db.execute('INSERT INTO notes VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,transcript=excluded.transcript,url=excluded.url,type=excluded.type,updated=excluded.updated',
                        (note['id'], note['title'], note['body'], note.get('transcript', ''), note['url'], note['type'], time.time()))
        self.db.commit()

    def recall(self, query, limit):
        terms = query.split()
        if not terms:
            raise Failure('INVALID_INPUT', 'Recall query must not be empty')
        clauses, args = [], []
        for term in terms:
            escaped = term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            clauses.append("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR transcript LIKE ? ESCAPE '\\')")
            args.extend(['%' + escaped + '%'] * 3)
        rows = self.db.execute('SELECT * FROM notes WHERE ' + ' OR '.join(clauses) + ' ORDER BY updated DESC LIMIT ?', [*args, limit])
        return [dict(row) for row in rows]

    def close(self):
        self.db.close()
