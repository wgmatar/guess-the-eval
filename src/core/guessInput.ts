import { clampedPawns, quantizedPawns, type Eval } from './eval';

/**
 * The typed guess. Lenient while typing: an empty box, a lone sign or a lone point all read
 * as 0.00, commas are decimal points, and U+2212 is a minus. Anything else is rejected and
 * the caller keeps the last good value.
 */
export type ParsedGuess = { readonly ok: true; readonly eval: Eval } | { readonly ok: false };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const ZERO_FORMS = new Set(['', '+', '-', '.', '+.', '-.']);

export function parseGuess(text: string): ParsedGuess {
  const normalised = text.trim().replace(/,/g, '.').replace(/−/g, '-');
  if (ZERO_FORMS.has(normalised)) return { ok: true, eval: quantizedPawns(0) };
  if (!NUMBER.test(normalised)) return { ok: false };
  const value = Number(normalised);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, eval: quantizedPawns(value) };
}

/** `+1.30`, `-0.45`, `0.00`: an ASCII hyphen, so the text parses back to the same value. */
export function formatGuess(e: Eval): string {
  const q = quantizedPawns(clampedPawns(e));
  const p = q.kind === 'pawns' ? q.pawns : 0;
  if (p === 0) return '0.00';
  return `${p > 0 ? '+' : '-'}${Math.abs(p).toFixed(2)}`;
}

const EDITING_KEYS = new Set([
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Tab',
  'Enter',
  'Escape',
]);

/** Keys the eval box accepts; letters and everything else are swallowed. */
export function isAllowedKey(key: string): boolean {
  return /^[0-9.,+\-−]$/.test(key) || EDITING_KEYS.has(key);
}
