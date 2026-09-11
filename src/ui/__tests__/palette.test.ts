import { describe, expect, it } from 'vitest';
import { bubbleFill, bubbleLabel, contrastRatio, type BubbleKind } from '../palette';

describe('palette', () => {
  it('keeps every bubble label at WCAG AA (4.5:1) on its fill', () => {
    const kinds: BubbleKind[] = ['guess', 'actual', 'close', 'off', 'exact'];
    for (const kind of kinds) {
      expect(contrastRatio(bubbleLabel(kind), bubbleFill(kind)), kind).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('computes the reference ratios', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 9);
  });
});
