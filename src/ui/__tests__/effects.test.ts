import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/sequencer';
import { alpha, burst, BURSTS, step } from '../effects';

describe('confetti', () => {
  it('makes gold clearly bigger than green', () => {
    const green = burst('close', 0, 0, mulberry32(1));
    const gold = burst('exact', 0, 0, mulberry32(1));
    expect(gold.length).toBeGreaterThan(green.length * 2);
    expect(Math.max(...gold.map((p) => p.life))).toBeGreaterThan(
      Math.max(...green.map((p) => p.life)),
    );
    expect(gold.some((p) => p.sparkle)).toBe(true);
    expect(green.some((p) => p.sparkle)).toBe(false);
  });

  it('launches upward in its own colours, and is short', () => {
    for (const kind of ['close', 'exact'] as const) {
      for (const p of burst(kind, 10, 20, mulberry32(7))) {
        expect(p.vy).toBeLessThanOrEqual(0);
        expect(BURSTS[kind].colors).toContain(p.color);
        expect(p.delay + p.life).toBeLessThanOrEqual(kind === 'close' ? 1.1 : 2.1);
      }
    }
  });

  it('falls under gravity, slows in the air and fades out', () => {
    const [p] = burst('close', 0, 0, mulberry32(3));
    const vx = Math.abs(p!.vx);
    const vy = p!.vy;
    step(p!, 0.05);
    expect(p!.vy).toBeGreaterThan(vy);
    expect(Math.abs(p!.vx)).toBeLessThan(vx);
    expect(alpha(p!, 0)).toBe(1);
    expect(alpha(p!, p!.life * 0.9)).toBeLessThan(1);
    expect(alpha(p!, p!.life)).toBe(0);
  });
});
