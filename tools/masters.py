#!/usr/bin/env python3
"""Collect elite classical games from 2000 to 2019 from the Lichess masters database.

    tools/.venv/bin/python tools/masters.py walk      # find game ids, year by year
    tools/.venv/bin/python tools/masters.py export    # download their PGNs

Lichess broadcasts start around 2020, so older top events come from the masters database
(explorer.lichess.ovh/masters). Its API is position-based: there is no "games of an event"
query. `walk` therefore walks the opening tree from the start position, one year at a time,
collecting each position's top games (the highest rated first). `export` downloads the PGNs of
the games where both players are rated 2600+, 300 at a time, through the game export API.
Everything is cached under tools/.cache/masters/, so both steps resume where they stopped.

The masters API needs a Lichess API token (no permissions). It is read at runtime from
~/.config/guess-the-eval/lichess-token and is never printed, logged or written anywhere.
Requests go out one at a time (explorer requests 2.1 s apart, exports 1 s) and honour
429 Retry-After.

`event_rejection()` is the event filter the generator applies to these games: a list of the
top tournaments asked for, minus rapid, blitz and other non-classical formats.
"""

import argparse
import collections
import heapq
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
CACHE = TOOLS_DIR / ".cache" / "masters"
WALK = CACHE / "walk.jsonl"
PGN = CACHE / "games.pgn"
TOKEN_FILE = Path.home() / ".config" / "guess-the-eval" / "lichess-token"
EXPLORER = "https://explorer.lichess.ovh/masters"
EXPORT = "https://lichess.org/api/games/export/_ids"
USER_AGENT = "guess-the-eval-tools/1.0 (+https://github.com/wgmatar/guess-the-eval)"
SPACING = 1.0
BATCH = 300


def log(message: str):
    print(message, file=sys.stderr, flush=True)


# ----------------------------------------------------------------------------- events

# The top tournaments asked for, as ChessBase-style event names spell them.
EVENTS = [
    ("Candidates", r"candidates|\bcand\b"),
    ("World Championship", r"\bwch\b|world[- ]?ch|world championship|fide[- ]wch|wcc\b"),
    ("Corus / Tata Steel", r"corus|tata steel|wijk aan zee|hoogovens"),
    ("Linares", r"linares|morelia"),
    ("Dortmund", r"dortmund"),
    ("M-Tel Masters", r"m-?tel"),
    ("Pearl Spring", r"pearl spring|nanjing"),
    ("London Chess Classic", r"london (chess )?classic|\blcc\b"),
    ("Sinquefield Cup", r"sinquefield"),
    ("Norway Chess", r"norway chess|altibox"),
    ("Shamkir / Gashimov", r"shamkir|gashimov"),
    ("Zurich Chess Challenge", r"z[uü]rich"),
    ("FIDE Grand Prix", r"grand prix|\bgp\b"),
    ("World Cup", r"world cup|wcup"),
    ("Olympiad", r"olympiad|\bol\b"),
]
EVENT_PATTERNS = [(name, re.compile(pattern, re.I)) for name, pattern in EVENTS]
NOT_CLASSICAL = re.compile(
    r"rapid|blitz|blind|armageddon|960|fischer ?random|freestyle|speed|online|internet|simul|"
    r"exhibition|\bexh\b|tie-?break|play-?off|\bTB\b|\bbl\b|\brap\b|\bbli\b|basque|chess960|"
    r"g/\d+|\d+'|\bkasparovchess\b|"
    r"women|girls|junior|u\d\d|senior|amateur|open\b(?!.*masters)|\bb\b group|\bb-group|"
    r"challengers|group b|\bb$|corus b|corus c|tata steel-?b|tata steel-?c", re.I)
KNOCKOUT = re.compile(r"world cup|wcup|\bko\b|k\.o\.|knock|candidates (2007|2011)|cand (2007|2011)", re.I)
# Tata Steel and Corus groups other than A: the event name carries the group.
GROUP = re.compile(r"(?:corus|tata steel|wijk aan zee)\W*(?:group\s*)?([a-c])\b", re.I)


def event_family(event: str):
    for name, pattern in EVENT_PATTERNS:
        if pattern.search(event):
            return name
    return None


def event_rejection(headers) -> str | None:
    """Why a masters game is not used, or None when it is a classical game from a listed event."""
    event = " ".join(headers.get("Event", "").split())
    family = event_family(event)
    if not family:
        return "event not listed"
    if NOT_CLASSICAL.search(event):
        return "not classical or not the top group"
    group = GROUP.search(event)
    if group and group.group(1).lower() != "a":
        return "not the top group"
    time_control = headers.get("TimeControl", "-")
    base = time_control.split("+")[0]
    if base.isdigit() and int(base) < 3600:
        return "not classical"
    # Knockouts play two classical games per round, then rapid tie-breaks: "1.3", "1.4", ...
    round_ = headers.get("Round", "")
    if KNOCKOUT.search(event) and re.fullmatch(r"\d+\.\d+", round_):
        if int(round_.split(".")[1]) > 2:
            return "tie-break"
    return None


# ----------------------------------------------------------------------------- http

_last = 0.0


def token() -> str:
    try:
        value = TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        raise SystemExit(f"no Lichess token at {TOKEN_FILE}")
    if not value:
        raise SystemExit(f"{TOKEN_FILE} is empty")
    return value


