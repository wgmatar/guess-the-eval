#!/usr/bin/env python3
"""Build public/positions.json from Lichess broadcast games.

    python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt
    tools/.venv/bin/python tools/fetch_positions.py discover
    tools/.venv/bin/python tools/fetch_positions.py generate --target 25000

`discover` finds finished, top-tier classical broadcast tournaments through the public
Lichess API and appends them to tools/broadcast_tours.json. Existing rows are kept verbatim.

`generate` downloads each tour's PGN once (cached, gitignored, under tools/.cache/), in which
Lichess has annotated every move with `[%eval]`: Stockfish server analysis, White's
perspective, in pawns. With `--masters` it also reads the games `tools/masters.py` collected
from the Lichess masters database (2000-2019), which carry no evals: those positions are
screened and then evaluated by a local Stockfish (`tools/engine.py`). New rows are chosen by
quota (`tools/quota.py`): |eval| >= 0.50, fixed shares per eval bucket, balanced side to move,
and minimums for tricky categories. Only quiet positions qualify: not in check, not reached by
a capture, and an eval that holds on the next move. They are appended to the dataset. Rows already in the file are kept byte-for-byte, so the browser's
record of what a player has answered (indices into the file) stays valid. `--rebuild` starts
from nothing and requires a new `--dataset` name, which tells browsers to discard that record.

Requests go out one at a time, at least a second apart, and back off on 429 and 5xx.
"""

import argparse
import collections
import datetime
import gzip
import json
import math
import random
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.pgn

import engine
import masters
import pgnmentor
import quota

TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
CACHE_DIR = TOOLS_DIR / ".cache"
MANIFEST = TOOLS_DIR / "broadcast_tours.json"
KEYWORDS = TOOLS_DIR / "keywords.txt"
OUT = ROOT / "public" / "positions.json"
API = "https://lichess.org"
USER_AGENT = "guess-the-eval-tools/1.0 (+https://github.com/wgmatar/guess-the-eval)"
SPACING = 1.0  # seconds between requests
GAME_URL = re.compile(r"^https://lichess\.org/broadcast/[^/]+/[^/]+/\w{8}/\w{8}$")
MASTERS_URL = re.compile(r"^https://lichess\.org/\w{8}$")
# Each source's url pattern; PGN Mentor games have no Lichess game, so no url.
SOURCES = {"broadcast": GAME_URL, "masters": MASTERS_URL, "pgnmentor": None}
# Engine-evaluated events get indices after every manifest tour, so their rows sort after
# broadcast rows: masters events from 100000, PGN Mentor events from 200000.
SOURCE_BASE = {"masters": 100000, "pgnmentor": 200000}
SCHEMA = 1

# Tournaments found by `discover` whose names mark a section that yields almost no 2500+ classical
# games (lower Olympiad sections, women's, junior and senior events, weak open groups) or is not
# classical chess at all. Each costs minutes to download for nothing. Hand-listed manifest rows
# (no "source") are never skipped by name; `--include-low-yield` turns the filter off.
LOW_YIELD = re.compile("|".join([
    r"\| (?:Open|Women) (?:II|III|IV|V)\b",
    r"\bWomen|Girls|Femenin|Menchik",
    r"Cadets|\bunder \d+|\bU\d\d\b|Junior|Senior|Amateur|Tienkamp|College|University|Disabilit|Futures",
    r"960|Fischer Random|Freestyle|Antichess|Esports|Rapid|Blitz|Fast Standard|Triathlon|Streamer",
    r"Ladder|Training Match|Battle of Minds|Exchange Matches|Wild Card|Qualification Match",
    r"Open [B-F]\b|Group [BC]\b|[B-F]-Open|IM Open|Elo - Open|Boards (?:6[5-9]|[7-9]\d|1\d\d|2\d\d)",
    r"Austrian|SGM|Bundesliga Cup",
]), re.I)


def low_yield(tour: dict) -> bool:
    return bool(tour.get("source")) and bool(LOW_YIELD.search(tour["event"]))

# Names the broadcasts give without a comma, in the form the press uses. Any other
# comma-less name (mostly Indian players, e.g. "Nihal Sarin") is kept as broadcast: the
# app shows such names verbatim, and guessing the surname would be wrong more often than not.
NAME_OVERRIDES = {
    "Gukesh D": "Gukesh, D",
    "Praggnanandhaa R": "Praggnanandhaa, R",
    "Erigaisi Arjun": "Erigaisi, Arjun",
}


# ----------------------------------------------------------------------------- http

class ClientError(Exception):
    """A 4xx other than 429: the request itself is wrong, so retrying cannot help."""

    def __init__(self, url: str, code: int):
        super().__init__(f"{url}: HTTP {code}")
        self.code = code


class NotFound(ClientError):
    pass


_last_request = 0.0


