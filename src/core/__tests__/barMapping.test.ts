import { describe, expect, it } from 'vitest';
import {
  evalForWhiteFraction,
  quantizedEvalForTopFraction,
  quantizedEvalForWhiteFraction,
  topFraction,
  whiteFraction,
} from '../barMapping';
import { clampedPawns, mate, pawns } from '../eval';

describe('bar mapping (EvalBarMappingTests port)', () => {
  it('level is the centre', () => {
    expect(whiteFraction(pawns(0))).toBe(0.5);
  });

  it('hits the documented anchors', () => {
    expect(whiteFraction(pawns(1))).toBeCloseTo(0.61, 2);
    expect(whiteFraction(pawns(-1))).toBeCloseTo(0.39, 2);
    expect(whiteFraction(pawns(3))).toBeCloseTo(0.795, 3);
    expect(whiteFraction(pawns(-3))).toBeCloseTo(0.205, 3);
    expect(whiteFraction(pawns(8))).toBe(1);
    expect(whiteFraction(pawns(-8))).toBe(0);
  });

  it('clamps beyond the limit, mate included', () => {
    expect(whiteFraction(pawns(12.37))).toBe(1);
    expect(whiteFraction(pawns(-12.37))).toBe(0);
    expect(whiteFraction(mate(1))).toBe(1);
    expect(whiteFraction(mate(-1))).toBe(0);
  });

  it('is monotonic and symmetric', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 1600; i++) {
      const f = whiteFraction(pawns(-8 + i * 0.01));
      expect(f).toBeGreaterThan(previous);
      previous = f;
    }
    for (let i = 0; i <= 80; i++) {
      const x = i * 0.1;
      expect(whiteFraction(pawns(x)) - 0.5).toBeCloseTo(0.5 - whiteFraction(pawns(-x)), 12);
    }
  });

  it('round-trips both ways within 1e-9', () => {
    for (let i = 0; i <= 3200; i++) {
      const x = -8 + i * 0.005;
      const back = evalForWhiteFraction(whiteFraction(pawns(x)));
      expect(back.kind === 'pawns' && Math.abs(back.pawns - x) <= 1e-9, `${x}`).toBe(true);
    }
    for (let i = 0; i <= 1000; i++) {
      const f = i / 1000;
      expect(Math.abs(whiteFraction(evalForWhiteFraction(f)) - f)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('keeps fractions and values in range', () => {
    for (let x = -100; x <= 100; x += 0.7) {
      const f = whiteFraction(pawns(x));
      expect(f >= 0 && f <= 1).toBe(true);
    }
    for (const f of [-5, -0.1, 0, 0.5, 1, 1.1, 9, Number.NaN]) {
      const p = clampedPawns(evalForWhiteFraction(f));
      expect(p >= -8 && p <= 8).toBe(true);
    }
  });

  it('lands drag values on two decimals', () => {
    for (let f = 0; f <= 1; f += 0.013) {
      const v = clampedPawns(quantizedEvalForWhiteFraction(f));
      expect(Math.abs(v - Math.round(v * 100) / 100)).toBeLessThan(1e-12);
    }
  });

  it('measures the upright bar from the top, Black above', () => {
    for (let x = -8; x <= 8; x += 0.5) {
      expect(topFraction(pawns(x))).toBeCloseTo(1 - whiteFraction(pawns(x)), 12);
    }
    expect(quantizedEvalForTopFraction(0)).toEqual(pawns(8));
    expect(quantizedEvalForTopFraction(1)).toEqual(pawns(-8));
    expect(quantizedEvalForTopFraction(0.5)).toEqual(pawns(0));
  });
});
