import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../accuracy';
import { EMPTY_BOARD } from '../chessBoard';
import { clampedPawns, LIMIT, quantizedPawns } from '../eval';
import { decodePosition, lichessUrl, parseDataset, type Position } from '../positions';

/** Rows before this index shipped first and never change; the rows after it were quota-sampled. */
const FIRST_NEW = 11472;

/** Invariants of the shipped file, which the generator also checks before writing. */
const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../public/positions.json', import.meta.url), 'utf8'),
);
const dataset = parseDataset(raw);
const positions = dataset.positions.map((_, i) => decodePosition(dataset, i));
const URLS: Record<string, RegExp> = {
  broadcast: /^https:\/\/lichess\.org\/broadcast\/[^/]+\/[^/]+\/\w{8}\/\w{8}$/,
  masters: /^https:\/\/lichess\.org\/\w{8}$/,
};

describe('public/positions.json', () => {
  it('is the broadcasts-b dataset', () => {
    expect(dataset.dataset).toBe('broadcasts-b');
    expect(dataset.positions).toHaveLength(22046);
  });

  it('adds no new row closer to equal than 0.50, and most of them between 0.70 and 1.20', () => {
    const fresh = (positions as Position[]).slice(FIRST_NEW);
    const pawnsOf = (p: Position) => (p.eval.kind === 'pawns' ? Math.abs(p.eval.pawns) : NaN);
    for (const p of fresh) expect(pawnsOf(p), `row ${p.index}`).toBeGreaterThanOrEqual(0.5);
    const middle = fresh.filter((p) => pawnsOf(p) >= 0.7 && pawnsOf(p) <= 1.2).length;
    // The biggest share by far; the sources ran out before the 40% target was reached.
    expect(middle / fresh.length).toBeGreaterThanOrEqual(0.35);
    expect(middle / fresh.length).toBeLessThanOrEqual(0.45);
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

  it('links every position to Lichess: its game at the right move, or the analysis board', () => {
    const used = new Set<number>();
    dataset.positions.forEach((row) => used.add((row as number[])[0]));
    expect(used.size).toBe(dataset.games.length);
    for (const game of dataset.games) {
      const source = typeof game.src === 'string' ? game.src : 'broadcast';
      expect(['broadcast', 'masters', 'pgnmentor']).toContain(source);
      // The url is optional (PGN Mentor games have none); when present it is the source's link.
      if (game.url !== undefined) expect(String(game.url)).toMatch(URLS[source]!);
      else expect(source).toBe('pgnmentor');
    }
    for (const p of positions as Position[]) {
      expect(p.moveNumber).toBeGreaterThanOrEqual(10);
      expect(lichessUrl(p)).toBe(
        p.gameUrl
          ? `${p.gameUrl}#${p.ply}`
          : `https://lichess.org/analysis/standard/${p.fen.replaceAll(' ', '_')}`,
      );
    }
  });
});
