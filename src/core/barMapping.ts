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
 * The bar stands upright beside the board, Black on top: distance from the top of the
 * bar to the divider, as a fraction.
 */
export function topFraction(e: Eval): number {
  return 1 - whiteFraction(e);
}

export function quantizedEvalForTopFraction(fraction: number): Eval {
  return quantizedEvalForWhiteFraction(1 - fraction);
}
