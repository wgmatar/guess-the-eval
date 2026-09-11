import { describe, expect, it } from 'vitest';
import { audioState, NOTES, playReveal } from '../sound';

describe('reveal sounds', () => {
  it('gives each outcome its own shape: a low drop, a two-note rise, a four-note chime', () => {
    const tonal = (k: keyof typeof NOTES) => NOTES[k].filter((n) => n.gain >= 0.05);
    expect(tonal('off').every((n) => n.freq < 300 && n.to !== undefined && n.to < n.freq)).toBe(
      true,
    );
    const green = tonal('close');
    expect(green).toHaveLength(2);
    expect(green[1]!.freq).toBeGreaterThan(green[0]!.freq);
    const gold = tonal('exact');
    expect(gold).toHaveLength(4);
    for (let i = 1; i < gold.length; i++) expect(gold[i]!.freq).toBeGreaterThan(gold[i - 1]!.freq);
  });

  it('stays gentle: no note is loud or long', () => {
    for (const notes of Object.values(NOTES)) {
      for (const n of notes) {
        expect(n.gain).toBeLessThanOrEqual(0.16);
        expect(n.at + n.length).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it('is a no-op without Web Audio', () => {
    expect(() => playReveal('exact')).not.toThrow();
    expect(audioState()).toBe('none');
  });
});
