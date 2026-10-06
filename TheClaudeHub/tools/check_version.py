"""Check a release tag against the app's version, and print the version.

    python tools/check_version.py theclaudehub-v0.1.0   # exits 1 unless they agree
    python tools/check_version.py                       # prints the version

The version lives in one place, ``theclaudehub/__init__.py``. The release
workflow runs this before building, so a tag that disagrees with it never
produces a release (the updater would compare against the wrong number).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from theclaudehub import __version__  # noqa: E402

TAG_PREFIX = "theclaudehub-v"


def main(argv: list) -> int:
    if not re.fullmatch(r"\d+\.\d+\.\d+", __version__):
        print(f"theclaudehub/__init__.py has version {__version__!r}; vpk needs "
              "major.minor.patch.", file=sys.stderr)
        return 1
    if not argv:
        print(__version__)
        return 0
    tag = argv[0]
    if not tag.startswith(TAG_PREFIX):
        print(f"Tag {tag} doesn't start with {TAG_PREFIX}.", file=sys.stderr)
        return 1
    tagged = tag[len(TAG_PREFIX):]
    if tagged != __version__:
        print(f"Tag {tag} says {tagged}, but theclaudehub/__init__.py says {__version__}. "
              "Change __version__ in the same commit as the tag.", file=sys.stderr)
        return 1
    print(__version__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