def request(url: str, data: bytes | None = None, accept: str = "application/json") -> bytes:
    """One request at a time, SPACING apart, with back-off. Errors never echo the headers."""
    global _last, SPACING
    headers = {"User-Agent": USER_AGENT, "Accept": accept, "Authorization": f"Bearer {token()}"}
    if data is not None:
        headers["Content-Type"] = "text/plain"
    backoff = iter([5, 15, 45, 90, 180])
    while True:
        wait = _last + SPACING - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last = time.monotonic()
        req = urllib.request.Request(url, data=data, headers=headers,
                                     method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=600) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 429:
                delay = int(error.headers.get("Retry-After") or 60)
                SPACING = min(SPACING + 1.0, 8.0)  # back off for good, not just this once
                log(f"  429: waiting {delay} s; now {SPACING:.1f} s between requests")
                time.sleep(delay)
                continue
            if error.code < 500:
                raise SystemExit(f"HTTP {error.code} from {url.split('?')[0]}")
            delay = next(backoff, None)
        except (urllib.error.URLError, TimeoutError):
            delay = next(backoff, None)
        if delay is None:
            raise SystemExit(f"network gave up on {url.split('?')[0]}")
        log(f"  network error: retrying in {delay} s")
        time.sleep(delay)


# ----------------------------------------------------------------------------- walk

def load_walk() -> dict:
    records = {}
    if WALK.exists():
        for line in WALK.read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                records[(record["year"], record["play"])] = record
    return records


def walk(args):
    global SPACING
    SPACING = args.spacing
    CACHE.mkdir(parents=True, exist_ok=True)
    records = load_walk()
    games = {}
    with open(WALK, "a", encoding="utf-8") as out:
        for year in range(args.first, args.last + 1):
            # Productive lines first: children of a position that turned up new elite games are
            # visited before the rest, so the walk goes deep along the lines elite players play,
            # where each position's top games are new, instead of re-reading the same famous
            # games near the root.
            frontier = [(0, 0, 0, "")]
            order = 0
            visited = 0
            fetched = 0
            while frontier and visited < args.budget:
                _, _, _, play = heapq.heappop(frontier)
                record = records.get((year, play))
                if record is None:
                    query = {"since": year, "until": year, "topGames": 15, "moves": args.moves}
                    if play:
                        query["play"] = play
                    body = json.loads(request(f"{EXPLORER}?{urllib.parse.urlencode(query)}"))
                    record = {
                        "year": year,
                        "play": play,
                        "games": [{"id": g["id"], "y": g.get("year"),
                                   "we": (g.get("white") or {}).get("rating"),
                                   "be": (g.get("black") or {}).get("rating")}
                                  for g in body.get("topGames", [])],
                        "moves": [{"uci": m["uci"], "n": m["white"] + m["draws"] + m["black"]}
                                  for m in body.get("moves", [])],
                    }
                    out.write(json.dumps(record, separators=(",", ":")) + "\n")
                    out.flush()
                    records[(year, play)] = record
                    fetched += 1
                visited += 1
                new = 0
                for g in record["games"]:
                    if g["id"] not in games:
                        games[g["id"]] = g
                        new += elite(g, args.min_elo)
                depth = len(play.split(",")) if play else 0
                if depth < args.depth:
                    for m in record["moves"]:
                        if m["n"] >= args.min_games:
                            order += 1
                            child = f"{play},{m['uci']}" if play else m["uci"]
                            heapq.heappush(frontier, (-new, -m["n"], order, child))
            strong = sum(1 for g in games.values() if elite(g, args.min_elo))
            log(f"{year}: {visited} positions ({fetched} fetched); {len(games)} games seen, "
                f"{strong} with both players {args.min_elo}+")


def elite(game: dict, min_elo: int) -> bool:
    return (game.get("we") or 0) >= min_elo and (game.get("be") or 0) >= min_elo


# ----------------------------------------------------------------------------- export

def exported_ids() -> set:
    if not PGN.exists():
        return set()
    return set(re.findall(r'^\[GameId "([^"]+)"\]', PGN.read_text(encoding="utf-8"), re.M))


def export(args):
    records = load_walk()
    wanted = {}
    for record in records.values():
        for g in record["games"]:
            if elite(g, args.min_elo) and args.first <= (g.get("y") or 0) <= args.last:
                wanted[g["id"]] = g
    have = exported_ids()
    missing = sorted(set(wanted) - have)
    log(f"{len(wanted)} games with both players {args.min_elo}+; {len(have)} exported; "
        f"{len(missing)} to fetch")
    with open(PGN, "a", encoding="utf-8") as out:
        for start in range(0, len(missing), BATCH):
            chunk = missing[start:start + BATCH]
            query = urllib.parse.urlencode({"evals": "false", "clocks": "false",
                                            "opening": "true", "literate": "false"})
            body = request(f"{EXPORT}?{query}", ",".join(chunk).encode(), "application/x-chess-pgn")
            out.write(body.decode("utf-8").strip() + "\n\n\n")
            out.flush()
            log(f"  exported {min(start + BATCH, len(missing))} / {len(missing)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    w = sub.add_parser("walk", help="walk the opening tree year by year, collecting top games")
    w.add_argument("--first", type=int, default=2000)
    w.add_argument("--last", type=int, default=2019)
    w.add_argument("--budget", type=int, default=120, help="positions visited per year")
    w.add_argument("--depth", type=int, default=16, help="plies deep")
    w.add_argument("--moves", type=int, default=12, help="moves listed per position")
    w.add_argument("--min-games", type=int, default=25, help="expand a move with this many games")
    w.add_argument("--min-elo", type=int, default=2600)
    w.add_argument("--spacing", type=float, default=2.1,
                   help="seconds between explorer requests (it answers 429 beyond about 30 a minute)")
    e = sub.add_parser("export", help="download the PGNs of the elite games found")
    e.add_argument("--first", type=int, default=2000)
    e.add_argument("--last", type=int, default=2019)
    e.add_argument("--min-elo", type=int, default=2600)
    args = parser.parse_args()
    {"walk": walk, "export": export}[args.command](args)


if __name__ == "__main__":
    main()
