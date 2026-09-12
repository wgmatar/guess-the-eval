# Guess The Eval

**Play it: https://wgmatar.github.io/guess-the-eval/**

A chess position from an elite classical game appears. You guess the engine's evaluation
(in pawns, from White's side) by typing it or dragging the eval bar beside the board, then
submit. The board faces the side to move, and the eval bar turns with it, as on Lichess; the
numbers are always from White's side. The bar springs to the truth and your guess turns gold (spot on), green (close) or
red (off), each with its own short sound. The feed never ends and never repeats a position until you have seen them all;
everything you answered stays browsable above the live position, frozen as you left it.
Once a position is answered, a link opens the source game on Lichess at that exact move.

22,046 positions from 8,772 games in 363 events, all classical chess between
elite players. The first 11,472 come from Lichess broadcasts of games between players rated
2500+, with Lichess's own Stockfish evaluation of each move. The 10,574 added since come
from the top tournaments of 2000 to 2019 and from more recent broadcasts, both players rated
2600+, evaluated offline with Stockfish: every one of them is at least half a pawn from equal,
and none is a quiet drift where the material settles the matter.

## Controls

| | Keyboard | Mouse / touch |
|---|---|---|
| Guess | type a number: `1.3`, `-0.45`, `+2` (clamped to ±8) | drag the bar or its bubble; the end nearer a side's pieces is better for that side |
| Submit | <kbd>Enter</kbd> | **Submit** |
| Next position | <kbd>Enter</kbd>, <kbd>↓</kbd> or <kbd>S</kbd> | **Next**, or swipe up on the board |
| Previous (answered) positions | <kbd>↑</kbd> or <kbd>W</kbd> | swipe down, or scroll |
| Stats | **Stats** link; <kbd>Esc</kbd> to return | swipe left; right to return |
| Sound | the speaker beside **Stats**, or the row on the Stats page | the same |
| Arrows and circles | | right-drag on the board for an arrow, right-click for a circle; hold <kbd>Shift</kbd> for red, <kbd>Alt</kbd> for blue, both for yellow; the same shape again removes it; a left click on the board clears them |

There is no skipping: the live position must be answered before the next one appears.

## Scoring

- **Gold**: within 0.03 of the engine (0.05 beyond ±1.20). A dead-equal position is gold
  only for exactly 0.00.
- **Green**: the right side, and the right magnitude band
  (0–0.30, 0.30–0.45, 0.45–0.70, 0.70–1.20, 1.20–1.80, 1.80–2.50, 2.50–3.30, 3.30–4.50,
  4.50+), with 0.05 of slack at each edge.
- **Red**: anything else, including any guess for the wrong side.

A streak counts gold and green answers in a row.

## Privacy

There are no accounts and no server. Progress lives only in your browser's `localStorage`,
in five keys: `gte.v1.dataset`, `gte.v1.stats`, `gte.v1.answered`, `gte.v1.history`, and
`gte.v1.sound` (whether the reveal plays a sound).
Add `?reset` to the URL to clear them. `?seed=N` makes the order of positions reproducible.

## Development

Requires Node 22 or newer.

```sh
npm install
npm run dev        # http://localhost:5173/guess-the-eval/
npm test           # Vitest, watch mode (npm test -- --run for a single pass)
npm run lint       # ESLint and Prettier
npm run build      # type-check, then build to dist/
```

```
src/core/    pure game logic: evaluation maths, scoring, bar mapping, layout, gestures
src/store/   localStorage persistence and the feed state machine
src/ui/      React components: board, bar, bubbles, typed guess, pager, stats
tools/       offline dataset and piece-art generators (Python)
public/      positions.json (generated) and the favicon
```

The core logic is a port of the iOS app of the same name, with its test tables ported to
Vitest.

## Regenerating the dataset

```sh
python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt
brew install stockfish                                        # 19, for pre-2020 games
tools/.venv/bin/python tools/fetch_positions.py discover      # find broadcast tournaments
tools/.venv/bin/python tools/masters.py walk                  # masters database game ids
tools/.venv/bin/python tools/masters.py export                # ... and their PGNs
tools/.venv/bin/python tools/pgnmentor.py                     # PGN Mentor event files
tools/.venv/bin/python tools/fetch_positions.py generate --masters --pgnmentor --target 25000
tools/.venv/bin/python tools/selftest.py                      # checks for the sampler and filters
```

`discover` searches the Lichess broadcast API for finished, top-tier classical tournaments and
adds them to `tools/broadcast_tours.json`. `generate` downloads each tournament's PGN once
(cached in `tools/.cache/`) and reads Lichess's evaluation of every move. Lichess streams large
tournament PGNs slowly, so it skips discovered sections that cannot yield strong classical games
(lower Olympiad sections, women's, junior and senior events, weak open groups, non-classical
formats); `--include-low-yield` keeps them.

Broadcasts start around 2020, so older top tournaments (Candidates, World Championships, Wijk
aan Zee, Linares, Dortmund, Sofia, Nanjing, London, Saint Louis, Stavanger, Shamkir, Zurich,
FIDE Grand Prix, World Cup, Olympiad) come from two more sources. `masters.py` walks the Lichess
masters database's opening tree year by year for games between players rated 2600+ and
exports their PGNs; it needs a Lichess API token with no permissions, read from
`~/.config/guess-the-eval/lichess-token` and never printed or stored elsewhere. The explorer
allows about 30 requests a minute, so the walk takes a couple of hours. `pgnmentor.py`
downloads PGN Mentor's per-event files. A game found in both keeps its masters copy, which
links to lichess.org; PGN Mentor positions link to the Lichess analysis board instead. These
games carry no evaluations: `generate` screens up to 24 of each game's quiet positions with
Stockfish at `--screen-nodes` (60,000), then evaluates the ones it picks at `--nodes`
(1,000,000) and the position after the reply at `--reply-nodes` (300,000), with one thread per
engine, `--workers` engines and a fresh game per position, so the numbers are reproducible.
Every result is cached in `tools/.cache/evals.jsonl`; a full run takes a few hours.

New rows are chosen by quota (`tools/quota.py`), not at random: both players rated 2600+,
|eval| at least 0.50, fixed shares per eval bucket (40% between 0.70 and 1.20), the side to move
balanced, and minimums for positions where Black is better (40%), the material is unequal (50%),
the winning side is down material (15%) and tricky endgames (20%). A game gives at most four
rows, at least six plies apart. Only quiet positions qualify: not
in check, not reached by a capture, and an eval that moves by at most `--quiet-delta` (0.30) on
the next move. Within those rules, positions whose evaluation is not simply the material count
come first. The log ends with the distribution and any target the sources could not meet.

Existing rows are never changed, because browsers store answered positions by index;
`--rebuild` with a new `--dataset` name starts over and tells browsers to discard that record.
`--out` writes somewhere else, for a trial run. Requests are sent one at a time, a second or
more apart, with back-off on 429.

`tools/fetch_pieces.py` regenerates `src/ui/pieces.ts` from the Cburnett SVGs.

## Deployment

Every push to `main` runs lint, tests and the build in GitHub Actions, then publishes `dist/`
to GitHub Pages.

## Credits

Game data: [Lichess](https://lichess.org) broadcasts (CC0) with Lichess's evaluations, and the
Lichess masters database and [PGN Mentor](https://www.pgnmentor.com) for 2000 to 2019, evaluated
offline with [Stockfish](https://stockfishchess.org). Piece art: Colin M.L. Burnett (BSD
3-Clause). See [LICENSES.md](LICENSES.md).
