#!/usr/bin/env python3
"""Checks for the dataset tools' pure parts: python tools/selftest.py (exits non-zero on failure)."""

import chess

import masters
import quota


def check(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def test_buckets():
    cases = {0.49: None, 0.5: 0, 0.69: 0, 0.7: 1, 1.2: 1, 1.21: 2, 2.0: 2, 2.01: 3, 3.0: 3,
             3.01: 4, 5.0: 4, 5.01: 5, 8.0: 5, 8.01: None, -0.7: 1, -1.2: 1, -5.5: 5}
    for value, bucket in cases.items():
        check(quota.bucket_of(value) == bucket, f"bucket_of({value}) = {quota.bucket_of(value)}, want {bucket}")
    check(quota.bucket_targets(13528) == [1353, 5411, 2706, 1894, 1488, 676], "targets for 13,528")
    check(sum(quota.bucket_targets(997)) == 997, "targets sum to n")
    mins = quota.minimums(13528)
    check(mins == {"black": 5412, "unequal": 6764, "down": 2030, "endgame": 2706}, f"minimums {mins}")


def test_describe():
    # Rook endgame, White a pawn up and better: an endgame, material not level.
    board = chess.Board("8/5k2/8/3R4/8/2P5/5K2/4r3 w - - 0 50")
    info = quota.describe(board, 0.8)
    check(info["cats"]["endgame"] and not info["cats"]["equal"] and not info["cats"]["down"], f"rook ending {info}")
    check(info["tier"] == 1, "an endgame counts as tricky")
    # Black better while a pawn down: compensation.
    board = chess.Board("r1bq1rk1/pp3ppp/2n5/8/3P4/8/PP2QPPP/RNB2RK1 b - - 0 12")
    info = quota.describe(board, -0.9)
    check(info["cats"]["black"] and info["cats"]["down"] and info["cats"]["unequal"]
          and info["tier"] == 0, f"compensation {info}")
    # Level material, queens on: not an endgame.
    info = quota.describe(chess.Board(), 0.6)
    check(info["cats"]["equal"] and not info["cats"]["endgame"] and not info["cats"]["black"], f"start {info}")
    # Up a piece and winning by as much: the simplest kind.
    board = chess.Board("rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    check(quota.describe(board, 3.2)["tier"] == 2, "a big material lead comes last of the imbalances")


def item(i, value, *, black=False, equal=False, down=False, endgame=False, white=True, game=None):
    return quota.Item(key=(0, i, 20), game=game if game is not None else (0, i), event="e", ply=20,
                      epd=f"epd{i}", value=-value if black else value,
                      cats={"black": black, "unequal": not equal, "equal": equal, "down": down,
                            "endgame": endgame},
                      tier=0 if down else 4 if equal else 1, white_to_move=white)


def test_sample():
    items = []
    values = [0.6, 0.9, 1.5, 2.5, 4.0, 6.0]
    for i in range(4000):
        v = values[i % 6]
        j = i // 6  # categories independent of the bucket
        items.append(item(i, v, black=j % 2 == 0, equal=j % 3 != 2, down=j % 5 == 0,
                          endgame=v <= 3 and j % 4 == 1, white=(j // 2) % 2 == 0))
    result = quota.sample(items, 600, set(), seed=1)
    check(len(result.chosen) == 600, f"chose {len(result.chosen)}")
    counts = [sum(1 for it in result.chosen if it.bucket == b) for b in range(6)]
    check(counts == result.targets, f"buckets {counts} vs {result.targets}")
    for cat, need in result.mins.items():
        have = sum(1 for it in result.chosen if it.cats[cat])
        check(have >= need, f"{cat}: {have} < {need}")
    white = sum(it.white_to_move for it in result.chosen)
    check(abs(white / 600 - 0.5) <= 0.02, f"side to move {white}")
    check(result.shortfalls == [], f"shortfalls {result.shortfalls}")
    again = quota.sample(items, 600, set(), seed=1)
    check([it.key for it in again.chosen] == [it.key for it in result.chosen], "deterministic")
    # Per game: at most three, six plies apart.
    same = [quota.Item(key=(0, 0, p), game=(0, 0), event="e", ply=p, epd=f"p{p}", value=0.9,
                       cats={"black": False, "unequal": True, "equal": False, "down": False,
                             "endgame": False},
                       tier=1, white_to_move=p % 2 == 0) for p in range(20, 60)]
    chosen = quota.sample(same, 10, set(), seed=2, per_game=4).chosen
    plies = sorted(it.ply for it in chosen)
    check(len(plies) <= 4 and all(b - a >= 6 for a, b in zip(plies, plies[1:])), f"per game {plies}")
    # Too few candidates: every missed target is reported.
    short = quota.sample(items[:50], 600, set(), seed=1)
    check(any("bucket" in s for s in short.shortfalls), "reports bucket shortfalls")


def test_events():
    def rejection(event, round_="1"):
        return masters.event_rejection({"Event": event, "Round": round_})
    for ok in ["Corus A", "Linares 21st", "WCh 2008 Anand-Kramnik", "Candidates 2014",
               "Sinquefield Cup 2015", "Olympiad-39", "World Cup 2011", "Tata Steel Masters",
               "Dortmund Sparkassen 2007", "M-Tel Masters 2006", "London Chess Classic 2012"]:
        check(rejection(ok) is None, f"{ok} should be kept: {rejection(ok)}")
    for bad in ["Corus B", "Tata Steel Challengers", "Zurich CC Rapid", "Linares blitz",
                "Aeroflot Open", "Olympiad Women", "Norway Chess Blitz", "Sinquefield Cup Blitz",
                "KasparovChess GP g/60", "Sydney ol exh", "Botvinnik Memorial m 5'", "Grand Prix Open"]:
        check(rejection(bad) is not None, f"{bad} should be rejected")
    check(rejection("World Cup 2011", "3.3") == "tie-break", "World Cup tie-break")
    check(rejection("World Cup 2011", "3.2") is None, "World Cup classical")
    check(rejection("Corus A", "5.3") is None, "a round-robin board number is not a tie-break")
    check(rejection("FIDE-Wch k.o.", "2.3") == "tie-break", "FIDE knockout tie-break")
    check(rejection("FIDE Grand Prix Baku") is None, "FIDE Grand Prix")
    check(rejection("Geneva Grand Prix 2017") is None, "a Grand Prix leg named after its city")


def test_pgnmentor():
    import pathlib
    import pgnmentor

    def label(file, event):
        return pgnmentor.event_headers(pathlib.Path(file), {"Event": event, "Round": "1"})["Event"]
    check(label("Linares2004.pgn", "XXI SuperGM") == "Linares XXI SuperGM", "series prefix")
    check(label("WijkaanZee2005.pgn", "Corus A") == "Wijk aan Zee Corus A", "Wijk aan Zee")
    check(label("Geneva2017.pgn", "Geneva Grand Prix 2017") == "Geneva Grand Prix 2017", "no series")
    check(masters.event_rejection({"Event": label("Linares2004.pgn", "XXI SuperGM")}) is None, "Linares kept")
    check(masters.event_rejection({"Event": label("Dortmund2011.pgn", "39th GM")}) is None, "Dortmund kept")
    check(masters.event_rejection({"Event": label("Biel2007.pgn", "GM Blitz Playoff")}) is not None, "Biel not listed")
    check(masters.event_rejection({"Event": label("Dortmund2002.pgn", "Sparkassen Gp 1 Playoff")}) is not None,
          "a play-off is not classical")
    check(masters.event_rejection({"Event": label("WijkaanZee2010.pgn", "Corus B")}) is not None, "group B")


if __name__ == "__main__":
    for test in (test_buckets, test_describe, test_sample, test_events, test_pgnmentor):
        test()
        print(f"ok  {test.__name__}")
