// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBoard } from '../../core/chessBoard';
import { Board } from '../Board';
import { PIECE_SYMBOLS } from '../pieces';

afterEach(cleanup);

const START = parseBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

/** Squares a symbol is drawn on, as "column,row" in board units. */
function drawnAt(container: HTMLElement, href: string): string[] {
  return [...container.querySelectorAll(`use[href="${href}"]`)].map(
    (u) => `${Math.floor(Number(u.getAttribute('x')))},${Math.floor(Number(u.getAttribute('y')))}`,
  );
}

const board = (flipped: boolean) => (
  <Board board={START} size={400} x={0} y={0} label="position" flipped={flipped} />
);

describe('Board', () => {
  it('draws White at the bottom, and Black at the bottom when flipped', () => {
    const { container, rerender } = render(board(false));
    expect(drawnAt(container, '#p-wK')).toEqual(['4,7']);
    expect(drawnAt(container, '#p-bK')).toEqual(['4,0']);
    rerender(board(true));
    expect(drawnAt(container, '#p-wK')).toEqual(['3,0']);
    expect(drawnAt(container, '#p-bK')).toEqual(['3,7']);
  });

  it('rims black pieces on dark squares with plain SVG, not a filter', () => {
    const { container } = render(board(false));
    expect(drawnAt(container, '#p-bN-rim')).toEqual(['1,0']);
    expect(drawnAt(container, '#p-bN')).toEqual(['6,0']);
    expect(drawnAt(container, '#p-bP-rim')).toHaveLength(4);
    expect(container.querySelector('[filter]')).toBeNull();
  });

  it('defines every piece, and a rim for every black piece', () => {
    for (const colour of 'wb') {
      for (const kind of 'KQRBNP') expect(PIECE_SYMBOLS).toContain(`id="p-${colour}${kind}"`);
    }
    for (const kind of 'KQRBNP') expect(PIECE_SYMBOLS).toContain(`id="p-b${kind}-rim"`);
    expect(PIECE_SYMBOLS).not.toContain('<filter');
  });
});
