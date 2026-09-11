import { describe, expect, it } from 'vitest';
import {
  classifyDrag,
  pageOffset,
  resisted,
  settlePage,
  settleStage,
  stageOffset,
  velocityOf,
  WheelPager,
  wheelPixels,
} from '../gestures';

describe('drag classification', () => {
  it('decides nothing inside the dead zone', () => {
    expect(classifyDrag(3, 3, 'feed', true)).toBe('undecided');
    expect(classifyDrag(0, 5, 'stats', false)).toBe('undecided');
  });

  it('gives a drag that starts beside the board to the guess, whatever its direction', () => {
    expect(classifyDrag(0, 10, 'feed', true)).toBe('guess');
    expect(classifyDrag(40, 2, 'feed', true)).toBe('guess');
  });

  it('pages vertically and opens Stats only on a deliberate horizontal drag', () => {
    expect(classifyDrag(1, 9, 'feed', false)).toBe('page');
    expect(classifyDrag(30, 10, 'feed', false)).toBe('stage');
    expect(classifyDrag(20, 5, 'feed', false)).toBe('undecided');
    expect(classifyDrag(30, 25, 'feed', false)).toBe('page');
  });

  it('on Stats, gives vertical movement to scrolling and waits for a real sideways drag', () => {
    expect(classifyDrag(30, 5, 'stats', false)).toBe('stage');
    expect(classifyDrag(2, 12, 'stats', false)).toBe('ignored');
    expect(classifyDrag(7, 3, 'stats', false)).toBe('undecided');
  });
});

describe('rubber band', () => {
  it('is bounded, monotonic and odd', () => {
    let previous = 0;
    for (let d = 1; d < 5000; d += 50) {
      const r = resisted(d, 800);
      expect(r).toBeGreaterThan(previous);
      expect(r).toBeLessThan(800);
      expect(resisted(-d, 800)).toBeCloseTo(-r, 9);
      previous = r;
    }
    expect(resisted(100, 0)).toBe(0);
  });

  it('always moves slower than the finger', () => {
    for (const d of [1, 10, 50, 200, 800]) expect(resisted(d, 800)).toBeLessThan(d * 0.56);
    expect(resisted(1, 800)).toBeCloseTo(0.55, 2);
  });

  it('applies only past the ends of the feed and the stage', () => {
    expect(pageOffset(50, 0, 3, 800)).toBeLessThan(50);
    expect(pageOffset(-50, 3, 3, 800)).toBeGreaterThan(-50);
    expect(pageOffset(-50, 1, 3, 800)).toBe(-50);
    expect(stageOffset(50, 'feed', 400)).toBeLessThan(50);
    expect(stageOffset(-50, 'feed', 400)).toBe(-50);
    expect(stageOffset(-50, 'stats', 400)).toBeGreaterThan(-50);
  });
});

describe('settling', () => {
  it('changes page past the commit distance or on a flick, and clamps', () => {
    expect(settlePage(-200, 0, 1, 3, 800)).toBe(2);
    expect(settlePage(-100, 0, 1, 3, 800)).toBe(1);
    expect(settlePage(-60, -1.5, 1, 3, 800)).toBe(2);
    expect(settlePage(200, 0, 1, 3, 800)).toBe(0);
    expect(settlePage(-400, 0, 3, 3, 800)).toBe(3);
    expect(settlePage(400, 0, 0, 3, 800)).toBe(0);
  });

  it('moves between the feed and Stats past a quarter or on a flick', () => {
    expect(settleStage(-120, 0, 'feed', 400)).toBe('stats');
    expect(settleStage(-80, 0, 'feed', 400)).toBe('feed');
    expect(settleStage(-40, -1, 'feed', 400)).toBe('stats');
    expect(settleStage(120, 0, 'stats', 400)).toBe('feed');
    expect(settleStage(120, 0, 'feed', 400)).toBe('feed');
  });

  it('measures release velocity over the last 100 ms', () => {
    expect(velocityOf([])).toEqual({ vx: 0, vy: 0 });
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 0, t: 400 },
      { x: 10, y: -50, t: 450 },
      { x: 20, y: -100, t: 500 },
    ];
    const v = velocityOf(samples);
    expect(v.vx).toBeCloseTo(0.2, 9);
    expect(v.vy).toBeCloseTo(-1, 9);
  });
});

describe('wheel paging', () => {
  it('pages once per flick, however long the inertial tail', () => {
    const pager = new WheelPager();
    const pages: number[] = [];
    for (let i = 0; i < 60; i++) pages.push(pager.push(30, i * 16));
    expect(pages.filter((p) => p !== 0)).toEqual([1]);
    expect(pager.push(-120, 60 * 16 + 400)).toBe(-1);
  });

  it('ignores small nudges and normalises line and page deltas', () => {
    const pager = new WheelPager();
    expect(pager.push(40, 0)).toBe(0);
    expect(pager.push(40, 500)).toBe(0);
    expect(wheelPixels(3, 1, 800)).toBe(48);
    expect(wheelPixels(1, 2, 800)).toBe(800);
    expect(wheelPixels(12, 0, 800)).toBe(12);
  });
});
