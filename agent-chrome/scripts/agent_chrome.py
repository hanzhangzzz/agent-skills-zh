#!/usr/bin/env python3
"""agent-chrome: one launcher for every logged-in Chrome profile used by AI automation.

Each profile is a user-data-dir under ROOT, launched with the real Google Chrome on a
fixed CDP port from the registry. Agents attach with `--cdp <port>` / connectOverCDP and
never start their own browser. Standard library only.
"""
import argparse
import json
import os
import plistlib
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.abspath(os.path.expanduser(os.environ.get("AGENT_CHROME_ROOT", "~/.chrome-profiles")))
REGISTRY = os.path.join(ROOT, "registry.json")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_APP = CHROME.split("/Contents/")[0]
MAIN_COOKIES = os.path.expanduser("~/Library/Application Support/Google/Chrome/Default/Cookies")
PORTS = range(19300, 19400)
NAME_RE = re.compile(r"^[a-z0-9]+-[A-Za-z0-9_一-鿿-]+$")
HERE = os.path.dirname(os.path.realpath(__file__))
HELPER = os.path.join(HERE, "chrome_helper.mjs")


class Fail(Exception):
    pass


# ---------- registry ----------
def load():
    if not os.path.exists(REGISTRY):
        return {"version": 1, "site_defaults": {}, "profiles": {}}
    with open(REGISTRY, encoding="utf-8") as f:
        return json.load(f)


def save(reg):
    os.makedirs(ROOT, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=ROOT, prefix=".registry-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, REGISTRY)


def resolve(reg, key):
    if key in reg["profiles"]:
        return key
    if key in reg["site_defaults"]:
        return reg["site_defaults"][key]
    raise Fail(f"未登记的 profile 或站点: {key}（先 add，或 ls 查看）")


def abs_dir(p):
    return os.path.join(ROOT, p["dir"])


# ---------- processes ----------
def chrome_procs(udd):
    """All processes whose command line carries exactly --user-data-dir=<udd>."""
    out = subprocess.run(["ps", "-axww", "-o", "pid=,command="], capture_output=True, text=True).stdout
    flag = re.compile(re.escape(f"--user-data-dir={udd}") + r"/?(\s|$)")  # exact dir, not foo vs foo-accounts
    procs = []
    for line in out.splitlines():
        pid, _, cmd = line.strip().partition(" ")
        if not flag.search(cmd):
            continue
        procs.append((int(pid), cmd))
    return procs


def main_proc(udd):
    for pid, cmd in chrome_procs(udd):
        exe = cmd.split(" --", 1)[0].lower()
        if "--type=" in cmd or "crashpad" in exe or "chrom" not in exe:
            continue
        return pid, cmd
    return None, None


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def lock_pid(udd):
    try:
        target = os.readlink(os.path.join(udd, "SingletonLock"))
    except OSError:
        return None
    m = re.search(r"-(\d+)$", target)
    return int(m.group(1)) if m else None


def version(port, timeout=1.0):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=timeout) as r:
            return json.load(r)
    except (OSError, ValueError):
        return None


def listener(port):
    """pid listening on 127.0.0.1:<port> (Chrome 156 no longer writes DevToolsActivePort for fixed ports)."""
    out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else None


def state(p):
    """(running, pid, cmd). Running = this dir's main Chrome owns the registered port and /json/version answers."""
    pid, cmd = main_proc(abs_dir(p))
    running = bool(pid) and listener(p["port"]) == pid and version(p["port"]) is not None
    return running, pid, cmd


def port_busy(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


# ---------- commands ----------
def cmd_ls(reg, a):
    rows = [("NAME", "PORT", "SITES", "DAEMON", "RUNNING", "DIR")]
    for name, p in sorted(reg["profiles"].items()):
        running = state(p)[0]
        rows.append((name, str(p["port"]), ",".join(p.get("sites", [])), "yes" if p.get("daemon") else "no",
                     "yes" if running else "no", p["dir"]))
    defaults = ", ".join(f"{k}->{v}" for k, v in sorted(reg["site_defaults"].items()))
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip())
    if defaults:
        print(f"site_defaults: {defaults}")


def detect_keychain(udd):
    """Playwright-created profiles encrypt cookies with the mock keychain; real Chrome uses the macOS one."""
    rows = []
    for sub in sorted(os.listdir(udd)) if os.path.isdir(udd) else []:
        db = os.path.join(udd, sub, "Cookies")
        if not os.path.isfile(db):
            continue
        with tempfile.TemporaryDirectory() as t:
            cp = os.path.join(t, "c.db")
            shutil.copyfile(db, cp)
            con = sqlite3.connect(cp)
            rows += [{"host_key": h, "ev": ev} for h, ev in con.execute(
                "select host_key, hex(encrypted_value) from cookies where length(encrypted_value) > 3 limit 5")]
            con.close()
    if not rows:
        return "real"
    r = subprocess.run(["node", HELPER, "detect"], input=json.dumps(rows), capture_output=True, text=True)
    if r.returncode != 0:
        raise Fail(f"keychain 检测失败: {r.stderr.strip()}")
    return r.stdout.strip()


