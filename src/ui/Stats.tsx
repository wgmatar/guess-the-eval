import type { CSSProperties } from 'react';
import type { StatsSnapshot } from '../store/statsStore';

interface Props {
  readonly stats: StatsSnapshot;
  readonly inert: boolean;
  readonly style: CSSProperties;
  readonly onBack: () => void;
  readonly soundOn: boolean;
  readonly onToggleSound: () => void;
}

const number = new Intl.NumberFormat();

function Row({ label, spoken, value }: { label: string; spoken: string; value: number }) {
  return (
    <div className="stat-row">
      <dt aria-label={spoken}>{label}</dt>
      <dd>{number.format(value)}</dd>
    </div>
  );
}

/** Four numbers on a quiet page, and nothing that congratulates you. */
export function Stats({ stats, inert, style, onBack, soundOn, onToggleSound }: Props) {
  return (
    <section className="stats-page" style={style} inert={inert} aria-labelledby="stats-title">
      <div className="stats-inner">
        <button type="button" className="text-button back" onClick={onBack}>
          ‹ Back
        </button>
        <h1 id="stats-title">Stats</h1>

        <h2>Streak</h2>
        <dl>
          <Row label="Current" spoken="Current streak" value={stats.currentStreak} />
          <Row label="Longest" spoken="Longest streak" value={stats.longestStreak} />
        </dl>

        <h2>Positions</h2>
        <dl>
          <Row label="Solved" spoken="Positions solved" value={stats.solved} />
          <Row label="Answered" spoken="Positions answered" value={stats.answered} />
        </dl>

        <h2>Settings</h2>
        <dl>
          <div className="stat-row">
            <dt id="sound-label">Sound</dt>
            <dd>
              <button
                type="button"
                className="capsule setting"
                aria-labelledby="sound-label"
                aria-pressed={soundOn}
                onClick={onToggleSound}
              >
                {soundOn ? 'On' : 'Off'}
              </button>
            </dd>
          </div>
        </dl>

        <div className="about">
          <p>
            Every position comes from an elite classical game: broadcasts on Lichess, evaluated by
            Lichess’s Stockfish, and top tournaments from 2000 to 2019 from the Lichess masters
            database and PGN Mentor, evaluated by Stockfish offline. The evaluation is in pawns from
            White’s side. Gold is spot on, green is close, red is off. A streak counts gold and
            green.
          </p>
          <p>
            <kbd>Enter</kbd> submits, then moves on. <kbd>↑</kbd> <kbd>↓</kbd> browse your answers.{' '}
            <kbd>Esc</kbd> closes this page.
          </p>
          <p>
            Progress is kept in this browser only. Piece art by Colin M.L. Burnett (BSD). Game data
            from Lichess (CC0).{' '}
            <a
              href="https://github.com/wgmatar/guess-the-eval"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source on GitHub
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
