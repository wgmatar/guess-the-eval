import { describe, expect, it } from 'vitest';
import { mate, pawns } from '../eval';
import {
  decodePosition,
  lichessUrl,
  parseDataset,
  PositionSource,
  positionTitle,
  shortName,
  sideLabel,
  type Dataset,
} from '../positions';

const URL = 'https://lichess.org/broadcast/fide-candidates-2022/round-1/LsFeKWZU/nPhUcrb7';
const dataset: Dataset = {
  schema: 1,
  dataset: 'test',
  games: [
    {
      w: 'Radjabov, Teimour',
      b: 'Rapport, Richard',
      we: 2753,
      be: 2764,
      y: 2022,
      ev: 'FIDE Candidates 2022',
      op: 'Sicilian, Taimanov variation',
      url: URL,
    },
    { w: 'A, B', b: 'C, D' },
    { w: 'E, F', b: 'G, H', src: 'masters', url: 'https://lichess.org/3IjC40lK' },
  ],
  positions: [
    [0, '8/8/8/8/8/8/8/8 b - - 3 17', 0.35],
    [1, '8/8/8/8/8/8/8/8 w - - 0 1', { mate: -3 }],
    [5, '8/8/8/8/8/8/8/8 w - - 0 1', 0.1],
    [0, '8/8/8/8/8/8/8/8 w - - 0 1', 'x'],
    'nonsense',
    [2, '8/8/8/8/8/8/8/8 b - - 0 20', 0.8],
  ],
};

describe('positions', () => {
  it('shortens player names', () => {
    expect(shortName('Radjabov, Teimour')).toBe('T. Radjabov');
    expect(shortName('Duda, Jan-Krzysztof')).toBe('J. Duda');
    expect(shortName('Magnus Carlsen')).toBe('Magnus Carlsen');
    expect(shortName('Gukesh, D')).toBe('D. Gukesh');
    expect(shortName('')).toBe('');
  });

  it('composes the title with the iOS punctuation', () => {
    const p = decodePosition(dataset, 0);
    expect(p && positionTitle(p)).toBe(
      'T. Radjabov (2753) vs R. Rapport (2764), 2022 — Sicilian, Taimanov variation',
    );
  });

  it('drops missing metadata cleanly', () => {
    const p = decodePosition(dataset, 1);
    expect(p?.eval).toEqual(mate(-3));
    expect(p && positionTitle(p)).toBe('B. A vs D. C');
    // No game on Lichess: its analysis board at this exact position instead.
    expect(p && lichessUrl(p)).toBe(
      'https://lichess.org/analysis/standard/8/8/8/8/8/8/8/8_w_-_-_0_1',
    );
    expect(p?.source).toBe('broadcast');
  });

  it('links a masters game to its Lichess page at the ply', () => {
    const p = decodePosition(dataset, 5);
    expect(p?.source).toBe('masters');
    expect(p && lichessUrl(p)).toBe('https://lichess.org/3IjC40lK#39');
  });

  it('links to the source game at the position’s ply', () => {
    const p = decodePosition(dataset, 0);
    expect(p?.eval).toEqual(pawns(0.35));
    expect(p && lichessUrl(p)).toBe(`${URL}#33`);
  });

  it('says whose move it is, with the move number alongside', () => {
    const black = decodePosition(dataset, 0);
    const white = decodePosition(dataset, 1);
    expect(black && sideLabel(black)).toBe('Black to move');
    expect(black?.moveNumber).toBe(17);
    expect(white && sideLabel(white)).toBe('White to move');
  });

  it('skips rows that do not decode', () => {
    expect(decodePosition(dataset, 2)).toBeNull();
    expect(decodePosition(dataset, 3)).toBeNull();
    expect(decodePosition(dataset, 4)).toBeNull();
  });

  it('memoises and bounds the cache', () => {
    const source = new PositionSource(dataset);
    expect(source.count).toBe(6);
    expect(source.position(0)).toBe(source.position(0));
    expect(source.position(-1)).toBeNull();
    expect(source.position(6)).toBeNull();
  });

  it('rejects a malformed envelope', () => {
    expect(() => parseDataset(null)).toThrow();
    expect(() => parseDataset({ schema: 2, dataset: 'x', games: [], positions: [] })).toThrow();
    expect(() => parseDataset({ schema: 1, dataset: '', games: [], positions: [] })).toThrow();
    expect(() => parseDataset({ schema: 1, dataset: 'x', games: [] })).toThrow();
    expect(parseDataset({ schema: 1, dataset: 'x', games: [], positions: [] }).dataset).toBe('x');
  });
});
