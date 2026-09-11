import { memo } from 'react';
import { isLightSquare, type Board as BoardData } from '../core/chessBoard';
import { COLORS } from './palette';

const DARK_SQUARES = Array.from({ length: 64 }, (_, i) => i)
  .filter((i) => !isLightSquare(i >> 3, i & 7))
  .map((i) => `M${i & 7} ${i >> 3}h1v1h-1z`)
  .join('');

interface Props {
  readonly board: BoardData;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  /** Black to move: draw the board from Black's side. */
  readonly flipped: boolean;
}

/**
 * The board, one SVG drawn in board units. Memoised on its inputs, so it is untouched while
 * the guess is dragged, the feed pages, or the answer is revealed. No coordinates, no
 * highlights. It faces the side to move: flipped when Black is to move. The square colours need
 * no flipping, because turning the board half a turn keeps every square's colour.
 */
export const Board = memo(function Board({ board, size, x, y, label, flipped }: Props) {
  return (
    <svg
      className="board"
      viewBox="0 0 8 8"
      width={size}
      height={size}
      style={{ left: x, top: y }}
      role="img"
      aria-label={label}
    >
      <rect width="8" height="8" fill={COLORS.boardLight} shapeRendering="crispEdges" />
      <path d={DARK_SQUARES} fill={COLORS.boardDark} shapeRendering="crispEdges" />
      {board.map((code, i) => {
        if (!code) return null;
        const row = i >> 3;
        const column = i & 7;
        // Black pieces on dark squares get an ivory rim so they do not sink into the square.
        const rim = code[0] === 'b' && !isLightSquare(row, column);
        return (
          <use
            key={i}
            href={`#p-${code}${rim ? '-rim' : ''}`}
            x={(flipped ? 7 - column : column) + 0.03}
            y={(flipped ? 7 - row : row) + 0.03}
            width={0.94}
            height={0.94}
          />
        );
      })}
    </svg>
  );
});
