import { describe, expect, it } from 'vitest';
import {
  clampedPawns,
  decodeEval,
  display,
  mate,
  MINUS,
  pawns,
  quantizedPawns,
  roundHalfAway,
  spoken,
} from '../eval';

describe('eval', () => {
  it('displays like the iOS formatter', () => {
    expect(display(pawns(1.3))).toBe('+1.30');
    expect(display(pawns(-0.45))).toBe(`${MINUS}0.45`);
    expect(display(pawns(0))).toBe('0.00');
    expect(display(pawns(-0.004))).toBe('0.00');
    expect(display(pawns(8))).toBe('+8.00');
    expect(display(mate(4))).toBe('M4');
    expect(display(mate(-4))).toBe(`${MINUS}M4`);
  });

  it('speaks without symbols', () => {
    expect(spoken(pawns(-0.45))).not.toContain(MINUS);
    expect(spoken(pawns(1.3)).startsWith('plus 1.30')).toBe(true);
    expect(spoken(pawns(0)).startsWith('zero')).toBe(true);
    expect(spoken(mate(4))).toBe('mate in 4 for White');
  });

  it('quantises to what is displayed, half away from zero, capped at the bar', () => {
    expect(quantizedPawns(1.30499)).toEqual(pawns(1.3));
    expect(quantizedPawns(1.30501)).toEqual(pawns(1.31));
    expect(quantizedPawns(99)).toEqual(pawns(8));
    expect(quantizedPawns(-99)).toEqual(pawns(-8));
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.5)).toBe(3);
    expect(Object.is(roundHalfAway(-0.4), 0)).toBe(true);
  });

  it('saturates mate at the bar', () => {
    expect(clampedPawns(mate(3))).toBe(8);
    expect(clampedPawns(mate(-3))).toBe(-8);
    expect(clampedPawns(pawns(-12.37))).toBe(-8);
  });

  it('decodes the three encodings and rejects the rest', () => {
    expect(decodeEval(0.35)).toEqual(pawns(0.35));
    expect(decodeEval({ cp: -120 })).toEqual(pawns(-1.2));
    expect(decodeEval({ mate: -2 })).toEqual(mate(-2));
    expect(decodeEval('1.0')).toBeNull();
    expect(decodeEval(null)).toBeNull();
    expect(decodeEval(Number.NaN)).toBeNull();
  });
});
