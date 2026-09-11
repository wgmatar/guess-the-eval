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
}

/**
 * The board, one SVG drawn in board units. Memoised on its inputs, so it is untouched while
 * the guess is dragged, the feed pages, or the answer is revealed. No coordinates, no
 * highlights, White always at the bottom.
 */
export const Board = memo(function Board({ board, size, x, y, label }: Props) {
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
        const rim = code[0] === 'b' && !isLightSquare(row, column);
        return (
          <use
            key={i}
            href={`#p-${code}`}
            x={column + 0.03}
            y={row + 0.03}
            width={0.94}
            height={0.94}
            filter={rim ? 'url(#rim)' : undefined}
          />
        );
      })}
    </svg>
  );
});
