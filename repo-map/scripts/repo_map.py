#!/usr/bin/env python3
"""本地 git 仓库地图（repo-map）：扫描、增量缓存、名称解析、定时自愈。

用法:
  repo_map.py scan            强制全量重扫（重新分析所有仓库）
  repo_map.py resolve <词>    解析名称/关键词 → 路径、读写角色与实时检出状态（自动增量同步）
  repo_map.py list            列出全部仓库（自动增量同步）
  repo_map.py sync            静默增量同步 + 重析未成型仓库（供定时任务调用）
  repo_map.py schedule on [间隔秒]   注册 macOS launchd 定时增量同步（默认 3600s）
  repo_map.py schedule off           注销定时任务
  repo_map.py schedule status        查看定时任务状态（未开启时 exit 3）

配置: ~/.claude/repo-map.config.json
  {"scan_roots": ["~/code"], "self_emails": ["you@example.com"],
   "trusted_hosts": ["gitlab.your-org.com"]}
缓存: ~/.claude/repo-map-cache.json —— 纯产物，勿手工编辑，删除后自动重建。

角色判定（读写边界的证据链）:
  按顺序首中即停：有本人 commit → 自研·可写；无 remote（且无本人 commit）→ 本地·可写（不存在上游，谈不上第三方）；
  remote host 在 trusted_hosts → 协作·可写；其余 → 第三方·只读。

一致性维护：resolve/list/sync 都先做低成本检查（find .git 清单 vs 缓存路径集合），
只对差集做增量分析与剪枝。sync 额外重析"未成型仓库"（无 remote 或无提交）——
刚 git init 的新仓库会被记成本地·可写且无摘要，等它配好远端/首次提交后必须复查。
不开定时任务时，这套自愈只在用户手动跑 resolve/list 的那一刻发生。
"""
import json
import os
import plistlib
import re
import subprocess
import sys
import time
from pathlib import Path

CONFIG_PATH = Path.home() / '.claude' / 'repo-map.config.json'
CACHE_PATH = Path.home() / '.claude' / 'repo-map-cache.json'
MAXDEPTH = 6
SKIP_DIRS = {'node_modules', 'venv', '.venv', 'vendor', '__pycache__',
             'dist', 'build', 'target', 'Library'}

LABEL = 'com.claude-code.repo-map-sync'
PLIST_PATH = Path.home() / 'Library' / 'LaunchAgents' / f'{LABEL}.plist'
SYNC_LOG = Path.home() / '.claude' / 'logs' / 'repo-map-sync.log'
DEFAULT_INTERVAL = 3600
MIN_INTERVAL = 300


def fail(msg):
    print(f'repo-map 错误: {msg}', file=sys.stderr)
    sys.exit(1)


def load_config():
    if not CONFIG_PATH.exists():
        fail(f'缺少配置 {CONFIG_PATH}，示例: '
             '{"scan_roots": ["~/code"], "self_emails": ["you@example.com"], '
             '"trusted_hosts": ["gitlab.your-org.com"]}')
    cfg = json.loads(CONFIG_PATH.read_text())
    roots = [Path(r).expanduser() for r in cfg.get('scan_roots', [])]
    if not roots:
        fail('配置中 scan_roots 为空')
    return {'scan_roots': roots,
            'self_emails': [e for e in cfg.get('self_emails', []) if e],
            'trusted_hosts': set(cfg.get('trusted_hosts', []))}


def find_repo_paths(roots):
    """逐层下探找仓库根：目录含 .git 即收录并停止下探。

    仓库内部（含 .git/objects）完全不遍历，嵌套仓库（子模块/vendor）天然剔除。
    """
    found = set()

    def walk(d, depth):
        try:
            entries = list(os.scandir(d))
        except OSError:
            return
        if any(e.name == '.git' for e in entries):
            found.add(d)
            return
        if depth >= MAXDEPTH:
            return
        for e in entries:
            if not e.is_dir(follow_symlinks=False):
                continue
            if e.name.startswith('.') or e.name in SKIP_DIRS:
                continue
            walk(e.path, depth + 1)

    for root in roots:
        if not root.exists():
            print(f'警告: 扫描根不存在，跳过: {root}', file=sys.stderr)
            continue
        walk(str(root), 1)
    return found


