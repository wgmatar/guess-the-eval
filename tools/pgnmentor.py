#!/usr/bin/env python3
"""Download PGN Mentor's per-event files from 2000 to 2019 (https://www.pgnmentor.com/files.html).

    tools/.venv/bin/python tools/pgnmentor.py

PGN Mentor offers these files "completely free". They complement the Lichess masters database
for the top tournaments before Lichess broadcasts began. Files are cached under
tools/.cache/pgnmentor/; the generator (`--pgnmentor`) applies the same event filter as for
masters games (`masters.event_rejection`), so only the listed classical events are used.
One request at a time, a second apart.
"""

import re
import sys
import time
import urllib.request
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
CACHE = TOOLS_DIR / ".cache" / "pgnmentor"
SITE = "https://www.pgnmentor.com/"
USER_AGENT = "guess-the-eval-tools/1.0 (+https://github.com/wgmatar/guess-the-eval)"


# PGN Mentor's Event headers are often generic ("SuperGM", "It", "GM"); the file name carries
# the tournament. Files whose name is not here are judged by their Event header alone (the
# Grand Prix legs, named after their host city, say "Grand Prix" or "GP" there).
SERIES = {
    "WijkaanZee": "Wijk aan Zee",
    "Linares": "Linares",
    "Dortmund": "Dortmund",
    "Sofia": "M-Tel Masters",
    "Nanjing": "Pearl Spring",
    "London": "London Classic",
    "SaintLouis": "Sinquefield Cup",
    "Stavanger": "Norway Chess",
    "Shamkir": "Shamkir",
    "Zurich": "Zurich",
    "Candidates": "Candidates",
    "WccQual": "Candidates",
    "WorldChamp": "World Championship",
    "FideChamp": "FIDE WCh",
    "WorldCup": "World Cup",
}


def series(path: Path) -> str | None:
    """The tournament a PGN Mentor file holds, from its name (`Linares2004.pgn`), or None."""
    stem = re.sub(r"\d{4}$", "", path.stem)
    return SERIES.get(stem)


def event_headers(path: Path, headers) -> dict:
    """The game's headers with the file's tournament prefixed to its Event, for the event filter
    and for display: `Linares SuperGM`. The header's own words still decide rapid or tie-break."""
    event = " ".join((headers.get("Event") or "").split())
    name = series(path)
    out = dict(headers)
    if name and name.lower() not in event.lower():
        out["Event"] = f"{name} {event}".strip()
    return out


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def main(first: int = 2000, last: int = 2019):
    CACHE.mkdir(parents=True, exist_ok=True)
    html = get(SITE + "files.html").decode("latin-1")
    files = sorted(set(re.findall(r'href="events/([A-Za-z]+(\d{4})\.pgn)"', html)))
    files = [name for name, year in files if first <= int(year) <= last]
    print(f"{len(files)} event files from {first} to {last}", file=sys.stderr)
    for name in files:
        path = CACHE / name
        if path.exists() and path.stat().st_size > 0:
            continue
        time.sleep(1.0)
        data = get(SITE + "events/" + name)
        path.with_suffix(".tmp").write_bytes(data)
        path.with_suffix(".tmp").rename(path)
        print(f"  {name}: {len(data) // 1024} KB", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
