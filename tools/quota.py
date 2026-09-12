"""Quota sampling for new rows.

The new rows are chosen to be interesting to guess rather than a uniform sample: every one has
|eval| >= 0.50, the eval buckets follow fixed shares, the side to move is balanced, and minimums
hold for positions where Black is better, where the material is unequal, where the winning side
is down material (real compensation) and for tricky endgames. Within those rules, imbalanced
material comes first, the winning side's compensation before a plain lead.

Pure functions only: `describe()` classifies a position, `sample()` chooses rows. Both are
deterministic for a given seed.
"""

import collections
import math
import random
from dataclasses import dataclass, field

import chess

POINTS = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}

# (low, high, share). 0.70 and 1.20 both belong to the second bucket; the others include their
# upper edge and exclude their lower one.
BUCKETS = [
    (0.50, 0.70, 0.10),
    (0.70, 1.20, 0.40),
    (1.20, 2.00, 0.20),
    (2.00, 3.00, 0.14),
    (3.00, 5.00, 0.11),
    (5.00, 8.00, 0.05),
]
MIN_SHARES = {"black": 0.40, "unequal": 0.50, "down": 0.15, "endgame": 0.20}
CATEGORIES = tuple(MIN_SHARES)
LABELS = {"black": "Black better", "unequal": "material unequal", "equal": "material equal",
          "down": "winning side down material", "endgame": "tricky endgame"}


def bucket_of(value: float):
    """Index into BUCKETS for a two-decimal eval, or None below 0.50 or above 8.00."""
    v = round(abs(value), 2)
    if v < 0.50 or v > 8.00:
        return None
    if v < 0.70:
        return 0
    if v <= 1.20:
        return 1
    if v <= 2.00:
        return 2
    if v <= 3.00:
        return 3
    if v <= 5.00:
        return 4
    return 5


def bucket_label(index: int) -> str:
    low, high, _ = BUCKETS[index]
    return f"{low:.2f}-{high:.2f}"


def bucket_targets(n: int) -> list:
    """Rows per bucket for n new rows: the shares, rounded by largest remainder to sum to n."""
    raw = [share * n for _, _, share in BUCKETS]
    counts = [math.floor(r) for r in raw]
    order = sorted(range(len(raw)), key=lambda i: raw[i] - counts[i], reverse=True)
    for i in order[:n - sum(counts)]:
        counts[i] += 1
    return counts


def minimums(n: int) -> dict:
    return {cat: math.ceil(share * n - 1e-9) for cat, share in MIN_SHARES.items()}


def material(board: chess.Board):
    white = sum(POINTS[p.piece_type] for p in board.piece_map().values() if p.color == chess.WHITE and p.piece_type in POINTS)
    black = sum(POINTS[p.piece_type] for p in board.piece_map().values() if p.color == chess.BLACK and p.piece_type in POINTS)
    return white, black


def describe(board: chess.Board, value: float) -> dict:
    """The categories a position with this eval (pawns, White's view) belongs to."""
    white, black = material(board)
    diff = white - black
    sign = 1 if value > 0 else -1
    pieces = {color: sum(1 for p in board.piece_map().values()
                         if p.color == color and p.piece_type not in (chess.PAWN, chess.KING))
              for color in (chess.WHITE, chess.BLACK)}
    queens = any(p.piece_type == chess.QUEEN for p in board.piece_map().values())
    endgame = (not queens and pieces[chess.WHITE] <= 2 and pieces[chess.BLACK] <= 2
               and 0.50 <= abs(value) <= 3.00)
    cats = {
        "black": value < 0,
        "unequal": diff != 0,
        "equal": diff == 0,
        "down": sign * diff < 0,
        "endgame": endgame,
    }
    # How far the eval is from "count the material": 0 is least explained by it.
    lead = sign * diff
    # Material imbalance first, the winning side's compensation before a plain lead; level
    # material fills what is left, an endgame before a middlegame.
    if cats["down"]:
        tier = 0
    elif cats["unequal"]:
        tier = 1 if lead <= 2 else 2
    elif endgame:
        tier = 3
    else:
        tier = 4
    return {"cats": cats, "tier": tier, "white_to_move": board.turn == chess.WHITE}


