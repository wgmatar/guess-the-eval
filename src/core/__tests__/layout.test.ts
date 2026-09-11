import { describe, expect, it } from 'vitest';
import { bubbleCenter, computeLayout, inGuessRegion, SIZES, topFractionForY } from '../layout';

const WIDTHS = [320, 375, 393, 430, 600, 720];
const HEIGHTS = [647, 874, 900];

describe('page layout (vertical bar)', () => {
  it('never lets a bubble cross the board edge or leave the page', () => {
    for (const w of WIDTHS) {
      for (const h of HEIGHTS) {
        const l = computeLayout(w, h);
        const boardRight = l.board.x + l.board.width;
        for (const top of [0, 0.5, 1]) {
          const c = bubbleCenter(l, top);
          expect(c.x - SIZES.bubbleW / 2, `${w}x${h} @${top}`).toBeGreaterThanOrEqual(boardRight);
          expect(c.x + SIZES.bubbleW / 2, `${w}x${h} @${top}`).toBeLessThanOrEqual(w);
        }
      }
    }
  });

  it('stands the bar beside the board at exactly its height', () => {
    for (const w of WIDTHS) {
      const l = computeLayout(w, 874);
      expect(l.bar.y).toBe(l.board.y);
      expect(l.bar.height).toBe(l.board.height);
      expect(l.bar.x).toBeGreaterThan(l.board.x + l.board.width);
    }
  });

  it('keeps the board a positive multiple of 8 on a small phone', () => {
    const l = computeLayout(375, 647);
    expect(l.board.width).toBeGreaterThan(0);
    expect(l.board.width % 8).toBe(0);
  });

  it('puts the controls under the board and the lowest bubble, inside the page', () => {
    for (const w of WIDTHS) {
      for (const h of HEIGHTS) {
        const l = computeLayout(w, h);
        expect(l.controls.y).toBeGreaterThanOrEqual(l.bar.y + l.bar.height + SIZES.bubbleH / 2);
        expect(l.controls.y + l.controls.height).toBeLessThanOrEqual(h);
        expect(l.submit.x).toBe(l.input.x + l.input.width + SIZES.inputGap);
        expect(l.submit.x + l.submit.width).toBe(l.bar.x + l.bar.width);
      }
    }
  });

  it('keeps the title clear of the Stats link', () => {
    for (const w of WIDTHS) {
      const l = computeLayout(w, 874);
      expect(l.title.x + l.title.width).toBeLessThanOrEqual(l.sound.x);
      expect(l.sound.x + l.sound.width).toBeLessThanOrEqual(l.stats.x);
    }
  });

  it('uses the desktop column generously', () => {
    expect(computeLayout(720, 900).board.width).toBe(608);
    expect(computeLayout(720, 650).board.width).toBe(480);
  });

  it('grabs the guess beside the board, never on it', () => {
    const l = computeLayout(393, 800);
    const midY = l.bar.y + l.bar.height / 2;
    expect(inGuessRegion(l, l.barCenterX, midY)).toBe(true);
    expect(inGuessRegion(l, l.barCenterX, l.bar.y - 10)).toBe(true);
    expect(inGuessRegion(l, l.board.x + l.board.width - 2, midY)).toBe(false);
    expect(inGuessRegion(l, l.board.x + 10, midY)).toBe(false);
    expect(inGuessRegion(l, l.barCenterX, l.controls.y + 20)).toBe(false);
  });

  it('maps y to a clamped bar fraction', () => {
    const l = computeLayout(393, 800);
    expect(topFractionForY(l, l.bar.y)).toBe(0);
    expect(topFractionForY(l, l.bar.y + l.bar.height)).toBe(1);
    expect(topFractionForY(l, l.bar.y + l.bar.height / 2)).toBe(0.5);
    expect(topFractionForY(l, -100)).toBe(0);
    expect(topFractionForY(l, 9999)).toBe(1);
  });
});
