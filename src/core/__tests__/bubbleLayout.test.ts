import { describe, expect, it } from 'vitest';
import { evaluate } from '../accuracy';
import { topFraction } from '../barMapping';
import { resolveBubbles } from '../bubbleLayout';
import { pawns } from '../eval';

const geometry = { barHeight: 380, bubbleHeight: 32 };

describe('bubble layout (PresentationTests @ dc8699c port)', () => {
  it('merges gold into one bubble on the true divider', () => {
    expect(
      resolveBubbles({ guessTop: 0.5, actualTop: 0.51, accuracy: 'exact', ...geometry }),
    ).toEqual({
      kind: 'merged',
      top: 0.51,
    });
  });

  it('nudges colliding non-gold bubbles apart by the minimum along the bar', () => {
    const r = resolveBubbles({ guessTop: 0.5, actualTop: 0.52, accuracy: 'off', ...geometry });
    if (r.kind !== 'separate') throw new Error('expected two bubbles');
    expect(r.guessTop).toBe(0.5);
    expect((r.actualTop - r.guessTop) * 380).toBeGreaterThanOrEqual(32 - 1e-9);
    expect(r.actualTop).toBeCloseTo(0.5 + 32 / 380, 9);
  });

  it('flips the nudge toward the middle at the end of the bar', () => {
    const r = resolveBubbles({ guessTop: 0.99, actualTop: 0.995, accuracy: 'close', ...geometry });
    if (r.kind !== 'separate') throw new Error('expected two bubbles');
    expect(r.guessTop).toBe(0.99);
    expect(r.actualTop).toBeCloseTo(0.99 - 32 / 380, 9);
    expect(r.actualTop >= 0 && r.actualTop <= 1).toBe(true);
  });

  it('always resolves to disjoint frames without moving the guess', () => {
    for (let i = 0; i <= 20; i++) {
      const guess = i * 0.05;
      const r = resolveBubbles({
        guessTop: guess,
        actualTop: Math.min(1, guess + 0.01),
        accuracy: 'off',
        ...geometry,
      });
      if (r.kind !== 'separate') throw new Error(`expected two bubbles at ${guess}`);
      expect(r.guessTop).toBe(guess);
      expect(Math.abs(r.actualTop - r.guessTop) * 380).toBeGreaterThanOrEqual(32 - 1e-9);
    }
  });

  it('leaves well-separated bubbles alone', () => {
    expect(
      resolveBubbles({ guessTop: 0.2, actualTop: 0.8, accuracy: 'close', ...geometry }),
    ).toEqual({
      kind: 'separate',
      guessTop: 0.2,
      actualTop: 0.8,
    });
  });

  it('never paints a wrong guess gold however close the bubbles are', () => {
    const accuracy = evaluate(pawns(0), pawns(0.8));
    expect(accuracy).toBe('off');
    const r = resolveBubbles({
      guessTop: topFraction(pawns(0)),
      actualTop: topFraction(pawns(0.8)),
      accuracy,
      ...geometry,
    });
    expect(r.kind).toBe('separate');
  });
});
