/**
 * A parsed position, ready to draw: 64 squares, a8 first, White always at the bottom.
 * Port of `ChessBoard.swift`. Nothing here knows the rules of chess.
 */
export type PieceCode = `${'w' | 'b'}${'K' | 'Q' | 'R' | 'B' | 'N' | 'P'}`;
export type Board = readonly (PieceCode | null)[];

export const EMPTY_BOARD: Board = Object.freeze(Array<PieceCode | null>(64).fill(null));

const KINDS = 'kqrbnp';

/** Parses a FEN's placement field. Anything that is not 8×8 yields `EMPTY_BOARD`. */
export function parseBoard(fen: string): Board {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  const out: (PieceCode | null)[] = [];
  for (const rank of placement.split('/')) {
    let files = 0;
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        const skip = ch.charCodeAt(0) - 48;
        for (let i = 0; i < skip; i++) out.push(null);
        files += skip;
      } else if (KINDS.includes(ch.toLowerCase())) {
        const colour = ch === ch.toLowerCase() ? 'b' : 'w';
        out.push(`${colour}${ch.toUpperCase()}` as PieceCode);
        files += 1;
      } else {
        return EMPTY_BOARD;
      }
    }
    if (files !== 8) return EMPTY_BOARD;
  }
  return out.length === 64 ? out : EMPTY_BOARD;
}

export function pieceAt(board: Board, row: number, column: number): PieceCode | null {
  if (row < 0 || row > 7 || column < 0 || column > 7) return null;
  return board[row * 8 + column] ?? null;
}

export function isLightSquare(row: number, column: number): boolean {
  return (row + column) % 2 === 0;
}

export interface FenMeta {
  readonly sideToMove: 'w' | 'b';
  readonly moveNumber: number;
  /** Half-moves from the initial position: the Lichess `#ply` anchor. */
  readonly ply: number;
}

export function fenMeta(fen: string): FenMeta | null {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 6) return null;
  const side = fields[1];
  const move = Number(fields[5]);
  if ((side !== 'w' && side !== 'b') || !Number.isInteger(move) || move < 1) return null;
  return { sideToMove: side, moveNumber: move, ply: side === 'b' ? 2 * move - 1 : 2 * (move - 1) };
}
