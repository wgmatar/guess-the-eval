import { clampedPawns, LIMIT, pawns, quantizedPawns, type Eval } from './eval';

/**
 * The only conversion between an evaluation and a position on the eval bar. Port of
 * `EvalBarMapping.swift`. The drawn divider, the bubbles and the drag-to-value conversion
 * all route through here, so what the user sees and what a drag produces cannot drift.
 *
 * With `t = min(|e|, 8) / 8`: `white = 0.5 + 0.5 · sign(e) · (1 − (1 − t)^1.9)`, giving
 * ±1 → 61/39, ±3 → 79.5/20.5, ±8 → 100/0, monotonic and closed-form invertible.
 */
export const EXPONENT = 1.9;

/** White's share of the bar: 0.5 is level, 1 is White's extreme. */
export function whiteFraction(e: Eval): number {
  const p = clampedPawns(e);
  if (p === 0) return 0.5;
  const t = Math.min(Math.abs(p), LIMIT) / LIMIT;
  const magnitude = 1 - Math.pow(1 - t, EXPONENT);
  return 0.5 + 0.5 * (p < 0 ? -magnitude : magnitude);
}

/** The evaluation a divider at `fraction` represents. Exact inverse of `whiteFraction`. */
export function evalForWhiteFraction(fraction: number): Eval {
  const f = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0.5;
  const signed = 2 * f - 1;
  const magnitude = Math.min(Math.abs(signed), 1);
  const t = 1 - Math.pow(1 - magnitude, 1 / EXPONENT);
  const p = t * LIMIT;
  return pawns(signed < 0 ? -p : p);
}

export function quantizedEvalForWhiteFraction(fraction: number): Eval {
  return quantizedPawns(clampedPawns(evalForWhiteFraction(fraction)));
}

/**
 * Distance from the top of the upright bar to the divider, as a fraction. The bar follows the
 * board, as on Lichess: the side at the bottom of the board owns the bottom of the bar. Normally
 * that is White, with Black on top; when Black is to move the board is flipped, and so is the bar.
 * The numbers are always from White's side either way.
 */
export function barFraction(e: Eval, flipped: boolean): number {
  const white = whiteFraction(e);
  return flipped ? white : 1 - white;
}

/** White's share of the bar when its divider sits `fraction` of the way down. */
export function whiteFractionForBar(fraction: number, flipped: boolean): number {
  return flipped ? fraction : 1 - fraction;
}

/** The unflipped bar: Black on top. */
export function topFraction(e: Eval): number {
  return barFraction(e, false);
}
