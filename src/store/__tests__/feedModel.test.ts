import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '../../core/accuracy';
import { pawns } from '../../core/eval';
import { PositionSource } from '../../core/positions';
import { KEYS, memoryStore } from '../storage';
import { launch, makeDataset, play, sourceOf } from './fixtures';

describe('feed model (FeedModelTests port)', () => {
  it('opens a fresh install on a live page, the only page', () => {
    const model = launch(memoryStore(), sourceOf(105));
    const s = model.getState();
    expect(s.historyCount).toBe(0);
    expect(s.visible).toBe(0);
    expect(model.lastPage).toBe(0);
    expect(model.page(0)?.submittedGuess).toBeNull();
    expect(model.page(1)).toBeNull();
  });

  it('deals a different position on different launches', () => {
    const source = sourceOf(105);
    const starts = new Set(
      Array.from(
        { length: 20 },
        (_, seed) => launch(memoryStore(), source, seed).getState().livePositionIndex,
      ),
    );
    expect(starts.size).toBeGreaterThan(1);
  });

  it('never restores where the user was looking', () => {
    const store = memoryStore();
    const source = sourceOf(105);
    launch(store, source, 1).submit();
    const second = launch(store, source, 1);
    expect(second.getState().visible).toBe(second.lastPage);
  });

  it('freezes the answered page and opens the next below it', () => {
    const model = launch(memoryStore(), sourceOf(105), 7);
    const before = model.page(0)?.position.index;
    model.setLiveGuessWhiteFraction(0.7);
    const guess = model.getState().liveGuess;
    expect(guess).not.toEqual(pawns(0));
    const accuracy = model.submit();
    const s = model.getState();
    expect(s.historyCount).toBe(1);
    expect(s.visible).toBe(0);
    const answered = model.page(0);
    expect(answered?.submittedGuess).toEqual(guess);
    expect(answered?.position.index).toBe(before);
    expect(answered?.accuracy).toBe(accuracy);
    const live = model.page(1);
    expect(live?.submittedGuess).toBeNull();
    expect(live?.position.index).not.toBe(before);
    expect(s.liveGuess).toEqual(pawns(0));
  });

  it('does not serve an answered position again in a session or across reloads', () => {
    const served = play(launch(memoryStore(), sourceOf(105), 11), 40);
    expect(new Set(served).size).toBe(40);

    const store = memoryStore();
    const source = sourceOf(105);
    const seen = new Set<number>();
    for (let i = 0; i < 15; i++) {
      const model = launch(store, source, 1000 + i);
      const index = model.getState().livePositionIndex ?? -1;
      expect(seen.has(index)).toBe(false);
      seen.add(index);
      model.submit();
    }
  });

  it('keeps history browsable and frozen after a reload', () => {
    const store = memoryStore();
    const source = sourceOf(105);
    const first = launch(store, source, 3);
    first.setLiveGuessWhiteFraction(0.75);
    const guess = first.getState().liveGuess;
    const answeredIndex = first.page(0)?.position.index;
    first.submit();

    const second = launch(store, source, 99);
    expect(second.getState().historyCount).toBe(1);
    expect(second.getState().visible).toBe(1);
    const history = second.page(0);
    expect(history?.position.index).toBe(answeredIndex);
    expect(history?.submittedGuess).toEqual(guess);
  });

  it('keeps the live page last, and show() clamps', () => {
    const model = launch(memoryStore(), sourceOf(105), 5);
    for (let i = 0; i < 5; i++) {
      expect(model.lastPage).toBe(model.getState().historyCount);
      expect(model.page(model.lastPage + 1)).toBeNull();
      model.submit();
    }
    model.show(99);
    expect(model.getState().visible).toBe(model.lastPage);
    model.show(-5);
    expect(model.getState().visible).toBe(0);
  });

  it('never serves the same position on consecutive pages across reshuffles', () => {
    const source = sourceOf(12);
    for (let seed = 0; seed < 30; seed++) {
      const served = play(launch(memoryStore(), source, seed * 31 + 7), 36);
      for (let i = 1; i < served.length; i++)
        expect(served[i], `seed ${seed}`).not.toBe(served[i - 1]);
    }
  });

  it('reshuffles when the file is exhausted and carries on', () => {
    const model = launch(memoryStore(), sourceOf(3), 42);
    const served = play(model, 9);
    expect(new Set(served.slice(0, 3)).size).toBe(3);
    expect(new Set(served.slice(3, 6)).size).toBe(3);
    expect(new Set(served.slice(6, 9)).size).toBe(3);
    expect(model.getState().historyCount).toBe(9);
  });

  it('degrades quietly with no positions, or none that decode', () => {
    for (const source of [
      sourceOf(0),
      new PositionSource({ schema: 1, dataset: 'bad', games: [{}], positions: [[0], 'x'] }),
    ]) {
      const model = launch(memoryStore(), source, 1);
      expect(model.page(0)).toBeNull();
      expect(model.showsEmptyState).toBe(true);
      expect(model.submit()).toBeNull();
      expect(model.getState().historyCount).toBe(0);
    }
  });

  it('skips an undecodable row and keeps advancing on every seed', () => {
    const data = makeDataset(5);
    const positions = [...data.positions];
    positions[2] = [0, 42, 'bad'];
    const source = new PositionSource({ ...data, positions });
    for (let seed = 0; seed < 12; seed++) {
      const model = launch(memoryStore(), source, seed);
      for (let step = 0; step < 8; step++) {
        const page = model.page(model.lastPage);
        expect(page, `seed ${seed} step ${step}`).not.toBeNull();
        expect(page?.position.index).not.toBe(2);
        const before = model.getState().historyCount;
        model.submit();
        expect(model.getState().historyCount).toBe(before + 1);
      }
    }
  });

  it('quantises and clamps guesses from the bar, the box and nudges', () => {
    const model = launch(memoryStore(), sourceOf(10), 2);
    model.setLiveGuessWhiteFraction(1);
    expect(model.getState().liveGuess).toEqual(pawns(8));
    model.setLiveGuessWhiteFraction(0);
    expect(model.getState().liveGuess).toEqual(pawns(-8));
    model.setLiveGuessWhiteFraction(0.5);
    expect(model.getState().liveGuess).toEqual(pawns(0));
    model.nudgeLiveGuess(0.1);
    expect(model.getState().liveGuess).toEqual(pawns(0.1));
    model.nudgeLiveGuess(99);
    expect(model.getState().liveGuess).toEqual(pawns(8));
    model.setLiveGuessEval(pawns(-1.304));
    expect(model.getState().liveGuess).toEqual(pawns(-1.3));
  });

  it('scores the submitted guess, updates stats, and buzzes on gold only', () => {
    const source = new PositionSource(makeDataset(20, 'test', () => 0.5));
    const buzz = vi.fn();
    const model = launch(memoryStore(), source, 4, buzz);
    model.setLiveGuessEval(pawns(0.52));
    expect(model.submit()).toBe('exact');
    model.setLiveGuessEval(pawns(-0.5));
    expect(model.submit()).toBe('off');
    expect(buzz).toHaveBeenCalledTimes(1);
    expect(model.getState().stats).toEqual({
      solved: 1,
      answered: 2,
      currentStreak: 0,
      longestStreak: 1,
    });
    expect(model.page(0)?.accuracy).toBe(evaluate(pawns(0.52), pawns(0.5)));
  });

  it('notifies subscribers and keeps state objects stable between changes', () => {
    const model = launch(memoryStore(), sourceOf(10), 2);
    const listener = vi.fn();
    const unsubscribe = model.subscribe(listener);
    const before = model.getState();
    expect(model.getState()).toBe(before);
    model.setLiveGuessEval(pawns(0));
    expect(listener).not.toHaveBeenCalled();
    model.setLiveGuessEval(pawns(1));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    model.submit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('starts over on a new dataset without losing stats', () => {
    const store = memoryStore();
    launch(store, sourceOf(10, 'a'), 1).submit();
    const next = launch(store, sourceOf(10, 'b'), 1);
    expect(next.getState().historyCount).toBe(0);
    expect(next.getState().stats.answered).toBe(1);
    expect(store.get(KEYS.dataset)).toBe('b');
  });
});
