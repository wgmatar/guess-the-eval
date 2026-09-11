import { describe, expect, it } from 'vitest';
import {
  arrowGeometry,
  brushFor,
  centre,
  CIRCLE_RADIUS,
  isShort,
  lineWidth,
  opacity,
  snappedSquareAt,
  squareAt,
  toggleShape,
  type Shape,
} from '../shapes';

const BOARD = { x: 100, y: 50, width: 400, height: 400 };
const none = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

describe('brushes', () => {
  it('maps modifiers as chessground eventBrush does', () => {
    expect(brushFor(none)).toBe('green');
    expect(brushFor({ ...none, shiftKey: true })).toBe('red');
    expect(brushFor({ ...none, ctrlKey: true })).toBe('red');
    expect(brushFor({ ...none, altKey: true })).toBe('blue');
    expect(brushFor({ ...none, metaKey: true })).toBe('blue');
    expect(brushFor({ ...none, shiftKey: true, altKey: true })).toBe('yellow');
    expect(brushFor({ ...none, ctrlKey: true, metaKey: true })).toBe('yellow');
  });

  it('uses chessground widths and opacities', () => {
    expect(lineWidth('green', false)).toBeCloseTo(10 / 64);
    expect(lineWidth('green', true)).toBeCloseTo(8.5 / 64);
    expect(CIRCLE_RADIUS).toBeCloseTo(0.46875);
    expect(opacity('red', false, false)).toBe(1);
    expect(opacity('red', true, false)).toBe(0.9);
    expect(opacity('red', false, true)).toBe(0.6);
  });
});

describe('squares', () => {
  it('finds the square under a point, facing either side', () => {
    expect(squareAt(BOARD, 101, 51, false)).toBe('a8');
    expect(squareAt(BOARD, 499, 449, false)).toBe('h1');
    expect(squareAt(BOARD, 101, 51, true)).toBe('h1');
    expect(squareAt(BOARD, 499, 449, true)).toBe('a8');
    // e4 is the fifth column, fifth row from the top.
    expect(squareAt(BOARD, 100 + 4.5 * 50, 50 + 4.5 * 50, false)).toBe('e4');
    expect(squareAt(BOARD, 100 + 3.5 * 50, 50 + 3.5 * 50, true)).toBe('e4');
    expect(squareAt(BOARD, 99, 100, false)).toBeNull();
    expect(squareAt(BOARD, 200, 451, false)).toBeNull();
  });

  it('centres squares in board units, matching Board', () => {
    expect(centre('a1', false)).toEqual([0.5, 7.5]);
    expect(centre('e4', false)).toEqual([4.5, 4.5]);
    expect(centre('a1', true)).toEqual([7.5, 0.5]);
    expect(centre('e4', true)).toEqual([3.5, 3.5]);
  });

  it('snaps the head to a queen or knight move from the start square', () => {
    const at = (sq: string, dx = 0, dy = 0) => {
      const [cx, cy] = centre(sq, false);
      return [BOARD.x + cx * 50 + dx, BOARD.y + cy * 50 + dy] as const;
    };
    expect(snappedSquareAt(BOARD, 'e2', ...at('e4'), false)).toBe('e4');
    expect(snappedSquareAt(BOARD, 'g1', ...at('f3'), false)).toBe('f3');
    // d5 is neither a queen nor a knight move from e2: the nearest reachable centre wins.
    expect(['e5', 'd4', 'c4', 'd3']).toContain(snappedSquareAt(BOARD, 'e2', ...at('d5'), false));
    expect(snappedSquareAt(BOARD, 'e2', ...at('e2', 5, 5), false)).toBe('e2');
  });
});

describe('toggling', () => {
  const arrow: Shape = { orig: 'e2', dest: 'e4', brush: 'green' };
  const circle: Shape = { orig: 'e2', dest: null, brush: 'green' };

  it('adds, removes the same shape, and replaces a recoloured one', () => {
    let shapes = toggleShape([], arrow);
    expect(shapes).toEqual([arrow]);
    shapes = toggleShape(shapes, circle);
    expect(shapes).toEqual([arrow, circle]);
    shapes = toggleShape(shapes, { ...arrow, brush: 'red' });
    expect(shapes).toEqual([circle, { ...arrow, brush: 'red' }]);
    shapes = toggleShape(shapes, { ...arrow, brush: 'red' });
    expect(shapes).toEqual([circle]);
    shapes = toggleShape(shapes, circle);
    expect(shapes).toEqual([]);
  });

  it('does not mutate its input', () => {
    const shapes = [arrow];
    toggleShape(shapes, arrow);
    expect(shapes).toEqual([arrow]);
  });
});

describe('arrow geometry', () => {
  it('runs from centre to just short of the destination centre', () => {
    const g = arrowGeometry('e2', 'e4', 'green', false, false, false);
    expect(g.x1).toBe(4.5);
    expect(g.y1).toBe(6.5);
    expect(g.x2).toBeCloseTo(4.5);
    expect(g.y2).toBeCloseTo(4.5 + 10 / 64);
    expect(g.width).toBeCloseTo(10 / 64);
    // The tip overshoots the line end by 0.95 line widths.
    const tip = g.head.split(' ')[2]!.split(',').map(Number);
    expect(tip[0]).toBeCloseTo(4.5);
    expect(tip[1]).toBeCloseTo(4.5 + 10 / 64 - 0.95 * (10 / 64), 3);
  });

  it('points the same way on a flipped board, turned half a turn', () => {
    const g = arrowGeometry('e2', 'e4', 'green', true, false, false);
    expect(g.y1).toBe(1.5);
    expect(g.y2).toBeCloseTo(3.5 - 10 / 64);
  });

  it('pulls converging arrows back further', () => {
    const a: Shape = { orig: 'e2', dest: 'e4', brush: 'green' };
    const b: Shape = { orig: 'f3', dest: 'e4', brush: 'green' };
    const c: Shape = { orig: 'e6', dest: 'e4', brush: 'green' };
    expect(isShort('e4', [a])).toBe(false);
    expect(isShort('e4', [a, b])).toBe(true);
    expect(isShort('e4', [a, c])).toBe(false);
    const g = arrowGeometry('e2', 'e4', 'green', false, false, true);
    expect(g.y2).toBeCloseTo(4.5 + 20 / 64);
  });
});
