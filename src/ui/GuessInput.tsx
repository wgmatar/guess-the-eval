import { useEffect, useState, type RefObject } from 'react';
import { clampedPawns, evalEquals, quantizedPawns, type Eval } from '../core/eval';
import { formatGuess, isAllowedKey, parseGuess } from '../core/guessInput';

interface Props {
  readonly value: Eval;
  readonly width: number;
  /** The live page is on screen and settled: take focus if the device has a keyboard. */
  readonly active: boolean;
  readonly autoFocus: boolean;
  /** Phone keypads have no minus key, so touch devices get a ± button. */
  readonly signToggle: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onChange: (value: Eval) => void;
}

/**
 * The typed guess. The text is the user's own while it parses; when the guess changes from
 * elsewhere (a drag on the bar), the text is rewritten to match it.
 */
export function GuessInput({
  value,
  width,
  active,
  autoFocus,
  signToggle,
  inputRef,
  onChange,
}: Props) {
  const [text, setText] = useState(() => (clampedPawns(value) === 0 ? '' : formatGuess(value)));
  const [shown, setShown] = useState(value);
  if (!evalEquals(shown, value)) {
    setShown(value);
    setText(formatGuess(value));
  }

  useEffect(() => {
    if (active && autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [active, autoFocus, inputRef]);

  const accept = (next: string, parsed: Eval) => {
    setText(next);
    setShown(parsed);
    onChange(parsed);
  };

  const flipSign = () => {
    const pawns = clampedPawns(value);
    const flipped = quantizedPawns(-pawns);
    const next = pawns !== 0 ? formatGuess(flipped) : text.startsWith('-') ? '' : '-';
    accept(next, flipped);
  };

  return (
    <div className={signToggle ? 'eval-box with-toggle' : 'eval-box'} style={{ width }}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        enterKeyHint="go"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={7}
        placeholder="0.00"
        aria-label="Your guess: the evaluation in pawns, positive if White is better"
        value={text}
        onChange={(e) => {
          const parsed = parseGuess(e.target.value);
          if (parsed.ok) accept(e.target.value, parsed.eval);
        }}
        onKeyDown={(e) => {
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !isAllowedKey(e.key)) {
            e.preventDefault();
          }
        }}
        onBlur={() => {
          if (text.trim() !== '') setText(formatGuess(value));
        }}
      />
      {signToggle && (
        <button
          type="button"
          className="sign-toggle"
          aria-label="Flip the sign of your guess"
          onPointerDown={(e) => e.preventDefault()}
          onClick={flipSign}
        >
          ±
        </button>
      )}
    </div>
  );
}