def last_used_profile(udd):
    """Chrome shows a profile picker (no page, nothing to drive) when a dir holds several profiles; pin one."""
    try:
        with open(os.path.join(udd, "Local State"), encoding="utf-8") as f:
            return json.load(f).get("profile", {}).get("last_used") or "Default"
    except (OSError, ValueError):
        return "Default"


def cmd_add(reg, a):
    if not NAME_RE.match(a.name):
        raise Fail(f"名字不合规: {a.name}（必须是 <站点>-<别名>，首个账号用 main，如 x-main）")
    if a.name in reg["profiles"]:
        raise Fail(f"已存在: {a.name}")
    used = {p["port"] for p in reg["profiles"].values()}
    port = next((x for x in PORTS if x not in used and not port_busy(x)), None)
    if port is None:
        raise Fail("端口池 19300-19399 已用完")
    d = a.dir or a.name
    udd = os.path.join(ROOT, d)
    os.makedirs(udd, mode=0o700, exist_ok=True)
    p = {"dir": d, "port": port, "sites": [s for s in (a.sites or "").split(",") if s],
         "daemon": a.daemon, "keychain": detect_keychain(udd), "profile_directory": last_used_profile(udd),
         "note": a.note or ""}
    reg["profiles"][a.name] = p
    if a.default_for:
        reg["site_defaults"][a.default_for] = a.name
    save(reg)
    print(json.dumps({"profile": a.name, **p}, ensure_ascii=False))


def cmd_resolve(reg, a):
    print(resolve(reg, a.target))


def open_window(ws, url):
    r = subprocess.run(["node", HELPER, "window", "--ws", ws, "--url", url or "about:blank"], capture_output=True, text=True)
    if r.returncode != 0:
        raise Fail(f"开窗口失败: {r.stderr.strip()}")


