import { describe, expect, it } from 'vitest';
import { bandIndex, evaluate } from '../accuracy';
import { mate, pawns } from '../eval';

const result = (guess: number, actual: number) => evaluate(pawns(guess), pawns(actual));

describe('accuracy (AccuracyEvaluatorTests port)', () => {
  it('zero is all or nothing', () => {
    expect(result(0, 0)).toBe('exact');
    expect(result(0.01, 0)).toBe('off');
    expect(result(-0.01, 0)).toBe('off');
    expect(result(0.3, 0)).toBe('off');
  });

  it('wrong polarity is always off', () => {
    expect(result(0.5, -0.5)).toBe('off');
    expect(result(-2, 2)).toBe('off');
    expect(result(-0.01, 0.02)).toBe('off');
  });

  it('same band is green, both signs', () => {
    const pairs: [number, number][] = [
      [0.01, 0.3],
      [0.31, 0.45],
      [0.46, 0.7],
      [0.71, 1.2],
      [1.21, 1.8],
      [1.81, 2.5],
      [2.51, 3.3],
      [3.31, 4.5],
      [4.51, 8],
    ];
    for (const [g, a] of pairs) {
      expect(result(g, a), `${g} vs ${a}`).toBe('close');
      expect(result(-g, -a), `${-g} vs ${-a}`).toBe('close');
    }
  });

  it('band edges belong to the band below them', () => {
    expect(result(1.2, 0.75)).toBe('close');
    expect(result(1.25, 0.75)).toBe('close');
    expect(result(1.26, 0.75)).toBe('off');
  });

  it('the slack reaches exactly 0.05 past a boundary', () => {
    expect(result(0.28, 0.32)).toBe('close');
    expect(result(0.25, 0.32)).toBe('close');
    expect(result(0.24, 0.32)).toBe('off');
    expect(result(0.35, 0.28)).toBe('close');
    expect(result(0.36, 0.28)).toBe('off');
  });

  it('gold is tight near zero and wider past 1.20', () => {
    expect(result(0.53, 0.5)).toBe('exact');
    expect(result(0.54, 0.5)).toBe('close');
    expect(result(2.05, 2)).toBe('exact');
    expect(result(2.06, 2)).toBe('close');
    expect(result(1.23, 1.2)).toBe('exact');
    expect(result(1.24, 1.2)).toBe('close');
  });

  it('gold wins across a band edge', () => {
    expect(bandIndex(0.29)).not.toBe(bandIndex(0.31));
    expect(result(0.29, 0.31)).toBe('exact');
  });

  it('a zero guess can be gold but never green', () => {
    expect(result(0, 0.02)).toBe('exact');
    expect(result(0, 0.03)).toBe('exact');
    expect(result(0, 0.04)).toBe('off');
    expect(result(0, 0.2)).toBe('off');
  });

  it('gold sweep', () => {
    for (let i = 0; i <= 64; i++) {
      const actual = -8 + i * 0.25;
      if (Math.abs(actual) < 0.005) continue;
      const tolerance = Math.abs(actual) <= 1.2 ? 0.03 : 0.05;
      for (const delta of [-tolerance, -tolerance / 2, 0, tolerance / 2, tolerance]) {
        expect(result(actual + delta, actual), `delta ${delta} at ${actual}`).toBe('exact');
      }
      const inward = actual > 0 ? -(tolerance + 0.01) : tolerance + 0.01;
      expect(result(actual + inward, actual)).not.toBe('exact');
    }
  });

  it('mate needs 4.50 with the right sign and is never gold', () => {
    expect(evaluate(pawns(4.5), mate(4))).toBe('close');
    expect(evaluate(pawns(8), mate(4))).toBe('close');
    expect(evaluate(pawns(4.49), mate(4))).toBe('off');
    expect(evaluate(pawns(3), mate(4))).toBe('off');
    expect(evaluate(pawns(-4.5), mate(-2))).toBe('close');
    expect(evaluate(pawns(4.5), mate(-2))).toBe('off');
    for (let i = 0; i <= 160; i++) {
      const g = -8 + i * 0.1;
      expect(evaluate(pawns(g), mate(3))).not.toBe('exact');
      expect(evaluate(pawns(g), mate(-3))).not.toBe('exact');
    }
  });

  it('scores out-of-range actuals against the bar limit', () => {
    expect(result(-8, -12.37)).toBe('exact');
    expect(result(8, 8.31)).toBe('exact');
    expect(result(-8, -8.46)).toBe('exact');
    expect(result(8, 9.39)).toBe('exact');
    expect(result(7, 9.39)).toBe('close');
  });

  it('saturates guesses beyond the bar', () => {
    expect(evaluate(pawns(50), pawns(8))).toBe('exact');
    expect(evaluate(mate(2), mate(5))).toBe('close');
  });
});
