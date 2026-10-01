#!/usr/bin/env python3
"""Add ?v=<version> to the site's own CSS/JS links and module imports before deploying.

GitHub Pages caches files for 10 minutes; without versioned URLs a browser can mix a cached
old index.html with a new app.js (or the reverse) right after a deploy and break the page.
Usage: python3 stamp_assets.py site <version>
"""
import re, sys
from pathlib import Path

HTML_LINK = re.compile(r'((?:href|src)=")((?!https?:|//)[\w./-]+\.(?:js|css))(")')
JS_IMPORT = re.compile(r'(\bfrom\s+")(\./[\w./-]+\.js)(")')


def stamp_html(text, version):
    return HTML_LINK.sub(lambda m: f"{m[1]}{m[2]}?v={version}{m[3]}", text)


def stamp_js(text, version):
    return JS_IMPORT.sub(lambda m: f"{m[1]}{m[2]}?v={version}{m[3]}", text)


def stamp_dir(site, version):
    for path in Path(site).glob("*.html"):
        path.write_text(stamp_html(path.read_text(), version))
    for path in Path(site).glob("*.js"):
        path.write_text(stamp_js(path.read_text(), version))


if __name__ == "__main__":
    stamp_dir(sys.argv[1], sys.argv[2])