def git(path, *args):
    try:
        r = subprocess.run(['git', '-C', path, *args],
                           capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, OSError):
        return ''
    return r.stdout.strip() if r.returncode == 0 else ''


def readme_summary(path):
    for name in ('README.md', 'readme.md', 'README.rst', 'README'):
        f = Path(path) / name
        if not f.is_file():
            continue
        for line in f.read_text(errors='replace').splitlines():
            text = line.strip().lstrip('#').strip()
            if text:
                return text[:80]
        return ''
    return ''


def remote_host(remote):
    m = re.search(r'^(?:\w+://)?(?:[^@/]+@)?([^:/]+)', remote)
    return m.group(1) if m else ''


def decide_role(path, remote, cfg):
    if any(git(path, 'log', '--all', '-1', f'--author={e}', '--format=%H')
           for e in cfg['self_emails']):
        return '自研·可写'
    if not remote:
        return '本地·可写'
    if remote_host(remote) in cfg['trusted_hosts']:
        return '协作·可写'
    return '第三方·只读'


def analyze_repo(path, cfg):
    remote = git(path, 'remote', 'get-url', 'origin')
    aliases = {Path(path).name.lower()}
    m = re.search(r'[/:]([^/:]+?)(?:\.git)?$', remote) if remote else None
    if m:
        aliases.add(m.group(1).lower())
    return {
        'name': Path(path).name,
        'path': path,
        'role': decide_role(path, remote, cfg),
        'remote': remote,
        'last_active': git(path, 'log', '-1', '--format=%cs'),
        'summary': readme_summary(path),
        'aliases': sorted(aliases),
    }


def write_cache(repos):
    """原子替换：hook 与定时任务并发时，读方绝不会看到半个文件。"""
    tmp = CACHE_PATH.parent / f'{CACHE_PATH.name}.{os.getpid()}.tmp'
    tmp.write_text(json.dumps(
        {'updated': time.strftime('%Y-%m-%d %H:%M:%S'), 'repos': repos},
        ensure_ascii=False, indent=1))
    os.replace(tmp, CACHE_PATH)


def sync(cfg, force=False, recheck_unsettled=False):
    old = (json.loads(CACHE_PATH.read_text()).get('repos', {})
           if CACHE_PATH.exists() else {})
    current = find_repo_paths(cfg['scan_roots'])
    kept = {} if force else {p: r for p, r in old.items() if p in current}
    if recheck_unsettled:
        # 无 remote 或无提交 = 仓库还没定型，重析一次（成本仅几个仓库）
        kept = {p: r for p, r in kept.items()
                if r.get('remote') and r.get('last_active')}
    fresh = {p: analyze_repo(p, cfg)
             for p in sorted(current - set(kept))}
    repos = {**kept, **fresh}
    removed = sorted(set(old) - current)
    if fresh or removed or force or not CACHE_PATH.exists():
        write_cache(repos)
    return repos, len(fresh), len(removed)


def fmt(r):
    summary = f' —— {r["summary"]}' if r['summary'] else ''
    return (f'{r["name"]} → {r["path"]}'
            f'（{r["role"]}，最近活跃 {r["last_active"] or "?"}）{summary}')


