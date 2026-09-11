import { COLORS } from './palette';
import { PIECE_SYMBOLS } from './pieces';

/**
 * An ivory rim for black pieces on dark squares, which otherwise sink into the square. The
 * radius is in board units (a square is 1), so it scales with the board.
 */
const RIM_FILTER =
  '<filter id="rim" x="-0.2" y="-0.2" width="1.4" height="1.4">' +
  '<feMorphology in="SourceAlpha" operator="dilate" radius="0.02" result="grown"/>' +
  `<feFlood flood-color="${COLORS.ivory}" flood-opacity="0.9"/>` +
  '<feComposite in2="grown" operator="in" result="ring"/>' +
  '<feMerge><feMergeNode in="ring"/><feMergeNode in="SourceGraphic"/></feMerge>' +
  '</filter>';

/** The twelve piece symbols, defined once and referenced by every board with `<use>`. */
export function PieceDefs() {
  return (
    <svg className="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs dangerouslySetInnerHTML={{ __html: PIECE_SYMBOLS + RIM_FILTER }} />
    </svg>
  );
}