def up(reg, target, headless=True, url=None):
    name = resolve(reg, target)
    p = reg["profiles"][name]
    udd, port = abs_dir(p), p["port"]
    running, pid, cmd = state(p)
    if running:
        is_headless = "--headless" in cmd
        if is_headless and not headless:
            raise Fail(f"{name} 正以 headless 运行（pid {pid}），要有头窗口先 down {name}")
        v = version(port)
        if url:
            open_window(v["webSocketDebuggerUrl"], url)
        return {"profile": name, "dir": udd, "port": port, "ws": v["webSocketDebuggerUrl"], "pid": pid,
                "headless": is_headless, "reused": True}
    if pid:
        raise Fail(f"{name} 的目录正被另一个 Chrome 占用（pid {pid}，不在端口 {port} 上），不会杀它；先让占用方退出")
    lp = lock_pid(udd)
    if lp and alive(lp):
        raise Fail(f"{name} 的 SingletonLock 指向活着的进程 pid {lp}，不会杀它；先让占用方退出")
    if port_busy(port):
        raise Fail(f"端口 {port} 已被其他进程监听，{name} 无法启动")
    if not os.path.exists(CHROME):
        raise Fail(f"找不到正式版 Chrome: {CHROME}")
    os.makedirs(udd, mode=0o700, exist_ok=True)
    args = [f"--user-data-dir={udd}", f"--profile-directory={p.get('profile_directory', 'Default')}",
            f"--remote-debugging-port={port}", "--no-first-run",
            "--no-default-browser-check", "--disable-background-networking",
            "--disable-blink-features=AutomationControlled"]
    if p.get("keychain") == "mock":
        args.append("--use-mock-keychain")
    if headless:
        subprocess.Popen([CHROME, "--headless=new", f"--user-agent={headless_ua()}", "--window-size=1440,900", *args,
                          url or "about:blank"], start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        # Any window Chrome opens itself steals focus, even with `open -g`; start windowless, then add one via CDP.
        subprocess.run(["open", "-g", "-n", "-a", CHROME_APP, "--args", "--no-startup-window", *args], check=True)
    deadline = time.time() + 20
    while time.time() < deadline:
        v = version(port)
        if v:
            pid, _ = main_proc(udd)
            if not headless:
                open_window(v["webSocketDebuggerUrl"], url)
            return {"profile": name, "dir": udd, "port": port, "ws": v["webSocketDebuggerUrl"], "pid": pid,
                    "headless": headless, "reused": False}
        time.sleep(0.3)
    raise Fail(f"{name} 启动后 20s 内端口 {port} 不可达")


def headless_ua():
    """Headless Chrome announces itself as HeadlessChrome; present the same UA as the headed browser."""
    with open(os.path.join(CHROME_APP, "Contents/Info.plist"), "rb") as f:
        major = plistlib.load(f)["CFBundleShortVersionString"].split(".")[0]
    return (f"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{major}.0.0.0 Safari/537.36")


def cmd_up(reg, a):
    print(json.dumps(up(reg, a.target, a.headless, a.url), ensure_ascii=False))


def down(reg, target, force=False):
    name = resolve(reg, target)
    p = reg["profiles"][name]
    if p.get("daemon") and not force:
        raise Fail(f"{name} 标记为 daemon，常驻不关；确需关闭加 --force")
    udd = abs_dir(p)
    pid, _ = main_proc(udd)
    if not pid:
        return {"profile": name, "stopped": False, "note": "未在运行"}
    v = version(p["port"]) if listener(p["port"]) == pid else None
    if v:  # graceful: Browser.close flushes the cookie store, SIGTERM drops the last ~30s of changes
        subprocess.run(["node", HELPER, "close", "--ws", v["webSocketDebuggerUrl"]], capture_output=True, timeout=15)
        deadline = time.time() + 10
        while alive(pid) and time.time() < deadline:
            time.sleep(0.2)
    if alive(pid):
        os.kill(pid, signal.SIGTERM)
        deadline = time.time() + 5
        while alive(pid) and time.time() < deadline:
            time.sleep(0.2)
    killed = alive(pid)
    if killed:
        os.kill(pid, signal.SIGKILL)
    deadline = time.time() + 5  # helpers exit once the browser is gone
    while chrome_procs(udd) and time.time() < deadline:
        time.sleep(0.2)
    for cpid, _ in chrome_procs(udd):
        try:
            os.kill(cpid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    return {"profile": name, "stopped": True, "pid": pid, "sigkill": killed}


def cmd_down(reg, a):
    print(json.dumps(down(reg, a.target, a.force), ensure_ascii=False))


def cmd_status(reg, a):
    names = [resolve(reg, a.target)] if a.target else sorted(reg["profiles"])
    out = []
    for name in names:
        p = reg["profiles"][name]
        running, pid, cmd = state(p)
        started = None
        if pid:
            started = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"}).stdout.strip()
        out.append({"profile": name, "running": running, "pid": pid, "port": p["port"],
                    "headless": ("--headless" in cmd) if cmd else None, "started": started,
                    "occupied_by_other": bool(pid) and not running})
    print(json.dumps(out[0] if a.target else out, ensure_ascii=False, indent=None if a.target else 1))


def cmd_seed(reg, a):
    if not a.from_main:
        raise Fail("目前只支持 --from-main")
    domains = [d.strip().lstrip(".") for d in a.domains.split(",") if d.strip()]
    if not domains:
        raise Fail("--domains 不能为空")
    if not os.path.exists(MAIN_COOKIES):
        raise Fail(f"找不到主 Chrome cookie 库: {MAIN_COOKIES}")
    name = resolve(reg, a.target)
    with tempfile.TemporaryDirectory(prefix="agent-chrome-seed-") as t:
        cp = os.path.join(t, "Cookies")
        shutil.copyfile(MAIN_COOKIES, cp)  # read-only use of the main profile: copy, never open in place
        where = " or ".join(["host_key = ? or host_key like ?"] * len(domains))
        params = [x for d in domains for x in (d, "%." + d)]
        con = sqlite3.connect(cp)
        con.row_factory = sqlite3.Row
        rows = [dict(r) for r in con.execute(
            "select host_key, name, path, is_secure, is_httponly, expires_utc, has_expires, is_persistent, "
            "samesite, priority, top_frame_site_key, hex(encrypted_value) as ev, value "
            f"from cookies where {where}", params)]
        con.close()
        rows = [r for r in rows if not r["top_frame_site_key"]]  # skip partitioned cookies
        if not rows:
            raise Fail(f"主 Chrome 里没有这些域名的 cookie: {','.join(domains)}")
        info = up(reg, name, headless=True)
        try:
            r = subprocess.run(["node", HELPER, "seed", "--ws", info["ws"]],
                               input=json.dumps(rows), capture_output=True, text=True)
        finally:
            if not info["reused"]:
                down(reg, name, force=True)
    if r.returncode != 0:
        raise Fail(f"导入失败: {r.stderr.strip()}")
    res = json.loads(r.stdout)
    print(json.dumps({"profile": name, "domains": domains, "found": len(rows), **res}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(prog="agent_chrome.py", description=__doc__.split("\n")[0])
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("ls")
    x = sp.add_parser("add")
    x.add_argument("name")
    x.add_argument("--sites")
    x.add_argument("--dir")
    x.add_argument("--daemon", action="store_true")
    x.add_argument("--note")
    x.add_argument("--default-for")
    x = sp.add_parser("resolve")
    x.add_argument("target")
    x = sp.add_parser("up")
    x.add_argument("target")
    x.add_argument("--headless", action="store_true")
    x.add_argument("--url")
    x = sp.add_parser("down")
    x.add_argument("target")
    x.add_argument("--force", action="store_true")
    x = sp.add_parser("status")
    x.add_argument("target", nargs="?")
    x = sp.add_parser("seed")
    x.add_argument("target")
    x.add_argument("--from-main", action="store_true")
    x.add_argument("--domains", required=True)
    a = ap.parse_args()
    try:
        globals()[f"cmd_{a.cmd}"](load(), a)
    except Fail as e:
        print(f"agent_chrome: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
