import { describe, expect, it } from 'vitest';
import { EMPTY_BOARD, fenMeta, isLightSquare, parseBoard, pieceAt } from '../chessBoard';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('chess board (ChessBoardTests port)', () => {
  it('orients the starting position with White at the bottom', () => {
    const board = parseBoard(START);
    expect(board).toHaveLength(64);
    expect(pieceAt(board, 0, 0)).toBe('bR');
    expect(pieceAt(board, 0, 4)).toBe('bK');
    expect(pieceAt(board, 1, 3)).toBe('bP');
    expect(pieceAt(board, 7, 0)).toBe('wR');
    expect(pieceAt(board, 7, 4)).toBe('wK');
    expect(pieceAt(board, 6, 3)).toBe('wP');
    for (let row = 2; row <= 5; row++) {
      for (let column = 0; column < 8; column++) expect(pieceAt(board, row, column)).toBeNull();
    }
  });

  it('never flips for the side to move', () => {
    expect(pieceAt(parseBoard(START.replace(' w ', ' b ')), 7, 4)).toBe('wK');
  });

  it('parses a shipped-style FEN', () => {
    const board = parseBoard('r1b4r/3k2p1/p1p1pnB1/3q2Bp/1b1p3P/5Q2/PPP2PP1/RN3K1R b - - 3 17');
    expect(board.filter(Boolean)).toHaveLength(26);
    expect(pieceAt(board, 0, 0)).toBe('bR');
    expect(pieceAt(board, 1, 3)).toBe('bK');
    expect(pieceAt(board, 7, 5)).toBe('wK');
  });

  it('yields an empty board for malformed input', () => {
    expect(parseBoard('8/8/8/8/8/8/8/8 w - - 0 1').every((s) => s === null)).toBe(true);
    for (const fen of [
      '',
      'not a fen',
      '8/8/8 w - - 0 1',
      'rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w',
      'xxxxxxxx/8/8/8/8/8/8/8 w - - 0 1',
      '9/8/8/8/8/8/8/8 w - - 0 1',
      '0/8/8/8/8/8/8/8 w - - 0 1',
    ]) {
      expect(parseBoard(fen), fen).toBe(EMPTY_BOARD);
    }
  });

  it('is nil out of bounds, and a8 is a light square', () => {
    const board = parseBoard(START);
    expect(pieceAt(board, -1, 0)).toBeNull();
    expect(pieceAt(board, 8, 0)).toBeNull();
    expect(pieceAt(board, 0, 8)).toBeNull();
    expect(isLightSquare(0, 0)).toBe(true);
    expect(isLightSquare(7, 0)).toBe(false);
  });

  it('derives the side, move number and Lichess ply from the FEN', () => {
    expect(fenMeta(START.replace(' w ', ' b '))).toEqual({
      sideToMove: 'b',
      moveNumber: 1,
      ply: 1,
    });
    expect(fenMeta('8/8/8/8/8/8/8/8 w - - 0 2')).toEqual({
      sideToMove: 'w',
      moveNumber: 2,
      ply: 2,
    });
    expect(fenMeta('8/8/8/8/8/8/8/8 b - - 3 17')?.ply).toBe(33);
    expect(fenMeta('8/8/8/8/8/8/8/8 w')).toBeNull();
    expect(fenMeta('8/8/8/8/8/8/8/8 x - - 0 3')).toBeNull();
  });
});