@dataclass
class Item:
    """One candidate row, as the sampler sees it."""
    key: tuple          # a total, deterministic order before the shuffle
    game: tuple         # the game it comes from
    event: str
    ply: int
    epd: str
    value: float
    cats: dict
    tier: int
    white_to_move: bool
    bucket: int = field(init=False)

    def __post_init__(self):
        self.bucket = bucket_of(self.value)


@dataclass
class Result:
    chosen: list
    targets: list
    mins: dict
    shortfalls: list


def sample(items, n: int, used_epds: set, seed: int, per_game: int = 3, spacing: int = 6,
           event_cap: int | None = None, existing_per_event=None, side_slack: float = 0.01) -> Result:
    items = [it for it in items if it.bucket is not None]
    rng = random.Random(seed)
    order = sorted(items, key=lambda it: it.key)
    rng.shuffle(order)
    rank = {id(it): i for i, it in enumerate(order)}

    targets = bucket_targets(n)
    mins = minimums(n)
    side_cap = [math.ceil(t / 2) + max(1, round(side_slack * t)) for t in targets]
    pools = [[it for it in order if it.bucket == b] for b in range(len(BUCKETS))]

    used = set(used_epds)
    per_event = collections.Counter(existing_per_event or {})
    plies = collections.defaultdict(list)
    in_bucket = [0] * len(BUCKETS)
    sides = [[0, 0] for _ in BUCKETS]
    cat_count = collections.Counter()
    cat_in_bucket = collections.Counter()
    chosen = []
    taken = set()

    def fits(it, side_limit=True) -> bool:
        b = it.bucket
        if id(it) in taken or in_bucket[b] >= targets[b] or it.epd in used:
            return False
        if side_limit and sides[b][it.white_to_move] >= side_cap[b]:
            return False
        if event_cap is not None and per_event[it.event] >= event_cap:
            return False
        game_plies = plies[it.game]
        return len(game_plies) < per_game and all(abs(p - it.ply) >= spacing for p in game_plies)

    def take(it):
        taken.add(id(it))
        used.add(it.epd)
        per_event[it.event] += 1
        plies[it.game].append(it.ply)
        in_bucket[it.bucket] += 1
        sides[it.bucket][it.white_to_move] += 1
        for cat in CATEGORIES:
            if it.cats[cat]:
                cat_count[cat] += 1
                cat_in_bucket[(cat, it.bucket)] += 1
        chosen.append(it)

    # A: the minimums, scarcest category first, spread over the buckets in proportion to their
    # targets, preferring rows that also count toward other categories still short.
    for cat in ("black", "endgame", "down", "unequal"):
        eligible = [b for b in range(len(BUCKETS)) if any(it.cats[cat] for it in pools[b])]
        total = sum(targets[b] for b in eligible)
        for b in eligible:
            want = math.ceil(mins[cat] * targets[b] / total) if total else 0
            short = [c for c in CATEGORIES if c != cat and cat_count[c] < mins[c]]
            pool = sorted((it for it in pools[b] if it.cats[cat]),
                          key=lambda it: (-sum(it.cats[c] for c in short), it.tier, rank[id(it)]))
            for it in pool:
                if cat_in_bucket[(cat, b)] >= want or cat_count[cat] >= mins[cat] * 1.02:
                    break
                if fits(it):
                    take(it)

    # B: fill every bucket, least material-explained first; C: the same without the side limit.
    for side_limit in (True, False):
        for b in range(len(BUCKETS)):
            for it in sorted(pools[b], key=lambda it: (it.tier, rank[id(it)])):
                if in_bucket[b] >= targets[b]:
                    break
                if fits(it, side_limit):
                    take(it)

    shortfalls = []
    for b, target in enumerate(targets):
        if in_bucket[b] < target:
            shortfalls.append(f"bucket {bucket_label(b)}: {in_bucket[b]} of {target}")
    for cat, need in mins.items():
        if cat_count[cat] < need:
            shortfalls.append(f"{LABELS[cat]}: {cat_count[cat]} of at least {need}")
    white = sum(s[1] for s in sides)
    if chosen and abs(white / len(chosen) - 0.5) > 0.02:
        shortfalls.append(f"side to move: White {white} of {len(chosen)}")
    chosen.sort(key=lambda it: it.key)
    return Result(chosen, targets, mins, shortfalls)
