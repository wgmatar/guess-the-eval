import { useState, type RefObject } from 'react';
import type { Accuracy } from '../core/accuracy';
import { barFraction } from '../core/barMapping';
import { resolveBubbles } from '../core/bubbleLayout';
import { display, spoken, type Eval } from '../core/eval';
import { bubbleCenter, SIZES, type PageLayout } from '../core/layout';
import { lichessUrl, positionTitle, sideLabel } from '../core/positions';
import type { Shape } from '../core/shapes';
import type { PageState } from '../store/feedModel';
import { Board } from './Board';
import { GuessInput } from './GuessInput';
import type { BubbleKind } from './palette';
import { Shapes } from './Shapes';
import { rectStyle } from './style';

interface Props {
  readonly page: PageState;
  readonly layout: PageLayout;
  /** The live guess. Ignored once the page is answered. */
  readonly liveGuess: Eval;
  readonly active: boolean;
  readonly finePointer: boolean;
  readonly showHint: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** Arrows and circles drawn on this page, and the one being drawn. */
  readonly shapes: readonly Shape[];
  readonly drawing: Shape | null;
  readonly onGuess: (value: Eval) => void;
  readonly onSubmit: () => void;
  readonly onNext: () => void;
}

interface BubbleSpec {
  readonly key: 'guess' | 'actual';
  readonly kind: BubbleKind;
  readonly text: string;
  readonly top: number;
  readonly pop: boolean;
}

const OUTCOME: Record<Accuracy, string> = { exact: 'spot on', close: 'close', off: 'off' };

/**
 * One page of the feed. The live page and an answered page share one layout; only the
 * divider, the bubbles and the controls row differ, and the board never redraws between them.
 */
export function Page(props: Props) {
  const { page, layout: l, finePointer } = props;
  const answered = page.submittedGuess !== null;
  // Only a page answered in front of the user animates its reveal; history pages arrive still.
  const [mountedLive] = useState(!answered);
  const { position, accuracy } = page;
  const guess = page.submittedGuess ?? props.liveGuess;
  // Black to move: the board is seen from Black's side and the bar turns with it, as on Lichess.
  const flipped = position.sideToMove === 'b';
  const guessTop = barFraction(guess, flipped);
  const dividerTop = answered ? barFraction(position.eval, flipped) : guessTop;

  let bubbles: BubbleSpec[] = [
    { key: 'guess', kind: 'guess', text: display(guess), top: guessTop, pop: false },
  ];
  if (answered && accuracy) {
    const resolution = resolveBubbles({
      guessTop,
      actualTop: barFraction(position.eval, flipped),
      accuracy,
      barHeight: l.bar.height,
      bubbleHeight: SIZES.bubbleH,
    });
    bubbles =
      resolution.kind === 'merged'
        ? [
            {
              key: 'guess',
              kind: 'exact',
              text: display(position.eval),
              top: resolution.top,
              pop: false,
            },
          ]
        : [
            {
              key: 'actual',
              kind: 'actual',
              text: display(position.eval),
              top: resolution.actualTop,
              pop: mountedLive,
            },
            {
              key: 'guess',
              kind: accuracy,
              text: display(guess),
              top: resolution.guessTop,
              pop: false,
            },
          ];
  }

  // A reveal in front of the player: gold rings its bubble and sweeps a light up the bar.
  const cheer = mountedLive && answered ? accuracy : null;

  const url = answered ? lichessUrl(position) : null;
  const turn = sideLabel(position);
  const hintTop = l.controls.y + l.controls.height + 18;
  const hintFits = hintTop + 40 <= l.pageH;

  return (
    <div className={answered ? 'page answered' : 'page live'}>
      <div className="title-block" style={rectStyle(l.title)}>
        <p className="title">{positionTitle(position)}</p>
        {turn && (
          <p className="turn">
            <span className={`swatch ${position.sideToMove}`} aria-hidden="true" />
            <span className="side">{turn}</span>
            {position.moveNumber !== null && <span>· move {position.moveNumber}</span>}
          </p>
        )}
      </div>
      <Board
        board={position.board}
        size={l.board.width}
        x={l.board.x}
        y={l.board.y}
        flipped={flipped}
        label={`Chess position, ${turn ?? 'side to move unknown'}`}
      />
      <Shapes
        shapes={props.shapes}
        current={props.drawing}
        size={l.board.width}
        x={l.board.x}
        y={l.board.y}
        flipped={flipped}
      />
      <div
        className={`bar${flipped ? ' flipped' : ''}${cheer === 'exact' ? ' shimmer' : ''}`}
        style={rectStyle(l.bar)}
        aria-hidden="true"
      >
        <div
          className="bar-black"
          style={{ height: `${(flipped ? 1 - dividerTop : dividerTop) * 100}%` }}
        />
      </div>
      {bubbles.map((b) => {
        const c = bubbleCenter(l, b.top);
        return (
          <div
            key={b.key}
            className={`bubble ${b.kind}${b.pop ? ' pop' : ''}${cheer && b.key === 'guess' && cheer !== 'off' ? ` cheer-${cheer}` : ''}`}
            style={{
              transform: `translate3d(${c.x - SIZES.bubbleW / 2}px, ${c.y - SIZES.bubbleH / 2}px, 0)`,
            }}
            aria-hidden="true"
          >
            {b.text}
          </div>
        );
      })}

      {answered ? (
        <div className="controls" style={rectStyle(l.controls)}>
          {url ? (
            <a
              className="capsule lichess"
              style={{ width: l.input.width }}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              draggable={false}
              title={position.event ?? undefined}
            >
              Lichess ↗
            </a>
          ) : (
            <span style={{ width: l.input.width }} />
          )}
          <button type="button" className="capsule next" onClick={props.onNext}>
            Next
            {finePointer && <kbd>Enter</kbd>}
          </button>
        </div>
      ) : (
        <div className="controls" style={rectStyle(l.controls)}>
          <GuessInput
            value={guess}
            width={l.input.width}
            active={props.active}
            autoFocus={finePointer}
            signToggle={!finePointer}
            inputRef={props.inputRef}
            onChange={props.onGuess}
          />
          <button type="button" className="capsule submit" onClick={props.onSubmit}>
            Submit
          </button>
        </div>
      )}

      {!answered && props.showHint && hintFits && (
        <p className="hint" style={{ left: l.controls.x, top: hintTop, width: l.controls.width }}>
          {finePointer
            ? 'Guess the engine’s evaluation from White’s side. Type it or drag the bar, then press Enter.'
            : 'Guess the engine’s evaluation from White’s side. Drag the bar or type it, then Submit.'}
        </p>
      )}

      {answered && mountedLive && accuracy && (
        <p className="sr-only" role="status">
          {`Engine evaluation ${spoken(position.eval)}. Your guess ${spoken(guess)}, ${OUTCOME[accuracy]}.`}
        </p>
      )}
    </div>
  );
}
