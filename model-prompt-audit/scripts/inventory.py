#!/usr/bin/env python3
"""Inventory the global agent configuration that shapes model behavior, as JSON.

Covers the user-level instruction file (following symlinks and @imports one level), rule files,
settings keys that affect the model, and installed plugin skills whose descriptions look like
behavioral guidelines. Secret-looking env values are masked. Nothing is modified.
Usage: inventory.py [--home DIR] [--project DIR]
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys

SECRET = re.compile(r'(^|_)(API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIALS?)$', re.I)
BEHAVIORAL = re.compile(r'(guideline|coding style|coding standard|discipline|mistakes|规范|纪律|准则|风格)', re.I)
IMPORT = re.compile(r'^@(\S+)$', re.M)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def describe(path):
    p = pathlib.Path(path)
    info = {'path': str(p), 'exists': p.exists()}
    if p.is_symlink():
        info['symlink_target'] = str(p.resolve())
    if p.exists() and p.is_file():
        text = p.read_text(encoding='utf-8', errors='replace')
        info.update(bytes=len(text.encode('utf-8')), lines=text.count('\n') + 1, sha256=digest(p))
        imports = [str((p.parent / m).resolve()) for m in IMPORT.findall(text)]
        if imports:
            info['imports'] = imports
    return info


def summarize_settings(data):
    env = data.get('env') or {}
    masked = {k: ('***' if SECRET.search(k) else v) for k, v in env.items()}
    return {
        'model': data.get('model'),
        'effort': data.get('effortLevel'),
        'env': masked,
        'modelSettings': data.get('modelSettings'),
        'enabledPlugins': data.get('enabledPlugins'),
        'outputStyle': data.get('outputStyle'),
    }


def frontmatter(text):
    if not text.startswith('---'):
        return {}
    end = text.find('\n---', 3)
    if end < 0:
        return {}
    meta = {}
    key = None
    for line in text[3:end].splitlines():
        m = re.match(r'^([A-Za-z_-]+):\s*(.*)$', line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            meta[key] = '' if val in ('|', '>') else val
        elif key and line.startswith(' '):
            meta[key] = (meta[key] + ' ' + line.strip()).strip()
    return meta


def enabled_plugins(home):
    """'name@marketplace' keys set to true across settings files."""
    enabled = set()
    for name in ('settings.json', 'settings.local.json'):
        p = home / '.claude' / name
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding='utf-8'))
            except ValueError:
                continue
            enabled |= {k for k, v in (data.get('enabledPlugins') or {}).items() if v}
    return enabled


def plugin_skills(home):
    """SKILL.md files of enabled plugins only (cache layout: plugins/cache/<marketplace>/<plugin>/...)."""
    found = []
    cache = home / '.claude' / 'plugins' / 'cache'
    enabled = enabled_plugins(home)
    roots = [cache / m / pl for key in enabled for pl, _, m in [key.rpartition('@')] if (cache / m / pl).exists()]
    for root in roots:
        for skill in sorted(root.rglob('SKILL.md')):
            if skill.is_symlink() and not skill.exists():
                continue
            try:
                meta = frontmatter(skill.read_text(encoding='utf-8', errors='replace'))
            except OSError:
                continue
            desc = meta.get('description', '')
            found.append({'path': str(skill), 'name': meta.get('name'), 'behavioral': bool(BEHAVIORAL.search(desc)), 'description': desc[:160]})
    return found


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--home', default=str(pathlib.Path.home()))
    ap.add_argument('--project', help='project directory to include its CLAUDE.md / AGENTS.md')
    args = ap.parse_args(argv)
    home = pathlib.Path(args.home)
    claude = home / '.claude'
    files = [describe(claude / 'CLAUDE.md')]
    files += [describe(p) for p in sorted((claude / 'rules').glob('*.md'))] if (claude / 'rules').exists() else []
    files += [describe(p) for p in sorted((claude / 'output-styles').glob('*.md'))] if (claude / 'output-styles').exists() else []
    if args.project:
        proj = pathlib.Path(args.project)
        files += [describe(proj / n) for n in ('CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md') if (proj / n).exists()]
    settings = {}
    for name in ('settings.json', 'settings.local.json'):
        p = claude / name
        if p.exists():
            try:
                settings[name] = summarize_settings(json.loads(p.read_text(encoding='utf-8')))
            except ValueError as exc:
                settings[name] = {'error': f'invalid JSON: {exc}'}
    report = {'files': files, 'settings': settings, 'plugin_skills': plugin_skills(home),
              'total_instruction_bytes': sum(f.get('bytes', 0) for f in files)}
    print(json.dumps(report, indent=1, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
