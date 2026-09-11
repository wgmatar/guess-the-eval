#!/usr/bin/env python3
"""Build public/positions.json from Lichess broadcast games.

    python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt
    tools/.venv/bin/python tools/fetch_positions.py discover
    tools/.venv/bin/python tools/fetch_positions.py generate --target 25000

`discover` finds finished, top-tier classical broadcast tournaments through the public
Lichess API and appends them to tools/broadcast_tours.json. Existing rows are kept verbatim.

`generate` downloads each tour's PGN once (cached, gitignored, under tools/.cache/), in which
Lichess has annotated every move with `[%eval]`: Stockfish server analysis, White's
perspective, in pawns. Positions are sampled from classical games between strong players and
appended to the dataset. Rows already in the file are kept byte-for-byte, so the browser's
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
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.pgn

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
SCHEMA = 1

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
            with urllib.request.urlopen(request, timeout=300) as response:
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
    """(ply, board-after-move, cp from White's view) for every mainline move Lichess
    evaluated with a non-mate score. The `[%eval]` on a move describes the resulting position."""
    board = game.board()
    out = []
    for ply, node in enumerate(game.mainline(), start=1):
        board.push(node.move)
        pov = node.eval()
        if pov is None:
            continue
        score = pov.white()
        if score.is_mate():
            continue
        out.append((ply, board.copy(stack=False), score.score()))
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
    cp: int
    game: dict


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
    for ply, board, cp in positions:
        if board.fullmove_number < args.min_move or abs(cp) > args.max_abs_eval * 100:
            continue
        if board.is_game_over():
            continue
        fen = board.fen()
        if ply_of(fen) != ply:
            drops["ply mismatch"] += 1
            continue
        candidates.append(Candidate(tour_index, game_index, ply, fen, board.epd(), cp, row))
    return candidates


# ----------------------------------------------------------------------------- sample

def sample(candidates, used_epds, args):
    rng = random.Random(args.seed)
    candidates = sorted(candidates, key=lambda c: (c.tour_index, c.game_index, c.ply))
    rng.shuffle(candidates)
    accepted_plies = collections.defaultdict(list)
    # Rows already in the file count toward each tour's cap.
    per_tour = collections.Counter(getattr(args, "existing_per_tour", {}))
    chosen = []
    for cand in candidates:
        if len(chosen) >= args.needed:
            break
        if cand.epd in used_epds or per_tour[cand.tour_index] >= args.max_per_tour:
            continue
        plies = accepted_plies[(cand.tour_index, cand.game_index)]
        if len(plies) >= args.per_game or any(abs(p - cand.ply) < 6 for p in plies):
            continue
        plies.append(cand.ply)
        per_tour[cand.tour_index] += 1
        used_epds.add(cand.epd)
        chosen.append(cand)
    return chosen


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


def validate(doc: dict, previous: dict, max_abs_eval: float):
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
        used.add(game_index)
    if len(used) != len(games):
        raise SystemExit("a game has no positions")
    for i, game in enumerate(games):
        if not GAME_URL.match(game["url"]):
            raise SystemExit(f"game {i}: bad url {game['url']}")
    if json.loads(serialize(doc)) != doc:
        raise SystemExit("serialised output does not re-parse to the same document")


def log(message: str):
    print(message, file=sys.stderr, flush=True)


def report(doc: dict, new_count: int, tour_stats: list, encoded: bytes):
    games, positions = doc["games"], doc["positions"]
    new = positions[len(positions) - new_count:] if new_count else []
    log(f"\n{len(positions)} positions from {len(games)} games ({new_count} new positions)")
    bands = [(0, 0.3), (0.3, 1.0), (1.0, 2.5), (2.5, 8.01)]
    hist = collections.Counter()
    for _, _, value in positions:
        for low, high in bands:
            if low <= abs(value) < high:
                hist[(low, high)] += 1
                break
    log("|eval| histogram (all rows):")
    for low, high in bands:
        log(f"  [{low:.1f}, {min(high, 8.0):.1f}]  {hist[(low, high)]:6d}  {100 * hist[(low, high)] / max(1, len(positions)):5.1f} %")
    zeros = sum(1 for _, _, v in positions if v == 0)
    log(f"  exactly 0.00: {zeros} ({100 * zeros / max(1, len(positions)):.1f} %)")
    white = sum(1 for _, fen, _ in positions if fen.split()[1] == "w")
    log(f"side to move: white {white}, black {len(positions) - white}")
    log("per year:  " + ", ".join(f"{y}: {n}" for y, n in sorted(
        collections.Counter(games[g]["y"] for g, _, _ in positions).items())))
    log("per tour (positions in file / games seen / new candidates; drops):")
    per_event = collections.Counter(games[g]["ev"] for g, _, _ in positions)
    for event, seen, found, drops in tour_stats:
        dropped = ", ".join(f"{k} {v}" for k, v in sorted(drops.items())) or "none"
        log(f"  {per_event.get(event, 0):5d} / {seen:4d} / {found:6d}  {event}; {dropped}")
    odd = sorted({name for g in games for name in (g["w"], g["b"]) if ", " not in name})
    if odd:
        log(f"names not in 'Last, First' form ({len(odd)}): " + "; ".join(odd[:40]) + (" …" if len(odd) > 40 else ""))
    log(f"size: {len(encoded) / 1e6:.2f} MB raw, {len(gzip.compress(encoded, 9)) / 1e6:.2f} MB gzip")
    if new:
        log(f"new rows' mean |eval|: {sum(abs(v) for _, _, v in new) / len(new):.2f}")


# ----------------------------------------------------------------------------- generate

def generate(args):
    out = args.out
    previous = None
    if out.exists() and not args.rebuild:
        previous = json.loads(out.read_text(encoding="utf-8"))
        if previous.get("schema") != SCHEMA:
            raise SystemExit(f"{out} has schema {previous.get('schema')}; expected {SCHEMA}")
        if previous["dataset"] != args.dataset:
            raise SystemExit(f"{out} is dataset {previous['dataset']!r}; pass --dataset {previous['dataset']} "
                             "to append, or --rebuild with a new name")
    elif out.exists() and args.rebuild:
        old = json.loads(out.read_text(encoding="utf-8")).get("dataset")
        if old == args.dataset:
            raise SystemExit("--rebuild needs a new --dataset name so browsers discard their answered record")

    games = list(previous["games"]) if previous else []
    positions = list(previous["positions"]) if previous else []
    args.used_urls = {g["url"] for g in games}
    used_epds = {epd_of(fen) for _, fen, _ in positions}
    args.needed = max(0, args.target - len(positions))

    manifest = load_manifest()
    tour_of_event = {tour["event"]: i for i, tour in enumerate(manifest)}
    args.existing_per_tour = collections.Counter(
        tour_of_event[games[g]["ev"]] for g, _, _ in positions if games[g]["ev"] in tour_of_event)
    manifest_changed = False
    all_candidates, tour_stats = [], []
    for tour_index, tour in enumerate(manifest):
        if tour.get("skip"):
            continue
        try:
            path = fetch_tour_pgn(tour["id"], args.refresh, args.offline)
        except NotFound:
            log(f"{tour['event']}: 404, marked skip")
            tour["skip"] = "404"
            manifest_changed = True
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

    if manifest_changed:
        write_manifest(manifest)

    chosen = sample(all_candidates, used_epds, args) if args.needed else []
    if len(chosen) < args.needed:
        log(f"\nWARNING: only {len(chosen)} new positions available of {args.needed} wanted; "
            "run discover to add tours")
    chosen.sort(key=lambda c: (c.tour_index, c.game_index, c.ply))
    index_of = {}
    for cand in chosen:
        url = cand.game["url"]
        if url not in index_of:
            index_of[url] = len(games)
            games.append(cand.game)
        positions.append([index_of[url], cand.fen, eval_value(cand.cp)])

    doc = {"schema": SCHEMA, "dataset": args.dataset,
           "generated": datetime.date.today().isoformat(),
           "tours": len({g["ev"] for g in games}), "games": games, "positions": positions}
    validate(doc, previous, args.max_abs_eval)
    encoded = serialize(doc).encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(encoded)
    tmp.rename(out)
    log(f"\nwrote {out}")
    report(doc, len(chosen), tour_stats, encoded)


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
    g.add_argument("--per-game", type=int, default=3, help="max positions from one game")
    g.add_argument("--max-per-tour", type=int, default=1500, help="max new positions from one tour")
    g.add_argument("--min-elo", type=int, default=2500)
    g.add_argument("--min-move", type=int, default=10, help="skip positions before this move")
    g.add_argument("--max-abs-eval", type=float, default=8.0, help="skip |eval| beyond the bar")
    g.add_argument("--seed", type=int, default=20260910)
    g.add_argument("--dataset", default="broadcasts-a")
    g.add_argument("--refresh", action="store_true", help="re-download cached PGNs")
    g.add_argument("--rebuild", action="store_true", help="start from an empty file")
    g.add_argument("--offline", action="store_true", help="use cached PGNs only")
    g.add_argument("--out", type=Path, default=OUT, help="where to write (default public/positions.json)")

    args = parser.parse_args()
    discover(args) if args.command == "discover" else generate(args)


if __name__ == "__main__":
    main()
