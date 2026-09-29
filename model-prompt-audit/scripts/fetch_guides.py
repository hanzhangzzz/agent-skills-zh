#!/usr/bin/env python3
"""Fetch the current official prompting guides for a Claude model, live, into a local directory.

Never answers from memory: every page comes from the docs site's llms.txt index at run time.
Usage:
  fetch_guides.py --model claude-opus-5-5 --out /tmp/guides
  fetch_guides.py --model claude-opus-5-5 --list
"""
import argparse
import json
import pathlib
import re
import sys
import urllib.request

DEFAULT_BASE = 'https://platform.claude.com'
INDEX = '/llms.txt'
LINK = re.compile(r'\[([^\]]*)\]\((https?://[^\s)]+\.md)\)')


def family(model_id):
    """'claude-opus-5-5[1m]' -> ('opus-5-5', 'opus'); 'claude-haiku-4-5-20251001' -> ('haiku-4-5', 'haiku')."""
    core = re.sub(r'\[.*?\]$', '', model_id.strip())
    core = re.sub(r'^(us\.|eu\.|apac\.|global\.)?(anthropic\.)?', '', core)
    core = re.sub(r'^claude-', '', core)
    core = re.sub(r'-v\d+(:\d+)?$', '', core)
    core = re.sub(r'-\d{8}$', '', core)
    name = core.split('-')[0]
    return core, name


def select_urls(llms_text, model_id):
    """Pick the pages worth reading for this model from llms.txt: every model prompting guide,
    the cross-model best-practices page, and the what's-new / migration pages of the model's family."""
    slug, name = family(model_id)
    picked = {}
    for title, url in LINK.findall(llms_text):
        low = url.lower()
        keep = False
        if '/prompt-engineering/prompting-claude-' in low or low.endswith('/claude-prompting-best-practices.md'):
            keep = True
        elif f'/models/{slug}/' in low or f'/models/{name}-' in low:
            keep = any(k in low for k in ('whats-new', 'migration-guide', 'introducing'))
        if keep:
            picked.setdefault(url, title)
    return [{'title': t, 'url': u} for u, t in picked.items()]


def rank(entries, model_id):
    """Current model's own guide first, then other guides of the same family, then the rest."""
    slug, name = family(model_id)
    def key(e):
        u = e['url'].lower()
        return (0 if f'prompting-claude-{slug}.md' in u else
                1 if f'/models/{slug}/' in u else
                2 if f'prompting-claude-{name}-' in u else
                3 if 'best-practices' in u else 4, u)
    return sorted(entries, key=key)


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'model-prompt-audit/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', 'replace')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--model', required=True, help='model id you run, e.g. claude-opus-5-5')
    ap.add_argument('--out', help='directory to write the .md pages and index.json into')
    ap.add_argument('--base', default=DEFAULT_BASE)
    ap.add_argument('--list', action='store_true', help='only print the selected URLs')
    args = ap.parse_args(argv)
    try:
        index_text = fetch(args.base + INDEX)
    except Exception as exc:  # network is the one hard dependency; say so and stop
        print(json.dumps({'error': f'cannot fetch {args.base + INDEX}: {exc}', 'hint': 'no network or docs moved; do not substitute memory'}), file=sys.stderr)
        return 2
    entries = rank(select_urls(index_text, args.model), args.model)
    slug, _ = family(args.model)
    own = [e for e in entries if f'prompting-claude-{slug}.md' in e['url'].lower()]
    if args.list or not args.out:
        print(json.dumps({'model': args.model, 'slug': slug, 'own_guide_found': bool(own), 'pages': entries}, indent=1, ensure_ascii=False))
        return 0 if own else 1
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for e in entries:
        name = re.sub(r'[^a-z0-9.-]+', '-', e['url'].lower().split('/docs/en/')[-1]).strip('-')
        path = out / name
        try:
            body = fetch(e['url'])
        except Exception as exc:
            written.append({**e, 'error': str(exc)})
            continue
        path.write_text(body, encoding='utf-8')
        written.append({**e, 'path': str(path), 'bytes': len(body.encode('utf-8'))})
    (out / 'index.json').write_text(json.dumps({'model': args.model, 'slug': slug, 'own_guide_found': bool(own), 'pages': written}, indent=1, ensure_ascii=False))
    print(json.dumps({'out': str(out), 'own_guide_found': bool(own), 'fetched': sum('path' in w for w in written), 'failed': sum('error' in w for w in written)}))
    return 0 if own else 1


if __name__ == '__main__':
    sys.exit(main())
