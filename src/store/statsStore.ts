import type { Accuracy } from '../core/accuracy';
import { KEYS, type KeyValueStore } from './storage';

export interface StatsSnapshot {
  readonly solved: number;
  readonly answered: number;
  readonly currentStreak: number;
  readonly longestStreak: number;
}

export const EMPTY_STATS: StatsSnapshot = {
  solved: 0,
  answered: 0,
  currentStreak: 0,
  longestStreak: 0,
};

/**
 * iOS starts the current streak at zero on every cold launch. On the web a reload is not a
 * new session, so the running streak is kept.
 */
export const PERSIST_CURRENT_STREAK = true;

/**
 * The four numbers on the Stats page. Port of `StatsStore.swift`: incremented once per
 * submit, never derived, because nothing else can rebuild them.
 */
export class StatsStore {
  private value: StatsSnapshot;

  constructor(private readonly store: KeyValueStore) {
    this.value = read(store.get(KEYS.stats));
  }

  get snapshot(): StatsSnapshot {
    return this.value;
  }

  /** Gold and green both count as solved; red ends the streak. */
  record(accuracy: Accuracy): void {
    const v = this.value;
    const solved = accuracy !== 'off';
    const currentStreak = solved ? v.currentStreak + 1 : 0;
    this.value = {
      answered: v.answered + 1,
      solved: v.solved + (solved ? 1 : 0),
      currentStreak,
      longestStreak: Math.max(v.longestStreak, currentStreak),
    };
    this.store.set(
      KEYS.stats,
      JSON.stringify({
        solved: this.value.solved,
        answered: this.value.answered,
        current: PERSIST_CURRENT_STREAK ? this.value.currentStreak : 0,
        longest: this.value.longestStreak,
      }),
    );
  }

  reset(): void {
    this.value = EMPTY_STATS;
    this.store.remove(KEYS.stats);
  }
}

function read(text: string | null): StatsSnapshot {
  if (!text) return EMPTY_STATS;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
    const current = PERSIST_CURRENT_STREAK ? n(o.current) : 0;
    return {
      solved: n(o.solved),
      answered: n(o.answered),
      currentStreak: current,
      longestStreak: Math.max(n(o.longest), current),
    };
  } catch {
    return EMPTY_STATS;
  }
}
