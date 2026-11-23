"""Generate a folder per route from index.html, so each route has a real URL.

GitHub Pages only serves files, so /links/lit/ needs lit/index.html. Each one is a copy
of index.html with, right after <head>:
    <base href="../">                  every relative path (css/, images/, js/) still works
    <meta name="route" content="lit">  js/router.js picks the route from this
Without JavaScript the copies are just the static page.

Run after editing index.html:   python scripts/build_routes.py
Check they are up to date:      python scripts/build_routes.py --check   (exit 1 if not)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTES = ["lit"]          # also add the route to ROUTES in js/router.js


def page_for(route, index):
    depth = route.count("/") + 1
    head = (f'<head>\n    <!-- Generated from index.html by scripts/build_routes.py: edit index.html, '
            f'then rerun it. -->\n    <base href="{"../" * depth}">\n'
            f'    <meta name="route" content="{route}">')
    page, n = re.subn(r"<head>", head, index, count=1)
    assert n == 1, "index.html has no <head>"
    return page


def main():
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    stale = []
    for route in ROUTES:
        out = ROOT / route / "index.html"
        page = page_for(route, index)
        if "--check" in sys.argv:
            if not out.exists() or out.read_text(encoding="utf-8") != page:
                stale.append(str(out.relative_to(ROOT)))
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page, encoding="utf-8", newline="\n")
        print("Wrote", out.relative_to(ROOT))
    if stale:
        print("Out of date (run python scripts/build_routes.py):", ", ".join(stale))
        sys.exit(1)


if __name__ == "__main__":
    main()
