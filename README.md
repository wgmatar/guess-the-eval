# Guess The Eval

**Play it: https://wgmatar.github.io/guess-the-eval/**

A chess position from an elite classical game appears. You guess the engine's evaluation
(in pawns, from White's side) by typing it or dragging the eval bar beside the board, then
submit. The board faces the side to move, and the eval bar turns with it, as on Lichess; the
numbers are always from White's side. The bar springs to the truth and your guess turns gold (spot on), green (close) or
red (off). The feed never ends and never repeats a position until you have seen them all;
everything you answered stays browsable above the live position, frozen as you left it.
Once a position is answered, a link opens the source game on Lichess at that exact move.

11,472 positions from 3,937 games in 51 tournaments come from classical games between
players rated 2500+ that were broadcast on Lichess. The evaluations are Lichess's own Stockfish analysis of each move.

## Controls

| | Keyboard | Mouse / touch |
|---|---|---|
| Guess | type a number: `1.3`, `-0.45`, `+2` (clamped to ±8) | drag the bar or its bubble; the end nearer a side's pieces is better for that side |
| Submit | <kbd>Enter</kbd> | **Submit** |
| Next position | <kbd>Enter</kbd>, <kbd>↓</kbd> or <kbd>S</kbd> | **Next**, or swipe up on the board |
| Previous (answered) positions | <kbd>↑</kbd> or <kbd>W</kbd> | swipe down, or scroll |
| Stats | **Stats** link; <kbd>Esc</kbd> to return | swipe left; right to return |
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
in four keys: `gte.v1.dataset`, `gte.v1.stats`, `gte.v1.answered`, `gte.v1.history`.
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
tools/.venv/bin/python tools/fetch_positions.py discover             # find broadcast tournaments
tools/.venv/bin/python tools/fetch_positions.py generate --target 25000   # appends up to 25,000
```

`discover` searches the Lichess broadcast API for finished, top-tier classical tournaments and
adds them to `tools/broadcast_tours.json`. `generate` downloads each tournament's PGN once
(cached in `tools/.cache/`), samples evaluated positions, validates them, and appends them to
`public/positions.json`. Existing rows are never changed, because browsers store answered
positions by index; `--rebuild` with a new `--dataset` name starts over and tells browsers to
discard that record. `--out` writes somewhere else, for a trial run. Requests are sent one at
a time, a second apart, with back-off on 429. Lichess streams large tournament PGNs slowly, so
`generate` skips discovered sections that cannot yield 2500+ classical games (lower Olympiad
sections, women's, junior and senior events, weak open groups, non-classical formats);
`--include-low-yield` keeps them.

`tools/fetch_pieces.py` regenerates `src/ui/pieces.ts` from the Cburnett SVGs.

## Deployment

Every push to `main` runs lint, tests and the build in GitHub Actions, then publishes `dist/`
to GitHub Pages.

## Credits

Game data and evaluations: [Lichess](https://lichess.org) broadcasts (CC0). Piece art: Colin
M.L. Burnett (BSD 3-Clause). See [LICENSES.md](LICENSES.md).
