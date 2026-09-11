import { PIECE_SYMBOLS } from './pieces';

/**
 * The piece symbols, defined once and referenced by every board with `<use>`. The ivory rim on
 * black pieces is drawn by their `-rim` symbols in plain SVG: a filter on `<use>` is drawn
 * unreliably across browsers, and a failed filter hides the piece altogether.
 */
export function PieceDefs() {
  return (
    <svg className="defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs dangerouslySetInnerHTML={{ __html: PIECE_SYMBOLS }} />
    </svg>
  );
}
