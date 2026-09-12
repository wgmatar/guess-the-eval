import { fenMeta, parseBoard, type Board } from './chessBoard';
import { decodeEval, type Eval } from './eval';

/**
 * The dataset in `public/positions.json`, written by `tools/fetch_positions.py`:
 * `{schema, dataset, generated, tours, games: [GameRow], positions: [[gameIdx, fen, eval]]}`.
 * Side to move, move number and ply are derived from the FEN rather than stored.
 */
export interface GameRow {
  readonly w?: unknown;
  readonly b?: unknown;
  readonly we?: unknown;
  readonly be?: unknown;
  readonly y?: unknown;
  readonly ev?: unknown;
  readonly eco?: unknown;
  readonly op?: unknown;
  /** Absent on broadcast games; `masters` for the Lichess masters database. */
  readonly src?: unknown;
  readonly url?: unknown;
}

export interface Dataset {
  readonly schema: 1;
  readonly dataset: string;
  readonly games: readonly GameRow[];
  readonly positions: readonly unknown[];
}

export interface Position {
  readonly index: number;
  readonly fen: string;
  readonly eval: Eval;
  readonly board: Board;
  readonly white: string;
  readonly black: string;
  readonly whiteElo: number | null;
  readonly blackElo: number | null;
  readonly year: number | null;
  readonly opening: string | null;
  readonly event: string | null;
  readonly moveNumber: number | null;
  readonly sideToMove: 'w' | 'b' | null;
  readonly ply: number | null;
  readonly gameUrl: string | null;
  /** Where the game came from: `broadcast` (the default) or `masters`. */
  readonly source: string;
}

/** Checks the envelope; individual rows are checked lazily, and a bad one is skipped. */
export function parseDataset(raw: unknown): Dataset {
  if (raw === null || typeof raw !== 'object') throw new Error('positions file is not an object');
  const o = raw as Record<string, unknown>;
  if (o.schema !== 1) throw new Error(`unsupported positions schema ${String(o.schema)}`);
  if (typeof o.dataset !== 'string' || !o.dataset)
    throw new Error('positions file has no dataset name');
  if (!Array.isArray(o.games) || !Array.isArray(o.positions)) {
    throw new Error('positions file is missing games or positions');
  }
  return { schema: 1, dataset: o.dataset, games: o.games as GameRow[], positions: o.positions };
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;
const LICHESS = /^https:\/\/lichess\.org\//;

export function decodePosition(dataset: Dataset, index: number): Position | null {
  const row = dataset.positions[index];
  if (!Array.isArray(row) || row.length < 3) return null;
  const [gameIndex, fen, rawEval] = row as unknown[];
  if (typeof gameIndex !== 'number' || !Number.isInteger(gameIndex)) return null;
  const game = dataset.games[gameIndex];
  if (game === null || typeof game !== 'object') return null;
  if (typeof fen !== 'string' || !fen.trim()) return null;
  const evaluation = decodeEval(rawEval);
  if (!evaluation) return null;
  const meta = fenMeta(fen);
  const url = text(game.url);
  return {
    index,
    fen,
    eval: evaluation,
    board: parseBoard(fen),
    white: text(game.w) ?? '',
    black: text(game.b) ?? '',
    whiteElo: int(game.we),
    blackElo: int(game.be),
    year: int(game.y),
    opening: text(game.op),
    event: text(game.ev),
    moveNumber: meta?.moveNumber ?? null,
    sideToMove: meta?.sideToMove ?? null,
    ply: meta?.ply ?? null,
    gameUrl: url && LICHESS.test(url) ? url : null,
    source: text(game.src) ?? 'broadcast',
  };
}

/** Decodes positions on demand and keeps the most recent ones, so paging never re-parses. */
export class PositionSource {
  static readonly CACHE_LIMIT = 64;
  private readonly cache = new Map<number, Position | null>();

  constructor(readonly data: Dataset) {}

  get count(): number {
    return this.data.positions.length;
  }

  get datasetName(): string {
    return this.data.dataset;
  }

  /** The position at `index`, or `null` when out of range or undecodable. */
  position(index: number): Position | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return null;
    if (this.cache.has(index)) {
      const hit = this.cache.get(index) as Position | null;
      this.cache.delete(index);
      this.cache.set(index, hit);
      return hit;
    }
    const decoded = decodePosition(this.data, index);
    this.cache.set(index, decoded);
    if (this.cache.size > PositionSource.CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return decoded;
  }
}

/** `"Radjabov, Teimour"` → `"T. Radjabov"`. Anything not in `Last, First` form passes through. */
export function shortName(raw: string): string {
  const comma = raw.indexOf(',');
  if (comma < 0) return raw;
  const last = raw.slice(0, comma).trim();
  const first = raw.slice(comma + 1).trim();
  if (!last || !first) return raw;
  return `${[...first][0]}. ${last}`;
}

/** `T. Radjabov (2753) vs R. Rapport (2764), 2022 — Sicilian`; each part optional. */
export function positionTitle(p: Position): string {
  const rating = (elo: number | null) => (elo === null ? '' : ` (${elo})`);
  let line = `${shortName(p.white)}${rating(p.whiteElo)} vs ${shortName(p.black)}${rating(p.blackElo)}`;
  if (p.year !== null) line += `, ${p.year}`;
  if (p.opening) line += ` — ${p.opening}`;
  return line;
}

/**
 * `White to move` or `Black to move`. The board never flips, so this is the only cue whose turn
 * it is; it matters, because having the move is often worth a lot in the evaluation.
 */
export function sideLabel(p: Position): string | null {
  if (p.sideToMove === 'w') return 'White to move';
  if (p.sideToMove === 'b') return 'Black to move';
  return null;
}

/**
 * The source game on Lichess, opened at this position's move; for a game Lichess does not
 * host, its analysis board at this exact position.
 */
export function lichessUrl(p: Position): string {
  if (!p.gameUrl)
    return `https://lichess.org/analysis/standard/${p.fen.trim().replace(/\s+/g, '_')}`;
  return p.ply === null ? p.gameUrl : `${p.gameUrl}#${p.ply}`;
}
