/**
 * Arrows and circles drawn on the board with the right mouse button, following Lichess's
 * chessground (`src/draw.ts`, `src/svg.ts`, `src/state.ts`): the same brushes, modifier keys,
 * toggle rule, snapping and geometry. Everything here is in board units, one square = 1, with
 * (0, 0) the top-left corner of the board as drawn.
 */
import type { Rect } from './layout';

export type Brush = 'green' | 'red' | 'blue' | 'yellow';
/** A square in algebraic notation, `a1` … `h8`. */
export type Square = string;

export interface Shape {
  readonly orig: Square;
  /** `null` for a circle on `orig`. */
  readonly dest: Square | null;
  readonly brush: Brush;
}

/** chessground's default brushes: colour, opacity and line width in 64ths of a square. */
export const BRUSHES: Record<Brush, { color: string; opacity: number; lineWidth: number }> = {
  green: { color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { color: '#e68f00', opacity: 1, lineWidth: 10 },
};

const ORDER: readonly Brush[] = ['green', 'red', 'blue', 'yellow'];

export interface Modifiers {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** chessground `eventBrush` for a right-button draw: Shift or Ctrl red, Alt or Meta blue, both yellow. */
export function brushFor(e: Modifiers): Brush {
  const a = e.shiftKey || e.ctrlKey;
  const b = e.altKey || e.metaKey;
  return ORDER[(a ? 1 : 0) + (b ? 2 : 0)]!;
}

const FILES = 'abcdefgh';

/** [file 0–7, rank 0–7] of a square. */
function coords(square: Square): [number, number] {
  return [FILES.indexOf(square[0]!), Number(square[1]) - 1];
}

function squareOf(file: number, rank: number): Square {
  return `${FILES[file]}${rank + 1}`;
}

/** The square under a point in page pixels, or null off the board. */
export function squareAt(board: Rect, x: number, y: number, flipped: boolean): Square | null {
  if (board.width <= 0) return null;
  let column = Math.floor((8 * (x - board.x)) / board.width);
  let row = Math.floor((8 * (y - board.y)) / board.height);
  if (column < 0 || column > 7 || row < 0 || row > 7) return null;
  if (flipped) {
    column = 7 - column;
    row = 7 - row;
  }
  return squareOf(column, 7 - row);
}

/** Centre of a square in board units, as drawn: White at the bottom unless flipped. */
export function centre(square: Square, flipped: boolean): [number, number] {
  const [file, rank] = coords(square);
  const column = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return [column + 0.5, row + 0.5];
}

/**
 * chessground `getSnappedKeyAtDomPos`: the arrow's head snaps to the nearest square a queen or
 * a knight could reach from `orig` (or `orig` itself, for a circle).
 */
export function snappedSquareAt(
  board: Rect,
  orig: Square,
  x: number,
  y: number,
  flipped: boolean,
): Square {
  const [of, or] = coords(orig);
  const unit = board.width / 8;
  let best = orig;
  let bestDistance = Infinity;
  for (let file = 0; file < 8; file++) {
    for (let rank = 0; rank < 8; rank++) {
      const dx = Math.abs(file - of);
      const dy = Math.abs(rank - or);
      const queen = dx === 0 || dy === 0 || dx === dy;
      const knight = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
      if (!queen && !knight) continue;
      const square = squareOf(file, rank);
      const [cx, cy] = centre(square, flipped);
      const d = (board.x + cx * unit - x) ** 2 + (board.y + cy * unit - y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = square;
      }
    }
  }
  return best;
}

export const sameEndpoints = (a: Shape, b: Shape) => a.orig === b.orig && a.dest === b.dest;

/**
 * chessground `addShape`: drawing a shape again with the same brush removes it; with another
 * brush it replaces it.
 */
export function toggleShape(shapes: readonly Shape[], shape: Shape): Shape[] {
  const similar = shapes.find((s) => sameEndpoints(s, shape));
  const rest = similar ? shapes.filter((s) => !sameEndpoints(s, shape)) : [...shapes];
  if (!similar || similar.brush !== shape.brush) rest.push(shape);
  return rest;
}

/** Line width in board units; the arrow being drawn is a little thinner. */
export const lineWidth = (brush: Brush, current: boolean) =>
  (BRUSHES[brush].lineWidth * (current ? 0.85 : 1)) / 64;

export const CIRCLE_WIDTH = { current: 3 / 64, done: 4 / 64 } as const;
/** The committed circle's outer edge just touches the square's edge. */
export const CIRCLE_RADIUS = 0.5 - CIRCLE_WIDTH.done / 2;

export const opacity = (brush: Brush, current: boolean, pendingErase: boolean) =>
  BRUSHES[brush].opacity * (pendingErase ? 0.6 : current ? 0.9 : 1);

const slotOf = (from: Square, to: Square): number => {
  const [fx, fy] = coords(from);
  const [tx, ty] = coords(to);
  const angle = Math.atan2(ty - fy, tx - fx) + Math.PI;
  return (((Math.round((angle * 8) / Math.PI) % 16) + 16) % 16) as number;
};

/**
 * chessground `isShort`: an arrow is pulled back further when another arrow reaches the same
 * square from within 90 degrees, so the two heads do not overlap.
 */
export function isShort(dest: Square, arrows: readonly Shape[]): boolean {
  const slots = new Set<number>();
  for (const s of arrows) if (s.dest === dest) slots.add(slotOf(s.orig, s.dest));
  return [...slots].some((slot) =>
    [-3, -2, -1, 1, 2, 3].some((i) => slots.has((((slot + i) % 16) + 16) % 16)),
  );
}

export interface ArrowGeometry {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width: number;
  /** The head, drawn as chessground's marker `M0,0 V4 L3,2 Z` (refX 2.05, refY 2) would be. */
  readonly head: string;
}

/**
 * From the centre of `orig` to the centre of `dest`, pulled back by 10/64 of a square (20/64
 * when shortened), with a head four line widths wide and three long.
 */
export function arrowGeometry(
  orig: Square,
  dest: Square,
  brush: Brush,
  flipped: boolean,
  current: boolean,
  shorten: boolean,
): ArrowGeometry {
  const [x1, y1] = centre(orig, flipped);
  const [tx, ty] = centre(dest, flipped);
  const margin = (shorten && !current ? 20 : 10) / 64;
  const angle = Math.atan2(ty - y1, tx - x1);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const x2 = tx - ux * margin;
  const y2 = ty - uy * margin;
  const w = lineWidth(brush, current);
  const at = (along: number, across: number) =>
    `${round(x2 + ux * along * w - uy * across * w)},${round(y2 + uy * along * w + ux * across * w)}`;
  const head = `${at(-2.05, -2)} ${at(-2.05, 2)} ${at(0.95, 0)}`;
  return { x1, y1, x2, y2, width: w, head };
}

const round = (v: number) => Math.round(v * 10000) / 10000;