def live_status(path):
    """resolve 命中仓库的实时检出状态：分支、相对 origin/master 位置、工作区。

    只读不 fetch（基于上次 fetch 的远端引用）；仓库损坏/超时返回空串，不阻断解析。
    意义：跨仓库读取时，工作区可能停在旧任务分支——非 master 检出必须显式警告，
    否则读取方会把分支残留当作该仓库的现状。
    """
    branch = git(path, 'rev-parse', '--abbrev-ref', 'HEAD')
    if not branch:
        return ''
    master = next((m for m in ('master', 'main')
                   if git(path, 'rev-parse', '--verify', '-q',
                          f'refs/remotes/origin/{m}')), '')
    parts = [f'分支 {branch}']
    if master:
        counts = git(path, 'rev-list', '--left-right', '--count',
                     f'origin/{master}...HEAD')
        if counts:
            behind, ahead = (counts.split() + ['?', '?'])[:2]
            parts.append(f'vs origin/{master}: ahead {ahead} / behind {behind}'
                         '（基于上次 fetch）')
    dirty = git(path, '--no-optional-locks', 'status', '--porcelain',
                '--untracked-files=no')
    if dirty:
        parts.append(f'未提交改动 {len(dirty.splitlines())} 处')
    line = '  状态: ' + ' | '.join(parts)
    if master and branch != master:
        line += (f'\n  ⚠️ 非 {master} 检出，工作区可能是任务分支残留——跨仓库读取请用 '
                 f'`git -C {path} show origin/{master}:<相对路径>`，'
                 '或先在该仓库归位（repo-tidy）')
    return line


def cmd_resolve(cfg, keyword):
    repos, _, _ = sync(cfg)
    kw = keyword.lower()
    exact = [r for r in repos.values() if kw in r['aliases']]
    partial = [r for r in repos.values()
               if r not in exact and any(kw in a for a in r['aliases'])]
    fuzzy = [r for r in repos.values()
             if r not in exact + partial and kw in r['summary'].lower()]
    hits = exact + partial + fuzzy
    if not hits:
        print(f'未命中 "{keyword}"。可能原因: 仓库在扫描根之外'
              f'（编辑 {CONFIG_PATH} 的 scan_roots 后重试），或换个关键词/用 list 全量查看。')
        sys.exit(2)
    for r in hits[:10]:
        print(fmt(r))
        status = live_status(r['path'])
        if status:
            print(status)


def cmd_sync(cfg):
    t0 = time.time()
    repos, added, removed = sync(cfg, recheck_unsettled=True)
    print(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] 增量同步完成: {len(repos)} 个仓库'
          f'（新增/重析 {added}，剪枝 {removed}），耗时 {time.time() - t0:.1f}s',
          flush=True)


# ---------- 定时任务（macOS launchd）----------

def launchctl(*args):
    r = subprocess.run(['launchctl', *args], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def require_macos():
    if sys.platform != 'darwin':
        fail(f'schedule 仅支持 macOS（launchd），当前平台 {sys.platform}。'
             '其他平台请用 cron 调用本脚本的 sync 子命令。')


def python_bin():
    """写进 plist 的解释器：用执行 schedule on 的这个解释器的绝对路径。

    launchd 不继承 shell PATH、不跑 pyenv 初始化，所以不能写 `python3`；
    也不能写 /usr/bin/python3：它在 launchd 下会被 macOS TCC 拒绝读 ~/Desktop、
    ~/Documents（Errno 1 Operation not permitted），仓库放在这些目录时同步全废。
    """
    exe = sys.executable
    if exe.startswith(('/usr/bin/', '/Library/Developer/CommandLineTools/')):
        print(f'警告: 当前解释器 {exe} 是系统 python，launchd 下读不了 ~/Desktop、'
              '~/Documents；仓库在这些目录时请改用 pyenv/Homebrew 的 python3 执行 schedule on。',
              file=sys.stderr)
    return exe


def schedule_on(interval):
    require_macos()
    if interval < MIN_INTERVAL:
        fail(f'间隔 {interval}s 过小（最小 {MIN_INTERVAL}s）；增量同步虽轻，'
             '也不该每几秒扫一遍磁盘。')
    SYNC_LOG.parent.mkdir(parents=True, exist_ok=True)
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PLIST_PATH, 'wb') as f:
        plistlib.dump({
            'Label': LABEL,
            'ProgramArguments': [python_bin(),
                                 str(Path(__file__).resolve()), 'sync'],
            'StartInterval': interval,
            'RunAtLoad': True,
            'StandardOutPath': str(SYNC_LOG),
            'StandardErrorPath': str(SYNC_LOG),
        }, f)
    domain = f'gui/{os.getuid()}'
    launchctl('bootout', f'{domain}/{LABEL}')  # 幂等：先卸旧，忽略未加载时的报错
    code, out = launchctl('bootstrap', domain, str(PLIST_PATH))
    if code != 0:
        fail(f'launchctl bootstrap 失败（exit {code}）: {out or "无输出"}')
    print(f'定时增量同步已开启: 每 {interval}s 一次（RunAtLoad，注册即跑一次）\n'
          f'  任务: {LABEL}\n  plist: {PLIST_PATH}\n  日志: {SYNC_LOG}')


