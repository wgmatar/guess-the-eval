import { evaluate, type Accuracy } from '../core/accuracy';
import { quantizedEvalForWhiteFraction } from '../core/barMapping';
import { clampedPawns, evalEquals, pawns, quantizedPawns, ZERO, type Eval } from '../core/eval';
import type { Position, PositionSource } from '../core/positions';
import { pickIndex, type Random } from '../core/sequencer';
import type { AnswerStore } from './answerStore';
import type { StatsSnapshot, StatsStore } from './statsStore';

/** One page of the feed. A page with a guess is frozen in its result state for good. */
export interface PageState {
  readonly pageIndex: number;
  readonly position: Position;
  readonly submittedGuess: Eval | null;
  readonly accuracy: Accuracy | null;
}

export interface FeedState {
  /** Answered pages above the live one. */
  readonly historyCount: number;
  /** Page on screen. */
  readonly visible: number;
  /** The live page's guess. Each new position starts at 0.00. */
  readonly liveGuess: Eval;
  readonly livePositionIndex: number | null;
  readonly stats: StatsSnapshot;
}

/**
 * The feed's state machine. Port of `FeedModel.swift`, exposed to React through
 * `subscribe` / `getState` (`useSyncExternalStore`).
 *
 * Pages `0..historyCount-1` are answered and frozen; page `historyCount` is live and always
 * last. There is nothing below it, which is how "no skipping" is enforced: by construction.
 * Only what has been answered is persisted, never where the user was looking.
 */
export class FeedModel {
  private state: FeedState;
  private readonly listeners = new Set<() => void>();
  private readonly pageCache = new Map<number, PageState>();

  constructor(
    private readonly source: PositionSource,
    private readonly answers: AnswerStore,
    private readonly stats: StatsStore,
    private readonly random: Random,
    private readonly onExact?: () => void,
  ) {
    const historyCount = answers.history.length;
    this.state = {
      historyCount,
      visible: historyCount,
      liveGuess: ZERO,
      livePositionIndex: null,
      stats: stats.snapshot,
    };
    this.state = { ...this.state, livePositionIndex: this.nextLive(null) };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): FeedState => this.state;

  private update(patch: Partial<FeedState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get isEmpty(): boolean {
    return this.source.count === 0;
  }

  get lastPage(): number {
    return this.state.historyCount;
  }

  /** Nothing can be shown at all: no positions, or none that decode. */
  get showsEmptyState(): boolean {
    return this.state.livePositionIndex === null && this.state.historyCount === 0;
  }

  page(index: number): PageState | null {
    const cached = this.pageCache.get(index);
    if (cached) return cached;
    const built = this.buildPage(index);
    if (built) this.pageCache.set(index, built);
    return built;
  }

  private buildPage(index: number): PageState | null {
    const { historyCount, livePositionIndex } = this.state;
    if (!Number.isInteger(index) || index < 0 || index > historyCount) return null;
    if (index === historyCount) {
      if (livePositionIndex === null) return null;
      const position = this.source.position(livePositionIndex);
      return position ? { pageIndex: index, position, submittedGuess: null, accuracy: null } : null;
    }
    const answer = this.answers.history[index];
    const position = answer ? this.source.position(answer.p) : null;
    if (!answer || !position) return null;
    const guess = pawns(answer.g);
    return {
      pageIndex: index,
      position,
      submittedGuess: guess,
      accuracy: evaluate(guess, position.eval),
    };
  }

  // Guessing

  /** From the bar: White's share of it, 0 to 1. The UI turns a pointer position into this. */
  setLiveGuessWhiteFraction(fraction: number): void {
    this.setLiveGuess(quantizedEvalForWhiteFraction(fraction));
  }

  setLiveGuessEval(value: Eval): void {
    this.setLiveGuess(quantizedPawns(clampedPawns(value)));
  }

  nudgeLiveGuess(delta: number): void {
    this.setLiveGuess(quantizedPawns(clampedPawns(this.state.liveGuess) + delta));
  }

  private setLiveGuess(value: Eval): void {
    if (!evalEquals(value, this.state.liveGuess)) this.update({ liveGuess: value });
  }

  /**
   * Freezes the live page into its result and opens the next page below it. The visible page
   * does not change: the user stays on the answer until they move on.
   */
  submit(): Accuracy | null {
    const { historyCount, livePositionIndex: live, liveGuess } = this.state;
    if (live === null) return null;
    const page = this.page(historyCount);
    if (!page) return null;
    this.answers.append({ p: live, g: clampedPawns(liveGuess), t: Date.now() });
    const accuracy = evaluate(liveGuess, page.position.eval);
    this.stats.record(accuracy);
    this.pageCache.delete(historyCount);
    this.update({
      historyCount: historyCount + 1,
      liveGuess: ZERO,
      livePositionIndex: this.nextLive(live),
      stats: this.stats.snapshot,
    });
    if (accuracy === 'exact') this.onExact?.();
    return accuracy;
  }

  // Navigation

  show(pageIndex: number): void {
    const visible = Math.min(Math.max(Math.round(pageIndex), 0), this.lastPage);
    if (visible !== this.state.visible) this.update({ visible });
  }

  /**
   * A random position not yet answered, never the one just answered. Once every position is
   * answered the record clears and a new round begins, so the feed never ends. A row that
   * does not decode is marked answered so the round can still complete.
   */
  private nextLive(avoid: number | null): number | null {
    const count = this.source.count;
    if (count === 0) return null;
    const answered = this.answers.answered;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (answered.isComplete(count)) this.answers.clearAnswered();
      const avoiding = attempt < 2 ? avoid : null;
      const pick = pickIndex(
        count,
        (i) => {
          if (answered.contains(i) || (count > 1 && i === avoiding)) return false;
          if (this.source.position(i) !== null) return true;
          answered.insert(i);
          return false;
        },
        this.random,
      );
      if (pick !== null) return pick;
    }
    return null;
  }
}
