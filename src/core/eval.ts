/**
 * An engine evaluation, always from White's perspective. Port of `Eval.swift` and
 * `EvalFormatter.swift`: the only place evaluation text is composed.
 */
export type Eval =
  | { readonly kind: 'pawns'; readonly pawns: number }
  | { readonly kind: 'mate'; readonly mate: number };

/** The bar, and therefore the guess, saturates here. */
export const LIMIT = 8;
/** U+2212 MINUS SIGN: visually balanced against `+`, unlike a hyphen. */
export const MINUS = '−';

export const pawns = (value: number): Eval => ({ kind: 'pawns', pawns: value });
export const mate = (moves: number): Eval => ({ kind: 'mate', mate: moves });
export const ZERO: Eval = pawns(0);

/** Swift's `.rounded()`: half away from zero. Never returns a signed zero. */
export function roundHalfAway(x: number): number {
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

/** The pawn value used for geometry. Mate saturates at the bar's extreme. */
export function clampedPawns(e: Eval): number {
  if (e.kind === 'pawns') return Math.min(Math.max(e.pawns, -LIMIT), LIMIT);
  if (e.mate === 0) return 0;
  return e.mate > 0 ? LIMIT : -LIMIT;
}

/**
 * Snaps a pawn value to the two decimals the UI shows, so a bubble's label never
 * disagrees with the value that gets submitted.
 */
export function quantizedPawns(p: number): Eval {
  const clamped = Math.min(Math.max(p, -LIMIT), LIMIT);
  return pawns(roundHalfAway(clamped * 100) / 100);
}

export function evalEquals(a: Eval, b: Eval): boolean {
  if (a.kind === 'pawns') return b.kind === 'pawns' && a.pawns === b.pawns;
  return b.kind === 'mate' && a.mate === b.mate;
}

/** A bare pawn number, `{"cp": int}` or `{"mate": int}`; anything else is `null`. */
export function decodeEval(raw: unknown): Eval | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? pawns(raw) : null;
  if (raw !== null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.mate === 'number' && Number.isInteger(o.mate)) return mate(o.mate);
    if (typeof o.cp === 'number' && Number.isInteger(o.cp)) return pawns(o.cp / 100);
  }
  return null;
}

const hundredths = (raw: number): number => roundHalfAway(raw * 100) / 100;

/** `+1.30`, `−0.45`, `0.00`, `M4`, `−M4`. Rounds first, so −0.004 reads `0.00`. */
export function display(e: Eval): string {
  if (e.kind === 'mate') {
    if (e.mate === 0) return 'M0';
    return e.mate > 0 ? `M${e.mate}` : `${MINUS}M${Math.abs(e.mate)}`;
  }
  const rounded = hundredths(e.pawns);
  const magnitude = Math.abs(rounded).toFixed(2);
  if (rounded > 0) return `+${magnitude}`;
  if (rounded < 0) return `${MINUS}${magnitude}`;
  return '0.00';
}

/** Spoken form for screen readers, which read `−` and `+` unreliably. */
export function spoken(e: Eval): string {
  if (e.kind === 'mate') {
    if (e.mate === 0) return 'mate';
    return `mate in ${Math.abs(e.mate)} for ${e.mate > 0 ? 'White' : 'Black'}`;
  }
  const rounded = hundredths(e.pawns);
  const magnitude = Math.abs(rounded).toFixed(2);
  if (rounded > 0) return `plus ${magnitude}, White better`;
  if (rounded < 0) return `minus ${magnitude}, Black better`;
  return 'zero, equal';
}