def schedule_off():
    require_macos()
    code, out = launchctl('bootout', f'gui/{os.getuid()}/{LABEL}')
    if code != 0 and 'no such process' not in out.lower():
        print(f'警告: launchctl bootout 返回 {code}: {out}', file=sys.stderr)
    existed = PLIST_PATH.exists()
    if existed:
        PLIST_PATH.unlink()
    print('定时增量同步已关闭' + ('' if existed else '（原本未注册）'))


def schedule_status():
    require_macos()
    code, out = launchctl('print', f'gui/{os.getuid()}/{LABEL}')
    loaded = code == 0
    if not loaded and not PLIST_PATH.exists():
        print('定时增量同步: 未开启')
        sys.exit(3)
    interval = re.search(r'run interval\s*=\s*(\d+)', out)
    state = re.search(r'state\s*=\s*([^\n]+)', out)
    last = re.search(r'last exit (?:code|status)\s*=\s*(\S+)', out)
    print(f'定时增量同步: {"已开启" if loaded else "plist 存在但未加载（需重新 on）"}'
          + (f'，间隔 {interval.group(1)}s' if interval else ''))
    print(f'  任务: {LABEL}（state={state.group(1) if state else "?"}，'
          f'last exit={last.group(1) if last else "?"}）')
    print(f'  plist: {PLIST_PATH}')
    if CACHE_PATH.exists():
        c = json.loads(CACHE_PATH.read_text())
        print(f'  缓存: {c.get("updated", "?")}，{len(c.get("repos", {}))} 个仓库')
    if SYNC_LOG.exists():
        tail = SYNC_LOG.read_text(errors='replace').strip().splitlines()[-1:]
        print(f'  日志: {SYNC_LOG}' + (f'\n    最近: {tail[0]}' if tail else ''))
    if not loaded:
        sys.exit(3)


def cmd_schedule(argv):
    action = argv[2] if len(argv) > 2 else ''
    if action == 'on':
        try:
            interval = int(argv[3]) if len(argv) > 3 else DEFAULT_INTERVAL
        except ValueError:
            fail(f'间隔必须是整数秒，收到: {argv[3]}')
        schedule_on(interval)
    elif action == 'off':
        schedule_off()
    elif action == 'status':
        schedule_status()
    else:
        fail('用法: schedule on [间隔秒] | schedule off | schedule status')


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in (
            'scan', 'resolve', 'list', 'sync', 'schedule'):
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == 'schedule':  # 不依赖配置，装/卸定时任务与扫描根无关
        return cmd_schedule(sys.argv)
    cfg = load_config()
    if cmd == 'scan':
        t0 = time.time()
        repos, added, removed = sync(cfg, force=True)
        print(f'全量重扫完成: {len(repos)} 个仓库'
              f'（重析 {added}，剪枝 {removed}），耗时 {time.time() - t0:.1f}s')
    elif cmd == 'sync':
        cmd_sync(cfg)
    elif cmd == 'resolve':
        if len(sys.argv) < 3:
            fail('用法: resolve <名称或关键词>')
        cmd_resolve(cfg, sys.argv[2])
    else:
        repos, _, _ = sync(cfg)
        for r in sorted(repos.values(),
                        key=lambda x: x['last_active'] or '', reverse=True):
            print(fmt(r))


if __name__ == '__main__':
    main()
