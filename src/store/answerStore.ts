import { LIMIT } from '../core/eval';
import { AnsweredSet } from './answeredSet';
import { KEYS, type KeyValueStore } from './storage';

/** One submitted guess: position index, guess in pawns, time in ms. */
export interface Answer {
  readonly p: number;
  readonly g: number;
  readonly t: number;
}

/** Only the newest answers are kept on disk; older pages leave history on the next load. */
export const HISTORY_CAP = 1000;

/**
 * The record of what has been answered. Port of `AnswerStore.swift`. Written synchronously
 * on every submit, so closing the tab straight afterwards never loses the answer.
 *
 * Indices only mean something against the dataset they were recorded on, so a different
 * dataset name drops the bitmap and history. Stats are counts, not indices, and survive.
 */
export class AnswerStore {
  readonly answered: AnsweredSet;
  private readonly all: Answer[];

  constructor(
    private readonly store: KeyValueStore,
    dataset: string,
    count: number,
  ) {
    if (store.get(KEYS.dataset) !== dataset) {
      store.remove(KEYS.answered);
      store.remove(KEYS.history);
      store.set(KEYS.dataset, dataset);
    }
    this.all = readHistory(store.get(KEYS.history), count);
    this.answered = AnsweredSet.fromBase64(store.get(KEYS.answered));
    this.answered.truncate(count);
  }

  /** Every answer, oldest first. Page `i` of the feed is `history[i]`. */
  get history(): readonly Answer[] {
    return this.all;
  }

  append(answer: Answer): void {
    this.all.push(answer);
    this.answered.insert(answer.p);
    this.store.set(KEYS.history, JSON.stringify(this.all.slice(-HISTORY_CAP)));
    this.store.set(KEYS.answered, this.answered.toBase64());
  }

  /** Starts a fresh round once every position has been answered. */
  clearAnswered(): void {
    this.answered.clear();
    this.store.set(KEYS.answered, this.answered.toBase64());
  }
}

function readHistory(text: string | null, count: number): Answer[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Answer[] = [];
  for (const row of raw.slice(-HISTORY_CAP)) {
    if (row === null || typeof row !== 'object') continue;
    const { p, g, t } = row as Record<string, unknown>;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p >= count) continue;
    if (typeof g !== 'number' || !Number.isFinite(g)) continue;
    out.push({ p, g: Math.min(Math.max(g, -LIMIT), LIMIT), t: typeof t === 'number' ? t : 0 });
  }
  return out;
}