def http_get(url: str, accept: str) -> bytes:
    """One polite GET. 404 raises NotFound; 429 honours Retry-After; 5xx backs off."""
    global _last_request
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    backoff = iter([5, 15, 45])
    rate_limited = 0
    while True:
        wait = _last_request + SPACING - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                data = response.read()
            _last_request = time.monotonic()
            return data
        except urllib.error.HTTPError as error:
            _last_request = time.monotonic()
            if error.code == 404:
                raise NotFound(url, 404) from None
            if 400 <= error.code < 500 and error.code != 429:
                raise ClientError(url, error.code) from None
            if error.code == 429 and rate_limited < 5:
                rate_limited += 1
                try:
                    delay = int(error.headers.get("Retry-After", "60"))
                except ValueError:
                    delay = 60
                log(f"  429 from {url}; waiting {delay} s")
                time.sleep(delay)
                continue
            delay = next(backoff, None) if error.code >= 500 else None
            if delay is None:
                raise SystemExit(f"{url}: HTTP {error.code}")
            log(f"  HTTP {error.code} from {url}; retrying in {delay} s")
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            _last_request = time.monotonic()
            delay = next(backoff, None)
            if delay is None:
                raise SystemExit(f"{url}: {error}")
            log(f"  {error} from {url}; retrying in {delay} s")
            time.sleep(delay)


def fetch_json(url: str):
    return json.loads(http_get(url, "application/json"))


def fetch_ndjson(url: str) -> list:
    body = http_get(url, "application/x-ndjson").decode("utf-8")
    return [json.loads(line) for line in body.splitlines() if line.strip()]


def fetch_tour_pgn(tour_id: str, refresh: bool, offline: bool):
    """Path to the cached PGN, downloading it first if needed. None when offline and uncached."""
    CACHE_DIR.mkdir(exist_ok=True)
    path = CACHE_DIR / f"{tour_id}.pgn"
    if path.exists() and path.stat().st_size > 0 and not refresh:
        return path
    if offline:
        return None
    data = http_get(f"{API}/api/broadcast/{tour_id}.pgn", "application/x-chess-pgn")
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.rename(path)
    return path


# ----------------------------------------------------------------------------- manifest

def load_manifest() -> list:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def write_manifest(rows: list):
    text = "[\n" + ",\n".join(" " + json.dumps(row, ensure_ascii=False) for row in rows) + "\n]\n"
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.rename(MANIFEST)


# ----------------------------------------------------------------------------- discover

def base_minutes(tc: str):
    """Base time in minutes from a free-text control such as "90 min + 30 sec" or "90+30"."""
    match = re.search(r"(\d+)\s*(?:min|minutes|m\b|')", tc) or re.search(r"(?:^|[\s/])(\d+)\s*\+\s*\d+", tc)
    if not match:
        return None
    base = int(match.group(1))
    return base // 60 if base >= 600 else base  # "5400+30" is in seconds


def tour_rejection(tour: dict, min_tier: int, cutoff_ms: int):
    """None if the tour qualifies, else a short reason."""
    if (tour.get("tier") or 0) < min_tier:
        return "tier"
    dates = tour.get("dates") or []
    if not dates:
        return "no dates"
    if dates[-1] > cutoff_ms:
        return "not finished"
    info = tour.get("info") or {}
    fide = info.get("fideTC")
    if fide:
        return None if fide == "standard" else f"fideTC {fide}"
    minutes = base_minutes(info.get("tc", ""))
    if minutes is None:
        return "unknown time control"
    return None if minutes >= 60 else "fast time control"


def discover(args):
    manifest = load_manifest()
    known = {row["id"] for row in manifest}
    seen = {}

    def take(tour, source):
        if isinstance(tour, dict) and tour.get("id") and tour["id"] not in seen:
            seen[tour["id"]] = (tour, source)

    log("official broadcasts")
    for line in fetch_ndjson(f"{API}/api/broadcast?nb=100"):
        take(line.get("tour"), "official")

    log("top broadcasts")
    for page in range(1, args.top_pages + 1):
        try:
            data = fetch_json(f"{API}/api/broadcast/top?page={page}")
        except ClientError as error:  # past the last page the API answers 400
            log(f"  top broadcasts end at page {page - 1} ({error.code})")
            break
        for entry in data.get("active") or []:
            take(entry.get("tour"), "top")
        past = data.get("past") or {}
        for entry in past.get("currentPageResults") or []:
            take(entry.get("tour"), "top")
        if not past.get("nextPage"):
            break

    keywords = [k.strip() for k in KEYWORDS.read_text(encoding="utf-8").splitlines() if k.strip()]
    for keyword in keywords:
        log(f"search: {keyword}")
        for page in range(1, args.search_pages + 1):
            query = urllib.parse.urlencode({"q": keyword, "page": page})
            try:
                data = fetch_json(f"{API}/api/broadcast/search?{query}")
            except ClientError:
                break
            for entry in data.get("currentPageResults") or []:
                take(entry.get("tour", entry), f"search:{keyword}")
            if not data.get("nextPage"):
                break

    cutoff = int((time.time() - 2 * 86400) * 1000)
    added, rejected, unknown = [], collections.Counter(), []
    for tour_id, (tour, source) in seen.items():
        if tour_id in known:
            continue
        reason = tour_rejection(tour, args.min_tier, cutoff)
        if reason:
            rejected[reason] += 1
            if reason == "unknown time control" and (tour.get("tier") or 0) >= args.min_tier:
                unknown.append(f"{tour.get('name')} ({(tour.get('info') or {}).get('tc', '')!r})")
            continue
        year = datetime.datetime.fromtimestamp(tour["dates"][0] / 1000, datetime.timezone.utc).year
        added.append({"id": tour_id, "event": tour.get("name", tour_id), "year": year,
                      "tier": tour.get("tier"), "source": source})

    added.sort(key=lambda row: (row["year"], row["event"]))
    write_manifest(manifest + added)
    log(f"\n{len(seen)} tours seen, {len(added)} added, manifest now {len(manifest) + len(added)} rows")
    for reason, count in rejected.most_common():
        log(f"  rejected {count:4d}  {reason}")
    for line in unknown:
        log(f"  unknown time control: {line}")
    by_year = collections.Counter(row["year"] for row in added)
    log("  added per year: " + ", ".join(f"{y}: {n}" for y, n in sorted(by_year.items())))


