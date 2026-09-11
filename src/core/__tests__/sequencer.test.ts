import { describe, expect, it } from 'vitest';
import { mulberry32, pickIndex } from '../sequencer';

describe('sequencer', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
    const firsts = new Set(Array.from({ length: 20 }, (_, s) => mulberry32(s)()));
    expect(firsts.size).toBe(20);
  });

  it('stays in [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('handles empty and single-entry sets', () => {
    expect(pickIndex(0, () => true, mulberry32(1))).toBeNull();
    expect(pickIndex(1, () => true, mulberry32(1))).toBe(0);
    expect(pickIndex(1, () => false, mulberry32(1))).toBeNull();
  });

  it('finds the last acceptable index by scanning once random draws run out', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(pickIndex(25000, (i) => i === 12345, mulberry32(seed))).toBe(12345);
    }
  });

  it('spreads picks across the range', () => {
    const r = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pickIndex(10, () => true, r) ?? -1);
    expect(seen.size).toBe(10);
  });
});
