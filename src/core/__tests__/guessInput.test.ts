import { describe, expect, it } from 'vitest';
import { mate, pawns } from '../eval';
import { formatGuess, isAllowedKey, parseGuess } from '../guessInput';

describe('typed guess', () => {
  it('parses the lenient table', () => {
    const table: [string, number][] = [
      ['', 0],
      ['+', 0],
      ['-', 0],
      ['.', 0],
      ['-.', 0],
      ['1.3', 1.3],
      ['-.4', -0.4],
      ['9', 8],
      ['-12', -8],
      ['1,25', 1.25],
      ['−0.5', -0.5],
      [' 2 ', 2],
      ['1.', 1],
      ['0.005', 0.01],
      ['0.004', 0],
      ['+0.45', 0.45],
    ];
    for (const [input, value] of table) {
      expect(parseGuess(input), JSON.stringify(input)).toEqual({ ok: true, eval: pawns(value) });
    }
  });

  it('rejects anything else', () => {
    for (const input of ['abc', '1.2.3', '1e3', '--1', '1-', 'Infinity', '0x1']) {
      expect(parseGuess(input).ok, input).toBe(false);
    }
  });

  it('formats so the text parses back', () => {
    expect(formatGuess(pawns(1.3))).toBe('+1.30');
    expect(formatGuess(pawns(-0.45))).toBe('-0.45');
    expect(formatGuess(pawns(0))).toBe('0.00');
    expect(formatGuess(pawns(-0.004))).toBe('0.00');
    expect(formatGuess(mate(3))).toBe('+8.00');
    for (const v of [-8, -1.37, -0.01, 0, 0.3, 7.99]) {
      expect(parseGuess(formatGuess(pawns(v)))).toEqual({ ok: true, eval: pawns(v) });
    }
  });

  it('allows only numeric and editing keys', () => {
    for (const k of ['1', '0', '.', ',', '+', '-', '−', 'Backspace', 'Enter', 'Tab']) {
      expect(isAllowedKey(k), k).toBe(true);
    }
    for (const k of ['a', 'e', 'w', 's', ' ', 'ArrowUp', 'ArrowDown']) {
      expect(isAllowedKey(k), k).toBe(false);
    }
  });
});