# ----------------------------------------------------------------------------- parse

def iter_games(path: Path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        while True:
            try:
                game = chess.pgn.read_game(handle)
            except Exception as error:  # a torn game must not stop the run
                log(f"  parse error skipped: {error}")
                continue
            if game is None:
                return
            yield game


def parse_elo(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def game_is_classical(game, default: bool) -> bool:
    for node in game.mainline():
        clock = node.clock()
        if clock is not None:
            return clock >= 60 * 60
    time_control = game.headers.get("TimeControl", "")
    base = time_control.split(":")[0].split("/")[-1].split("+")[0]
    if base.isdigit():
        return int(base) >= 3600
    return default


def format_name(raw: str, order: str) -> str:
    """Normalise to "Last, First". `order` is "first-last" for broadcasts that wrote
    "Hikaru Nakamura"; current ones write "Nakamura, Hikaru"."""
    raw = " ".join(raw.split())
    if raw in NAME_OVERRIDES:
        return NAME_OVERRIDES[raw]
    if "," in raw:
        last, first = raw.split(",", 1)
        return f"{last.strip()}, {first.strip()}"
    if order == "first-last" and " " in raw:
        first, last = raw.rsplit(" ", 1)
        return f"{last}, {first}"
    return raw


def evaluated_positions(game):
    """(ply, board-after-move, cp, next cp, reached by a capture) for every mainline move Lichess
    evaluated with a non-mate score, cp from White's view. The `[%eval]` on a move describes the
    resulting position; `next cp` is the eval after the reply (None when missing or a mate)."""
    board = game.board()
    nodes = list(game.mainline())
    out = []
    for i, node in enumerate(nodes):
        capture = board.is_capture(node.move) or node.move.promotion is not None
        board.push(node.move)
        pov = node.eval()
        if pov is None:
            continue
        score = pov.white()
        if score.is_mate():
            continue
        following = nodes[i + 1].eval() if i + 1 < len(nodes) else None
        next_cp = None if following is None or following.white().is_mate() else following.white().score()
        out.append((i + 1, board.copy(stack=False), score.score(), next_cp, capture))
    return out


def epd_of(fen: str) -> str:
    return " ".join(fen.split()[:4])


def ply_of(fen: str) -> int:
    """Half-moves played to reach a FEN from the initial position: the Lichess `#ply` anchor."""
    fields = fen.split()
    move = int(fields[5])
    return 2 * move - 1 if fields[1] == "b" else 2 * (move - 1)


@dataclass
class Candidate:
    tour_index: int
    game_index: int
    ply: int
    fen: str
    epd: str
    cp: int | None
    game: dict
    src: str = "broadcast"
    # Masters positions: the position after the reply played, and whether the evals are the
    # full-depth ones rather than the screen.
    next_fen: str | None = None
    next_cp: int | None = None
    verified: bool = True


def is_quiet(board: chess.Board, capture: bool, cp, next_cp, max_delta_cp: float) -> str | None:
    """Why a position is not quiet, or None. Down material must mean compensation, not the
    middle of a trade: not in check, not reached by a capture, and an eval that holds."""
    if board.is_check():
        return "in check"
    if capture:
        return "after a capture"
    if next_cp is None:
        return "no eval after the reply"
    if abs(next_cp - cp) > max_delta_cp:
        return "eval not stable"
    return None


def game_candidates(game, tour_index, game_index, tour, args, drops) -> list:
    headers = game.headers
    if headers.get("Variant", "Standard") != "Standard":
        drops["variant"] += 1
        return []
    if headers.get("SetUp") == "1" or "FEN" in headers:
        drops["setup position"] += 1
        return []
    if headers.get("Result", "*") == "*":
        drops["unfinished"] += 1
        return []
    url = headers.get("GameURL", "")
    if not GAME_URL.match(url):
        drops["no GameURL"] += 1
        return []
    if url in args.used_urls:
        drops["already in dataset"] += 1
        return []
    white_elo = parse_elo(headers.get("WhiteElo"))
    black_elo = parse_elo(headers.get("BlackElo"))
    if white_elo is None or black_elo is None or min(white_elo, black_elo) < args.min_elo:
        drops["elo"] += 1
        return []
    if not game_is_classical(game, default=True):
        drops["not classical"] += 1
        return []
    positions = evaluated_positions(game)
    if not positions:
        drops["no evals"] += 1
        return []
    date = headers.get("Date", "")
    year = int(date[:4]) if date[:4].isdigit() else tour["year"]
    # Names stay raw until the whole tour is read: the tour's name order is decided from all of them.
    row = {"w": headers.get("White", ""), "b": headers.get("Black", ""), "we": white_elo,
           "be": black_elo, "y": year, "ev": tour["event"], "eco": headers.get("ECO", ""),
           "op": headers.get("Opening", ""), "url": url}
    candidates = []
    for ply, board, cp, next_cp, capture in positions:
        if board.fullmove_number < args.min_move or abs(cp) > args.max_abs_eval * 100:
            continue
        if abs(eval_value(cp)) < args.min_abs_eval:
            continue
        if board.is_game_over():
            continue
        reason = is_quiet(board, capture, cp, next_cp, args.quiet_delta * 100)
        if reason:
            drops[reason] += 1
            continue
        fen = board.fen()
        if ply_of(fen) != ply:
            drops["ply mismatch"] += 1
            continue
        candidates.append(Candidate(tour_index, game_index, ply, fen, board.epd(), cp, row))
    return candidates


# ----------------------------------------------------------------------------- masters

def engine_games(args, used_urls: set, drops, unlisted: collections.Counter):
    """Games for local evaluation: the masters database first, then PGN Mentor, filtered to
    the listed classical events, both players rated --min-elo, and deduplicated by year and
    moves, so a game in both keeps its masters copy (and its Lichess link)."""
    sources = []
    if args.masters:
        if masters.PGN.exists():
            sources.append(("masters", [masters.PGN]))
        else:
            log(f"no masters games at {masters.PGN}; run tools/masters.py walk and export")
    if args.pgnmentor:
        sources.append(("pgnmentor", sorted(pgnmentor.CACHE.glob("*.pgn"))))
    seen = {}
    for src, paths in sources:
        for path in paths:
            for game in iter_games(path):
                h = pgnmentor.event_headers(path, game.headers) if src == "pgnmentor" else game.headers
                reason = masters.event_rejection(h)
                if reason:
                    drops[f"{src}: {reason}"] += 1
                    if reason == "event not listed":
                        unlisted[f"{h.get('Event', '?')} ({src})"] += 1
                    continue
                if h.get("Variant", "Standard") != "Standard" or h.get("SetUp") == "1" or "FEN" in h:
                    drops[f"{src}: variant or set-up"] += 1
                    continue
                if h.get("Result", "*") == "*":
                    drops[f"{src}: unfinished"] += 1
                    continue
                white_elo, black_elo = parse_elo(h.get("WhiteElo")), parse_elo(h.get("BlackElo"))
                if white_elo is None or black_elo is None or min(white_elo, black_elo) < args.min_elo:
                    drops[f"{src}: elo"] += 1
                    continue
                date = h.get("Date", "")
                year = int(date[:4]) if date[:4].isdigit() else None
                if year is None or not args.masters_first <= year <= args.masters_last:
                    drops[f"{src}: year"] += 1
                    continue
                url = None
                if src == "masters":
                    url = f"{API}/{h.get('GameId', '')}"
                    if not MASTERS_URL.match(url):
                        drops[f"{src}: no game id"] += 1
                        continue
                    if url in used_urls:
                        drops[f"{src}: already in dataset"] += 1
                        continue
                moves = tuple(m.uci() for m in game.mainline_moves())
                if len(moves) < 2 * args.min_move:
                    drops[f"{src}: too short"] += 1
                    continue
                key = (year, moves)
                if key in seen:
                    drops[f"{src}: same game as a {seen[key]} one"] += 1
                    continue
                seen[key] = src
                yield game, h.get("Event", ""), src, url, white_elo, black_elo, year


def engine_candidates(args, used_urls: set, event_index: dict, drops, unlisted: collections.Counter) -> list:
    """Quiet positions from masters and PGN Mentor games, not yet evaluated."""
    games_by_event = collections.defaultdict(list)
    for game, event, src, url, white_elo, black_elo, year in engine_games(args, used_urls, drops, unlisted):
        event = " ".join(event.split())
        name = event if str(year) in event else f"{event} {year}"
        games_by_event[(src, name)].append((game, url, white_elo, black_elo, year))

    candidates = []
    for src, name in sorted(games_by_event):
        index = event_index.setdefault((src, name), SOURCE_BASE[src] + len(event_index))
        games = sorted(games_by_event[(src, name)],
                       key=lambda g: (g[0].headers.get("Date", ""), g[0].headers.get("Round", ""),
                                      g[0].headers.get("White", ""), g[0].headers.get("Black", "")))
        for game_index, (game, url, white_elo, black_elo, year) in enumerate(games):
            h = game.headers
            row = {"w": format_name(h.get("White", ""), "last-first"),
                   "b": format_name(h.get("Black", ""), "last-first"),
                   "we": white_elo, "be": black_elo, "y": year, "ev": name,
                   "eco": h.get("ECO", ""), "op": h.get("Opening", "")}
            if url:
                row["url"] = url
            row["src"] = src
            board = game.board()
            nodes = list(game.mainline())
            quiet = []
            for i, node in enumerate(nodes[:-1]):
                capture = board.is_capture(node.move) or node.move.promotion is not None
                board.push(node.move)
                if board.fullmove_number < args.min_move or capture or board.is_check():
                    continue
                if board.is_game_over():
                    continue
                after = board.copy(stack=False)
                after.push(nodes[i + 1].move)
                quiet.append(Candidate(index, game_index, i + 1, board.fen(), board.epd(), None,
                                       row, src, after.fen(), None, False))
            # A game gives at most three rows, so screening every quiet move would be wasted
            # engine time: a seeded sample of them is plenty to choose from.
            rng = random.Random(f"{args.seed}:{src}:{name}:{game_index}")
            if len(quiet) > args.screen_per_game:
                quiet = sorted(rng.sample(quiet, args.screen_per_game), key=lambda c: c.ply)
            candidates.extend(quiet)
    return candidates


def screen_engine(candidates: list, args, cache) -> list:
    """Cheap first pass: keep positions whose screen eval is near a bucket and holds a move on."""
    first = engine.evaluate([c.fen for c in candidates], args.screen_nodes, args.engine,
                            args.workers, cache, args.hash, "screen")
    margin = 5  # centipawns of slack: the full evaluation decides
    near = [c for c in candidates
            if first[c.fen] is not None and args.min_abs_eval * 100 - margin <= abs(first[c.fen]) <= args.max_abs_eval * 100 + margin]
    second = engine.evaluate([c.next_fen for c in near], args.screen_nodes, args.engine,
                             args.workers, cache, args.hash, "screen, reply")
    kept = []
    for c in near:
        cp, next_cp = first[c.fen], second[c.next_fen]
        if next_cp is None or abs(next_cp - cp) > args.quiet_delta * 100 * 1.5:
            continue
        c.cp, c.next_cp = cp, next_cp
        kept.append(c)
    log(f"engine sources: {len(kept)} of {len(candidates)} positions pass the screen")
    return kept


def verify_engine(chosen: list, args, cache) -> int:
    """Full-depth evals for chosen engine-evaluated positions; returns how many failed."""
    todo = [c for c in chosen if not c.verified]
    if not todo:
        return 0
    full = engine.evaluate([c.fen for c in todo], args.nodes, args.engine, args.workers, cache,
                           args.hash, "full")
    reply = engine.evaluate([c.next_fen for c in todo], args.reply_nodes, args.engine, args.workers,
                            cache, args.hash, "full, reply")
    failed = 0
    for c in todo:
        cp, next_cp = full[c.fen], reply[c.next_fen]
        ok = (cp is not None and next_cp is not None
              and args.min_abs_eval <= abs(eval_value(cp)) <= args.max_abs_eval
              and abs(next_cp - cp) <= args.quiet_delta * 100)
        c.cp, c.next_cp, c.verified = cp, next_cp, True
        if not ok:
            c.cp = None
            failed += 1
    return failed


# ----------------------------------------------------------------------------- sample

def to_item(c: Candidate) -> quota.Item:
    value = eval_value(c.cp)
    info = quota.describe(chess.Board(c.fen), value)
    return quota.Item(key=(c.tour_index, c.game_index, c.ply), game=(c.tour_index, c.game_index),
                      event=str(c.tour_index), ply=c.ply, epd=c.epd, value=value, cats=info["cats"],
                      tier=info["tier"], white_to_move=info["white_to_move"])


def sample(candidates, used_epds, args):
    """Quota-sample new rows; engine-evaluated picks are verified at full depth and re-sampled
    until every chosen row carries a verified eval."""
    pool = [c for c in candidates if c.cp is not None]
    items = {}  # id -> (cp, item): describing a position parses its board, so do it once per eval
    def item_of(c):
        cached = items.get(id(c))
        if cached is None or cached[0] != c.cp:
            cached = items[id(c)] = (c.cp, to_item(c))
        return cached[1]
    # Each round verifies the engine picks it made; a pick whose full eval leaves its bucket or
    # fails the stability check is replaced next round. It settles when a round adds no failure.
    for round_ in range(1, 200):
        by_key = {(c.tour_index, c.game_index, c.ply): c for c in pool}
        result = quota.sample([item_of(c) for c in pool], args.needed, used_epds, args.seed,
                              per_game=args.per_game, event_cap=args.max_per_tour,
                              existing_per_event={str(k): v for k, v in args.existing_per_tour.items()})
        chosen = [by_key[it.key] for it in result.chosen]
        failed = verify_engine(chosen, args, args.eval_cache)
        log(f"sampling round {round_}: {len(chosen)} chosen, {failed} engine picks failed the full evaluation")
        if not any(not c.verified for c in chosen) and failed == 0:
            return chosen, result
        pool = [c for c in pool if c.cp is not None]
    raise SystemExit("sampling did not settle")


def eval_value(cp: int) -> float:
    value = round(cp / 100, 2)
    return 0.0 if value == 0 else value  # never "-0.0"


# ----------------------------------------------------------------------------- output

def dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def serialize(doc: dict) -> str:
    """One row per line, so a re-run that appends rows is an append-only diff."""
    head = dump({k: doc[k] for k in ("schema", "dataset", "generated", "tours")})
    lines = [head[:-1] + ","]
    for key in ("games", "positions"):
        rows = doc[key]
        lines.append(f'"{key}":[')
        lines += [dump(row) + ("," if i < len(rows) - 1 else "") for i, row in enumerate(rows)]
        lines.append("]," if key == "games" else "]")
    lines.append("}")
    return "\n".join(lines) + "\n"


def validate(doc: dict, previous: dict, max_abs_eval: float, min_abs_new: float = 0.0):
    games, positions = doc["games"], doc["positions"]
    if previous:
        if games[:len(previous["games"])] != previous["games"]:
            raise SystemExit("output would alter existing games; refusing to write")
        if positions[:len(previous["positions"])] != previous["positions"]:
            raise SystemExit("output would alter existing positions; refusing to write")
    epds = [epd_of(fen) for _, fen, _ in positions]
    if len(set(epds)) != len(epds):
        raise SystemExit("duplicate positions in output")
    used = set()
    for i, (game_index, fen, value) in enumerate(positions):
        if not 0 <= game_index < len(games):
            raise SystemExit(f"position {i}: game index {game_index} out of range")
        board = chess.Board(fen)
        if not board.is_valid():
            raise SystemExit(f"position {i}: illegal FEN {fen}")
        if abs(value) > max_abs_eval:
            raise SystemExit(f"position {i}: eval {value} outside the bar")
        if value == 0 and math.copysign(1, value) < 0:
            raise SystemExit(f"position {i}: signed zero")
        if board.ply() != ply_of(fen):
            raise SystemExit(f"position {i}: ply formula disagrees with python-chess")
        if previous and i >= len(previous["positions"]) and abs(value) < min_abs_new:
            raise SystemExit(f"position {i}: new row with |eval| {abs(value)} below {min_abs_new}")
        used.add(game_index)
    if len(used) != len(games):
        raise SystemExit("a game has no positions")
    for i, game in enumerate(games):
        src = game.get("src", "broadcast")
        if src not in SOURCES:
            raise SystemExit(f"game {i}: unknown source {src!r}")
        # The url is optional; when present it must be the source's Lichess link.
        if "url" in game and (SOURCES[src] is None or not SOURCES[src].match(game["url"])):
            raise SystemExit(f"game {i}: bad url {game['url']}")
    if json.loads(serialize(doc)) != doc:
        raise SystemExit("serialised output does not re-parse to the same document")


def log(message: str):
    print(message, file=sys.stderr, flush=True)


def distribution(rows, games) -> dict:
    """Counts by bucket, side, sign and category for rows [game, fen, value]."""
    out = {"n": len(rows), "buckets": collections.Counter(), "below": 0, "black": 0, "white": 0,
           "zero": 0, "white_to_move": 0, "cats": collections.Counter(), "tiers": collections.Counter(),
           "sources": collections.Counter()}
    for g, fen, value in rows:
        b = quota.bucket_of(value)
        if b is None:
            out["below"] += 1
        else:
            out["buckets"][b] += 1
        out["black" if value < 0 else "white" if value > 0 else "zero"] += 1
        out["white_to_move"] += fen.split()[1] == "w"
        info = quota.describe(chess.Board(fen), value)
        for cat, yes in info["cats"].items():
            out["cats"][cat] += yes
        out["tiers"][info["tier"]] += 1
        out["sources"][games[g].get("src", "broadcast")] += 1
    return out


def pct(k: int, n: int) -> str:
    return f"{k:6d}  {100 * k / max(1, n):5.1f} %"


def report(doc: dict, new_count: int, tour_stats: list, encoded: bytes, result=None):
    games, positions = doc["games"], doc["positions"]
    new = positions[len(positions) - new_count:] if new_count else []
    log(f"\n{len(positions)} positions from {len(games)} games in {doc['tours']} events "
        f"({new_count} new positions)")
    for title, rows in (("all rows", positions), ("new rows", new)):
        if not rows:
            continue
        d = distribution(rows, games)
        n = d["n"]
        log(f"\n{title} ({n}):")
        log(f"  |eval| < 0.50              {pct(d['below'], n)}")
        for b in range(len(quota.BUCKETS)):
            target = f"  (target {result.targets[b]})" if result and title == "new rows" else ""
            log(f"  |eval| {quota.bucket_label(b):<19} {pct(d['buckets'][b], n)}{target}")
        log(f"  White better              {pct(d['white'], n)}")
        log(f"  Black better              {pct(d['black'], n)}")
        log(f"  exactly 0.00              {pct(d['zero'], n)}")
        log(f"  White to move             {pct(d['white_to_move'], n)}")
        for cat in quota.CATEGORIES:
            need = f"  (at least {result.mins[cat]})" if result and title == "new rows" else ""
            log(f"  {quota.LABELS[cat]:<26}{pct(d['cats'][cat], n)}{need}")
        log("  eval not simply material: " + ", ".join(
            f"{name} {d['tiers'][t]}" for t, name in enumerate(
                ("down material", "level or endgame", "up 2 or less", "up more"))))
        log("  per source: " + ", ".join(f"{k} {v}" for k, v in sorted(d["sources"].items())))
    if result is not None:
        log("\nquota shortfalls: " + ("; ".join(result.shortfalls) if result.shortfalls else "none"))
    if new:
        log("\nnew rows per event:")
        per_event = collections.Counter(games[g]["ev"] for g, _, _ in new)
        for event, count in sorted(per_event.items(), key=lambda kv: (-kv[1], kv[0])):
            log(f"  {count:5d}  {event}")
    log("\nper broadcast tour (games seen / candidates; drops):")
    for event, seen, found, drops in tour_stats:
        dropped = ", ".join(f"{k} {v}" for k, v in sorted(drops.items())) or "none"
        log(f"  {seen:4d} / {found:6d}  {event}; {dropped}")
    odd = sorted({name for g in games for name in (g["w"], g["b"]) if ", " not in name})
    if odd:
        log(f"names not in 'Last, First' form ({len(odd)}): " + "; ".join(odd[:40]) + (" …" if len(odd) > 40 else ""))
    log(f"size: {len(encoded) / 1e6:.2f} MB raw, {len(gzip.compress(encoded, 9)) / 1e6:.2f} MB gzip")


# ----------------------------------------------------------------------------- generate

def generate(args):
    out = args.out or args.base
    base = args.base
    previous = None
    if base.exists() and not args.rebuild:
        previous = json.loads(base.read_text(encoding="utf-8"))
        args.dataset = args.dataset or previous.get("dataset")
        if previous.get("schema") != SCHEMA:
            raise SystemExit(f"{out} has schema {previous.get('schema')}; expected {SCHEMA}")
        if previous["dataset"] != args.dataset:
            raise SystemExit(f"{out} is dataset {previous['dataset']!r}; pass --dataset {previous['dataset']} "
                             "to append, or --rebuild with a new name")
    elif not args.dataset:
        raise SystemExit("--dataset is required for a new file")
    elif base.exists() and args.rebuild:
        old = json.loads(base.read_text(encoding="utf-8")).get("dataset")
        if old == args.dataset:
            raise SystemExit("--rebuild needs a new --dataset name so browsers discard their answered record")

    games = list(previous["games"]) if previous else []
    positions = list(previous["positions"]) if previous else []
    args.used_urls = {g["url"] for g in games if "url" in g}
    used_epds = {epd_of(fen) for _, fen, _ in positions}
    args.needed = max(0, args.target - len(positions))

    manifest = load_manifest()
    tour_of_event = {tour["event"]: i for i, tour in enumerate(manifest)}
    args.existing_per_tour = collections.Counter(
        tour_of_event[games[g]["ev"]] for g, _, _ in positions if games[g]["ev"] in tour_of_event)
    manifest_changed = False
    all_candidates, tour_stats = [], []
    low_yield_skipped = 0
    for tour_index, tour in enumerate(manifest):
        if tour.get("skip"):
            continue
        if low_yield(tour) and not args.include_low_yield:
            low_yield_skipped += 1
            continue
        try:
            path = fetch_tour_pgn(tour["id"], args.refresh, args.offline)
        except NotFound:
            log(f"{tour['event']}: 404, marked skip")
            tour["skip"] = "404"
            manifest_changed = True
            continue
        except SystemExit as error:  # the network gave up on this tour; the rest can still run
            log(f"{tour['event']}: download failed ({error}); skipped this run")
            continue
        if path is None:
            continue
        drops, seen, tour_candidates, tour_games = collections.Counter(), 0, [], []
        for game_index, game in enumerate(iter_games(path)):
            seen += 1
            found = game_candidates(game, tour_index, game_index, tour, args, drops)
            if found:
                tour_games.append(found[0].game)
                tour_candidates.extend(found)
        names = [n for g in tour_games for n in (g["w"], g["b"])]
        order = tour.get("nameOrder") or (
            "first-last" if names and sum("," in n for n in names) * 2 < len(names) else "last-first")
        for g in tour_games:
            g["w"], g["b"] = format_name(g["w"], order), format_name(g["b"], order)
        all_candidates.extend(tour_candidates)
        tour_stats.append((tour["event"], seen, len(tour_candidates), drops))
        log(f"{tour['event']}: {seen} games, {len(tour_candidates)} candidates")

    if low_yield_skipped:
        log(f"skipped {low_yield_skipped} low-yield tours by name (--include-low-yield to keep them)")
    if manifest_changed:
        write_manifest(manifest)

    args.eval_cache = engine.EvalCache(args.eval_cache_path)
    if args.masters or args.pgnmentor:
        engine_drops, unlisted = collections.Counter(), collections.Counter()
        event_index = {}
        found = engine_candidates(args, args.used_urls, event_index, engine_drops, unlisted)
        games_found = collections.Counter(c.src for c in {(c.tour_index, c.game_index): c for c in found}.values())
        log(f"engine sources: {len(found)} quiet positions from games " + ", ".join(
            f"{k} {v}" for k, v in sorted(games_found.items())) + "; drops: " + ", ".join(
            f"{k} {v}" for k, v in sorted(engine_drops.items())))
        if unlisted:
            log("most common unlisted events: " + "; ".join(
                f"{e} {n}" for e, n in unlisted.most_common(30)))
        all_candidates.extend(screen_engine(found, args, args.eval_cache) if found else [])
    if args.cached_only:
        # Publish from what the engine has already analysed: keep the positions whose full
        # evaluation and stability check are both in the cache and pass, and drop the rest.
        kept, missing = [], 0
        for c in all_candidates:
            if c.src == "broadcast":
                kept.append(c)
                continue
            cp = args.eval_cache.get(c.fen, args.nodes)
            next_cp = args.eval_cache.get(c.next_fen, args.reply_nodes)
            if cp is engine.MISSING or next_cp is engine.MISSING:
                missing += 1
                continue
            if cp is None or next_cp is None or abs(next_cp - cp) > args.quiet_delta * 100:
                continue
            if not args.min_abs_eval <= abs(eval_value(cp)) <= args.max_abs_eval:
                continue
            c.cp, c.next_cp, c.verified = cp, next_cp, True
            kept.append(c)
        log(f"--cached-only: {len(kept)} candidates with a finished evaluation "
            f"({missing} not analysed yet)")
        all_candidates = kept
    source_count = collections.Counter(c.src for c in all_candidates)
    log("candidates: " + ", ".join(f"{k} {v}" for k, v in sorted(source_count.items())))

    chosen, result = sample(all_candidates, used_epds, args) if args.needed else ([], None)
    if len(chosen) < args.needed:
        log(f"\nWARNING: only {len(chosen)} new positions available of {args.needed} wanted")
    chosen.sort(key=lambda c: (c.tour_index, c.game_index, c.ply))
    index_of = {}
    for cand in chosen:
        # A game is its event and its place in it; PGN Mentor games have no url to key on.
        key = (cand.tour_index, cand.game_index)
        if key not in index_of:
            index_of[key] = len(games)
            games.append(cand.game)
        positions.append([index_of[key], cand.fen, eval_value(cand.cp)])

    doc = {"schema": SCHEMA, "dataset": args.dataset,
           "generated": datetime.date.today().isoformat(),
           "tours": len({g["ev"] for g in games}), "games": games, "positions": positions}
    validate(doc, previous, args.max_abs_eval, args.min_abs_eval)
    encoded = serialize(doc).encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(encoded)
    tmp.rename(out)
    log(f"\nwrote {out}")
    report(doc, len(chosen), tour_stats, encoded, result)


# ----------------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    d = sub.add_parser("discover", help="add qualifying broadcast tours to the manifest")
    d.add_argument("--min-tier", type=int, default=4)
    d.add_argument("--top-pages", type=int, default=20)
    d.add_argument("--search-pages", type=int, default=2)

    g = sub.add_parser("generate", help="sample positions into public/positions.json")
    g.add_argument("--target", type=int, default=25000, help="total positions wanted in the file")
    g.add_argument("--per-game", type=int, default=4, help="max positions from one game")
    g.add_argument("--max-per-tour", type=int, default=1500, help="max new positions from one tour")
    g.add_argument("--min-elo", type=int, default=2600, help="both players, for new rows")
    g.add_argument("--min-move", type=int, default=10, help="skip positions before this move")
    g.add_argument("--max-abs-eval", type=float, default=8.0, help="skip |eval| beyond the bar")
    g.add_argument("--min-abs-eval", type=float, default=0.5, help="no new row closer to equal than this")
    g.add_argument("--quiet-delta", type=float, default=0.30,
                   help="max eval change over the reply for a position to count as quiet")
    g.add_argument("--seed", type=int, default=20260911)
    g.add_argument("--dataset", help="dataset name (default: the existing file's)")
    g.add_argument("--masters", action="store_true", help="also use games from tools/masters.py")
    g.add_argument("--pgnmentor", action="store_true", help="also use events from tools/pgnmentor.py")
    g.add_argument("--masters-first", type=int, default=2000)
    g.add_argument("--masters-last", type=int, default=2019)
    g.add_argument("--engine", default=shutil.which("stockfish") or "/opt/homebrew/bin/stockfish")
    g.add_argument("--nodes", type=int, default=1_000_000, help="Stockfish nodes per shipped eval")
    g.add_argument("--reply-nodes", type=int, default=300_000,
                   help="Stockfish nodes for the position after the reply (the stability check)")
    g.add_argument("--screen-nodes", type=int, default=60_000, help="Stockfish nodes per screen eval")
    g.add_argument("--screen-per-game", type=int, default=24, help="quiet positions screened per game")
    g.add_argument("--workers", type=int, default=7, help="Stockfish processes, one thread each")
    g.add_argument("--cached-only", action="store_true",
                   help="use only positions Stockfish has already evaluated; runs no new analysis")
    g.add_argument("--eval-cache", dest="eval_cache_path", type=Path, default=engine.CACHE_FILE,
                   help="where Stockfish results are cached (default tools/.cache/evals.jsonl)")
    g.add_argument("--hash", type=int, default=64, help="Stockfish hash per process, MB")
    g.add_argument("--refresh", action="store_true", help="re-download cached PGNs")
    g.add_argument("--rebuild", action="store_true", help="start from an empty file")
    g.add_argument("--offline", action="store_true", help="use cached PGNs only")
    g.add_argument("--include-low-yield", action="store_true", help="do not skip tours by name")
    g.add_argument("--base", type=Path, default=OUT, help="the file to append to (default public/positions.json)")
    g.add_argument("--out", type=Path, help="where to write (default: --base), e.g. for a trial run")

    args = parser.parse_args()
    discover(args) if args.command == "discover" else generate(args)


if __name__ == "__main__":
    main()
