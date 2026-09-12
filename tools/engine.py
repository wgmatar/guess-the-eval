"""Local Stockfish evaluations for positions from games that carry none.

Reproducible: one thread per engine, a fixed node budget and a fresh game (cleared hash) for
every position, so the same FEN and budget always give the same score. Every result is cached
in tools/.cache/evals.jsonl, so a re-run only analyses what is new. Scores are centipawns from
White's view; mates come back as None. Stockfish (GPL-3.0) runs offline on the developer's
machine only and is not part of the site.
"""

import atexit
import json
import multiprocessing
import sys
import time
from pathlib import Path

import chess
import chess.engine

CACHE_FILE = Path(__file__).resolve().parent / ".cache" / "evals.jsonl"
MISSING = object()

_engine = None


def log(message: str):
    print(message, file=sys.stderr, flush=True)


class EvalCache:
    def __init__(self, path: Path = CACHE_FILE):
        self.path = path
        self.values = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    self.values[(row["fen"], row["nodes"])] = row["cp"]
        path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(path, "a", encoding="utf-8")

    def get(self, fen: str, nodes: int):
        return self.values.get((fen, nodes), MISSING)

    def put(self, fen: str, nodes: int, cp):
        self.values[(fen, nodes)] = cp
        self.handle.write(json.dumps({"fen": fen, "nodes": nodes, "cp": cp}, separators=(",", ":")) + "\n")

    def flush(self):
        self.handle.flush()


def _quit():
    if _engine is not None:
        try:
            _engine.quit()
        except Exception:
            pass


def _init(path: str, hash_mb: int):
    global _engine
    _engine = chess.engine.SimpleEngine.popen_uci(path)
    _engine.configure({"Threads": 1, "Hash": hash_mb})
    atexit.register(_quit)


def _analyse(job):
    fen, nodes = job
    info = _engine.analyse(chess.Board(fen), chess.engine.Limit(nodes=nodes), game=object())
    score = info["score"].white()
    return fen, nodes, None if score.is_mate() else score.score()


def evaluate(fens, nodes: int, engine_path: str, workers: int, cache: EvalCache,
             hash_mb: int = 256, label: str = "") -> dict:
    """Centipawns (or None for mate) for every FEN, analysing only those not cached."""
    fens = list(dict.fromkeys(fens))
    todo = [f for f in fens if cache.get(f, nodes) is MISSING]
    if todo:
        log(f"{label}: analysing {len(todo)} positions at {nodes} nodes on {workers} engines "
            f"({len(fens) - len(todo)} cached)")
        start = time.monotonic()
        with multiprocessing.get_context("spawn").Pool(workers, _init, (engine_path, hash_mb)) as pool:
            for i, (fen, n, cp) in enumerate(pool.imap_unordered(_analyse, [(f, nodes) for f in todo], chunksize=4), 1):
                cache.put(fen, n, cp)
                if i % 1000 == 0 or i == len(todo):
                    cache.flush()
                    rate = i / max(1e-9, time.monotonic() - start)
                    log(f"  {i} / {len(todo)}  ({rate:.1f}/s, {(len(todo) - i) / max(rate, 1e-9) / 60:.0f} min left)")
            # Leaving the block terminates the workers. Joining them instead would wait forever:
            # python-chess keeps a thread alive in each worker. A terminated worker's Stockfish
            # sees its input close and quits on its own.
        cache.flush()
    return {f: cache.get(f, nodes) for f in fens}
