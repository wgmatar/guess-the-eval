import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../accuracy';
import { EMPTY_BOARD } from '../chessBoard';
import { clampedPawns, LIMIT, quantizedPawns } from '../eval';
import { decodePosition, lichessUrl, parseDataset, type Position } from '../positions';

/** Invariants of the shipped file, which the generator also checks before writing. */
const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../public/positions.json', import.meta.url), 'utf8'),
);
const dataset = parseDataset(raw);
const positions = dataset.positions.map((_, i) => decodePosition(dataset, i));
const GAME_URL = /^https:\/\/lichess\.org\/broadcast\/[^/]+\/[^/]+\/\w{8}\/\w{8}$/;

describe('public/positions.json', () => {
  it('is a named schema-1 dataset of thousands of positions', () => {
    expect(dataset.dataset).toMatch(/^broadcasts-[a-z]$/);
    expect(dataset.positions.length).toBeGreaterThan(4000);
  });

  it('decodes every row into a real board with one king each', () => {
    positions.forEach((p, i) => {
      expect(p, `row ${i}`).not.toBeNull();
      const board = (p as Position).board;
      expect(board).not.toBe(EMPTY_BOARD);
      expect(board.filter((s) => s === 'wK')).toHaveLength(1);
      expect(board.filter((s) => s === 'bK')).toHaveLength(1);
    });
  });

  it('keeps every eval on the bar, never a signed zero, and always answerable in gold', () => {
    for (const p of positions as Position[]) {
      expect(p.eval.kind).toBe('pawns');
      const v = p.eval.kind === 'pawns' ? p.eval.pawns : NaN;
      expect(Math.abs(v)).toBeLessThanOrEqual(LIMIT);
      expect(Object.is(v, -0)).toBe(false);
      expect(evaluate(quantizedPawns(clampedPawns(p.eval)), p.eval)).toBe('exact');
    }
  });

  it('never repeats a position', () => {
    const epds = (positions as Position[]).map((p) => p.fen.split(' ').slice(0, 4).join(' '));
    expect(new Set(epds).size).toBe(epds.length);
  });

  it('links every position to its game on Lichess at the right move', () => {
    const used = new Set<number>();
    dataset.positions.forEach((row) => used.add((row as number[])[0]));
    expect(used.size).toBe(dataset.games.length);
    for (const game of dataset.games) expect(String(game.url)).toMatch(GAME_URL);
    for (const p of positions as Position[]) {
      expect(p.moveNumber).toBeGreaterThanOrEqual(10);
      expect(lichessUrl(p)).toBe(`${p.gameUrl}#${p.ply}`);
    }
  });
});
