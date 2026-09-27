#!/usr/bin/env python3
"""Download Google Fonts (SIL OFL) into a local folder so renders never depend on the network.

Writes <out>/*.woff2 and <out>/fonts.css. URLs in fonts.css are relative to the CSS file,
so link it from the page as <link rel="stylesheet" href="fonts/fonts.css">.

Usage: fetch_fonts.py --out fonts "Instrument Serif:ital@0;1" "Inter Tight:wght@400;500;600" "JetBrains Mono:wght@400;600"
       [--subsets latin,latin-ext]
"""
import argparse
import os
import re
import sys
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("families", nargs="+", help='Google Fonts css2 family specs, e.g. "Inter Tight:wght@400;600"')
    ap.add_argument("--out", required=True)
    ap.add_argument("--subsets", default="latin")
    a = ap.parse_args()
    subsets = set(a.subsets.split(","))

    query = "&".join("family=" + urllib.parse.quote(f, safe=":;@,") for f in a.families)
    try:
        css = get(f"https://fonts.googleapis.com/css2?{query}&display=swap").decode()
    except Exception as e:  # network or unknown family
        sys.exit(f"could not fetch font CSS ({e}); check the family names or use locally installed fonts")

    os.makedirs(a.out, exist_ok=True)
    rules = []
    for subset, body in re.findall(r"/\* ([\w-]+) \*/\s*@font-face \{(.*?)\}", css, re.S):
        if subset not in subsets:
            continue
        fam = re.search(r"font-family: '([^']+)'", body).group(1)
        style = re.search(r"font-style: (\w+)", body).group(1)
        weight = re.search(r"font-weight: ([\d ]+);", body).group(1).strip()
        url = re.search(r"url\((.*?)\)", body).group(1)
        rng = re.search(r"unicode-range: ([^;]+);", body)
        fn = f"{fam.replace(' ', '')}-{weight.replace(' ', '_')}-{style}-{subset}.woff2"
        with open(os.path.join(a.out, fn), "wb") as fh:
            fh.write(get(url))
        rules.append(f"@font-face{{font-family:'{fam}';font-style:{style};font-weight:{weight};"
                     f"src:url({fn}) format('woff2');" + (f"unicode-range:{rng.group(1)};" if rng else "") + "}")
    if not rules:
        sys.exit(f"no @font-face rules matched subsets {sorted(subsets)}")
    with open(os.path.join(a.out, "fonts.css"), "w") as fh:
        fh.write("\n".join(rules) + "\n")
    print(f"✓ {len(rules)} font files → {a.out}/fonts.css")


if __name__ == "__main__":
    main()
