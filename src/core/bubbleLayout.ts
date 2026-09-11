import type { Accuracy } from './accuracy';

/**
 * Where the result bubbles go on the upright bar. Port of `BubbleLayout.swift` from the
 * vertical-bar design (iOS commit dc8699c).
 *
 * Merging is driven by `exact`, never by pixel overlap: two bubbles overlap whenever the
 * evaluations are close near the centre, which would otherwise paint a wrong guess gold.
 * When the result is not exact but the frames would collide, the *actual* bubble is nudged
 * along the bar, away from the guess, by the minimum that clears it: inboard is the board
 * and outboard the page edge, so there is no room off-axis. The divider still marks the
 * true value exactly. The guess bubble never moves.
 */
export type BubbleResolution =
  | { readonly kind: 'merged'; readonly top: number }
  | { readonly kind: 'separate'; readonly guessTop: number; readonly actualTop: number };

export interface BubbleInput {
  readonly guessTop: number;
  readonly actualTop: number;
  readonly accuracy: Accuracy;
  readonly barHeight: number;
  readonly bubbleHeight: number;
}

export function resolveBubbles({
  guessTop,
  actualTop,
  accuracy,
  barHeight,
  bubbleHeight,
}: BubbleInput): BubbleResolution {
  if (accuracy === 'exact') return { kind: 'merged', top: actualTop };
  const separation = (actualTop - guessTop) * barHeight;
  if (!(barHeight > 0) || Math.abs(separation) >= bubbleHeight) {
    return { kind: 'separate', guessTop, actualTop };
  }
  const clearance = bubbleHeight / barHeight;
  const below = guessTop + clearance;
  const above = guessTop - clearance;
  const preferred = separation >= 0 ? below : above;
  const resolved = preferred >= 0 && preferred <= 1 ? preferred : separation >= 0 ? above : below;
  return { kind: 'separate', guessTop, actualTop: Math.min(Math.max(resolved, 0), 1) };
}
