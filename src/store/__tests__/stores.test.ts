import { describe, expect, it } from 'vitest';
import { AnsweredSet } from '../answeredSet';
import { AnswerStore, HISTORY_CAP } from '../answerStore';
import { EMPTY_STATS, StatsStore } from '../statsStore';
import { clearAll, KEYS, memoryStore } from '../storage';

describe('answered set', () => {
  it('inserts, contains and round-trips through base64', () => {
    const set = new AnsweredSet();
    for (const i of [0, 7, 8, 24999]) set.insert(i);
    const back = AnsweredSet.fromBase64(set.toBase64());
    for (const i of [0, 7, 8, 24999]) expect(back.contains(i)).toBe(true);
    for (const i of [1, 9, 24998, 25000, -1]) expect(back.contains(i)).toBe(false);
    expect(AnsweredSet.fromBase64('%%%').contains(0)).toBe(false);
  });

  it('knows when a round is complete', () => {
    for (const count of [1, 7, 8, 9, 20]) {
      const set = new AnsweredSet();
      for (let i = 0; i < count - 1; i++) set.insert(i);
      expect(set.isComplete(count)).toBe(false);
      set.insert(count - 1);
      expect(set.isComplete(count)).toBe(true);
    }
    expect(new AnsweredSet().isComplete(0)).toBe(false);
  });

  it('truncates indices that no longer exist', () => {
    const set = new AnsweredSet();
    for (const i of [2, 9, 10, 30]) set.insert(i);
    set.truncate(10);
    expect(set.contains(2)).toBe(true);
    expect(set.contains(9)).toBe(true);
    expect(set.contains(10)).toBe(false);
    expect(set.contains(30)).toBe(false);
  });
});

describe('stats store (StatsStoreTests port)', () => {
  it('starts at zero', () => {
    expect(new StatsStore(memoryStore()).snapshot).toEqual(EMPTY_STATS);
  });

  it('counts gold and green as solved and red as answered only', () => {
    for (const acc of ['exact', 'close'] as const) {
      const s = new StatsStore(memoryStore());
      s.record(acc);
      expect(s.snapshot).toEqual({ solved: 1, answered: 1, currentStreak: 1, longestStreak: 1 });
    }
    const s = new StatsStore(memoryStore());
    s.record('off');
    expect(s.snapshot).toEqual({ solved: 0, answered: 1, currentStreak: 0, longestStreak: 0 });
  });

  it('keeps the longest streak as the running maximum', () => {
    const s = new StatsStore(memoryStore());
    for (const run of [2, 5, 1]) {
      for (let i = 0; i < run; i++) s.record('exact');
      s.record('off');
    }
    expect(s.snapshot).toEqual({ solved: 8, answered: 11, currentStreak: 0, longestStreak: 5 });
  });

  it('persists all four numbers, the current streak included (a web departure from iOS)', () => {
    const store = memoryStore();
    const first = new StatsStore(store);
    for (let i = 0; i < 4; i++) first.record('close');
    first.record('off');
    first.record('close');
    const second = new StatsStore(store);
    expect(second.snapshot).toEqual({ solved: 5, answered: 6, currentStreak: 1, longestStreak: 4 });
  });

  it('resets and tolerates garbage', () => {
    const store = memoryStore({ [KEYS.stats]: '{not json' });
    expect(new StatsStore(store).snapshot).toEqual(EMPTY_STATS);
    const s = new StatsStore(store);
    s.record('exact');
    s.reset();
    expect(new StatsStore(store).snapshot).toEqual(EMPTY_STATS);
  });
});

describe('answer store', () => {
  it('appends synchronously and survives a reload', () => {
    const store = memoryStore();
    const a = new AnswerStore(store, 'd1', 100);
    a.append({ p: 5, g: 1.3, t: 1 });
    a.append({ p: 9, g: -0.4, t: 2 });
    const b = new AnswerStore(store, 'd1', 100);
    expect(b.history).toEqual([
      { p: 5, g: 1.3, t: 1 },
      { p: 9, g: -0.4, t: 2 },
    ]);
    expect(b.answered.contains(5) && b.answered.contains(9)).toBe(true);
  });

  it('drops history and the bitmap on a new dataset but keeps stats', () => {
    const store = memoryStore();
    new AnswerStore(store, 'd1', 100).append({ p: 5, g: 1, t: 1 });
    new StatsStore(store).record('exact');
    const b = new AnswerStore(store, 'd2', 100);
    expect(b.history).toEqual([]);
    expect(b.answered.contains(5)).toBe(false);
    expect(new StatsStore(store).snapshot.answered).toBe(1);
    expect(store.get(KEYS.dataset)).toBe('d2');
  });

  it('caps stored history at the newest 1,000 and drops rows beyond the dataset', () => {
    const store = memoryStore();
    const a = new AnswerStore(store, 'd1', 5000);
    for (let i = 0; i < HISTORY_CAP + 50; i++) a.append({ p: i, g: 0, t: i });
    expect(a.history).toHaveLength(HISTORY_CAP + 50);
    const stored = JSON.parse(store.get(KEYS.history) ?? '[]') as { p: number }[];
    expect(stored).toHaveLength(HISTORY_CAP);
    expect(stored[0].p).toBe(50);
    const shrunk = new AnswerStore(store, 'd1', 100);
    expect(shrunk.history.every((row) => row.p < 100)).toBe(true);
    expect(shrunk.answered.contains(150)).toBe(false);
  });

  it('writes nothing outside the four keys, and ?reset clears them', () => {
    const store = memoryStore();
    const a = new AnswerStore(store, 'd1', 10);
    a.append({ p: 1, g: 0, t: 0 });
    new StatsStore(store).record('off');
    expect([...store.entries.keys()].sort()).toEqual(
      [KEYS.answered, KEYS.dataset, KEYS.history, KEYS.stats].sort(),
    );
    clearAll(store);
    expect(store.entries.size).toBe(0);
  });
});
