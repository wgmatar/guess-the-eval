import { clampedPawns, LIMIT, type Eval } from './eval';

/** How close a guess was. The only vocabulary the UI has for accuracy. */
export type Accuracy = 'exact' | 'close' | 'off';

/**
 * Port of `AccuracyEvaluator.swift`, the single place a guess meets an actual value.
 *
 * - 0.00 is all-or-nothing: against a dead-equal position only 0.00 scores, and gold.
 * - Wrong polarity is red whatever the magnitude.
 * - Green is band agreement, with `BAND_SLACK` past either edge of the actual's band.
 * - Gold is within `GOLD_NEAR` of the actual up to `GOLD_SPLIT`, `GOLD_FAR` beyond.
 * - Mate is green iff the guess is at least `MATE_THRESHOLD` with the mating side's sign.
 * Both sides are clamped to ±8 first, so every position the bar can show is answerable.
 */
export const BAND_EDGES: readonly number[] = [0.3, 0.45, 0.7, 1.2, 1.8, 2.5, 3.3, 4.5];
export const BAND_SLACK = 0.05;
export const GOLD_NEAR = 0.03;
export const GOLD_FAR = 0.05;
export const GOLD_SPLIT = 1.2;
export const MATE_THRESHOLD = 4.5;

/** Values arrive quantised to 0.01, so this cleanly separates 0.00 from 0.01. */
const ZERO_EPSILON = 0.005;
/** Absorbs binary representation error, so a guess exactly on a threshold lands inside it. */
const EPSILON = 1e-9;

export function evaluate(guess: Eval, actual: Eval): Accuracy {
  const g = clampedPawns(guess);

  if (actual.kind === 'mate') {
    if (actual.mate === 0) return 'off';
    const correctSign =
      actual.mate > 0 ? g >= MATE_THRESHOLD - EPSILON : g <= -MATE_THRESHOLD + EPSILON;
    return correctSign ? 'close' : 'off';
  }

  const a = clampedPawns(actual);
  if (Math.abs(a) < ZERO_EPSILON) return Math.abs(g) < ZERO_EPSILON ? 'exact' : 'off';
  if (g * a < 0) return 'off';
  if (Math.abs(g - a) <= goldTolerance(Math.abs(a)) + EPSILON) return 'exact';
  // 0.00 belongs to no band: it answers a dead-equal position and nothing else.
  if (Math.abs(g) < ZERO_EPSILON) return 'off';
  const [lo, hi] = greenWindow(Math.abs(a));
  const m = Math.abs(g);
  return m >= lo && m <= hi ? 'close' : 'off';
}

function goldTolerance(a: number): number {
  return a <= GOLD_SPLIT + EPSILON ? GOLD_NEAR : GOLD_FAR;
}

/** Index of the band containing `m`. Bands are upper-inclusive. */
export function bandIndex(m: number): number {
  for (let i = 0; i < BAND_EDGES.length; i++) {
    if (m <= BAND_EDGES[i] + EPSILON) return i;
  }
  return BAND_EDGES.length;
}

/** The guess magnitudes that score green against an actual of magnitude `m`. */
export function greenWindow(m: number): readonly [number, number] {
  const i = bandIndex(m);
  const lo = i === 0 ? 0 : BAND_EDGES[i - 1];
  const hi = i === BAND_EDGES.length ? LIMIT : BAND_EDGES[i];
  return [lo - BAND_SLACK - EPSILON, hi + BAND_SLACK + EPSILON];
}
